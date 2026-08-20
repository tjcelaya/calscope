import { Temporal } from 'temporal-polyfill'

/**
 * Half-open [start, end). Instants rather than ZonedDateTimes: set algebra should not
 * care about zones, and comparing instants is unambiguous across DST transitions.
 */
export type Interval = { start: Temporal.Instant; end: Temporal.Instant }

export const cmp = Temporal.Instant.compare

export function lengthMs(i: Interval): number {
  return i.end.epochMilliseconds - i.start.epochMilliseconds
}

export function isEmpty(i: Interval): boolean {
  return cmp(i.start, i.end) >= 0
}

export function contains(i: Interval, t: Temporal.Instant): boolean {
  return cmp(i.start, t) <= 0 && cmp(t, i.end) < 0
}

export function overlaps(a: Interval, b: Interval): boolean {
  return cmp(a.start, b.end) < 0 && cmp(b.start, a.end) < 0
}

/**
 * Sort by start and merge anything overlapping or touching. Every algebra operation
 * returns normalized output, so results are canonical and comparable by value.
 */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => !isEmpty(i)).sort((a, b) => cmp(a.start, b.start))
  const out: Interval[] = []

  for (const next of sorted) {
    const last = out[out.length - 1]
    // Touching intervals merge: [1,2) followed by [2,3) is one run, not two.
    if (last && cmp(next.start, last.end) <= 0) {
      if (cmp(next.end, last.end) > 0) out[out.length - 1] = { start: last.start, end: next.end }
    } else {
      out.push(next)
    }
  }
  return out
}

/**
 * Merge only STRICTLY overlapping intervals, leaving touching ones distinct.
 *
 * Windows are a partition, not a point set: seven daily windows tile a week with
 * day N's end equal to day N+1's start, and `normalize` would collapse all seven into
 * one blob. Generators and union use this; only the mask side of intersect/difference
 * uses full point-set `normalize`.
 */
export function normalizeWindows(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => !isEmpty(i)).sort((a, b) => cmp(a.start, b.start))
  const out: Interval[] = []

  for (const next of sorted) {
    const last = out[out.length - 1]
    if (last && cmp(next.start, last.end) < 0) {
      if (cmp(next.end, last.end) > 0) out[out.length - 1] = { start: last.start, end: next.end }
    } else {
      out.push(next)
    }
  }
  return out
}

export function union(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  return normalizeWindows([...a, ...b])
}

/**
 * Clip each window in `a` against the point set `b`, keeping the pieces of distinct
 * windows separate. A daily schedule intersected with work hours yields one window per
 * day, not a single merged run.
 */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const mask = normalize(b)
  const out: Interval[] = []

  for (const window of normalizeWindows(a)) {
    for (const m of mask) {
      if (cmp(m.end, window.start) <= 0) continue
      if (cmp(m.start, window.end) >= 0) break

      const start = cmp(window.start, m.start) > 0 ? window.start : m.start
      const end = cmp(window.end, m.end) < 0 ? window.end : m.end
      if (cmp(start, end) < 0) out.push({ start, end })
    }
  }
  return out.sort((x, y) => cmp(x.start, y.start))
}

export function difference(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const subtract = normalize(b)
  const out: Interval[] = []

  for (const base of normalizeWindows(a)) {
    let cursor = base.start
    for (const cut of subtract) {
      if (cmp(cut.end, cursor) <= 0) continue
      if (cmp(cut.start, base.end) >= 0) break

      if (cmp(cut.start, cursor) > 0) out.push({ start: cursor, end: cut.start })
      if (cmp(cut.end, cursor) > 0) cursor = cut.end
      if (cmp(cursor, base.end) >= 0) break
    }
    if (cmp(cursor, base.end) < 0) out.push({ start: cursor, end: base.end })
  }
  return out.sort((x, y) => cmp(x.start, y.start))
}

/** Clamp every window to `bounds`, dropping those entirely outside. Keeps them discrete. */
export function clipTo(intervals: readonly Interval[], bounds: Interval): Interval[] {
  return intersect(intervals, [bounds])
}

/**
 * Keep whole windows that overlap `bounds`, rather than truncating them.
 *
 * This is what generators use, and the distinction is load-bearing: a weekly
 * "150 minutes of exercise" goal viewed on a Wednesday must evaluate against the WHOLE
 * week. Clipping the window to the query range would total only Wednesday's minutes and
 * report Missed against a weekly target -- wrong, and wrong in the direction that
 * makes the app nag you.
 */
export function overlappingWith(intervals: readonly Interval[], bounds: Interval): Interval[] {
  return normalizeWindows(intervals).filter((i) => overlaps(i, bounds))
}

/**
 * Shift in ZonedDateTime space, not on the instant line.
 *
 * `Instant.add` rejects calendar units outright, and rightly so: "the day after" is 23
 * or 25 hours across a DST transition, so shifting by P1D on a fixed 24h offset would
 * land an hour off exactly twice a year.
 */
export function shift(
  intervals: readonly Interval[],
  by: Temporal.Duration,
  tz: string,
): Interval[] {
  return normalizeWindows(
    intervals.map((i) => ({
      start: i.start.toZonedDateTimeISO(tz).add(by).toInstant(),
      end: i.end.toZonedDateTimeISO(tz).add(by).toInstant(),
    })),
  )
}

export function totalMs(intervals: readonly Interval[]): number {
  return normalize(intervals).reduce((sum, i) => sum + lengthMs(i), 0)
}

export function toIso(i: Interval): { start: string; end: string } {
  return { start: i.start.toString(), end: i.end.toString() }
}
