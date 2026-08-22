import type { RadialConfig } from './radial.js'

export type RadialZoomOptions = {
  /** Radius of the innermost ring's inner edge. Raised relative to thickness because the
   * innermost bands are the binding legibility constraint, not ring count. */
  innerRadius?: number
  /** Gap between adjacent day bands. */
  ringGap?: number
  /** Outer radius the rings should fill. Thickness is derived from it, not vice versa. */
  targetRadius?: number
  hoursPerRevolution?: 24 | 12
}

const DEFAULTS = {
  innerRadius: 52,
  ringGap: 6,
  targetRadius: 250,
  hoursPerRevolution: 24,
} as const

/** Thickness clamp: below 14 containment insets vanish on a phone; above 44 few rings
 * read as a doughnut chart rather than a calendar. */
const MIN_THICKNESS = 14
const MAX_THICKNESS = 44

/**
 * Zoom-derived radial geometry. Zoom on the radial view IS the ring count, and this is
 * the `slotSize(zoom)` function of the locked-zoom invariant: a pure function of zoom
 * (plus static options) -- it takes no date, no zone, no day length, so equal zoom gives
 * byte-identical geometry everywhere and adjacent days stay visually comparable.
 *
 * Fewer rings fill the same target radius with thicker bands, which is what keeps
 * containment nesting legible at phone scale (relative insets of a constant thickness
 * were invisible on a Razr).
 */
export function radialConfigForZoom(rings: number, opts: RadialZoomOptions = {}): RadialConfig {
  const inner = opts.innerRadius ?? DEFAULTS.innerRadius
  const gap = opts.ringGap ?? DEFAULTS.ringGap
  const target = opts.targetRadius ?? DEFAULTS.targetRadius
  const count = Math.max(1, Math.floor(rings))

  const thickness = Math.max(MIN_THICKNESS, Math.min(MAX_THICKNESS, (target - inner) / count - gap))

  return {
    innerRadius: inner,
    ringGap: gap,
    ringThickness: thickness,
    // Spur height scales with ring pitch (spike finding: a constant spur reads as a
    // stray mark at 14 rings), floored so it never vanishes at minimum thickness.
    spurHeight: Math.max(6, thickness * 0.4),
    hoursPerRevolution: opts.hoursPerRevolution ?? DEFAULTS.hoursPerRevolution,
  }
}
