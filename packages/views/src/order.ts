/**
 * Which end of the radius the newest day occupies. Persisted user setting in M2, so it
 * follows the enum convention: as-const object + derived union, never a TS enum.
 */
export const RingOrder = {
  NewestOut: 'newest-out',
  NewestIn: 'newest-in',
} as const
export type RingOrder = (typeof RingOrder)[keyof typeof RingOrder]

/**
 * Day index (0 = oldest) -> ring index (0 = innermost). A pure permutation -- and its
 * own inverse -- of the day->ring assignment; nothing else in the pipeline may depend
 * on order. Angles, sweeps and sub-bands are functions of within-day time alone, so
 * flipping the order changes ring radii and nothing else.
 */
export function ringIndexFor(dayIndex: number, count: number, order: RingOrder): number {
  return order === RingOrder.NewestIn ? count - 1 - dayIndex : dayIndex
}
