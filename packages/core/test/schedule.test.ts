import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { CalendarUnit, PredicateRef, ScheduleKind } from '../src/model/enums.js'
import type { Entry, Schedule } from '../src/model/types.js'
import { occurrences } from '../src/schedule/evaluate.js'
import { dayLengthHours } from '../src/time/calendar.js'
import type { Interval } from '../src/time/interval.js'

const NY = 'America/New_York'

function range(startIso: string, endIso: string, tz = NY): Interval {
  return {
    start: Temporal.PlainDate.from(startIso).toZonedDateTime({ timeZone: tz, plainTime: '00:00' }).toInstant(),
    end: Temporal.PlainDate.from(endIso).toZonedDateTime({ timeZone: tz, plainTime: '00:00' }).toInstant(),
  }
}

const hours = (i: Interval) => (i.end.epochMilliseconds - i.start.epochMilliseconds) / 3_600_000

describe('calendar windows', () => {
  const daily: Schedule = { t: ScheduleKind.Calendar, unit: CalendarUnit.Day, tz: NY }

  it('emits one window per local day', () => {
    expect(occurrences(daily, range('2026-06-01', '2026-06-08'))).toHaveLength(7)
  })

  it('windows tile the range with no gaps and no overlaps', () => {
    const out = occurrences(daily, range('2026-06-01', '2026-06-08'))
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.start.epochMilliseconds).toBe(out[i - 1]!.end.epochMilliseconds)
    }
  })

  it('a fall-back day is 25 hours long, not 24', () => {
    // The whole reason windows use PlainDate -> startOfDay rather than start + 24h.
    const out = occurrences(daily, range('2026-11-01', '2026-11-02'))
    expect(out).toHaveLength(1)
    expect(hours(out[0]!)).toBe(25)
    expect(dayLengthHours(Temporal.PlainDate.from('2026-11-01'), NY)).toBe(25)
  })

  it('a spring-forward day is 23 hours long', () => {
    const out = occurrences(daily, range('2026-03-08', '2026-03-09'))
    expect(hours(out[0]!)).toBe(23)
  })

  it('a week containing a DST transition is 167 or 169 hours, and still one window', () => {
    const weekly: Schedule = { t: ScheduleKind.Calendar, unit: CalendarUnit.Week, tz: NY }
    const out = occurrences(weekly, range('2026-11-02', '2026-11-03'))
    expect(out).toHaveLength(1)
    expect(hours(out[0]!)).toBe(168)

    const dstWeek = occurrences(weekly, range('2026-10-27', '2026-10-28'))
    expect(hours(dstWeek[0]!)).toBe(169)
  })

  it('month windows align to the first of the month', () => {
    const monthly: Schedule = { t: ScheduleKind.Calendar, unit: CalendarUnit.Month, tz: NY }
    const out = occurrences(monthly, range('2026-02-10', '2026-04-10'))
    expect(out.length).toBeGreaterThanOrEqual(3)
  })
})

describe('composition', () => {
  const daily: Schedule = { t: ScheduleKind.Calendar, unit: CalendarUnit.Day, tz: NY }

  it('filter narrows daily windows to weekdays', () => {
    const weekdays: Schedule = { t: ScheduleKind.Filter, of: daily, pred: PredicateRef.IsWeekday, tz: NY }
    // 2026-06-01 is a Monday, so a 7-day span holds exactly 5 weekdays.
    expect(occurrences(weekdays, range('2026-06-01', '2026-06-08'))).toHaveLength(5)
  })

  it('difference subtracts an excluded span from a recurring schedule', () => {
    const minusHoliday: Schedule = {
      t: ScheduleKind.Difference,
      from: daily,
      minus: { t: ScheduleKind.Dates, dates: ['2026-06-03'], duration: 'P1D', tz: NY },
    }
    const out = occurrences(minusHoliday, range('2026-06-01', '2026-06-08'))
    expect(out).toHaveLength(6)
  })

  it('shift moves windows and still catches ones shifted INTO range', () => {
    const shifted: Schedule = {
      t: ScheduleKind.Shift,
      of: { t: ScheduleKind.Dates, dates: ['2026-06-01'], duration: 'PT1H', tz: NY },
      by: 'P1D',
      tz: NY,
    }
    const out = occurrences(shifted, range('2026-06-02', '2026-06-03'))
    expect(out).toHaveLength(1)
    expect(out[0]!.start.toZonedDateTimeISO(NY).toPlainDate().toString()).toBe('2026-06-02')
  })

  it('union of two schedules merges overlapping windows', () => {
    const both: Schedule = {
      t: ScheduleKind.Union,
      of: [
        { t: ScheduleKind.Dates, dates: ['2026-06-01T09:00'], duration: 'PT2H', tz: NY },
        { t: ScheduleKind.Dates, dates: ['2026-06-01T10:00'], duration: 'PT2H', tz: NY },
      ],
    }
    const out = occurrences(both, range('2026-06-01', '2026-06-02'))
    expect(out).toHaveLength(1)
    expect(hours(out[0]!)).toBe(3)
  })

  it('an empty intersect yields nothing rather than everything', () => {
    expect(occurrences({ t: ScheduleKind.Intersect, of: [] }, range('2026-06-01', '2026-06-08'))).toEqual([])
  })
})

