import type { GcalCalendarListEntry, GcalEvent } from '../src/types.js'
import type { HttpFetch, HttpResponse } from '../src/client.js'

/**
 * Hand-authored, realistic (scrubbed-shaped) Calendar API fixtures. Everything in this
 * package tests offline against these -- the sandbox blocks googleapis.com anyway.
 */

// --- calendars: two zones, so zone fallback is actually exercised -----------------------

export const laCalendar: GcalCalendarListEntry = {
  id: 'primary-la',
  summary: 'TJ (personal)',
  timeZone: 'America/Los_Angeles',
  primary: true,
}

export const utcCalendar: GcalCalendarListEntry = {
  id: 'ops-utc',
  summary: 'Ops',
  timeZone: 'UTC',
}

/** A calendar with no timeZone at all -- the zone-resolution hard-error case. */
export const zonelessCalendar: GcalCalendarListEntry = { id: 'no-tz' }

export const calendarListPage1 = {
  kind: 'calendar#calendarList',
  items: [
    { id: 'primary-la', summary: 'TJ (personal)', timeZone: 'America/Los_Angeles', primary: true, accessRole: 'owner' },
  ],
  nextPageToken: 'cal-page-2',
}

export const calendarListPage2 = {
  kind: 'calendar#calendarList',
  items: [{ id: 'ops-utc', summary: 'Ops', timeZone: 'UTC', accessRole: 'owner' }],
}

// --- events -----------------------------------------------------------------------------

/** Timed, with its own zone that differs from the calendar's. */
export const evTimedWithZone: GcalEvent = {
  id: 'ev-timed-tz',
  status: 'confirmed',
  summary: '. Read',
  start: { dateTime: '2026-01-05T09:00:00-05:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-01-05T09:45:00-05:00', timeZone: 'America/New_York' },
  updated: '2026-01-05T15:00:00.123Z',
  colorId: '3',
}

/** Timed, NO event zone -- must fall back to the owning calendar's zone. */
export const evTimedNoZone: GcalEvent = {
  id: 'ev-timed-notz',
  status: 'confirmed',
  summary: '[S] Coffee',
  start: { dateTime: '2026-01-06T08:00:00-08:00' },
  end: { dateTime: '2026-01-06T08:10:00-08:00' },
  updated: '2026-01-06T16:11:00.000Z',
  colorId: '5',
}

/** Single all-day event; end.date is Google's exclusive next day. */
export const evAllDay: GcalEvent = {
  id: 'ev-allday',
  status: 'confirmed',
  summary: 'Vacation day',
  start: { date: '2026-01-07' },
  end: { date: '2026-01-08' },
  updated: '2026-01-01T00:00:00.000Z',
}

/** All-day with no end at all -- mapper must synthesize next day's start. */
export const evAllDayNoEnd: GcalEvent = {
  id: 'ev-allday-noend',
  status: 'confirmed',
  summary: 'Anniversary',
  start: { date: '2026-02-14' },
}

/** Multi-day all-day: Feb 1..3 inclusive, so end.date is Feb 4. */
export const evAllDayMultiDay: GcalEvent = {
  id: 'ev-allday-multi',
  status: 'confirmed',
  summary: 'Conference',
  start: { date: '2026-02-01' },
  end: { date: '2026-02-04' },
}

/** Zero-duration timed event -- scribcal's instant marker. */
export const evZeroDuration: GcalEvent = {
  id: 'ev-zero',
  status: 'confirmed',
  summary: '[S] Coffee',
  start: { dateTime: '2026-01-08T14:30:00-08:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-01-08T14:30:00-08:00', timeZone: 'America/Los_Angeles' },
  updated: '2026-01-08T22:30:05.000Z',
  colorId: '5',
}

/** Cancelled sync stub: id + status only, as delivered by an incremental pull. */
export const evCancelled: GcalEvent = {
  id: 'ev-cancelled',
  status: 'cancelled',
}

/** Two expanded instances of one recurrence: same recurringEventId, distinct ids. */
export const evRecur1: GcalEvent = {
  id: 'evrec_20260105T170000Z',
  status: 'confirmed',
  summary: '. Meds',
  recurringEventId: 'evrec',
  start: { dateTime: '2026-01-05T09:00:00-08:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-01-05T09:00:00-08:00', timeZone: 'America/Los_Angeles' },
  updated: '2026-01-05T17:00:01.000Z',
}

export const evRecur2: GcalEvent = {
  id: 'evrec_20260106T170000Z',
  status: 'confirmed',
  summary: '. Meds',
  recurringEventId: 'evrec',
  start: { dateTime: '2026-01-06T09:00:00-08:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-01-06T09:00:00-08:00', timeZone: 'America/Los_Angeles' },
  updated: '2026-01-06T17:00:01.000Z',
}

