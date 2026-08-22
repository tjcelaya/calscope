import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  INSET_PER_DEPTH,
  MAX_INSET_FRACTION,
  MIN_INSET,
  containmentDepth,
  insetRing,
  type Span,
} from '../src/inset.js'

const span = (startSlot: number, endSlot: number): Span => ({ startSlot, endSlot })

describe('containmentDepth', () => {
  it('a 3-deep ladder yields depths 0 / 1 / 2', () => {
    // The concurrency ladder from the fixture: meeting inside workday, break inside meeting.
    const ladder = [span(9, 17), span(10, 11), span(10.25, 10.75)]
    expect(containmentDepth(ladder)).toEqual([0, 1, 2])
  })

  it('is deterministic', () => {
    const spans = [span(0, 10), span(2, 8), span(3, 5), span(9, 12)]
    expect(containmentDepth(spans)).toEqual(containmentDepth(spans))
  })

  it('partial overlap contributes no depth', () => {
    // The 16:30 meeting straddling work's end: neither contains the other.
    expect(containmentDepth([span(9, 17), span(16.5, 18)])).toEqual([0, 0])
  })

  it('identical spans never contain each other (strictly-longer excludes twins)', () => {
    expect(containmentDepth([span(1, 2), span(1, 2)])).toEqual([0, 0])
  })

  it('a container sharing a boundary still counts when strictly longer', () => {
    expect(containmentDepth([span(9, 17), span(9, 11)])).toEqual([0, 1])
  })

  const spanArb = fc
    .record({
      startSlot: fc.integer({ min: 0, max: 96 }),
      len: fc.integer({ min: 0, max: 48 }),
    })
    .map(({ startSlot, len }) => span(startSlot, startSlot + len))

  it('is order-independent: permuting the input permutes the output identically', () => {
    fc.assert(
      fc.property(
        fc.array(spanArb, { minLength: 1, maxLength: 12 }).chain((spans) =>
          fc.tuple(fc.constant(spans), fc.shuffledSubarray(spans, { minLength: spans.length })),
        ),
        ([spans, shuffled]) => {
          const depthOf = new Map(
            spans.map((s, i) => [s, containmentDepth(spans)[i]] as const),
          )
          const shuffledDepths = containmentDepth(shuffled)
          shuffled.forEach((s, i) => {
            expect(shuffledDepths[i]).toBe(depthOf.get(s))
          })
        },
      ),
    )
  })
})

describe('insetRing', () => {
  it('depth 0 leaves the ring untouched', () => {
    const ring = { r0: 100, r1: 140 }
    expect(insetRing(ring, 0)).toEqual(ring)
  })

  it('insets 18% of thickness per level when between floor and cap', () => {
    const ring = { r0: 100, r1: 140 } // thickness 40
    expect(insetRing(ring, 1)).toEqual({
      r0: 100 + 40 * INSET_PER_DEPTH,
      r1: 140 - 40 * INSET_PER_DEPTH,
    })
  })

  it('applies the absolute floor on thin bands', () => {
    // 18% of 10 is 1.8px -- invisible on a phone; the floor keeps nesting legible.
    const ring = { r0: 100, r1: 110 }
    expect(insetRing(ring, 1)).toEqual({ r0: 100 + MIN_INSET, r1: 110 - MIN_INSET })
  })

  it('caps at 36% of thickness so deep nesting keeps a visible band', () => {
    const ring = { r0: 100, r1: 140 }
    const cap = 40 * MAX_INSET_FRACTION
    expect(insetRing(ring, 10)).toEqual({ r0: 100 + cap, r1: 140 - cap })
    // The cap guarantees r0 < r1 survives any depth: 2 * 0.36 < 1.
    const r = insetRing(ring, 1000)
    expect(r.r0).toBeLessThan(r.r1)
  })
})
