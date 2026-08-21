import { arc as d3arc } from 'd3-shape'
import { Temporal } from 'temporal-polyfill'
import { HOURS_PER_DAY, type VirtualDay } from './virtual-day.js'

export const TAU = Math.PI * 2

export type RadialConfig = {
  /** Radius of the innermost ring's inner edge. */
  innerRadius: number
  /** Radial thickness of one day band. */
  ringThickness: number
  /** Gap between adjacent day bands. */
  ringGap: number
  /** 24 = one revolution per day; 12 = two revolutions (AM band + PM band). */
  hoursPerRevolution: 24 | 12
  /** How far a fall-back spur steps outside its ring band. */
  spurHeight: number
}

export const defaultRadialConfig: RadialConfig = {
  innerRadius: 60,
  ringThickness: 22,
  ringGap: 6,
  hoursPerRevolution: 24,
  spurHeight: 9,
}

export type Ring = { r0: number; r1: number }

/**
 * Radii for the day at `dayIndex` (0 = innermost). Depends on zoom-derived config only --
 * never on the day's real length. This is the locked-zoom invariant in radial form.
 */
export function ringRadii(config: RadialConfig, dayIndex: number): Ring {
  const pitch = config.ringThickness + config.ringGap
  const r0 = config.innerRadius + dayIndex * pitch
  return { r0, r1: r0 + config.ringThickness }
}

/** Total radius needed to draw `dayCount` rings, including room for a spur. */
export function radialExtent(config: RadialConfig, dayCount: number): number {
  if (dayCount <= 0) return config.innerRadius
  return ringRadii(config, dayCount - 1).r1 + config.spurHeight
}

/**
 * Canonical position within a virtual day, in [0, 24). Derived from wall-clock time, so
 * a repeated hour maps onto the same slot as its first occurrence -- the second
 * occurrence is drawn as a spur instead of overlapping.
 */
export function slotPosition(time: { hour: number; minute: number; second?: number }): number {
  return time.hour + time.minute / 60 + (time.second ?? 0) / 3600
}

/**
 * Slot position -> angle in d3-arc convention: 0 radians is 12 o'clock, increasing
 * clockwise. Midnight sits at the top and the day reads like a clock face.
 */
export function angleForSlot(slot: number, hoursPerRevolution: 24 | 12): number {
  return ((slot % hoursPerRevolution) / hoursPerRevolution) * TAU
}

/**
 * Which sub-band a slot falls in. Always 0 in 24h mode; in 12h mode, 0 = AM, 1 = PM,
 * which is how a day gets its "1 or 2 circles".
 *
 * Reduces to the WITHIN-DAY time first. Callers pass grid slots (hours from day 0's
 * midnight), and comparing those raw against 12 put every mark on every day but the
 * first into the PM band -- caught in the field as "everything looks overlapped in
 * 12h mode".
 */