/** Recent-era marker: `[source:scribcal]` in the description. */
export const evSourceTagged: GcalEvent = {
  id: 'ev-tagged',
  status: 'confirmed',
  summary: 'Water',
  description: 'auto-logged\n[source:scribcal]',
  start: { dateTime: '2026-01-09T10:00:00-08:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-01-09T10:00:00-08:00', timeZone: 'America/Los_Angeles' },
  updated: '2026-01-09T18:00:00.000Z',
  extendedProperties: { private: { source: 'scribcal' } },
}

/**
 * 2026-03-08 02:30 does not exist in America/Los_Angeles (spring-forward skips 02:00 ..
 * 03:00) -- must be REJECTED and reported, never snapped.
 */
export const evSkippedHour: GcalEvent = {
  id: 'ev-skipped',
  status: 'confirmed',
  summary: '. Meds',
  start: { dateTime: '2026-03-08T02:30:00-08:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-03-08T03:30:00-07:00', timeZone: 'America/Los_Angeles' },
}

/**
 * Foreign-zone event as the API actually renders it: start.timeZone is the event's own
 * zone, but the dateTime offset is in the RESPONSE zone -- the owning calendar's, since
 * the client never sets the timeZone request parameter. 06:00-08:00 = 14:00Z = 15:00 in
 * Paris. Must map (the instant is unambiguous), never reject.
 */
export const evCrossZoneRendered: GcalEvent = {
  id: 'ev-cross-zone',
  status: 'confirmed',
  summary: 'Paris call',
  start: { dateTime: '2026-01-05T06:00:00-08:00', timeZone: 'Europe/Paris' },
  end: { dateTime: '2026-01-05T06:30:00-08:00', timeZone: 'Europe/Paris' },
  updated: '2026-01-05T15:00:00.000Z',
}

/** Offset that contradicts the zone (LA is never -05:00) -- reject, do not reinterpret. */
export const evWrongOffset: GcalEvent = {
  id: 'ev-wrong-offset',
  status: 'confirmed',
  summary: 'Standup',
  start: { dateTime: '2026-01-05T09:00:00-05:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-01-05T09:15:00-05:00', timeZone: 'America/Los_Angeles' },
}

export const evMalformed: GcalEvent = {
  id: 'ev-malformed',
  status: 'confirmed',
  summary: 'garbage',
  start: { dateTime: 'not-a-timestamp' },
  end: { dateTime: 'not-a-timestamp' },
}

/** The two 1:30ams of a fall-back night (2026-11-01, America/Los_Angeles). */
export const evFallBackFirst: GcalEvent = {
  id: 'ev-fb-1',
  status: 'confirmed',
  summary: '. Meds',
  start: { dateTime: '2026-11-01T01:30:00-07:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-11-01T01:30:00-07:00', timeZone: 'America/Los_Angeles' },
}

export const evFallBackSecond: GcalEvent = {
  id: 'ev-fb-2',
  status: 'confirmed',
  summary: '. Meds',
  start: { dateTime: '2026-11-01T01:30:00-08:00', timeZone: 'America/Los_Angeles' },
  end: { dateTime: '2026-11-01T01:30:00-08:00', timeZone: 'America/Los_Angeles' },
}

/** UTC-calendar event with a Z timestamp and no event zone. */
export const evUtcTimed: GcalEvent = {
  id: 'ev-utc',
  status: 'confirmed',
  summary: 'Ops sync',
  start: { dateTime: '2026-01-05T17:00:00Z' },
  end: { dateTime: '2026-01-05T18:00:00Z' },
  updated: '2026-01-05T18:00:00.000Z',
}

// --- events.list pages (page split + syncToken continuation + 410) ----------------------

export const eventsPage1 = {
  kind: 'calendar#events',
  items: [evTimedWithZone, evTimedNoZone, evAllDay],
  nextPageToken: 'events-page-2',
}

export const eventsPage2 = {
  kind: 'calendar#events',
  items: [evZeroDuration, evRecur1, evRecur2, evCancelled],
  nextSyncToken: 'sync-token-1',
}

/** Incremental continuation for syncToken=sync-token-1: one edit, one cancellation. */
export const eventsSyncPage = {
  kind: 'calendar#events',
  items: [
    {
      ...evTimedWithZone,
      summary: '. Read (edited)',
      updated: '2026-01-10T09:00:00.000Z',
    },
    { id: 'ev-allday', status: 'cancelled' },
  ],
  nextSyncToken: 'sync-token-2',
}

/** syncToken value the fake server treats as expired -> HTTP 410. */
export const STALE_SYNC_TOKEN = 'stale-token'

// --- classifier fixture set: easy arithmetic, wide date range, no cutoff ----------------

