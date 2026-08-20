import { Temporal } from 'temporal-polyfill'
import * as rruleNs from 'rrule'
import { PredicateRef, ScheduleKind } from '../model/enums.js'
import type { Entry, Schedule, TrackId } from '../model/types.js'
import { calendarWindows, parseZoned } from '../time/calendar.js'
import {
  type Interval,
  difference,
  overlappingWith,
  intersect,
  normalizeWindows,
  shift,
  union,
} from '../time/interval.js'

export type ScheduleContext = {
  /** Entries available to a Derived schedule. */
  entries?: readonly Entry[]
}

/**
 * `rrule` ships no `exports` map -- only `main` (CJS) and `module` (ESM). Bundlers pick
 * the ESM build and get named exports; plain Node ESM picks the CJS build and does not.
 * Resolve both shapes so the engine runs under Vite AND under bare Node (the CLI).
 */
const RRule = ((rruleNs as Record<string, unknown>).RRule ??
  (rruleNs as { default?: Record<string, unknown> }).default?.RRule) as typeof rruleNs.RRule

const ZERO = Temporal.Duration.from({ seconds: 0 })

/**
 * Evaluate a Schedule to a normalized set of intervals over `range`.
 *
 * Pure and total: every kind is handled, and the default branch is typed `never` so a
 * new ScheduleKind fails to compile rather than silently returning nothing.
 */
export function occurrences(
  schedule: Schedule,
  range: Interval,
  ctx: ScheduleContext = {},
): Interval[] {
  switch (schedule.t) {
    case ScheduleKind.Calendar:
      return overlappingWith(
        calendarWindows(schedule.unit, schedule.tz, range, schedule.weekStart ?? 1),
        range,
      )

    case ScheduleKind.Span: {
      const span = {
        start: Temporal.Instant.from(schedule.start),
        end: Temporal.Instant.from(schedule.end),
      }
      return overlappingWith([span], range)
    }

    case ScheduleKind.Dates: {
      const duration = parseDuration(schedule.duration)
      const intervals = schedule.dates.map((d) => {
        const start = zonedFromLoose(d, schedule.tz)
        return { start: start.toInstant(), end: start.add(duration).toInstant() }
      })
      return overlappingWith(intervals, range)
    }

    case ScheduleKind.Rrule:
      return overlappingWith(
        expandRrule(schedule.rrule, schedule.tz, schedule.duration, range),
        range,
      )

    case ScheduleKind.Union:
      return schedule.of.reduce<Interval[]>(
        (acc, s) => union(acc, occurrences(s, range, ctx)),
        [],
      )

    case ScheduleKind.Intersect: {
      if (schedule.of.length === 0) return []
      const [head, ...rest] = schedule.of
      return rest.reduce<Interval[]>(
        (acc, s) => intersect(acc, occurrences(s, range, ctx)),
        occurrences(head!, range, ctx),
      )
    }

    case ScheduleKind.Difference:
      return difference(
        occurrences(schedule.from, range, ctx),
        occurrences(schedule.minus, range, ctx),
      )

    case ScheduleKind.Shift: {
      const by = parseDuration(schedule.by)
      // Widen the query so occurrences shifted INTO the range are not missed.
      const widened = widen(range, by, schedule.tz)
      return overlappingWith(shift(occurrences(schedule.of, widened, ctx), by, schedule.tz), range)
    }

    case ScheduleKind.Clip:
      return intersect(
        occurrences(schedule.of, range, ctx),
        occurrences(schedule.to, range, ctx),
      )

    case ScheduleKind.Filter: {
      const inner = occurrences(schedule.of, range, ctx)
      // normalizeWindows, not normalize: five contiguous weekdays must stay five
      // windows rather than merging into one Monday-to-Friday run.
      return normalizeWindows(inner.filter((i) => matches(schedule.pred, i, schedule.tz)))
    }

    case ScheduleKind.Derived:
      return overlappingWith(
        derivedFromTrack(
          schedule.fromTrack,
          parseDuration(schedule.before),
          parseDuration(schedule.after),
          ctx.entries ?? [],
        ),
        range,
      )

    default: {
      const exhaustive: never = schedule
      throw new Error(`unhandled schedule kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

function widen(range: Interval, by: Temporal.Duration, tz: string): Interval {
  const negated = by.negated()
  const a = range.start.toZonedDateTimeISO(tz).add(negated).toInstant()
  const b = range.end.toZonedDateTimeISO(tz).add(negated).toInstant()
  return {
    start: Temporal.Instant.compare(a, range.start) < 0 ? a : range.start,
    end: Temporal.Instant.compare(b, range.end) > 0 ? b : range.end,
  }
}

function parseDuration(iso: string | undefined): Temporal.Duration {
  return iso ? Temporal.Duration.from(iso) : ZERO
}

/** Accept a bare date ('2026-03-08') or a full wall-clock time. */
function zonedFromLoose(value: string, tz: string): Temporal.ZonedDateTime {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Temporal.PlainDate.from(value).toZonedDateTime({ timeZone: tz, plainTime: '00:00' })
  }
  return Temporal.PlainDateTime.from(value).toZonedDateTime(tz)
}

/**
 * The `rrule` library operates on JS Dates whose UTC fields carry FLOATING wall-clock
 * time -- it has no real timezone support. So we ask for occurrences in UTC, then
 * reinterpret each result's Y/M/D/H/M as local wall time in `tz`. This is the standard
 * workaround and it is what makes 9am stay 9am across a DST boundary.
 */
function expandRrule(
  rule: string,
  tz: string,
  duration: string | undefined,
  range: Interval,
): Interval[] {
  const parsed = RRule.fromString(rule)
  const span = parseDuration(duration)

  // Pad by a day either side so an occurrence starting just before `range` but
  // overlapping into it still shows up.
  const from = new Date(range.start.epochMilliseconds - 86_400_000)
  const to = new Date(range.end.epochMilliseconds + 86_400_000)

  return parsed.between(from, to, true).map((d) => {
    const local = Temporal.PlainDateTime.from({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    })
    const start = local.toZonedDateTime(tz)
    return { start: start.toInstant(), end: start.add(span).toInstant() }
  })
}

function matches(pred: PredicateRef, i: Interval, tz: string): boolean {
  const dow = i.start.toZonedDateTimeISO(tz).dayOfWeek
  switch (pred) {
    case PredicateRef.IsWeekday:
      return dow <= 5
    case PredicateRef.IsWeekend:
      return dow >= 6
    default: {
      const exhaustive: never = pred
      throw new Error(`unhandled predicate: ${String(exhaustive)}`)
    }
  }
}

/**
 * Windows derived from another track's entries -- "within 30 minutes of waking",
 * "the hour before the bedtime routine". This is what makes a goal's window depend on
 * what actually happened rather than on the clock.
 */
function derivedFromTrack(
  trackId: TrackId,
  before: Temporal.Duration,
  after: Temporal.Duration,
  entries: readonly Entry[],
): Interval[] {
  const out: Interval[] = []
  for (const entry of entries) {
    if (entry.trackId !== trackId) continue
    const start = parseZoned(entry.start).toInstant()
    const end = entry.end ? parseZoned(entry.end).toInstant() : start
    out.push({ start: start.add(before.negated()), end: end.add(after) })
  }
  return normalizeWindows(out)
}
