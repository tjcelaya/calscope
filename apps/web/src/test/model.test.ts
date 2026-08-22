import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { DstPolicy } from '@calscope/views'
import { ValueType, safeParseEntry, type Entry, type Track } from '../core'
import { LAT, LNG, TIME_ZONE, demoTracks, generateEntries, simulatedNow } from '../fake-data'
import { MarkKind, buildModel, type ModelRange } from '../model'

const TZ = 'America/New_York'

const range = (start: string, days: number): ModelRange => ({
  start: Temporal.PlainDate.from(start),
  days,
  tz: TZ,
  lat: LAT,
  lng: LNG,
})

const at = (iso: string) =>
  Temporal.PlainDateTime.from(iso).toZonedDateTime(TZ)

const tracks: Track[] = [
  { id: 'work', name: 'Work', valueType: ValueType.Interval, tags: [], color: '#3fa7a0' },
  { id: 'meeting', name: 'Meeting', valueType: ValueType.Interval, tags: [], color: '#8faa4b' },
  { id: 'coffee', name: 'Coffee', valueType: ValueType.Binary, tags: [], color: '#d98b45' },
]

describe('entry timestamps', () => {
  it('every demo entry satisfies the core Entry schema, including ZonedIsoSchema starts', () => {
    const entries = generateEntries(Temporal.PlainDate.from('2026-10-29'), 7)
    for (const e of entries) {
      const result = safeParseEntry(e)
      expect(result.success, `entry ${e.id}: ${e.start}`).toBe(true)
    }
  })

  it("the capture panel's Temporal.Now.zonedDateTimeISO(tz).toString() form validates", () => {
    // Exactly the write shape CapturePanel produces: ISO with offset AND bracketed zone.
    const start = Temporal.Now.zonedDateTimeISO(TZ).toString()
    expect(start).toMatch(/[+-]\d{2}:\d{2}\[America\/New_York\]$/)
    expect(safeParseEntry({ id: 'x', trackId: 't', start }).success).toBe(true)
  })
})

