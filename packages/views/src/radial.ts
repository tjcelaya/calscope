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
  /** Set when this mark is the S-shaped bridge between two pieces of one crossing event. */
  isConnector?: boolean
}

/**
 * Half-width, in slots, of the crossover window straddling a revolution boundary: each
 * adjoining arc gives up this much of its span to the S-shaped bridge. Slot-based, so
 * the wall-clock window is the same in both modes (its angular width doubles in 12h,
 * like everything else).
 */
export const CROSSOVER_HALF_SLOTS = 0.25

/** Cartesian point for (angle, radius) in the d3-arc frame: 0 at 12 o'clock, clockwise. */
function radialPoint(angle: number, r: number): [number, number] {
  return [r * Math.sin(angle), -r * Math.cos(angle)]
}

/**
 * The S-shaped bridge across a revolution boundary (always the top ray): a band from the
 * end cross-section of one arc piece to the start cross-section of the next, whose long
 * sides are cubic curves leaving and arriving TANGENT to their arcs -- so the mark reads
 * as one continuous shape bending onto the next radius -- joined by radial edges that
 * butt flush against the trimmed arc ends.
 */
export function crossoverPath(from: Ring, to: Ring, halfAngle: number): string {
  const [p1x, p1y] = radialPoint(-halfAngle, from.r1)
  const [p0x, p0y] = radialPoint(-halfAngle, from.r0)
  const [q1x, q1y] = radialPoint(halfAngle, to.r1)
  const [q0x, q0y] = radialPoint(halfAngle, to.r0)
  // Unit tangents along increasing angle at each edge (derivative of radialPoint).
  const tpx = Math.cos(halfAngle)
  const tpy = -Math.sin(halfAngle)
  const tqx = Math.cos(halfAngle)
  const tqy = Math.sin(halfAngle)
  const kOut = Math.hypot(q1x - p1x, q1y - p1y) / 3
  const kIn = Math.hypot(q0x - p0x, q0y - p0y) / 3
  const c = (n: number) => Number(n.toFixed(3))
  return (
    `M${c(p1x)},${c(p1y)}` +
    `C${c(p1x + kOut * tpx)},${c(p1y + kOut * tpy)},${c(q1x - kOut * tqx)},${c(q1y - kOut * tqy)},${c(q1x)},${c(q1y)}` +
    `L${c(q0x)},${c(q0y)}` +
    `C${c(q0x - kIn * tqx)},${c(q0y - kIn * tqy)},${c(p0x + kIn * tpx)},${c(p0y + kIn * tpy)},${c(p0x)},${c(p0y)}` +
    'Z'
  )
}

export type MarkForOptions = {
  /**
   * Bridge revolution-boundary crossings with S-shaped connectors, trimming the
   * adjoining arc ends by the connector's half-width so the shapes tile exactly.
   * Off by default: backgrounds and callers that place pieces independently want the
   * plain split.
   */
  connect?: boolean
}

/**
 * Geometry for an event occupying [startSlot, endSlot) of a day band, where slots are
 * hours measured from the start day's local midnight (so 25.5 is 1:30am the next day).
 *
 * Split at every revolution boundary so each piece is drawable and can be placed on the
 * correct ring/sub-band. Sweep comes from the slot delta directly -- comparing angles
 * would make a zero-length instant indistinguishable from a full revolution.
 *
 * With `connect`, each crossing where BOTH sides land on a drawable ring also yields a
 * connector mark (tagged `isConnector`, placed on the destination piece's dayOffset),
 * and the two arcs are trimmed back to meet its radial edges. The union of trimmed arcs
 * plus connector covers exactly the same slots as the plain split -- the crossing is
 * re-rendered, never re-timed, which is what the locked-zoom invariant demands.
 */
export function markFor(
  config: RadialConfig,
  ringAt: (dayOffset: number) => Ring | null,
  startSlot: number,
  endSlot: number,
  options?: MarkForOptions,
): Mark[] {
  const per = config.hoursPerRevolution
  const end = Math.max(endSlot, startSlot)

  let cursor = startSlot
  // An instant has no span to walk, so emit exactly one hairline segment.
  const boundaries: Array<[number, number]> = end === startSlot ? [[startSlot, startSlot]] : []

  while (cursor < end) {
    const nextBoundary = (Math.floor(cursor / per) + 1) * per
    const segEnd = Math.min(end, nextBoundary)
    boundaries.push([cursor, segEnd])
    cursor = segEnd
  }

  type Piece = { a: number; b: number; dayOffset: number; band: Ring; trimStart: number; trimEnd: number }
  const pieces: Array<Piece | null> = boundaries.map(([a, b]) => {
    const dayOffset = Math.floor(a / HOURS_PER_DAY)
    const ring = ringAt(dayOffset)
    if (!ring) return null
    return { a, b, dayOffset, band: subBand(ring, subBandForSlot(a, per), per), trimStart: 0, trimEnd: 0 }
  })

  const connectors: Mark[] = []
  if (options?.connect === true) {
    for (let i = 0; i + 1 < pieces.length; i++) {
      const prev = pieces[i]
      const next = pieces[i + 1]
      if (!prev || !next) continue
      // A short piece cannot give up more than half of itself, or its two connectors
      // would swallow it whole and overlap each other.
      const half = Math.min(CROSSOVER_HALF_SLOTS, (prev.b - prev.a) / 2, (next.b - next.a) / 2)
      if (half <= 0) continue
      prev.trimEnd = half
      next.trimStart = half
      connectors.push({
        path: crossoverPath(prev.band, next.band, (half / per) * TAU),
        dayOffset: next.dayOffset,
        isConnector: true,
      })
    }
  }

  const marks: Mark[] = []
  for (const p of pieces) {
    if (!p) continue
    const trimmed = p.trimStart > 0 || p.trimEnd > 0
    const len = p.b - p.a - p.trimStart - p.trimEnd
    const a0 = angleForSlot(p.a, per) + (p.trimStart / per) * TAU
    if (trimmed && len <= 1e-9) continue
    // A trimmed piece must not be re-inflated to MIN_SWEEP -- it would overlap the
    // connector it was trimmed to meet.
    const sweep = trimmed ? (len / per) * TAU : Math.max((len / per) * TAU, MIN_SWEEP)
    marks.push({ path: arcPath(p.band, a0, a0 + sweep), dayOffset: p.dayOffset })
  }
  return [...marks, ...connectors]
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
