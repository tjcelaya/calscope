import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { Temporal } from 'temporal-polyfill'
import { EntrySchema, ZonedIsoSchema } from '@calscope/core'
import { entryIdForEvent, mapEvents, ZoneResolutionError } from '../src/map.js'
import type { GcalEvent } from '../src/types.js'
import {
  evAllDay,
  evAllDayMultiDay,
  evAllDayNoEnd,
  evCancelled,
  evCrossZoneRendered,
  evFallBackFirst,
  evFallBackSecond,
  evMalformed,
  evRecur1,
  evRecur2,
  evSkippedHour,
  evSourceTagged,
  evTimedNoZone,
  evTimedWithZone,
  evUtcTimed,
  evWrongOffset,
  evZeroDuration,
  laCalendar,
  utcCalendar,
  zonelessCalendar,
} from './fixtures.js'

const happyEvents: GcalEvent[] = [
  evTimedWithZone,
  evCrossZoneRendered,
  evTimedNoZone,
  evAllDay,
  evAllDayNoEnd,
  evAllDayMultiDay,
  evZeroDuration,
  evRecur1,
  evRecur2,
  evSourceTagged,
  evFallBackFirst,
  evFallBackSecond,
  evCancelled,
]

function entryFor(id: string) {
  const result = mapEvents(happyEvents, laCalendar)
  const entry = result.entries.find((e) => e.gcalEventId === id)
  if (entry === undefined) throw new Error(`no entry mapped for ${id}`)
  return entry
}

describe('zone resolution', () => {
  it("uses the event's own timeZone when present, even when it differs from the calendar", () => {
    const entry = entryFor('ev-timed-tz')
    expect(entry.start).toBe('2026-01-05T09:00:00-05:00[America/New_York]')
    expect(entry.end).toBe('2026-01-05T09:45:00-05:00[America/New_York]')
  })

  it("falls back to the owning calendar's timeZone when the event has none", () => {
    const entry = entryFor('ev-timed-notz')
    expect(entry.start).toBe('2026-01-06T08:00:00-08:00[America/Los_Angeles]')
  })

  it('a different owning calendar yields a different zone for the same shape of event', () => {
    const { entries } = mapEvents([evUtcTimed], utcCalendar)
    expect(entries[0]?.start).toBe('2026-01-05T17:00:00+00:00[UTC]')
  })

  it("maps a foreign-zone event whose offset is rendered in the calendar's zone", () => {
    // The API renders dateTime offsets in the response zone (the calendar's by default),
    // so the offset legitimately disagrees with the event's own timeZone. The instant is
    // unambiguous: re-render it in the event's zone, do not reject.
    const { entries, rejects } = mapEvents([evCrossZoneRendered], laCalendar)
    expect(rejects).toEqual([])
    expect(entries[0]?.start).toBe('2026-01-05T15:00:00+01:00[Europe/Paris]')
    expect(entries[0]?.end).toBe('2026-01-05T15:30:00+01:00[Europe/Paris]')
  })

  it('still rejects a foreign-zone event whose offset is valid in NEITHER zone', () => {
    const bad: GcalEvent = {
      id: 'ev-cross-bad',
      status: 'confirmed',
      // -05:00 is never Paris and never LA: the offset is garbage, not a rendering.
      start: { dateTime: '2026-01-05T09:00:00-05:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-01-05T09:15:00-05:00', timeZone: 'Europe/Paris' },
    }
    const { entries, rejects } = mapEvents([bad], laCalendar)
    expect(entries).toEqual([])
    expect(rejects[0]?.reason).toContain('Europe/Paris')
  })

  it('hard-errors when neither event nor calendar carries a zone -- never the device zone', () => {
    const zoneless: GcalEvent = {
      id: 'ev-nozone',
      status: 'confirmed',
      start: { dateTime: '2026-01-05T09:00:00-08:00' },
      end: { dateTime: '2026-01-05T10:00:00-08:00' },
    }
    expect(() => mapEvents([zoneless], zonelessCalendar)).toThrow(ZoneResolutionError)
  })
})

describe('ZonedIsoSchema compliance', () => {
  it('every mapped start/end satisfies core ZonedIsoSchema and the whole Entry validates', () => {
    const { entries } = mapEvents(happyEvents, laCalendar)
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(v.is(ZonedIsoSchema, entry.start)).toBe(true)
      if (entry.end !== undefined) expect(v.is(ZonedIsoSchema, entry.end)).toBe(true)
      expect(v.safeParse(EntrySchema, entry).success).toBe(true)
    }
  })
})

describe('all-day events', () => {
  it("maps start.date to the calendar zone's midnight with end at the NEXT day's start", () => {
    const entry = entryFor('ev-allday')
    expect(entry.start).toBe('2026-01-07T00:00:00-08:00[America/Los_Angeles]')
    expect(entry.end).toBe('2026-01-08T00:00:00-08:00[America/Los_Angeles]')
  })

  it("synthesizes the next day's start when Google sends no end at all", () => {
    const entry = entryFor('ev-allday-noend')
    expect(entry.start).toBe('2026-02-14T00:00:00-08:00[America/Los_Angeles]')
    expect(entry.end).toBe('2026-02-15T00:00:00-08:00[America/Los_Angeles]')
  })

  it("multi-day all-day keeps Google's exclusive end.date", () => {
    const entry = entryFor('ev-allday-multi')
    expect(entry.start).toBe('2026-02-01T00:00:00-08:00[America/Los_Angeles]')
    expect(entry.end).toBe('2026-02-04T00:00:00-08:00[America/Los_Angeles]')
  })

  it('all-day on a UTC calendar lands at UTC midnight', () => {
    const { entries } = mapEvents(
      [{ id: 'utc-allday', status: 'confirmed', start: { date: '2026-01-07' }, end: { date: '2026-01-08' } }],
      utcCalendar,
    )
    expect(entries[0]?.start).toBe('2026-01-07T00:00:00+00:00[UTC]')
    expect(entries[0]?.end).toBe('2026-01-08T00:00:00+00:00[UTC]')
  })
})