function zeroDur(id: string, summary: string, dateTime: string, extra: Partial<GcalEvent> = {}): GcalEvent {
  return {
    id,
    status: 'confirmed',
    summary,
    start: { dateTime, timeZone: 'America/Los_Angeles' },
    end: { dateTime, timeZone: 'America/Los_Angeles' },
    ...extra,
  }
}

export const classifyEvents: GcalEvent[] = [
  // Coffee across all three marking eras plus zero-duration + one shared colour.
  zeroDur('c1', '[S] Coffee', '2015-03-02T08:00:00-08:00', { colorId: '5' }),
  zeroDur('c2', '[S] Coffee', '2016-01-10T09:00:00-08:00', { colorId: '5' }),
  zeroDur('c3', '. Coffee', '2019-05-04T07:30:00-07:00', { colorId: '5' }),
  zeroDur('c4', 'Coffee', '2024-11-20T08:15:00-08:00', {
    colorId: '5',
    description: 'brewed\n[source:scribcal]',
  }),
  // Dot-era with real duration.
  {
    id: 'r1',
    status: 'confirmed',
    summary: '. Read',
    start: { dateTime: '2020-02-02T21:00:00-08:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2020-02-02T21:30:00-08:00', timeZone: 'America/Los_Angeles' },
    colorId: '3',
  },
  {
    id: 'r2',
    status: 'confirmed',
    summary: '. Read',
    start: { dateTime: '2020-02-03T21:00:00-08:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2020-02-03T21:30:00-08:00', timeZone: 'America/Los_Angeles' },
    colorId: '3',
  },
  // No marker at all, but a consistent colour on a repeated title: weak corroborator only.
  {
    id: 'f1',
    status: 'confirmed',
    summary: 'Focus block',
    start: { dateTime: '2025-06-01T09:00:00-07:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2025-06-01T10:00:00-07:00', timeZone: 'America/Los_Angeles' },
    colorId: '9',
  },
  {
    id: 'f2',
    status: 'confirmed',
    summary: 'Focus block',
    start: { dateTime: '2025-06-02T09:00:00-07:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2025-06-02T10:00:00-07:00', timeZone: 'America/Los_Angeles' },
    colorId: '9',
  },
  // Genuinely unmarked appointments.
  {
    id: 'd1',
    status: 'confirmed',
    summary: 'Dentist',
    start: { dateTime: '2023-04-10T14:00:00-07:00', timeZone: 'America/Los_Angeles' },
    end: { dateTime: '2023-04-10T14:30:00-07:00', timeZone: 'America/Los_Angeles' },
  },
  { id: 'v1', status: 'confirmed', summary: 'Vacation', start: { date: '2022-08-01' }, end: { date: '2022-08-02' } },
  { id: 'x1', status: 'cancelled' },
]

// --- fake fetch -------------------------------------------------------------------------

export type FakeCall = { url: URL; headers: Record<string, string> }

export function fakeFetch(handler: (url: URL) => { status: number; body?: unknown }): {
  fetchImpl: HttpFetch
  calls: FakeCall[]
} {
  const calls: FakeCall[] = []
  const fetchImpl: HttpFetch = (input, init) => {
    const url = new URL(input)
    calls.push({ url, headers: init.headers })
    const res = handler(url)
    const response: HttpResponse = {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: () => Promise.resolve(res.body),
      text: () => Promise.resolve(JSON.stringify(res.body ?? '')),
    }
    return Promise.resolve(response)
  }
  return { fetchImpl, calls }
}

/**
 * A fake Calendar API good enough for the client tests: calendarList pagination, events
 * page split, syncToken continuation, and 410 on a stale token.
 */
export function fakeCalendarApi() {
  return fakeFetch((url) => {
    if (url.pathname.endsWith('/users/me/calendarList')) {
      return url.searchParams.get('pageToken') === 'cal-page-2'
        ? { status: 200, body: calendarListPage2 }
        : { status: 200, body: calendarListPage1 }
    }
    if (url.pathname.endsWith('/calendars/primary-la/events')) {
      const syncToken = url.searchParams.get('syncToken')
      if (syncToken === STALE_SYNC_TOKEN) return { status: 410, body: { error: { code: 410 } } }
      if (syncToken === 'sync-token-1') return { status: 200, body: eventsSyncPage }
      if (url.searchParams.get('pageToken') === 'events-page-2') {
        return { status: 200, body: eventsPage2 }
      }
      return { status: 200, body: eventsPage1 }
    }
    if (url.pathname.endsWith('/calendars/forbidden/events')) {
      return { status: 403, body: { error: { code: 403, message: 'insufficient scope' } } }
    }
    return { status: 404, body: { error: { code: 404 } } }
  })
}
