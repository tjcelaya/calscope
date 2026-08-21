import { Temporal } from 'temporal-polyfill'

/**
 * How long a local calendar day actually ran. DST makes this 23h or 25h -- and on
 * Lord Howe Island, 23.5h or 24.5h -- which is why `delta` is a Duration and never
 * an integer hour count.
 */
export const DayShape = {
  Normal: 'normal',
  Long: 'long',
  Short: 'short',
} as const
export type DayShape = (typeof DayShape)[keyof typeof DayShape]

/** Where the extra/missing segment is drawn. See plan section 8. */
export const DstPolicy = {
  AtTransition: 'at-transition',
  AtDayEnd: 'at-day-end',
} as const
export type DstPolicy = (typeof DstPolicy)[keyof typeof DstPolicy]

export type DayAnomaly = {
  /** The instant the offset changed. */
  at: Temporal.ZonedDateTime
  /** Canonical slot (0..HOURS_PER_DAY) the mark attaches to, per the active DstPolicy. */
  slotIndex: number
  /** +1h on a fall-back day, -1h on a spring-forward day, +/-30m on Lord Howe. */
  delta: Temporal.Duration
}

export type VirtualDay = {
  date: Temporal.PlainDate
  timeZone: string
  shape: DayShape
  /** Real elapsed time in the day. Never assume 24h. */
  actualHours: number
  anomaly?: DayAnomaly
}

export const HOURS_PER_DAY = 24

/**
 * A virtual day is ALWAYS 24 canonical slots regardless of its real length. That is the
 * locked-zoom invariant: slot geometry depends on zoom alone, so 3pm sits at the same
 * angle on every day and adjacent days stay visually comparable. DST is carried as an
 * annotation (`anomaly`) that renderers draw as an extra mark, never as a rescale.
 */
export function virtualDay(
  date: Temporal.PlainDate,
  timeZone: string,
  policy: DstPolicy = DstPolicy.AtTransition,
): VirtualDay {
  const start = date.toZonedDateTime({ timeZone, plainTime: '00:00' })
  const next = date.add({ days: 1 }).toZonedDateTime({ timeZone, plainTime: '00:00' })
  const actualHours = start.until(next, { largestUnit: 'hour' }).total({ unit: 'hour' })

  if (Math.abs(actualHours - HOURS_PER_DAY) < 1e-9) {
    return { date, timeZone, shape: DayShape.Normal, actualHours }
  }

  const transition = start.getTimeZoneTransition('next')
  const shape = actualHours > HOURS_PER_DAY ? DayShape.Long : DayShape.Short
  const deltaHours = actualHours - HOURS_PER_DAY

  // Fall back to the day boundary when we cannot locate the transition instant; a
  // renderer must still get a drawable slot rather than a silently missing mark.
  const at = transition !== null && Temporal.ZonedDateTime.compare(transition, next) < 0 ? transition : start

  // `at` reads the transition instant in the POST-transition offset. For a Long day that
  // is the start of the repeated wall-clock hour (NY: 1:00, the hour that happens twice).
  // For a Short day it is one shift-width LATE: NY's transition instant reads 3:00 EDT,
  // but the hour that never happened is 2:00-3:00 EST wall time. deltaHours is negative
  // on Short days, so adding it walks the slot back by exactly the shift width
  // (Lord Howe: 2.5 - 0.5 = 2.0). Caught in the field: the void rendered an hour late.
  const postSlot = at.hour + at.minute / 60
  const slotIndex =
    policy === DstPolicy.AtDayEnd
      ? HOURS_PER_DAY
      : shape === DayShape.Short
        ? postSlot + deltaHours
        : postSlot

  return {
    date,
    timeZone,
    shape,
    actualHours,
    anomaly: {
      at,
      slotIndex,
      delta: Temporal.Duration.from({ minutes: Math.round(deltaHours * 60) }),
    },
  }
}
