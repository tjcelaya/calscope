import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { radialConfigForZoom } from '../src/config.js'
import { ringRadii } from '../src/radial.js'

describe('radialConfigForZoom', () => {
  it('is a pure function of zoom: equal zoom gives identical config, no date or zone input exists', () => {
    // Locked zoom: the signature itself is the invariant -- there is no parameter through
    // which a date, zone or day length could leak in. Equal zoom, byte-equal geometry.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (rings) => {
        expect(radialConfigForZoom(rings)).toEqual(radialConfigForZoom(rings))
      }),
    )
  })

  it('thickness is monotone non-increasing in ring count', () => {
    let prev = Infinity
    for (let rings = 1; rings <= 60; rings++) {
      const t = radialConfigForZoom(rings).ringThickness
      expect(t).toBeLessThanOrEqual(prev)
      prev = t
    }
  })

  it('thickness is clamped to [14, 44] for any ring count', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (rings) => {
        const t = radialConfigForZoom(rings).ringThickness
        expect(t).toBeGreaterThanOrEqual(14)
        expect(t).toBeLessThanOrEqual(44)
      }),
    )
  })

  it('fills the target radius exactly when unclamped', () => {
    // 5 rings sits inside the clamp band: (250 - 52) / 5 - 6 = 33.6.
    const rings = 5
    const cfg = radialConfigForZoom(rings)
    expect(cfg.ringThickness).toBeCloseTo(33.6, 10)
    // Outer edge of the last ring plus its trailing gap lands on the target.
    expect(ringRadii(cfg, rings - 1).r1 + cfg.ringGap).toBeCloseTo(250, 9)
  })

  it('spur height scales with thickness, floored at 6', () => {
    const thick = radialConfigForZoom(2) // thickness clamps to 44
    expect(thick.ringThickness).toBe(44)
    expect(thick.spurHeight).toBeCloseTo(44 * 0.4, 10)

    const thin = radialConfigForZoom(60) // thickness clamps to 14; 0.4 * 14 = 5.6 < 6
    expect(thin.ringThickness).toBe(14)
    expect(thin.spurHeight).toBe(6)
  })

  it('respects options and passes hoursPerRevolution through', () => {
    const cfg = radialConfigForZoom(7, {
      innerRadius: 40,
      ringGap: 4,
      targetRadius: 300,
      hoursPerRevolution: 12,
    })
    expect(cfg.innerRadius).toBe(40)
    expect(cfg.ringGap).toBe(4)
    expect(cfg.hoursPerRevolution).toBe(12)
    expect(cfg.ringThickness).toBeCloseTo((300 - 40) / 7 - 4, 10)
  })
})
