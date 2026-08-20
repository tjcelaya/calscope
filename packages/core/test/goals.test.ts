import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { AggregateFn, Comparator, GoalStatus, SelectorKind } from '../src/model/enums.js'
import { evaluateGoal } from '../src/goals/evaluate.js'
import { AFTER, BEFORE, TZ, entries, goals, tags, tracks, week } from './fixture.js'

const evalGoal = (goal: (typeof goals)[string], now = AFTER) =>
  evaluateGoal(goal, entries, tracks, week(), tags, { now })

const dayOf = (iso: string) =>
  Temporal.Instant.from(iso).toZonedDateTimeISO(TZ).toPlainDate().toString()

describe('the encoding table, evaluated', () => {
  it('total caffeine under 400mg/day -- sums across tracks, converts g to mg', () => {
    const results = evalGoal(goals.caffeineUnder400!)
    const byDay = new Map(results.map((r) => [dayOf(r.window.start), r]))

    expect(byDay.get('2026-01-05')!.actual).toBe(120) // 80mg espresso + 40mg tea
    expect(byDay.get('2026-01-06')!.actual).toBe(80)
    expect(byDay.get('2026-01-07')!.actual).toBe(200) // 0.2g cola -> 200mg
    expect(byDay.get('2026-01-08')!.actual).toBe(0)

    // Under target every day.
    expect(results.every((r) => r.status === GoalStatus.Met)).toBe(true)
  })

  it('reports the cup-measured track as excluded rather than summing volume into mass', () => {
    const results = evalGoal(goals.caffeineUnder400!)
    for (const r of results) {
      expect(r.excludedTrackIds).toEqual(['coffee-cups'])
    }
    // The 2-cup entry on Wednesday must NOT have contributed.
    const third = results.find((r) => dayOf(r.window.start) === '2026-01-07')!
    expect(third.actual).toBe(200)
    expect(third.contributingEntryIds).not.toContain('c5')
  })

  it('150 minutes of exercise per week -- transitive tags pick up cardio and strength', () => {
    const results = evalGoal(goals.exercise150Weekly!)
    expect(results).toHaveLength(1)
    expect(results[0]!.actual).toBe(135) // 30 + 45 + 60
    expect(results[0]!.status).toBe(GoalStatus.Missed) // 135 < 150
  })

  it('did I take my meds today -- Met Mon, Tue, Thu and Missed Wed', () => {
    const byDay = new Map(evalGoal(goals.medsToday!).map((r) => [dayOf(r.window.start), r.status]))
    expect(byDay.get('2026-01-05')).toBe(GoalStatus.Met)
    expect(byDay.get('2026-01-06')).toBe(GoalStatus.Met)
    expect(byDay.get('2026-01-07')).toBe(GoalStatus.Missed)
    expect(byDay.get('2026-01-08')).toBe(GoalStatus.Met)
  })

  it('did I NOT drink this week -- a negative goal is Missed when the thing happened', () => {
    const results = evalGoal(goals.noDrinkThisWeek!)
    expect(results[0]!.actual).toBe(1)
    expect(results[0]!.status).toBe(GoalStatus.Missed)
  })

  it('exercise on 3 distinct days -- counts days, not sessions', () => {
    const results = evalGoal(goals.gymThreeDistinctDays!)
    // Three sessions, on Mon, Tue and Fri.
    expect(results[0]!.actual).toBe(3)
    expect(results[0]!.status).toBe(GoalStatus.Met)
  })

  it('no screens 1h before bedtime -- window derived from another track', () => {
    const results = evalGoal(goals.noScreensBeforeBed!)
    // Two bedtime anchors, so two windows.
    expect(results).toHaveLength(2)

    const withPhone = results.find((r) => r.contributingEntryIds.includes('p1'))
    expect(withPhone).toBeDefined()
    expect(withPhone!.status).toBe(GoalStatus.Missed)

    const clean = results.find((r) => !r.contributingEntryIds.includes('p1'))!
    expect(clean.status).toBe(GoalStatus.Met)
  })

  it('weekday-only windows skip the weekend', () => {
    const results = evalGoal(goals.weekdayMedsOnly!)
    const days = results.map((r) => dayOf(r.window.start))
    // 2026-01-10 is a Saturday and 01-11 a Sunday.
    expect(days).not.toContain('2026-01-10')
    expect(days).not.toContain('2026-01-11')
    expect(days).toContain('2026-01-06')
  })
})

describe('status semantics', () => {
  it('a window that has not started is Scheduled, never Missed', () => {
    const results = evalGoal(goals.medsToday!, BEFORE)
    expect(results.every((r) => r.status === GoalStatus.Scheduled)).toBe(true)
  })

  it('an open window with the target unmet is Pending, not Missed', () => {
    // Mid-way through Wednesday, the day the meds were missed.
    const midDay = Temporal.Instant.from('2026-01-07T18:00:00Z')
    const byDay = new Map(
      evalGoal(goals.medsToday!, midDay).map((r) => [dayOf(r.window.start), r.status]),
    )
    expect(byDay.get('2026-01-07')).toBe(GoalStatus.Pending)
    // Already-closed earlier days still resolve.
    expect(byDay.get('2026-01-05')).toBe(GoalStatus.Met)
    // Later days have not begun.
    expect(byDay.get('2026-01-09')).toBe(GoalStatus.Scheduled)
  })

  it('an open window already satisfied reads Met rather than Pending', () => {
    const afterDose = Temporal.Instant.from('2026-01-05T18:00:00Z')
    const first = evalGoal(goals.medsToday!, afterDose).find(
      (r) => dayOf(r.window.start) === '2026-01-05',
    )!
    expect(first.status).toBe(GoalStatus.Met)
  })

  it('a selector matching no usable track is NotApplicable, not Missed', () => {
    const orphan = {
      ...goals.medsToday!,
      what: { t: SelectorKind.Tag, tags: ['nonexistent'], match: 'any' as const },
    }
    expect(evalGoal(orphan).every((r) => r.status === GoalStatus.NotApplicable)).toBe(true)
  })
})

describe('aggregates', () => {
  it('Count counts entries where Exists only reports presence', () => {
    const base = goals.caffeineUnder400!
    const counted = { ...base, aggregate: AggregateFn.Count, compare: Comparator.Gte, target: 0 }
    const first = evaluateGoal(counted, entries, tracks, week(), tags, { now: AFTER }).find(
      (r) => dayOf(r.window.start) === '2026-01-05',
    )!
    expect(first.actual).toBe(2)

    const exists = { ...base, aggregate: AggregateFn.Exists, compare: Comparator.Gte, target: 0 }
    const existsFirst = evaluateGoal(exists, entries, tracks, week(), tags, { now: AFTER }).find(
      (r) => dayOf(r.window.start) === '2026-01-05',
    )!
    expect(existsFirst.actual).toBe(1)
  })

  it('Max and Min report the largest and smallest converted value', () => {
    const base = goals.caffeineUnder400!
    const shape = (aggregate: AggregateFn) =>
      evaluateGoal({ ...base, aggregate }, entries, tracks, week(), tags, { now: AFTER }).find(
        (r) => dayOf(r.window.start) === '2026-01-05',
      )!.actual

    expect(shape(AggregateFn.Max)).toBe(80)
    expect(shape(AggregateFn.Min)).toBe(40)
  })

  it('Duration totals minutes across a window', () => {
    const results = evalGoal(goals.exercise150Weekly!)
    expect(results[0]!.actual).toBe(135)
  })
})
