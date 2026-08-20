import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import {
  type Interval,
  difference,
  intersect,
  normalize,
  normalizeWindows,
  totalMs,
  union,
} from '../src/time/interval.js'

const inst = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms)
const iv = (a: number, b: number): Interval => ({ start: inst(a), end: inst(b) })

const arbInterval = fc
  .tuple(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 500 }))
  .map(([start, len]) => iv(start, start + len))

const arbSet = fc.array(arbInterval, { maxLength: 12 })

const asPairs = (xs: readonly Interval[]) =>
  xs.map((i) => [i.start.epochMilliseconds, i.end.epochMilliseconds])

describe('interval algebra', () => {
  it('normalize sorts, drops empties and merges overlapping or touching runs', () => {
    expect(asPairs(normalize([iv(5, 7), iv(0, 3), iv(2, 4), iv(9, 9), iv(7, 8)]))).toEqual([
      [0, 4],
      [5, 8],
    ])
  })

  it('normalize is idempotent', () => {
    fc.assert(
      fc.property(arbSet, (xs) => {
        const once = normalize(xs)
        expect(asPairs(normalize(once))).toEqual(asPairs(once))
      }),
    )
  })

  it('normalize output never overlaps and is strictly ordered', () => {
    fc.assert(
      fc.property(arbSet, (xs) => {
        const out = normalize(xs)
        for (let i = 1; i < out.length; i++) {
          expect(out[i - 1]!.end.epochMilliseconds).toBeLessThan(out[i]!.start.epochMilliseconds)
        }
      }),
    )
  })

  it('union is commutative and associative', () => {
    fc.assert(
      fc.property(arbSet, arbSet, arbSet, (a, b, c) => {
        expect(asPairs(union(a, b))).toEqual(asPairs(union(b, a)))
        expect(asPairs(union(union(a, b), c))).toEqual(asPairs(union(a, union(b, c))))
      }),
    )
  })

  it('intersect covers the same POINT SET regardless of operand order', () => {
    // intersect is deliberately asymmetric -- the left operand supplies window
    // structure, the right is only a mask -- so commutativity holds on the covered
    // point set rather than on the window subdivision.
    fc.assert(
      fc.property(arbSet, arbSet, arbSet, (a, b, c) => {
        expect(asPairs(normalize(intersect(a, b)))).toEqual(asPairs(normalize(intersect(b, a))))
        expect(asPairs(normalize(intersect(intersect(a, b), c)))).toEqual(
          asPairs(normalize(intersect(a, intersect(b, c)))),
        )
      }),
    )
  })

  it('intersect keeps the LEFT operand window structure', () => {
    // Three daily windows masked by one long span stay three windows...
    const days = [iv(0, 10), iv(10, 20), iv(20, 30)]
    expect(asPairs(intersect(days, [iv(5, 25)]))).toEqual([
      [5, 10],
      [10, 20],
      [20, 25],
    ])
    // ...but with the operands swapped, the single span stays a single window.
    expect(asPairs(intersect([iv(5, 25)], days))).toEqual([[5, 25]])
  })

  it('difference is exact at boundaries: |a| = |a-b| + |a and b|', () => {
    fc.assert(
      fc.property(arbSet, arbSet, (a, b) => {
        expect(totalMs(difference(a, b)) + totalMs(intersect(a, b))).toBe(totalMs(a))
      }),
    )
  })

  it('a minus itself is empty; a minus nothing is a', () => {
    fc.assert(
      fc.property(arbSet, (a) => {
        expect(difference(a, a)).toEqual([])
        expect(asPairs(difference(a, []))).toEqual(asPairs(normalizeWindows(a)))
      }),
    )
  })

  it('difference removes an interior bite, leaving both sides', () => {
    expect(asPairs(difference([iv(0, 10)], [iv(3, 5)]))).toEqual([
      [0, 3],
      [5, 10],
    ])
  })

  it('half-open semantics: touching intervals do not intersect', () => {
    expect(intersect([iv(0, 5)], [iv(5, 10)])).toEqual([])
  })

  it('normalize merges touching runs but normalizeWindows keeps them distinct', () => {
    // The distinction is load-bearing. Point-set algebra says [0,5) + [5,10) is [0,10).
    // Window algebra says they are two adjacent days and must stay two windows,
    // otherwise a week of daily goals collapses into a single blob.
    expect(asPairs(normalize([iv(0, 5), iv(5, 10)]))).toEqual([[0, 10]])
    expect(asPairs(normalizeWindows([iv(0, 5), iv(5, 10)]))).toEqual([
      [0, 5],
      [5, 10],
    ])
    // Genuinely overlapping windows still merge.
    expect(asPairs(normalizeWindows([iv(0, 6), iv(5, 10)]))).toEqual([[0, 10]])
  })
})
