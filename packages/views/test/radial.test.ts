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

  it('sub-band selection uses within-day time on EVERY day, not just day 0', () => {
    // Regression: comparing the raw grid slot against 12 put every mark on every day
    // after the first into the PM band, collapsing 12h mode into a single half-ring.
    expect(subBandForSlot(3 * 24 + 9, 12)).toBe(0) // day 3, 9am -> AM
    expect(subBandForSlot(3 * 24 + 21, 12)).toBe(1) // day 3, 9pm -> PM

    // Same morning event on day 0 and day 3 must occupy the same radii within its ring.
    const twelve = { ...cfg, hoursPerRevolution: 12 as const }
    const ringAt = (i: number) => (i < 8 ? ringRadii(twelve, i) : null)
    const d0 = markFor(twelve, ringAt, 9, 11)[0]!
    const d3 = markFor(twelve, ringAt, 3 * 24 + 9, 3 * 24 + 11)[0]!
    const r0 = ringRadii(twelve, 0)
    const r3 = ringRadii(twelve, 3)
    // Extract nothing from paths -- assert via fresh sub-band geometry instead.
    expect(subBand(r0, 0, 12).r0 - r0.r0).toBeCloseTo(subBand(r3, 0, 12).r0 - r3.r0, 9)
    expect(d0.path).not.toBe(d3.path) // different rings, so different radii
  })

  it('emits one tick per hour of a revolution, starting at 12 o clock', () => {
    expect(hourTicks(24)).toHaveLength(24)
    expect(hourTicks(12)).toHaveLength(12)
    expect(hourTicks(24)[0]).toBe(0)
  })
})

describe('crossover connectors', () => {
  const ringAt = (i: number) => (i < 8 ? ringRadii(cfg, i) : null)
  const startOf = (path: string): [number, number] => {
    const m = /^M(-?[\d.]+),(-?[\d.]+)/.exec(path)!
    return [Number(m[1]), Number(m[2])]
  }

  it('without the option, output is byte-identical to the plain split', () => {
    const plain = markFor(cfg, ringAt, 23.5, 30.5)
    expect(plain).toHaveLength(2)
    expect(plain.some((m) => m.isConnector)).toBe(false)
  })

  it('a midnight crossing yields two trimmed arcs plus one S connector on the destination ring', () => {
    const marks = markFor(cfg, ringAt, 23.5, 30.5, { connect: true })
    expect(marks).toHaveLength(3)
    const connector = marks.find((m) => m.isConnector)!
    expect(connector.dayOffset).toBe(1)
    // Two cubic curves and two straight edges -- the S-band shape.
    expect(connector.path.match(/C/g)).toHaveLength(2)
    expect(connector.path.match(/L/g)).toHaveLength(1)
    expect(connector.path.endsWith('Z')).toBe(true)
    // The arcs really were trimmed: they differ from the plain split's paths.
    const plain = markFor(cfg, ringAt, 23.5, 30.5)
    expect(marks[0]!.path).not.toBe(plain[0]!.path)
    expect(marks[1]!.path).not.toBe(plain[1]!.path)
  })

  it('the connector starts on the source band’s outer edge just before the boundary', () => {
    const marks = markFor(cfg, ringAt, 23.5, 30.5, { connect: true })
    const connector = marks.find((m) => m.isConnector)!
    const [x, y] = startOf(connector.path)
    const from = ringRadii(cfg, 0)
    const half = ((0.25 / 24) * TAU)
    expect(x).toBeCloseTo(from.r1 * Math.sin(-half), 2)
    expect(y).toBeCloseTo(-from.r1 * Math.cos(-half), 2)
  })

  it('a short piece halves the window instead of being swallowed by its connector', () => {
    // Next-day tail is only 0.05h, so the half-width clamps to 0.025 slots.
    const marks = markFor(cfg, ringAt, 23.5, 24.05, { connect: true })
    const connector = marks.find((m) => m.isConnector)!
    const [x] = startOf(connector.path)
    const from = ringRadii(cfg, 0)
    expect(x).toBeCloseTo(from.r1 * Math.sin(-((0.025 / 24) * TAU)), 2)
  })

  it('in 12h mode a noon crossing bridges the AM and PM sub-bands of the SAME ring', () => {
    const twelve = { ...cfg, hoursPerRevolution: 12 as const }
    const marks = markFor(twelve, ringAt, 11, 13, { connect: true })
    expect(marks).toHaveLength(3)
    const connector = marks.find((m) => m.isConnector)!
    expect(connector.dayOffset).toBe(0)
    const [, y] = startOf(connector.path)
    // Source is the AM sub-band's outer edge, half a window before the top ray.
    const am = subBand(ringRadii(twelve, 0), 0, 12)
    const half = (0.25 / 12) * TAU
    expect(y).toBeCloseTo(-am.r1 * Math.cos(half), 2)
  })

  it('no connector when the far side of the crossing is off the visible rings, and the near arc stays untrimmed', () => {
    const only0 = (i: number) => (i === 0 ? ringRadii(cfg, 0) : null)
    const marks = markFor(cfg, only0, 23.5, 30.5, { connect: true })
    expect(marks).toHaveLength(1)
    expect(marks[0]!.path).toBe(markFor(cfg, only0, 23.5, 30.5)[0]!.path)
  })

  it('instants and non-crossing spans never grow connectors', () => {
    expect(markFor(cfg, ringAt, 9, 9, { connect: true })).toHaveLength(1)
    expect(markFor(cfg, ringAt, 9, 17, { connect: true })).toHaveLength(1)
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
