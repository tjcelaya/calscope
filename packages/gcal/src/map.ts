import { Temporal } from 'temporal-polyfill'
import type { Entry } from '@calscope/core'
import { GcalEventStatus, type GcalCalendarListEntry, type GcalEvent, type GcalEventTime } from './types.js'
import { stripMarkerPrefix } from './classify.js'

/**
 * Event -> Entry mapper. `Entry.start/end` must satisfy core's ZonedIsoSchema (bracketed
 * IANA zone, `offset: 'reject'` semantics), and Google hands us bare RFC3339 offset
 * strings -- so the whole job here is attaching the RIGHT zone and refusing to guess.
 */

export type MapReject = {
  eventId: string
  raw: string
  reason: string
}

export type MapResult = {
  entries: Entry[]
  /** Entry ids of cancelled events -- surfaced as deletions, never as entries. */
  deletions: string[]
  /** Skipped events. Reported, never snapped to a neighbouring instant, never silent. */
  rejects: MapReject[]
}

export type MapOptions = {
  /**
   * Assigns the Entry's track. The review UI supplies this once title clusters are mapped
   * onto Tracks; until then everything lands on one per-calendar import track.
   */
  trackIdFor?: (event: GcalEvent, strippedTitle: string) => string
}

/**
 * Deterministic Entry id from the gcal event id: re-running the import maps onto the SAME
 * ids, so the op-log fold upserts instead of duplicating. This is the dedupe contract.
 */
export function entryIdForEvent(gcalEventId: string): string {
  return `gcal:${gcalEventId}`
}

/**
 * No zone on the event AND none on the owning calendar. A hard error, not a reject: the
 * one fallback everyone reaches for -- the device zone -- silently rewrites history when
 * you travel, and a calendar with no zone at all is a configuration problem upstream.
 */
export class ZoneResolutionError extends Error {
  constructor(eventId: string, calendarId: string) {
    super(
      `cannot resolve a time zone for event ${eventId}: neither the event nor calendar ` +
        `${calendarId} carries one, and the device zone is never an acceptable fallback`,
    )
    this.name = 'ZoneResolutionError'
  }
}

/** Internal control-flow signal: this one event is rejected, the batch continues. */
class RejectSignal {
  constructor(
    readonly raw: string,
    readonly reason: string,
  ) {}
}

function resolveZone(time: GcalEventTime, calendar: GcalCalendarListEntry, eventId: string): string {
  const eventZone = 'timeZone' in time ? time.timeZone : undefined
  const zone = eventZone ?? calendar.timeZone
  if (zone === undefined) throw new ZoneResolutionError(eventId, calendar.id)
  return zone
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function zdtFor(
  time: GcalEventTime,
  calendar: GcalCalendarListEntry,
  eventId: string,
): Temporal.ZonedDateTime {
  const zone = resolveZone(time, calendar, eventId)
  if ('date' in time) {
    try {
      return Temporal.PlainDate.from(time.date).toZonedDateTime({
        timeZone: zone,
        plainTime: '00:00',
      })
    } catch (error) {
      throw new RejectSignal(time.date, `all-day date does not parse: ${errorMessage(error)}`)
    }
  }
  // Parsing `<dateTime>[<zone>]` with offset:'reject' is what enforces invariant 7 here:
  // an offset inconsistent with the zone (e.g. a wall time inside a DST-skipped hour)
  // throws instead of being reinterpreted -- converting via Instant would silently snap.
  try {
    return Temporal.ZonedDateTime.from(`${time.dateTime}[${zone}]`, {
      offset: 'reject',
      disambiguation: 'reject',
    })
  } catch (error) {
    // events.list renders dateTime offsets in the RESPONSE zone -- by default the
    // calendar's, and the client never sets the timeZone parameter -- so a foreign-zone
    // event carries its own start.timeZone alongside a wall time+offset rendered in the
    // calendar's zone. That instant is unambiguous and valid; rejecting it here would be
    // wrong. Re-validate the offset against the calendar zone (offset:'reject' still
    // applies, so garbage offsets keep failing), then re-render in the event's own zone.
    // A wall time inside a DST-skipped hour parses in NEITHER zone and still rejects.
    const calendarZone = calendar.timeZone
    if (calendarZone !== undefined && calendarZone !== zone) {
      try {
        return Temporal.ZonedDateTime.from(`${time.dateTime}[${calendarZone}]`, {
          offset: 'reject',
          disambiguation: 'reject',
        }).withTimeZone(zone)
      } catch {
        // Fall through to the original rejection, reported against the event's zone.
      }
    }
    throw new RejectSignal(
      time.dateTime,
      `does not parse in zone ${zone}: ${errorMessage(error)}`,
    )
  }
}

/** All-day end when Google supplies none: the NEXT day's start, via PlainDate (invariant 6). */
function nextDayStart(date: string, zone: string): Temporal.ZonedDateTime {
  return Temporal.PlainDate.from(date)
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: zone, plainTime: '00:00' })
}

export function mapEvents(
  events: GcalEvent[],
  calendar: GcalCalendarListEntry,
  options: MapOptions = {},
): MapResult {
  const entries: Entry[] = []
  const deletions: string[] = []
  const rejects: MapReject[] = []

  for (const event of events) {
    if (event.status === GcalEventStatus.Cancelled) {
      deletions.push(entryIdForEvent(event.id))
      continue
    }
    if (event.start === undefined) {
      rejects.push({ eventId: event.id, raw: '', reason: 'non-cancelled event has no start' })
      continue
    }

    try {
      const startZdt = zdtFor(event.start, calendar, event.id)
      let endZdt: Temporal.ZonedDateTime | undefined
      if ('date' in event.start) {
        // Google's all-day `end.date` is already the exclusive next day; when absent,
        // a single all-day event ends at the following day's start.
        endZdt =
          event.end !== undefined && 'date' in event.end
            ? zdtFor(event.end, calendar, event.id)
            : nextDayStart(event.start.date, startZdt.timeZoneId)
      } else if (event.end !== undefined) {
        endZdt = zdtFor(event.end, calendar, event.id)
      }

      const strippedTitle = stripMarkerPrefix(event.summary ?? '').title
      const entry: Entry = {
        id: entryIdForEvent(event.id),
        trackId: options.trackIdFor?.(event, strippedTitle) ?? `gcal:${calendar.id}`,
        start: startZdt.toString(),
        gcalEventId: event.id,
        gcalCalendarId: calendar.id,
      }
      // Zero-duration events are instants: start === end collapses to no end at all.
      if (endZdt !== undefined && endZdt.epochNanoseconds !== startZdt.epochNanoseconds) {
        entry.end = endZdt.toString()
      }
      if (event.updated !== undefined) entry.gcalUpdated = event.updated
      if (event.summary !== undefined) entry.note = event.summary
      entries.push(entry)
    } catch (error) {
      if (error instanceof RejectSignal) {
        rejects.push({ eventId: event.id, raw: error.raw, reason: error.reason })
        continue
      }
      // ZoneResolutionError and anything unexpected propagate -- never swallowed.
      throw error
    }
  }

  return { entries, deletions, rejects }
}
