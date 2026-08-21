import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import {
  TAU,
  anomalyGeometry,
  arcPath,
  angleForSlot,
  defaultRadialConfig,
  hourTicks,
  markFor,
  ringRadii,
  subBand,
  subBandForSlot,
} from '../src/radial.js'
import { DayShape, DstPolicy, virtualDay } from '../src/virtual-day.js'

const NY = 'America/New_York'
const d = (s: string) => Temporal.PlainDate.from(s)
const cfg = defaultRadialConfig

// Zones with genuinely awkward rules, not just the easy US case.
const ZONES = [
  'America/New_York',
  'Europe/London',
  'Australia/Lord_Howe',
  'Asia/Tehran',
  'Pacific/Chatham',
  'America/Santiago',
]

describe('locked zoom', () => {
  it('slot geometry is identical for every day in every zone', () => {
    // THE invariant: slotSize(zoom), never slotSize(zoom, dayDurationHours).
    // If this fails, 3pm drifts between adjacent days and the views stop being comparable.
    const reference = angleForSlot(15, 24)

    for (const timeZone of ZONES) {
      for (let i = 0; i < 400; i++) {
        const day = virtualDay(d('2026-01-01').add({ days: i }), timeZone)
        // The scale function must not even accept the day's real length as input.
        expect(angleForSlot(15, 24)).toBe(reference)
        expect(day.actualHours).toBeGreaterThan(0)
      }
    }
  })

  it('ring radii depend on zoom config and index alone', () => {
    const a = ringRadii(cfg, 3)
    const b = ringRadii(cfg, 3)
    expect(a).toEqual(b)
    expect(a.r1 - a.r0).toBe(cfg.ringThickness)
  })

  it('consecutive rings never overlap', () => {
    for (let i = 1; i < 20; i++) {
      expect(ringRadii(cfg, i).r0).toBeGreaterThanOrEqual(ringRadii(cfg, i - 1).r1)
    }
  })

  it('a full day of hour slots sums to exactly one revolution on Long, Short and Normal days', () => {
    // The ring closes at 360 degrees regardless of DST -- the anomaly is drawn as an
    // extra mark, never by squeezing 25 hours into the same sweep.
    for (const date of ['2026-06-15', '2026-11-01', '2026-03-08']) {
      const day = virtualDay(d(date), NY)
      let total = 0
      for (let h = 0; h < 24; h++) {
        const a0 = angleForSlot(h, 24)
        const a1 = h === 23 ? TAU : angleForSlot(h + 1, 24)
        total += a1 - a0
      }
      expect(total).toBeCloseTo(TAU, 12)
      expect(day.actualHours).toBeGreaterThan(0)
    }
  })
})

describe('anomaly geometry', () => {
  it('is non-null exactly when the day is not Normal', () => {
    for (let i = 0; i < 400; i++) {
      const day = virtualDay(d('2026-01-01').add({ days: i }), NY)
      const geo = anomalyGeometry(cfg, ringRadii(cfg, 0), day)
      expect(geo !== null).toBe(day.shape !== DayShape.Normal)
    }
  })

  it('draws a fall-back day as a spur stepped OUTSIDE the ring band', () => {
    const day = virtualDay(d('2026-11-01'), NY)
    const geo = anomalyGeometry(cfg, ringRadii(cfg, 0), day)
    expect(geo?.isSpur).toBe(true)
    expect(geo?.path).toMatch(/^M/)
  })

  it('draws a spring-forward day as a void at normal width, not a spur', () => {
    const day = virtualDay(d('2026-03-08'), NY)
    const geo = anomalyGeometry(cfg, ringRadii(cfg, 0), day)
    expect(geo?.isSpur).toBeUndefined()
    expect(geo?.path).toMatch(/^M/)
  })

  it('AtDayEnd abuts midnight from the counter-clockwise side, never colliding with day start', () => {
    // On a ring, "after 24:00" is the same angle as 00:00 -- drawing there would be
    // indistinguishable from a day-start placement. The segment must END at the top.
    const ring = ringRadii(cfg, 0)
    const spurBand = { r0: ring.r1, r1: ring.r1 + cfg.spurHeight }
    const sweep = TAU / 24

    const geo = anomalyGeometry(cfg, ring, virtualDay(d('2026-11-01'), NY, DstPolicy.AtDayEnd))!
    expect(geo.path).toBe(arcPath(spurBand, TAU - sweep, TAU))
    expect(geo.path).not.toBe(arcPath(spurBand, 0, sweep))
  })

  it('both DstPolicy values produce a mark -- only its position differs', () => {
    // Placement must never drop or duplicate a mark.
    const ring = ringRadii(cfg, 0)
    const atTransition = anomalyGeometry(cfg, ring, virtualDay(d('2026-11-01'), NY, DstPolicy.AtTransition))
    const atDayEnd = anomalyGeometry(cfg, ring, virtualDay(d('2026-11-01'), NY, DstPolicy.AtDayEnd))

    expect(atTransition).not.toBeNull()
    expect(atDayEnd).not.toBeNull()
    expect(atTransition!.isSpur).toBe(atDayEnd!.isSpur)
    expect(atTransition!.path).not.toBe(atDayEnd!.path)
  })
})

