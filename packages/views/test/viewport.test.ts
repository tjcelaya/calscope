import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import { snapViewport, type Interval } from '../src/viewport.js'
import { DayShape, virtualDay, type VirtualDay } from '../src/virtual-day.js'

const d = (s: string) => Temporal.PlainDate.from(s)

function week(start: string, timeZone: string): VirtualDay[] {
  const first = d(start)
  return Array.from({ length: 7 }, (_, i) => virtualDay(first.add({ days: i }), timeZone))
}

const startOf = (day: VirtualDay) =>
  day.date.toZonedDateTime({ timeZone: day.timeZone, plainTime: '00:00' }).toInstant()
const endOf = (day: VirtualDay) =>
  day.date.add({ days: 1 }).toZonedDateTime({ timeZone: day.timeZone, plainTime: '00:00' }).toInstant()

const strictlyInside = (t: Temporal.Instant, day: VirtualDay) =>
  Temporal.Instant.compare(startOf(day), t) < 0 && Temporal.Instant.compare(t, endOf(day)) < 0

// Transition weeks in an easy zone and a genuinely awkward one (30-minute shift).
const WEEKS: Array<{ label: string; days: VirtualDay[] }> = [
  { label: 'NY spring forward', days: week('2026-03-08', 'America/New_York') },
  { label: 'NY fall back', days: week('2026-11-01', 'America/New_York') },
  { label: 'Lord Howe fall back', days: week('2026-04-05', 'Australia/Lord_Howe') },
  { label: 'Lord Howe spring forward', days: week('2026-10-04', 'Australia/Lord_Howe') },
]

describe('snapViewport', () => {
  it('the chosen weeks actually contain an anomaly (fixture sanity)', () => {
    for (const { label, days } of WEEKS) {
      expect(days.some((day) => day.shape !== DayShape.Normal), label).toBe(true)
    }
  })

  it('no-ops when every day is Normal', () => {
    const days = week('2026-01-05', 'America/New_York')
    const range: Interval = {
      start: startOf(days[0]!).add({ hours: 7 }),
      end: startOf(days[4]!).add({ hours: 13, minutes: 30 }),
    }
    // Same object back, not just equal values -- nothing to snap, nothing allocated.
    expect(snapViewport(range, days)).toBe(range)
  })

  it('snaps a boundary falling inside an anomalous day out to the day edge', () => {
    for (const { label, days } of WEEKS) {
      const anomalous = days.find((day) => day.shape !== DayShape.Normal)!
      const range: Interval = {
        start: startOf(anomalous).add({ hours: 5 }),
        end: startOf(anomalous).add({ hours: 90 }),
      }
      const snapped = snapViewport(range, days)
      expect(snapped.start.equals(startOf(anomalous)), label).toBe(true)
      // End fell on a Normal day, so it stays put.
      expect(snapped.end.equals(range.end), label).toBe(true)
    }
  })

  it('a range entirely inside the anomalous day widens to the whole day', () => {
    for (const { label, days } of WEEKS) {
      const anomalous = days.find((day) => day.shape !== DayShape.Normal)!
      const range: Interval = {
        start: startOf(anomalous).add({ hours: 4 }),
        end: startOf(anomalous).add({ hours: 11 }),
      }
      const snapped = snapViewport(range, days)
      expect(snapped.start.equals(startOf(anomalous)), label).toBe(true)
      expect(snapped.end.equals(endOf(anomalous)), label).toBe(true)
    }
  })

  const hoursIntoWeek = fc.double({ min: 0, max: 7 * 24, noNaN: true })

  it('idempotent, only widens, each end by less than one day, anomaly never half-in-range', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WEEKS),
        hoursIntoWeek,
        hoursIntoWeek,
        ({ days }, a, b) => {
          const origin = startOf(days[0]!)
          const [lo, hi] = a <= b ? [a, b] : [b, a]
          const range: Interval = {
            start: origin.add({ seconds: Math.round(lo * 3600) }),
            end: origin.add({ seconds: Math.round(hi * 3600) }),
          }
          const once = snapViewport(range, days)
          const twice = snapViewport(once, days)

          // Idempotent: a snapped boundary sits ON a day edge, never inside one.
          expect(twice.start.equals(once.start)).toBe(true)
          expect(twice.end.equals(once.end)).toBe(true)

          // Only ever widens.
          expect(Temporal.Instant.compare(once.start, range.start)).toBeLessThanOrEqual(0)
          expect(Temporal.Instant.compare(once.end, range.end)).toBeGreaterThanOrEqual(0)

          // ...and by less than one day per end (a day is at most 25h).
          expect(once.start.until(range.start).total({ unit: 'hour' })).toBeLessThan(25)
          expect(range.end.until(once.end).total({ unit: 'hour' })).toBeLessThan(25)

          // The point of it all: no anomalous day is partially in range.
          for (const day of days) {
            if (day.shape === DayShape.Normal) continue
            expect(strictlyInside(once.start, day)).toBe(false)
            expect(strictlyInside(once.end, day)).toBe(false)
          }
        },
      ),
    )
  })
})
