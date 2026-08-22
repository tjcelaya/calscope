import { describe, expect, it } from 'vitest'
import {
  FullResyncRequired,
  classify,
  type GcalCalendarListEntry,
  type GcalClient,
  type GcalEvent,
  type PullOptions,
} from '@calscope/gcal'
import { HlcClock, OpType, ValueType, fold, type Entry, type Track } from '../../core'
import type { OpStamp } from '../../persist'
import {
  ClusterTarget,
  buildImportOps,
  clusterKeyFor,
  defaultDecision,
  newTrackId,
  type ClusterDecision,
  type ImportPlanInput,
} from '../import-plan'
import { applyPullOutcome, mergeEvents, pullCalendar } from '../pull'

// Deterministic stamps so op payloads (the part LWW compares) are the only variable.
function stamp(): OpStamp {
  return { clock: new HlcClock('test-actor'), actor: 'test-actor' }
}

const calendar: GcalCalendarListEntry = {
  id: 'primary',
  summary: 'TJ',
  timeZone: 'America/Los_Angeles',
  primary: true,
}

/** Zero-duration, oldest-era marker: should land as a Binary track and an instant entry. */
const evCoffee: GcalEvent = {
  id: 'ev-coffee',
  status: 'confirmed',
  summary: '[S] Coffee',
  start: { dateTime: '2026-01-06T08:00:00-08:00' },
  end: { dateTime: '2026-01-06T08:00:00-08:00' },
  updated: '2026-01-06T16:11:00.000Z',
}

const evRead: GcalEvent = {
  id: 'ev-read',
  status: 'confirmed',
  summary: '. Read',
  start: { dateTime: '2026-01-05T09:00:00-05:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-01-05T09:45:00-05:00', timeZone: 'America/New_York' },
}

/** No marker, no corroborator -- a real appointment, defaulting to Skip. */
const evDentist: GcalEvent = {
  id: 'ev-dentist',
  status: 'confirmed',
  summary: 'Dentist',
  start: { dateTime: '2026-01-07T10:00:00-08:00' },
  end: { dateTime: '2026-01-07T11:00:00-08:00' },
}

const evCancelled: GcalEvent = { id: 'ev-gone', status: 'cancelled' }

const events = [evCoffee, evRead, evDentist, evCancelled]

function planInput(overrides: Partial<ImportPlanInput> = {}): ImportPlanInput {
  const clusters = classify(events).clusters
  const decisions: Record<string, ClusterDecision> = {
    Coffee: { target: ClusterTarget.NewTrack, name: 'Coffee' },
    Read: { target: ClusterTarget.NewTrack, name: 'Read' },
    // Dentist deliberately absent: an undecided cluster must not import.
  }
  return {
    clusters,
    decisions,
    calendars: [calendar],
    eventsByCalendar: { [calendar.id]: events },
    tracks: [],
    existingEntryIds: new Set<string>(),
    stamp: stamp(),
    ...overrides,
  }
}

describe('clusterKeyFor', () => {
  it('mirrors the classifier: strips era prefixes and names the untitled cluster', () => {
    expect(clusterKeyFor(evCoffee)).toBe('Coffee')
    expect(clusterKeyFor(evRead)).toBe('Read')
    expect(clusterKeyFor({ id: 'x', start: { date: '2026-01-01' } })).toBe('(untitled)')
  })
})

describe('defaultDecision', () => {
  const clusters = classify(events).clusters
  const coffee = clusters.find((c) => c.title === 'Coffee')!
  const dentist = clusters.find((c) => c.title === 'Dentist')!

  it('prefers an existing track whose name matches the stripped title', () => {
    const track: Track = { id: 't1', name: 'Coffee', valueType: ValueType.Binary, tags: [], color: '#fff' }
    expect(defaultDecision(coffee, [track])).toEqual({ target: ClusterTarget.Existing, trackId: 't1' })
  })

  it('matches through legacyTitles, so a renamed track still claims its history', () => {
    const track: Track = {
      id: 't2',
      name: 'Morning coffee',
      valueType: ValueType.Binary,
      tags: [],
      color: '#fff',
      legacyTitles: ['[S] Coffee'],
    }
    expect(defaultDecision(coffee, [track])).toEqual({ target: ClusterTarget.Existing, trackId: 't2' })
  })

  it('era-marked clusters default to a new track; unmarked ones default to Skip', () => {
    expect(defaultDecision(coffee, [])).toEqual({ target: ClusterTarget.NewTrack, name: 'Coffee' })
    expect(defaultDecision(dentist, [])).toEqual({ target: ClusterTarget.Skip })
  })
})

