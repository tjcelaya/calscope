import type { Ring } from './radial.js'

/** A mark's grid span in slots (hours from day 0's midnight). Instants are not spans --
 * filter them out before computing containment. */
export type Span = { startSlot: number; endSlot: number }

/**
 * Containment depth per span: the count of STRICTLY-LONGER spans fully containing it.
 * Radial inset encodes this depth so interval-inside-interval reads as nesting instead
 * of "the inner one replaces the outer" under overpainting.
 *
 * Strictly-longer is what makes it deterministic and order-independent: two identical
 * spans can never contain each other (a span is never strictly longer than itself or its
 * twin), so no tie needs breaking by input order. Partial overlap contributes nothing --
 * it has its own (still open) encoding rule.
 */
export function containmentDepth(spans: readonly Span[]): number[] {
  return spans.map(
    (a) =>
      spans.filter(
        (b) =>
          b.startSlot <= a.startSlot &&
          a.endSlot <= b.endSlot &&
          b.endSlot - b.startSlot > a.endSlot - a.startSlot,
      ).length,
  )
}

/** Fraction of band thickness removed per containment level. */
export const INSET_PER_DEPTH = 0.18
/** Cap as a fraction of thickness, so 3-deep still leaves a visible band. */
export const MAX_INSET_FRACTION = 0.36
/** Absolute floor in px: 18% of a thin band is a couple of physical pixels on a phone,
 * which made nesting invisible in the field. */
export const MIN_INSET = 2.5

/**
 * Inset a ring band symmetrically by containment depth, so the container stays visible
 * on both radial sides of the contained mark.
 */
export function insetRing(ring: Ring, depth: number): Ring {
  if (depth <= 0) return ring
  const t = ring.r1 - ring.r0
  const k = Math.min(Math.max(depth * INSET_PER_DEPTH * t, MIN_INSET), MAX_INSET_FRACTION * t)
  return { r0: ring.r0 + k, r1: ring.r1 - k }
}
