import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import {
  GcalCalendarListEntrySchema,
  GcalCalendarListResponseSchema,
  GcalEventSchema,
  GcalEventStatus,
  GcalEventTimeSchema,
  GcalEventsPageSchema,
} from '../src/types.js'
import {
  calendarListPage1,
  calendarListPage2,
  eventsPage1,
  eventsPage2,
  eventsSyncPage,
  evCancelled,
  evTimedWithZone,
} from './fixtures.js'

describe('GcalEventStatus', () => {
  it('is an as-const object, not a TS enum, with a derived schema', () => {
    expect(Object.values(GcalEventStatus)).toEqual(['confirmed', 'tentative', 'cancelled'])
    expect(v.is(v.picklist(Object.values(GcalEventStatus)), 'cancelled')).toBe(true)
  })
})

describe('calendarList schemas', () => {
  it('parses realistic pages and strips fields we do not consume', () => {
    const page = v.parse(GcalCalendarListResponseSchema, calendarListPage1)
    expect(page.nextPageToken).toBe('cal-page-2')
    expect(page.items?.[0]).toEqual({
      id: 'primary-la',
      summary: 'TJ (personal)',
      timeZone: 'America/Los_Angeles',
      primary: true,
    })
    expect(v.parse(GcalCalendarListResponseSchema, calendarListPage2).nextPageToken).toBeUndefined()
  })

  it('requires id', () => {
    expect(v.safeParse(GcalCalendarListEntrySchema, { summary: 'no id' }).success).toBe(false)
  })
})

describe('event time union', () => {
  it('accepts all-day, timed-with-zone and timed-without-zone shapes', () => {
    expect(v.parse(GcalEventTimeSchema, { date: '2026-01-07' })).toEqual({ date: '2026-01-07' })
    expect(
      v.parse(GcalEventTimeSchema, { dateTime: '2026-01-05T09:00:00-05:00', timeZone: 'America/New_York' }),
    ).toEqual({ dateTime: '2026-01-05T09:00:00-05:00', timeZone: 'America/New_York' })
    expect(v.parse(GcalEventTimeSchema, { dateTime: '2026-01-05T09:00:00-05:00' })).toEqual({
      dateTime: '2026-01-05T09:00:00-05:00',
    })
  })

  it('rejects a time that is neither shape', () => {
    expect(v.safeParse(GcalEventTimeSchema, {}).success).toBe(false)
    expect(v.safeParse(GcalEventTimeSchema, { timeZone: 'UTC' }).success).toBe(false)
  })
})

describe('event schema', () => {
  it('parses a full event including extendedProperties and recurringEventId', () => {
    const parsed = v.parse(GcalEventSchema, {
      ...evTimedWithZone,
      recurringEventId: 'base',
      extendedProperties: { private: { trackId: 't1' }, shared: { x: 'y' } },
      htmlLink: 'https://calendar.google.com/whatever',
    })
    expect(parsed.recurringEventId).toBe('base')
    expect(parsed.extendedProperties?.private).toEqual({ trackId: 't1' })
    expect('htmlLink' in parsed).toBe(false)
  })

  it('accepts a cancelled sync stub with no start/end', () => {
    expect(v.parse(GcalEventSchema, evCancelled)).toEqual({ id: 'ev-cancelled', status: 'cancelled' })
  })

  it('rejects an event without id and an unknown status', () => {
    expect(v.safeParse(GcalEventSchema, { status: 'confirmed' }).success).toBe(false)
    expect(v.safeParse(GcalEventSchema, { id: 'x', status: 'exploded' }).success).toBe(false)
  })
})

describe('events page schema', () => {
  it('parses a split page, a final page with nextSyncToken, and a sync continuation', () => {
    expect(v.parse(GcalEventsPageSchema, eventsPage1).nextPageToken).toBe('events-page-2')
    expect(v.parse(GcalEventsPageSchema, eventsPage2).nextSyncToken).toBe('sync-token-1')
    const sync = v.parse(GcalEventsPageSchema, eventsSyncPage)
    expect(sync.items).toHaveLength(2)
    expect(sync.nextSyncToken).toBe('sync-token-2')
  })
})
