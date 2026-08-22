import { Temporal } from 'temporal-polyfill'
import { DayShape, type VirtualDay } from './virtual-day.js'

/**
 * A half-open instant range. Structurally identical to @calscope/core's Interval, but
 * views has no dependency on core (deliberately -- geometry stays leaf-level), so the
 * minimal shape is declared locally.
 */
export type Interval = { start: Temporal.Instant; end: Temporal.Instant }

/**
 * Snap a viewport range outward to day boundaries wherever a boundary would otherwise
 * fall strictly inside a non-Normal day, so an anomalous day -- and therefore its spur
 * or void mark -- is never half-clipped at the viewport edge.
 *
 * Properties (tested): no-op when every day in range is Normal; idempotent (a snapped
 * boundary sits exactly on a day edge, never strictly inside one); only ever widens,
 * each end by less than one day. "Locked zoom" is unaffected -- this adjusts the
 * viewport, never slot geometry, and the zoom control stays live.
 *
 * Day edges come from PlainDate -> startOfDay in the day's own zone (invariant 6),
 * never start + 24h.
 */
export function snapViewport(range: Interval, days: readonly VirtualDay[]): Interval {
  let start = range.start
  let end = range.end
  let changed = false

  for (const day of days) {
    if (day.shape === DayShape.Normal) continue
    const dayStart = day.date
      .toZonedDateTime({ timeZone: day.timeZone, plainTime: '00:00' })
      .toInstant()
    const dayEnd = day.date
      .add({ days: 1 })
      .toZonedDateTime({ timeZone: day.timeZone, plainTime: '00:00' })
      .toInstant()

    if (Temporal.Instant.compare(dayStart, start) < 0 && Temporal.Instant.compare(start, dayEnd) < 0) {
      start = dayStart
      changed = true
    }
    if (Temporal.Instant.compare(dayStart, end) < 0 && Temporal.Instant.compare(end, dayEnd) < 0) {
      end = dayEnd
      changed = true
    }
  }

  return changed ? { start, end } : range
}