describe('buildModel over core entries', () => {
  const now = at('2026-06-10T14:30:00')

  it('an end-less entry is Ongoing on an Interval track and an Instant elsewhere', () => {
    const entries: Entry[] = [
      { id: 'a', trackId: 'work', start: at('2026-06-10T09:00:00').toString() },
      { id: 'b', trackId: 'coffee', start: at('2026-06-10T07:30:00').toString() },
    ]
    const m = buildModel(entries, tracks, range('2026-06-08', 3), DstPolicy.AtTransition, now)
    const kinds = new Map(m.marks.map((mk) => [mk.entryId, mk.kind]))
    expect(kinds.get('a')).toBe(MarkKind.Ongoing)
    expect(kinds.get('b')).toBe(MarkKind.Instant)
  })

  it('a gap-fill track entry renders as an interval from the previous end to its moment', () => {
    const sleep: Track = {
      id: 'sleep',
      name: 'Sleep',
      valueType: ValueType.Binary,
      tags: [],
      color: '#6c7bff',
      fillsGapBefore: true,
    }
    const entries: Entry[] = [
      {
        id: 'read',
        trackId: 'work',
        start: at('2026-06-09T22:00:00').toString(),
        end: at('2026-06-09T23:00:00').toString(),
      },
      { id: 'wake', trackId: 'sleep', start: at('2026-06-10T07:00:00').toString() },
    ]
    const m = buildModel(entries, [...tracks, sleep], range('2026-06-08', 3), DstPolicy.AtTransition, now)
    const wake = m.marks.find((mk) => mk.entryId === 'wake')!
    expect(wake.kind).toBe(MarkKind.Interval)
    // Day index 1 (June 9) 23:00 -> day index 2 (June 10) 07:00 in grid slots.
    expect(wake.startSlot).toBe(24 + 23)
    expect(wake.endSlot).toBe(48 + 7)
  })

  it("an ongoing mark ends exactly at `now`'s grid slot; advancing now moves only it", () => {
    const entries: Entry[] = [
      { id: 'a', trackId: 'work', start: at('2026-06-10T09:00:00').toString() },
      {
        id: 'closed',
        trackId: 'meeting',
        start: at('2026-06-10T10:00:00').toString(),
        end: at('2026-06-10T11:00:00').toString(),
      },
    ]
    const build = (n: Temporal.ZonedDateTime) =>
      buildModel(entries, tracks, range('2026-06-08', 3), DstPolicy.AtTransition, n)
    const m1 = build(now)
    const ongoing = m1.marks.find((mk) => mk.entryId === 'a')!
    expect(ongoing.endSlot).toBeCloseTo(2 * 24 + 14.5, 10)

    const m2 = build(now.add({ minutes: 30 }))
    expect(m2.marks.find((mk) => mk.entryId === 'a')!.endSlot).toBeCloseTo(2 * 24 + 15, 10)
    // Nothing else moved: the closed interval's slots are identical under both nows.
    const closed1 = m1.marks.find((mk) => mk.entryId === 'closed')!
    const closed2 = m2.marks.find((mk) => mk.entryId === 'closed')!
    expect([closed2.startSlot, closed2.endSlot]).toEqual([closed1.startSlot, closed1.endSlot])
  })

  it('containment depth uses strictly-longer containers; instants stay ticks', () => {
    const entries: Entry[] = [
      {
        id: 'work',
        trackId: 'work',
        start: at('2026-06-09T09:00:00').toString(),
        end: at('2026-06-09T17:00:00').toString(),
      },
      {
        id: 'meeting',
        trackId: 'meeting',
        start: at('2026-06-09T10:00:00').toString(),
        end: at('2026-06-09T11:30:00').toString(),
      },
      { id: 'coffee', trackId: 'coffee', start: at('2026-06-09T10:45:00').toString() },
    ]
    const m = buildModel(entries, tracks, range('2026-06-08', 3), DstPolicy.AtTransition, now)
    const byId = new Map(m.marks.map((mk) => [mk.entryId, mk]))
    expect(byId.get('work')!.depth).toBe(0)
    expect(byId.get('meeting')!.depth).toBe(1)
    expect(byId.get('coffee')!.kind).toBe(MarkKind.Instant)
    expect(m.days[1]!.ticks.map((t) => t.entryId)).toEqual(['coffee'])
  })

  it('an interval crossing midnight splits into one segment per day', () => {
    const entries: Entry[] = [
      {
        id: 'sleep',
        trackId: 'work',
        start: at('2026-06-08T23:00:00').toString(),
        end: at('2026-06-09T07:00:00').toString(),
      },
    ]
    const m = buildModel(entries, tracks, range('2026-06-08', 3), DstPolicy.AtTransition, now)
    const seg0 = m.days[0]!.segments.filter((s) => s.mark.entryId === 'sleep')
    const seg1 = m.days[1]!.segments.filter((s) => s.mark.entryId === 'sleep')
    expect(seg0.map((s) => [s.from, s.to])).toEqual([[23, 24]])
    expect(seg1.map((s) => [s.from, s.to])).toEqual([[0, 7]])
  })

  it('an interval that started before the range keeps its in-range part', () => {
    const entries: Entry[] = [
      {
        id: 'long',
        trackId: 'work',
        start: at('2026-06-07T20:00:00').toString(),
        end: at('2026-06-08T04:00:00').toString(),
      },
    ]
    const m = buildModel(entries, tracks, range('2026-06-08', 3), DstPolicy.AtTransition, now)
    const mark = m.marks.find((mk) => mk.entryId === 'long')!
    expect(mark.startSlot).toBeLessThan(0)
    expect(m.days[0]!.segments.map((s) => [s.from, s.to])).toEqual([[0, 4]])
  })

  it('entries recorded in another zone project into the display zone', () => {
    const entries: Entry[] = [
      {
        id: 'la',
        trackId: 'coffee',
        // 07:30 in Los Angeles is 10:30 in New York.
        start: Temporal.PlainDateTime.from('2026-06-09T07:30:00')
          .toZonedDateTime('America/Los_Angeles')
          .toString(),
      },
    ]
    const m = buildModel(entries, tracks, range('2026-06-08', 3), DstPolicy.AtTransition, now)
    expect(m.marks.find((mk) => mk.entryId === 'la')!.startSlot).toBeCloseTo(24 + 10.5, 10)
  })

  it('the two 1:30ams of a fall-back night stay distinct entries on the same slot', () => {
    // Same wall clock, different offsets -- distinct instants (invariant 7). Both land
    // on slot 1.5: the repeat is drawn as the spur, never as a second lap of geometry.
    const first = '2026-11-01T01:30:00-04:00[America/New_York]'
    const second = '2026-11-01T01:30:00-05:00[America/New_York]'
    expect(Temporal.ZonedDateTime.from(first).epochMilliseconds).not.toBe(
      Temporal.ZonedDateTime.from(second).epochMilliseconds,
    )
    const entries: Entry[] = [
      { id: 'e1', trackId: 'coffee', start: first },
      { id: 'e2', trackId: 'coffee', start: second },
    ]
    const m = buildModel(
      entries,
      tracks,
      range('2026-10-31', 2),
      DstPolicy.AtTransition,
      at('2026-11-01T12:00:00'),
    )
    const slots = m.marks.map((mk) => mk.startSlot)
    expect(slots).toEqual([24 + 1.5, 24 + 1.5])
    expect(m.marks).toHaveLength(2)
  })

  it('demo generation is deterministic and its ongoing work entry reaches simulated now', () => {
    const start = Temporal.PlainDate.from('2026-06-08')
    expect(generateEntries(start, 7)).toEqual(generateEntries(start, 7))

    const m = buildModel(
      generateEntries(start, 7),
      demoTracks,
      { start, days: 7, tz: TIME_ZONE, lat: LAT, lng: LNG },
      DstPolicy.AtTransition,
      simulatedNow(start, 7),
    )
    const ongoing = m.marks.filter((mk) => mk.kind === MarkKind.Ongoing)
    expect(ongoing).toHaveLength(1)
    expect(ongoing[0]!.endSlot).toBeCloseTo(6 * 24 + 14.5, 10)
    expect(m.nowDay).toBe(6)
  })
})