describe('rrule leaf', () => {
  it('expands a weekly rule at a stable local wall-clock time across a DST boundary', () => {
    const schedule: Schedule = {
      t: ScheduleKind.Rrule,
      rrule: 'DTSTART:20261012T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO',
      duration: 'PT1H',
      tz: NY,
    }
    const out = occurrences(schedule, range('2026-10-12', '2026-11-16'))
    expect(out.length).toBeGreaterThanOrEqual(4)

    // 9am must stay 9am on both sides of the 1 Nov transition -- not shift to 8am or 10am.
    for (const window of out) {
      expect(window.start.toZonedDateTimeISO(NY).hour).toBe(9)
    }
  })
})

describe('derived windows', () => {
  it('builds windows relative to another track entries', () => {
    // "within 30 minutes of waking" -- the window depends on what actually happened.
    const entries: Entry[] = [
      { id: 'e1', trackId: 'wake', start: '2026-06-01T06:30:00-04:00[America/New_York]' },
      { id: 'e2', trackId: 'wake', start: '2026-06-02T07:15:00-04:00[America/New_York]' },
      { id: 'e3', trackId: 'other', start: '2026-06-02T12:00:00-04:00[America/New_York]' },
    ]
    const schedule: Schedule = { t: ScheduleKind.Derived, fromTrack: 'wake', after: 'PT30M' }
    const out = occurrences(schedule, range('2026-06-01', '2026-06-03'), { entries })

    expect(out).toHaveLength(2)
    expect(hours(out[0]!)).toBeCloseTo(0.5, 9)
    expect(out[0]!.start.toZonedDateTimeISO(NY).hour).toBe(6)
  })

  it('supports a window BEFORE the anchor, for "1h before bedtime"', () => {
    const entries: Entry[] = [
      { id: 'e1', trackId: 'bed', start: '2026-06-01T22:00:00-04:00[America/New_York]' },
    ]
    const schedule: Schedule = { t: ScheduleKind.Derived, fromTrack: 'bed', before: 'PT1H' }
    const out = occurrences(schedule, range('2026-06-01', '2026-06-03'), { entries })
    expect(out[0]!.start.toZonedDateTimeISO(NY).hour).toBe(21)
  })
})

describe('windows are whole, not truncated to the query range', () => {
  it('a weekly window queried for a single day still covers the whole week', () => {
    // If generators clipped to the query range, a weekly "150 minutes of exercise" goal
    // viewed on a Wednesday would total only Wednesday and report Missed. Wrong, and
    // wrong in the direction that makes the app nag you.
    const weekly: Schedule = { t: ScheduleKind.Calendar, unit: CalendarUnit.Week, tz: NY }
    const out = occurrences(weekly, range('2026-01-07', '2026-01-08'))

    expect(out).toHaveLength(1)
    expect(hours(out[0]!)).toBe(168)
    expect(out[0]!.start.toZonedDateTimeISO(NY).toPlainDate().toString()).toBe('2026-01-05')
  })

  it('returns every week a multi-week range touches, each one whole', () => {
    const weekly: Schedule = { t: ScheduleKind.Calendar, unit: CalendarUnit.Week, tz: NY }
    const out = occurrences(weekly, range('2026-01-07', '2026-01-14'))
    expect(out).toHaveLength(2)
    for (const w of out) expect(hours(w)).toBe(168)
  })
})