export function subBandForSlot(slot: number, hoursPerRevolution: 24 | 12): 0 | 1 {
  if (hoursPerRevolution === HOURS_PER_DAY) return 0
  const withinDay = ((slot % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY
  return withinDay < 12 ? 0 : 1
}

/** Fraction of a band's thickness kept clear between the AM and PM sub-bands. */
const SUB_BAND_GAP = 0.18

/**
 * Split a ring into its sub-bands so 12h mode nests AM inside PM within one day band.
 * The gap matters: butted sub-bands read as two separate days rather than two halves
 * of one, which defeats the point of the mode.
 */
export function subBand(ring: Ring, subIndex: 0 | 1, hoursPerRevolution: 24 | 12): Ring {
  if (hoursPerRevolution === HOURS_PER_DAY) return ring
  const thickness = ring.r1 - ring.r0
  const half = (thickness * (1 - SUB_BAND_GAP)) / 2
  return subIndex === 0
    ? { r0: ring.r0, r1: ring.r0 + half }
    : { r0: ring.r1 - half, r1: ring.r1 }
}

const pathGen = d3arc()

/** SVG path data for an annular sector. Pure string out -- no DOM, no framework. */
export function arcPath(ring: Ring, startAngle: number, endAngle: number): string {
  return (
    pathGen({
      innerRadius: ring.r0,
      outerRadius: ring.r1,
      startAngle,
      endAngle,
    }) ?? ''
  )
}

/**
 * A zero-length event still has to be visible, so instants are drawn as a hairline
 * wedge rather than a degenerate arc.
 */
export const MIN_SWEEP = (6 / 60 / HOURS_PER_DAY) * TAU

export type Mark = {
  path: string
  /** Days past the start day this piece belongs to; lets a caller place it on the right ring. */
  dayOffset: number
  /** Set when this mark is the second pass of a repeated hour. */
  isSpur?: boolean
}

/**
 * Geometry for an event occupying [startSlot, endSlot) of a day band, where slots are
 * hours measured from the start day's local midnight (so 25.5 is 1:30am the next day).
 *
 * Split at every revolution boundary so each piece is drawable and can be placed on the
 * correct ring/sub-band. Sweep comes from the slot delta directly -- comparing angles
 * would make a zero-length instant indistinguishable from a full revolution.
 */
export function markFor(
  config: RadialConfig,
  ringAt: (dayOffset: number) => Ring | null,
  startSlot: number,
  endSlot: number,
): Mark[] {
  const per = config.hoursPerRevolution
  const end = Math.max(endSlot, startSlot)
  const marks: Mark[] = []

  let cursor = startSlot
  // An instant has no span to walk, so emit exactly one hairline segment.
  const boundaries: Array<[number, number]> = end === startSlot ? [[startSlot, startSlot]] : []

  while (cursor < end) {
    const nextBoundary = (Math.floor(cursor / per) + 1) * per
    const segEnd = Math.min(end, nextBoundary)
    boundaries.push([cursor, segEnd])
    cursor = segEnd
  }

  for (const [a, b] of boundaries) {
    const dayOffset = Math.floor(a / HOURS_PER_DAY)
    const ring = ringAt(dayOffset)
    if (!ring) continue

    const band = subBand(ring, subBandForSlot(a, per), per)
    const a0 = angleForSlot(a, per)
    const sweep = Math.max(((b - a) / per) * TAU, MIN_SWEEP)
    marks.push({ path: arcPath(band, a0, a0 + sweep), dayOffset })
  }
  return marks
}

/**
 * The extra hour on a fall-back day, drawn as a wedge stepped outward from the band so
 * the ring itself still closes at exactly 360 degrees, and the missing hour on a
 * spring-forward day, drawn as a void at normal width.
 *
 * Returns null for a Normal day -- `virtualDay(d).shape !== Normal` iff this is non-null.
 */
export function anomalyGeometry(
  config: RadialConfig,
  ring: Ring,
  day: VirtualDay,
): Mark | null {
  if (!day.anomaly) return null

  const per = config.hoursPerRevolution
  const start = day.anomaly.slotIndex
  const magnitudeHours = Math.abs(day.anomaly.delta.total({ unit: 'hour' }))
  const sweep = (magnitudeHours / per) * TAU

  // AtDayEnd cannot mean "after 24:00" on a ring -- the circle closes, so that angle IS
  // 00:00, indistinguishable from a day-start placement (and from an early at-transition
  // mark one wedge over). Abut midnight from the counter-clockwise side instead: the
  // segment ENDS exactly at the top, which reads as "appended at the end of the day".
  const atDayEnd = start >= HOURS_PER_DAY
  const a0 = atDayEnd ? TAU - sweep : angleForSlot(start, per)
  const a1 = a0 + sweep
  // A day-end mark occupies the last hour of the day, so in 12h mode it belongs to the
  // PM sub-band -- slot 24 would mod to 0 and land it in AM.
  const bandSlot = atDayEnd ? HOURS_PER_DAY - magnitudeHours : start
  const band = subBand(ring, subBandForSlot(bandSlot, per), per)

  if (day.shape === 'long') {
    // Stepped outside the band: the repeated hour is additional to a closed ring.
    const spur = { r0: band.r1, r1: band.r1 + config.spurHeight }
    return { path: arcPath(spur, a0, a1), dayOffset: 0, isSpur: true }
  }
  return { path: arcPath(band, a0, a1), dayOffset: 0 }
}

/** Hour ticks for one revolution, as angles. */
export function hourTicks(hoursPerRevolution: 24 | 12): number[] {
  return Array.from({ length: hoursPerRevolution }, (_, h) => angleForSlot(h, hoursPerRevolution))
}

/** Slot position of a ZonedDateTime, clamped into the day it belongs to. */
export function slotOf(t: Temporal.ZonedDateTime): number {
  return slotPosition(t)
}