describe('buildImportOps', () => {
  it('emits a deterministic-id track per new-track cluster, with legacy titles preserved', () => {
    const plan = buildImportOps(planInput())
    const trackOps = plan.ops.filter((op) => op.type === OpType.TrackUpsert)
    expect(trackOps).toHaveLength(2)
    const coffee = trackOps.map((op) => op.payload as Track).find((t) => t.name === 'Coffee')!
    expect(coffee.id).toBe(newTrackId('Coffee'))
    expect(coffee.legacyTitles).toEqual(['[S] Coffee'])
    expect(plan.trackCount).toBe(2)
  })

  it('a zero-duration cluster becomes a Binary track and its entry has no end', () => {
    const plan = buildImportOps(planInput())
    const coffeeTrack = plan.ops
      .filter((op) => op.type === OpType.TrackUpsert)
      .map((op) => op.payload as Track)
      .find((t) => t.name === 'Coffee')!
    expect(coffeeTrack.valueType).toBe(ValueType.Binary)

    const readTrack = plan.ops
      .filter((op) => op.type === OpType.TrackUpsert)
      .map((op) => op.payload as Track)
      .find((t) => t.name === 'Read')!
    expect(readTrack.valueType).toBe(ValueType.Interval)

    const coffeeEntry = plan.ops
      .filter((op) => op.type === OpType.EntryUpsert)
      .map((op) => op.payload as Entry)
      .find((e) => e.id === 'gcal:ev-coffee')!
    expect(coffeeEntry.end).toBeUndefined()
  })

  it('routes entries to decided tracks and imports nothing for undecided clusters', () => {
    const plan = buildImportOps(planInput())
    const entries = plan.ops
      .filter((op) => op.type === OpType.EntryUpsert)
      .map((op) => op.payload as Entry)
    expect(entries.map((e) => e.id).sort()).toEqual(['gcal:ev-coffee', 'gcal:ev-read'])
    expect(entries.find((e) => e.id === 'gcal:ev-read')!.trackId).toBe(newTrackId('Read'))
    expect(plan.skippedTitles).toContain('Dentist')
    expect(entries.some((e) => e.id === 'gcal:ev-dentist')).toBe(false)
  })

  it('is idempotent under the fold: importing twice converges to the same state', () => {
    const first = buildImportOps(planInput())
    const second = buildImportOps(planInput())
    const once = fold([...first.ops])
    const twice = fold([...first.ops, ...second.ops])
    expect(twice.entries).toEqual(once.entries)
    expect(twice.tracks).toEqual(once.tracks)
  })

  it('cancelled events delete only entries that exist locally', () => {
    const without = buildImportOps(planInput())
    expect(without.ops.filter((op) => op.type === OpType.EntryDelete)).toHaveLength(0)
    expect(without.deletionCount).toBe(0)

    const withExisting = buildImportOps(planInput({ existingEntryIds: new Set(['gcal:ev-gone']) }))
    const deletes = withExisting.ops.filter((op) => op.type === OpType.EntryDelete)
    expect(deletes).toHaveLength(1)
    expect(deletes[0]!.payload).toBe('gcal:ev-gone')
  })

  it('mapping onto an existing track merges legacy titles, writing only on change', () => {
    const track: Track = {
      id: 'mine',
      name: 'Coffee',
      valueType: ValueType.Binary,
      tags: [],
      color: '#fff',
      legacyTitles: ['[S] Coffee'],
    }
    const decisions: Record<string, ClusterDecision> = {
      Coffee: { target: ClusterTarget.Existing, trackId: 'mine' },
    }
    // Already knows every variant: no track op at all.
    const unchanged = buildImportOps(planInput({ tracks: [track], decisions }))
    expect(unchanged.ops.filter((op) => op.type === OpType.TrackUpsert)).toHaveLength(0)
    expect(
      unchanged.ops
        .filter((op) => op.type === OpType.EntryUpsert)
        .map((op) => op.payload as Entry)
        .find((e) => e.id === 'gcal:ev-coffee')!.trackId,
    ).toBe('mine')

    // Missing a variant: one upsert with the union.
    const stale: Track = { ...track, legacyTitles: [] }
    const merged = buildImportOps(planInput({ tracks: [stale], decisions }))
    const trackOps = merged.ops.filter((op) => op.type === OpType.TrackUpsert)
    expect(trackOps).toHaveLength(1)
    expect((trackOps[0]!.payload as Track).legacyTitles).toEqual(['[S] Coffee'])
  })

  it('a decision naming a track that no longer exists skips the cluster instead of importing onto a dangling id', () => {
    const decisions: Record<string, ClusterDecision> = {
      Coffee: { target: ClusterTarget.Existing, trackId: 'deleted-meanwhile' },
    }
    const plan = buildImportOps(planInput({ decisions }))
    expect(plan.skippedTitles).toContain('Coffee')
    expect(
      plan.ops
        .filter((op) => op.type === OpType.EntryUpsert)
        .map((op) => op.payload as Entry)
        .some((e) => e.id === 'gcal:ev-coffee'),
    ).toBe(false)
  })
})

