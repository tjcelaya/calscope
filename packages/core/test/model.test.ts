import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import {
  AggregateFn,
  CalendarUnit,
  Comparator,
  GoalStatus,
  OpType,
  Polarity,
  PredicateRef,
  ScheduleKind,
  SelectorKind,
  ValueType,
} from '../src/model/enums.js'
import {
  EntrySchema,
  ExportSchema,
  GoalSchema,
  ScheduleSchema,
  TrackSelectorSchema,
  parseExport,
} from '../src/model/schemas.js'
import { evaluateGoal } from '../src/goals/evaluate.js'
import { occurrences } from '../src/schedule/evaluate.js'
import { resolve } from '../src/select/resolve.js'
import { fold } from '../src/store/oplog.js'
import { parseZoned } from '../src/time/calendar.js'
import { AFTER, TZ, entries, goals, tags, tracks, week } from './fixture.js'

const ALL_ENUMS = {
  ValueType,
  Polarity,
  AggregateFn,
  Comparator,
  GoalStatus,
  ScheduleKind,
  SelectorKind,
  CalendarUnit,
  OpType,
  PredicateRef,
}

describe('enum hygiene', () => {
  it('every enum has unique values and serializes as plain strings', () => {
    for (const [name, e] of Object.entries(ALL_ENUMS)) {
      const values = Object.values(e)
      expect(new Set(values).size, `${name} has duplicate values`).toBe(values.length)
      for (const value of values) expect(typeof value).toBe('string')
      // An `as const` object has no reverse mapping, unlike a TS enum.
      expect(Object.keys(e).some((k) => /^\d+$/.test(k))).toBe(false)
    }
  })

  it('every enum survives a JSON round trip unchanged', () => {
    for (const e of Object.values(ALL_ENUMS)) {
      expect(JSON.parse(JSON.stringify(e))).toEqual(e)
    }
  })
})

describe('evaluator exhaustiveness', () => {
  it('every ScheduleKind is handled -- none throws "unhandled"', () => {
    const range = week()
    const samples: Record<ScheduleKind, unknown> = {
      [ScheduleKind.Calendar]: { t: ScheduleKind.Calendar, unit: CalendarUnit.Day, tz: TZ },
      [ScheduleKind.Rrule]: { t: ScheduleKind.Rrule, rrule: 'DTSTART:20260105T090000\nRRULE:FREQ=DAILY', duration: 'PT1H', tz: TZ },
      [ScheduleKind.Dates]: { t: ScheduleKind.Dates, dates: ['2026-01-06'], duration: 'P1D', tz: TZ },
      [ScheduleKind.Span]: { t: ScheduleKind.Span, start: '2026-01-05T00:00:00Z', end: '2026-01-06T00:00:00Z' },
      [ScheduleKind.Union]: { t: ScheduleKind.Union, of: [] },
      [ScheduleKind.Intersect]: { t: ScheduleKind.Intersect, of: [] },
      [ScheduleKind.Difference]: {
        t: ScheduleKind.Difference,
        from: { t: ScheduleKind.Calendar, unit: CalendarUnit.Day, tz: TZ },
        minus: { t: ScheduleKind.Dates, dates: ['2026-01-06'], duration: 'P1D', tz: TZ },
      },
      [ScheduleKind.Shift]: {
        t: ScheduleKind.Shift,
        of: { t: ScheduleKind.Dates, dates: ['2026-01-06'], duration: 'PT1H', tz: TZ },
        by: 'P1D',
        tz: TZ,
      },
      [ScheduleKind.Clip]: {
        t: ScheduleKind.Clip,
        of: { t: ScheduleKind.Calendar, unit: CalendarUnit.Day, tz: TZ },
        to: { t: ScheduleKind.Span, start: '2026-01-05T00:00:00Z', end: '2026-01-06T00:00:00Z' },
      },
      [ScheduleKind.Filter]: {
        t: ScheduleKind.Filter,
        of: { t: ScheduleKind.Calendar, unit: CalendarUnit.Day, tz: TZ },
        pred: PredicateRef.IsWeekday,
        tz: TZ,
      },
      [ScheduleKind.Derived]: { t: ScheduleKind.Derived, fromTrack: 'bedtime', before: 'PT1H' },
    }

    for (const kind of Object.values(ScheduleKind)) {
      const schedule = samples[kind]
      expect(v.safeParse(ScheduleSchema, schedule).success, `${kind} failed schema`).toBe(true)
      expect(() => occurrences(schedule as never, range, { entries }), `${kind} threw`).not.toThrow()
    }
  })

  it('every SelectorKind is handled', () => {
    const samples: Record<SelectorKind, unknown> = {
      [SelectorKind.Track]: { t: SelectorKind.Track, ids: ['run'] },
      [SelectorKind.Tag]: { t: SelectorKind.Tag, tags: ['caffeine'], match: 'any' },
      [SelectorKind.ValueType]: { t: SelectorKind.ValueType, valueTypes: [ValueType.Binary] },
      [SelectorKind.All]: { t: SelectorKind.All },
      [SelectorKind.Union]: { t: SelectorKind.Union, of: [] },
      [SelectorKind.Intersect]: { t: SelectorKind.Intersect, of: [] },
      [SelectorKind.Except]: {
        t: SelectorKind.Except,
        from: { t: SelectorKind.All },
        minus: { t: SelectorKind.Track, ids: ['run'] },
      },
    }

    for (const kind of Object.values(SelectorKind)) {
      const selector = samples[kind]
      expect(v.safeParse(TrackSelectorSchema, selector).success, `${kind} failed schema`).toBe(true)
      expect(() => resolve(selector as never, tracks, tags), `${kind} threw`).not.toThrow()
    }
  })

  it('every AggregateFn x Comparator pair evaluates without throwing', () => {
    for (const aggregate of Object.values(AggregateFn)) {
      for (const compare of Object.values(Comparator)) {
        const goal = { ...goals.caffeineUnder400!, aggregate, compare }
        expect(
          () => evaluateGoal(goal, entries, tracks, week(), tags, { now: AFTER }),
          `${aggregate} ${compare} threw`,
        ).not.toThrow()
      }
    }
  })
})

