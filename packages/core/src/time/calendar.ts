import { Temporal } from 'temporal-polyfill'
import { CalendarUnit } from '../model/enums.js'
import type { Interval } from './interval.js'

/**
 * Start of a local day as an instant. Uses PlainDate -> ZonedDateTime rather than
 * "midnight + 24h", because a fall-back day really is 25 hours long and arithmetic on
 * a fixed 24h offset silently produces the wrong boundary.
 */
export function startOfDay(date: Temporal.PlainDate, tz: string): Temporal.Instant {
  return date.toZonedDateTime({ timeZone: tz, plainTime: '00:00' }).toInstant()
}

export function dayInterval(date: Temporal.PlainDate, tz: string): Interval {
  return { start: startOfDay(date, tz), end: startOfDay(date.add({ days: 1 }), tz) }
}

/** Real length of a local day. 23, 24, 25 -- or 23.5/24.5 on Lord Howe. */
export function dayLengthHours(date: Temporal.PlainDate, tz: string): number {
  const i = dayInterval(date, tz)
  return (i.end.epochMilliseconds - i.start.epochMilliseconds) / 3_600_000
}

function startOfWeek(date: Temporal.PlainDate, weekStart: number): Temporal.PlainDate {
  // Temporal dayOfWeek is 1 (Mon) .. 7 (Sun).
  const diff = (date.dayOfWeek - weekStart + 7) % 7
  return date.subtract({ days: diff })
}

/**
 * Aligned calendar windows covering `range`. This is the workhorse behind "per day",
 * "per week", "per month" goals, and it is DST-correct by construction.
 */
export function calendarWindows(
  unit: CalendarUnit,
  tz: string,
  range: Interval,
  weekStart = 1,
): Interval[] {
  const first = range.start.toZonedDateTimeISO(tz).toPlainDate()
  const last = range.end.toZonedDateTimeISO(tz).toPlainDate()

  let cursor = alignDown(first, unit, weekStart)
  const out: Interval[] = []

  // Guard against a non-advancing cursor rather than trusting the unit switch.
  let guard = 0
  while (Temporal.PlainDate.compare(cursor, last) <= 0 && guard++ < 100_000) {
    const next = advance(cursor, unit)
    out.push({ start: startOfDay(cursor, tz), end: startOfDay(next, tz) })
    cursor = next
  }
  return out
}

function alignDown(date: Temporal.PlainDate, unit: CalendarUnit, weekStart: number): Temporal.PlainDate {
  switch (unit) {
    case CalendarUnit.Day:
      return date
    case CalendarUnit.Week:
      return startOfWeek(date, weekStart)
    case CalendarUnit.Month:
      return date.with({ day: 1 })
    case CalendarUnit.Year:
      return date.with({ month: 1, day: 1 })
  }
}

function advance(date: Temporal.PlainDate, unit: CalendarUnit): Temporal.PlainDate {
  switch (unit) {
    case CalendarUnit.Day:
      return date.add({ days: 1 })
    case CalendarUnit.Week:
      return date.add({ weeks: 1 })
    case CalendarUnit.Month:
      return date.add({ months: 1 })
    case CalendarUnit.Year:
      return date.add({ years: 1 })
  }
}

/**
 * Parse an entry timestamp.
 *
 * `offset: 'reject'` is what actually catches bad DST data: the offset must be valid for
 * that wall-clock time in that zone, so 02:30 on a spring-forward morning throws rather
 * than being silently snapped to a neighbouring instant. It also preserves the
 * distinction that matters most -- the two 1:30ams of a fall-back night carry different
 * offsets and therefore resolve to different instants (05:30Z and 06:30Z).
 */
export function parseZoned(iso: string): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from(iso, { disambiguation: 'reject', offset: 'reject' })
}
