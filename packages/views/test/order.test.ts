import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { RingOrder, ringIndexFor } from '../src/order.js'
import { radialConfigForZoom } from '../src/config.js'
import { markFor, ringRadii, type Ring } from '../src/radial.js'

describe('ringIndexFor', () => {
  it('newest-out is the identity, newest-in reverses', () => {
    expect(ringIndexFor(0, 7, RingOrder.NewestOut)).toBe(0)
    expect(ringIndexFor(6, 7, RingOrder.NewestOut)).toBe(6)
    expect(ringIndexFor(0, 7, RingOrder.NewestIn)).toBe(6)
    expect(ringIndexFor(6, 7, RingOrder.NewestIn)).toBe(0)
  })

  it('is a permutation of 0..count-1 and its own inverse', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.constantFrom(...Object.values(RingOrder)),
        (count, order) => {
          const image = Array.from({ length: count }, (_, d) => ringIndexFor(d, count, order))
          expect([...image].sort((a, b) => a - b)).toEqual(
            Array.from({ length: count }, (_, i) => i),
          )
          for (let d = 0; d < count; d++) {
            expect(ringIndexFor(ringIndexFor(d, count, order), count, order)).toBe(d)
          }
        },
      ),
    )
  })
})

describe('ring order flip permutes ring assignment only', () => {
  // Marks as [startSlot, endSlot] grid spans; instants included as zero-length.
  const marksFor = (count: number): Array<[number, number]> => [
    [9, 17], // workday on day 0
    [10, 10], // instant inside it
    [24 * Math.max(0, count - 2) + 22, 24 * Math.max(0, count - 2) + 26], // spans midnight
    [24 * (count - 1) + 1.5, 24 * (count - 1) + 7.25],
  ]

  it('markFor output is byte-identical under both orders when radii are held constant', () => {
    // markFor sees the order ONLY through ringAt. Holding radii constant while still
    // routing every lookup through ringIndexFor proves angles, sweeps and sub-bands are
    // untouched by the flip -- radii are the single channel through which order acts.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 14 }),
        fc.constantFrom<24 | 12>(24, 12),
        (count, per) => {
          const cfg = radialConfigForZoom(count, { hoursPerRevolution: per })
          const fixed: Ring = { r0: 80, r1: 80 + cfg.ringThickness }
          const ringAt = (order: RingOrder) => (dayOffset: number) => {
            const i = ringIndexFor(dayOffset, count, order)
            return i >= 0 && i < count ? fixed : null
          }
          for (const [s, e] of marksFor(count)) {
            expect(markFor(cfg, ringAt(RingOrder.NewestIn), s, e)).toEqual(
              markFor(cfg, ringAt(RingOrder.NewestOut), s, e),
            )
          }
        },
      ),
    )
  })

  it('with real radii, the flip drops or creates no pieces and keeps dayOffsets', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 14 }),
        fc.constantFrom<24 | 12>(24, 12),
        (count, per) => {
          const cfg = radialConfigForZoom(count, { hoursPerRevolution: per })
          const ringAt = (order: RingOrder) => (dayOffset: number) => {
            const i = ringIndexFor(dayOffset, count, order)
            return i >= 0 && i < count ? ringRadii(cfg, i) : null
          }
          for (const [s, e] of marksFor(count)) {
            const out = markFor(cfg, ringAt(RingOrder.NewestOut), s, e)
            const inn = markFor(cfg, ringAt(RingOrder.NewestIn), s, e)
            expect(inn.map((p) => p.dayOffset)).toEqual(out.map((p) => p.dayOffset))
          }
        },
      ),
    )
  })

  it('a single-day mark under newest-in matches the mirrored day under newest-out exactly', () => {
    // Day d under newest-in occupies ring count-1-d -- the same ring the mirrored day
    // count-1-d occupies under newest-out. Shifting a mark by whole days preserves its
    // within-day time, so the two paths must be byte-identical: the flip moved radii and
    // nothing else.
    const count = 7
    for (const per of [24, 12] as const) {
      const cfg = radialConfigForZoom(count, { hoursPerRevolution: per })
      const ringAt = (order: RingOrder) => (dayOffset: number) => {
        const i = ringIndexFor(dayOffset, count, order)
        return i >= 0 && i < count ? ringRadii(cfg, i) : null
      }
      for (const day of [0, 2, 6]) {
        const s = day * 24 + 9.5
        const e = day * 24 + 16.25
        const mirrored = (count - 1 - day) * 24
        const flipped = markFor(cfg, ringAt(RingOrder.NewestIn), s, e)
        const shifted = markFor(
          cfg,
          ringAt(RingOrder.NewestOut),
          mirrored + 9.5,
          mirrored + 16.25,
        )
        expect(flipped.map((p) => p.path)).toEqual(shifted.map((p) => p.path))
      }
    }
  })
})