describe('validation boundary', () => {
  it('rejects a wall-clock time inside a DST-skipped hour', () => {
    // 2026-03-08 02:30 does not exist in New York. It must be rejected, not snapped.
    const bad = { id: 'e', trackId: 't', start: '2026-03-08T02:30:00-05:00[America/New_York]' }
    expect(v.safeParse(EntrySchema, bad).success).toBe(false)

    const good = { id: 'e', trackId: 't', start: '2026-03-08T03:30:00-04:00[America/New_York]' }
    expect(v.safeParse(EntrySchema, good).success).toBe(true)
  })

  it('accepts both 1:30ams of a fall-back night as DISTINCT instants', () => {
    // This is what lets an entry be attributed to the correct slot vs the radial spur.
    const instants = new Set<string>()
    for (const offset of ['-04:00', '-05:00']) {
      const start = `2026-11-01T01:30:00${offset}[America/New_York]`
      expect(v.safeParse(EntrySchema, { id: 'e', trackId: 't', start }).success, offset).toBe(true)
      instants.add(parseZoned(start).toInstant().toString())
    }
    expect(instants.size).toBe(2)
  })

  it('rejects an offset that does not match the zone at that instant', () => {
    const wrongOffset = { id: 'e', trackId: 't', start: '2026-06-15T12:00:00+05:00[America/New_York]' }
    expect(v.safeParse(EntrySchema, wrongOffset).success).toBe(false)
  })

  it('rejects a Sum goal with no declared unit', () => {
    const { unit: _unit, ...noUnit } = goals.caffeineUnder400!
    expect(v.safeParse(GoalSchema, noUnit).success).toBe(false)
    expect(v.safeParse(GoalSchema, goals.caffeineUnder400).success).toBe(true)
  })

  it('rejects an unknown enum value rather than passing it through', () => {
    const bogus = { ...goals.medsToday!, aggregate: 'median' }
    expect(v.safeParse(GoalSchema, bogus).success).toBe(false)
  })

  it('rejects a malformed ISO duration', () => {
    const bad = { t: ScheduleKind.Derived, fromTrack: 'x', before: 'one hour' }
    expect(v.safeParse(ScheduleSchema, bad).success).toBe(false)
  })
})

describe('export round trip', () => {
  it('JSON export -> parse -> fold produces identical state', () => {
    const ops = [
      { id: 'o1', hlc: '000000000000001:00000:a', actor: 'a', type: OpType.TrackUpsert, payload: tracks[0] },
      { id: 'o2', hlc: '000000000000002:00000:a', actor: 'a', type: OpType.EntryUpsert, payload: entries[0] },
    ]
    const doc = { version: 1 as const, ops }

    const reparsed = parseExport(JSON.parse(JSON.stringify(doc)))
    expect(fold(reparsed.ops)).toEqual(fold(ops))
    expect(v.safeParse(ExportSchema, doc).success).toBe(true)
  })

  it('rejects an export with an unknown version', () => {
    expect(v.safeParse(ExportSchema, { version: 2, ops: [] }).success).toBe(false)
  })
})