describe('marks', () => {
  const ringAt = (i: number) => (i < 8 ? ringRadii(cfg, i) : null)

  it('renders a zero-length instant as a visible hairline, NOT a full revolution', () => {
    // Regression: comparing angles made a zero span wrap to a0 + TAU, so every instant
    // event painted an entire ring.
    const marks = markFor(cfg, ringAt, 9, 9)
    expect(marks).toHaveLength(1)
    expect(marks[0]!.dayOffset).toBe(0)

    const full = markFor(cfg, ringAt, 0, 24)
    expect(marks[0]!.path).not.toBe(full[0]!.path)
    expect(marks[0]!.path.length).toBeLessThan(full[0]!.path.length)
  })

  it('sweep grows monotonically with duration', () => {
    const widths = [0, 1, 4, 12, 23].map((h) => markFor(cfg, ringAt, 0, h)[0]!.path.length)
    expect(widths[0]).toBeLessThanOrEqual(widths[1]!)
  })

  it('splits an event crossing midnight onto the following ring', () => {
    // 23:30 + 7h of sleep belongs partly to tomorrow.
    const marks = markFor(cfg, ringAt, 23.5, 30.5)
    expect(marks).toHaveLength(2)
    expect(marks[0]!.dayOffset).toBe(0)
    expect(marks[1]!.dayOffset).toBe(1)
  })

  it('drops segments that fall outside the visible rings instead of misplacing them', () => {
    const marks = markFor(cfg, (i) => (i === 0 ? ringRadii(cfg, 0) : null), 23.5, 30.5)
    expect(marks).toHaveLength(1)
    expect(marks[0]!.dayOffset).toBe(0)
  })

  it('splits a sweep that crosses the AM/PM boundary in 12h mode', () => {
    const twelve = { ...cfg, hoursPerRevolution: 12 as const }
    expect(markFor(twelve, ringAt, 11, 13)).toHaveLength(2)
    expect(markFor(twelve, ringAt, 1, 3)).toHaveLength(1)
  })

  it('puts AM and PM in separate sub-bands in 12h mode only', () => {
    const ring = ringRadii(cfg, 0)
    expect(subBandForSlot(9, 12)).toBe(0)
    expect(subBandForSlot(21, 12)).toBe(1)
    expect(subBandForSlot(21, 24)).toBe(0)
    expect(subBand(ring, 0, 24)).toEqual(ring)
    expect(subBand(ring, 0, 12).r1).toBeLessThan(ring.r1)
  })

  it('emits one tick per hour of a revolution, starting at 12 o clock', () => {
    expect(hourTicks(24)).toHaveLength(24)
    expect(hourTicks(12)).toHaveLength(12)
    expect(hourTicks(24)[0]).toBe(0)
  })
})

describe('12h sub-bands', () => {
  it('leaves a visible gap between AM and PM so they do not read as separate days', () => {
    const ring = ringRadii(cfg, 0)
    const am = subBand(ring, 0, 12)
    const pm = subBand(ring, 1, 12)

    expect(am.r1).toBeLessThan(pm.r0)
    expect(am.r0).toBe(ring.r0)
    expect(pm.r1).toBe(ring.r1)
    expect(am.r1 - am.r0).toBeCloseTo(pm.r1 - pm.r0, 9)
  })

  it('never lets a sub-band escape its parent ring', () => {
    for (let i = 0; i < 12; i++) {
      const ring = ringRadii(cfg, i)
      for (const sub of [0, 1] as const) {
        const b = subBand(ring, sub, 12)
        expect(b.r0).toBeGreaterThanOrEqual(ring.r0)
        expect(b.r1).toBeLessThanOrEqual(ring.r1)
      }
    }
  })
})
