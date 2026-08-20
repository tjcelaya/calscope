import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { DayShape, DstPolicy, HOURS_PER_DAY, virtualDay } from '../src/virtual-day.js'

const NY = 'America/New_York'
const LORD_HOWE = 'Australia/Lord_Howe'

const d = (s: string) => Temporal.PlainDate.from(s)

describe('virtualDay', () => {
  it('classifies an ordinary day as Normal with no anomaly', () => {
    const vd = virtualDay(d('2026-06-15'), NY)
    expect(vd.shape).toBe(DayShape.Normal)
    expect(vd.actualHours).toBe(24)
    expect(vd.anomaly).toBeUndefined()
  })

  it('classifies the US fall-back day as Long (25h)', () => {
    const vd = virtualDay(d('2026-11-01'), NY)
    expect(vd.shape).toBe(DayShape.Long)
    expect(vd.actualHours).toBe(25)
    expect(vd.anomaly?.delta.total({ unit: 'hour' })).toBe(1)
  })

  it('classifies the US spring-forward day as Short (23h)', () => {
    const vd = virtualDay(d('2026-03-08'), NY)
    expect(vd.shape).toBe(DayShape.Short)
    expect(vd.actualHours).toBe(23)
    expect(vd.anomaly?.delta.total({ unit: 'hour' })).toBe(-1)
  })

  it('handles Lord Howe half-hour shifts -- delta is a Duration, not an hour count', () => {
    // Lord Howe shifts by 30 minutes, which an integer hour count would silently mangle.
    const shifts = [d('2026-04-05'), d('2026-10-04')]
      .map((date) => virtualDay(date, LORD_HOWE))
      .filter((vd) => vd.shape !== DayShape.Normal)

    expect(shifts.length).toBeGreaterThan(0)
    for (const vd of shifts) {
      expect(Math.abs(vd.actualHours - HOURS_PER_DAY)).toBeCloseTo(0.5, 9)
      expect(Math.abs(vd.anomaly!.delta.total({ unit: 'minute' }))).toBe(30)
    }
  })

  it('shape !== Normal iff an anomaly is present', () => {
    for (let i = 0; i < 400; i++) {
      const vd = virtualDay(d('2026-01-01').add({ days: i }), NY)
      expect(vd.anomaly !== undefined).toBe(vd.shape !== DayShape.Normal)
    }
  })

  it('AtDayEnd moves the anomaly to the day boundary without changing its magnitude', () => {
    const atTransition = virtualDay(d('2026-11-01'), NY, DstPolicy.AtTransition)
    const atDayEnd = virtualDay(d('2026-11-01'), NY, DstPolicy.AtDayEnd)

    expect(atTransition.anomaly!.slotIndex).toBeLessThan(HOURS_PER_DAY)
    expect(atDayEnd.anomaly!.slotIndex).toBe(HOURS_PER_DAY)
    expect(atDayEnd.anomaly!.delta.total({ unit: 'hour' })).toBe(
      atTransition.anomaly!.delta.total({ unit: 'hour' }),
    )
  })
})