describe('zero-duration events', () => {
  it('maps to an instant: start only, no end field', () => {
    const entry = entryFor('ev-zero')
    expect(entry.start).toBe('2026-01-08T14:30:00-08:00[America/Los_Angeles]')
    expect('end' in entry).toBe(false)
  })
})

describe('cancelled events', () => {
  it('surface as deletions with the deterministic entry id, never as entries', () => {
    const { entries, deletions } = mapEvents(happyEvents, laCalendar)
    expect(deletions).toEqual(['gcal:ev-cancelled'])
    expect(entries.some((e) => e.gcalEventId === 'ev-cancelled')).toBe(false)
  })
})

describe('rejected timestamps', () => {
  it('skips and REPORTS a wall time inside the DST-skipped hour -- never snaps it', () => {
    const { entries, rejects } = mapEvents([evSkippedHour], laCalendar)
    expect(entries).toEqual([])
    expect(rejects).toHaveLength(1)
    expect(rejects[0]?.eventId).toBe('ev-skipped')
    expect(rejects[0]?.raw).toBe('2026-03-08T02:30:00-08:00')
    expect(rejects[0]?.reason).toContain('America/Los_Angeles')
  })

  it('rejects an offset inconsistent with the resolved zone instead of reinterpreting it', () => {
    const { entries, rejects } = mapEvents([evWrongOffset], laCalendar)
    expect(entries).toEqual([])
    expect(rejects[0]?.raw).toBe('2026-01-05T09:00:00-05:00')
  })

  it('reports malformed timestamps with the raw value, and keeps mapping the rest', () => {
    const { entries, rejects } = mapEvents([evMalformed, evTimedNoZone], laCalendar)
    expect(rejects).toEqual([
      { eventId: 'ev-malformed', raw: 'not-a-timestamp', reason: expect.stringContaining('parse') },
    ])
    expect(entries.map((e) => e.gcalEventId)).toEqual(['ev-timed-notz'])
  })

  it('reports a non-cancelled event with no start at all', () => {
    const { rejects } = mapEvents([{ id: 'ev-empty', status: 'confirmed' }], laCalendar)
    expect(rejects[0]).toEqual({
      eventId: 'ev-empty',
      raw: '',
      reason: expect.stringContaining('no start'),
    })
  })
})

describe('fall-back night', () => {
  it('keeps the two 1:30ams as distinct instants, one hour apart', () => {
    const first = entryFor('ev-fb-1')
    const second = entryFor('ev-fb-2')
    const a = Temporal.ZonedDateTime.from(first.start)
    const b = Temporal.ZonedDateTime.from(second.start)
    expect(a.toPlainDateTime().equals(b.toPlainDateTime())).toBe(true)
    expect(b.epochMilliseconds - a.epochMilliseconds).toBe(3_600_000)
  })
})

describe('identity and provenance', () => {
  it("derives Entry.id deterministically as 'gcal:' + event id", () => {
    expect(entryIdForEvent('abc')).toBe('gcal:abc')
    const { entries } = mapEvents([evTimedWithZone], laCalendar)
    expect(entries[0]?.id).toBe('gcal:ev-timed-tz')
  })

  it('re-mapping the same input is idempotent: identical ids, deep-equal output', () => {
    const first = mapEvents(happyEvents, laCalendar)
    const second = mapEvents(happyEvents, laCalendar)
    expect(second).toEqual(first)
    expect(second.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id))
    // Deterministic ids are the dedupe contract: folding both runs upserts, no duplicates.
    expect(new Set(first.entries.map((e) => e.id)).size).toBe(first.entries.length)
  })

  it('recurring expanded instances map to distinct entries under one recurringEventId', () => {
    const { entries } = mapEvents([evRecur1, evRecur2], laCalendar)
    expect(entries.map((e) => e.id)).toEqual([
      'gcal:evrec_20260105T170000Z',
      'gcal:evrec_20260106T170000Z',
    ])
  })

  it('carries gcalEventId, gcalCalendarId and gcalUpdated', () => {
    const entry = entryFor('ev-timed-tz')
    expect(entry.gcalEventId).toBe('ev-timed-tz')
    expect(entry.gcalCalendarId).toBe('primary-la')
    expect(entry.gcalUpdated).toBe('2026-01-05T15:00:00.123Z')
  })

  it('omits gcalUpdated when Google sent none', () => {
    const entry = entryFor('ev-fb-1')
    expect('gcalUpdated' in entry).toBe(false)
  })
})

describe('track assignment', () => {
  it('defaults to one per-calendar import track', () => {
    expect(entryFor('ev-timed-tz').trackId).toBe('gcal:primary-la')
  })

  it('lets the caller assign tracks from the prefix-stripped title', () => {
    const { entries } = mapEvents([evTimedWithZone], laCalendar, {
      trackIdFor: (_event, strippedTitle) => `track:${strippedTitle}`,
    })
    expect(entries[0]?.trackId).toBe('track:Read')
  })
})