describe('pullCalendar', () => {
  function fakeClient(
    respond: (calendarId: string, options: PullOptions) => { events: GcalEvent[]; nextSyncToken?: string },
  ): { client: GcalClient; calls: PullOptions[] } {
    const calls: PullOptions[] = []
    return {
      calls,
      client: {
        listCalendars: () => Promise.resolve([calendar]),
        pullEvents: (calendarId, options) => {
          calls.push(options)
          return Promise.resolve(respond(calendarId, options))
        },
      },
    }
  }

  const window = { timeMin: '2025-08-22T00:00:00Z', timeMax: '2026-08-29T00:00:00Z' }

  it('without a stored token it runs a windowed full pull', async () => {
    const { client, calls } = fakeClient(() => ({ events: [evRead], nextSyncToken: 'tok-1' }))
    const outcome = await pullCalendar(client, 'primary', window)
    expect(calls).toEqual([window])
    expect(outcome).toEqual({ calendarId: 'primary', events: [evRead], nextSyncToken: 'tok-1', resynced: false })
  })

  it('with a stored token it pulls incrementally', async () => {
    const { client, calls } = fakeClient(() => ({ events: [], nextSyncToken: 'tok-2' }))
    const outcome = await pullCalendar(client, 'primary', window, 'tok-1')
    expect(calls).toEqual([{ syncToken: 'tok-1' }])
    expect(outcome.resynced).toBe(false)
    expect(outcome.nextSyncToken).toBe('tok-2')
  })

  it('an expired token (410) falls back to a full windowed pull and reports the resync', async () => {
    const { client, calls } = fakeClient((calendarId, options) => {
      if ('syncToken' in options) throw new FullResyncRequired(calendarId)
      return { events: [evRead, evCoffee], nextSyncToken: 'tok-fresh' }
    })
    const outcome = await pullCalendar(client, 'primary', window, 'tok-dead')
    expect(calls).toEqual([{ syncToken: 'tok-dead' }, window])
    expect(outcome.resynced).toBe(true)
    expect(outcome.events).toHaveLength(2)
    expect(outcome.nextSyncToken).toBe('tok-fresh')
  })

  it('other errors from the incremental pull propagate untouched', async () => {
    const boom = new Error('HTTP 500')
    const { client } = fakeClient(() => {
      throw boom
    })
    await expect(pullCalendar(client, 'primary', window, 'tok-1')).rejects.toBe(boom)
  })
})

describe('mergeEvents', () => {
  it('replaces changed events in place and appends genuinely new ones', () => {
    const updatedRead: GcalEvent = { ...evRead, summary: '. Read more' }
    const merged = mergeEvents([evCoffee, evRead], [updatedRead, evDentist])
    expect(merged.map((e) => e.id)).toEqual(['ev-coffee', 'ev-read', 'ev-dentist'])
    expect(merged[1]!.summary).toBe('. Read more')
  })

  it('a cancelled stub from an incremental pull replaces the live event', () => {
    const cancelledRead: GcalEvent = { id: 'ev-read', status: 'cancelled' }
    const merged = mergeEvents([evRead], [cancelledRead])
    expect(merged).toEqual([cancelledRead])
  })
})

describe('applyPullOutcome', () => {
  it('merges an incremental pull into the accumulated events', () => {
    const next = applyPullOutcome([evCoffee], {
      calendarId: 'primary',
      events: [evRead],
      resynced: false,
    })
    expect(next.map((e) => e.id)).toEqual(['ev-coffee', 'ev-read'])
  })

  it('a resynced full pull REPLACES the accumulated set, dropping token-gap deletions', () => {
    // evCoffee was deleted from Google while the syncToken was expired: the full re-pull
    // carries no cancelled stub for it (the expired token lost exactly those stubs), so
    // merging would resurrect it as a live entry and it would import via buildImportOps.
    const next = applyPullOutcome([evCoffee, evRead], {
      calendarId: 'primary',
      events: [evRead, evDentist],
      resynced: true,
    })
    expect(next.map((e) => e.id)).toEqual(['ev-read', 'ev-dentist'])
  })
})
