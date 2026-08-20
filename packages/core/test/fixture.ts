import { Temporal } from 'temporal-polyfill'
import {
  AggregateFn,
  CalendarUnit,
  Comparator,
  PredicateRef,
  ScheduleKind,
  SelectorKind,
  ValueType,
} from '../src/model/enums.js'
import type { Entry, Goal, Tag, Track } from '../src/model/types.js'
import type { Interval } from '../src/time/interval.js'

export const TZ = 'America/New_York'

export const tags: Tag[] = [
  { id: 'caffeine', name: 'caffeine' },
  { id: 'exercise', name: 'exercise' },
  { id: 'cardio', name: 'cardio', parentId: 'exercise' },
  { id: 'strength', name: 'strength', parentId: 'exercise' },
  { id: 'meds', name: 'meds' },
  { id: 'screens', name: 'screens' },
  { id: 'vice', name: 'vice' },
]

export const tracks: Track[] = [
  { id: 'espresso', name: 'Espresso', valueType: ValueType.Quantity, tags: ['caffeine'], unit: 'mg', color: '#d98b45' },
  { id: 'tea', name: 'Tea', valueType: ValueType.Quantity, tags: ['caffeine'], unit: 'mg', color: '#8fb45e' },
  { id: 'cola', name: 'Cola', valueType: ValueType.Quantity, tags: ['caffeine'], unit: 'g', color: '#b4525e' },
  // Deliberately incoherent with a milligram goal: this one must be EXCLUDED, not summed.
  { id: 'coffee-cups', name: 'Coffee (cups)', valueType: ValueType.Quantity, tags: ['caffeine'], unit: 'cup', color: '#a07a4a' },

  { id: 'run', name: 'Run', valueType: ValueType.Interval, tags: ['cardio'], color: '#c2557a' },
  { id: 'lift', name: 'Lift', valueType: ValueType.Interval, tags: ['strength'], color: '#5e8fb4' },

  { id: 'vitamind', name: 'Vitamin D', valueType: ValueType.Binary, tags: ['meds'], color: '#e0c34a' },
  { id: 'alcohol', name: 'Alcohol', valueType: ValueType.Binary, tags: ['vice'], color: '#7a4ac2' },
  { id: 'phone', name: 'Phone', valueType: ValueType.Interval, tags: ['screens'], color: '#4ac2b8' },
  { id: 'bedtime', name: 'Bedtime', valueType: ValueType.Binary, tags: [], color: '#6c7bff' },
]

const z = (day: string, time: string, offset = '-05:00') =>
  `2026-01-${day}T${time}:00${offset}[${TZ}]`

/**
 * One deterministic Monday-aligned week: Mon 2026-01-05 .. Sun 2026-01-11.
 *
 * Alignment matters. An earlier draft of this fixture used Jan 1-7, which is a Thursday
 * start and therefore straddles TWO calendar weeks -- weekly goals split in half and
 * every hand-computed total was wrong. Keep the fixture week Monday-aligned.
 */
export const entries: Entry[] = [
  // Caffeine. Mon: 80 + 40 = 120mg. Tue: 80mg. Wed: 0.2g cola = 200mg.
  { id: 'c1', trackId: 'espresso', start: z('05', '07:30'), value: 80 },
  { id: 'c2', trackId: 'tea', start: z('05', '15:00'), value: 40 },
  { id: 'c3', trackId: 'espresso', start: z('06', '08:00'), value: 80 },
  { id: 'c4', trackId: 'cola', start: z('07', '13:00'), value: 0.2 },
  // Excluded from any mg goal -- cups are a volume, not a mass.
  { id: 'c5', trackId: 'coffee-cups', start: z('07', '16:00'), value: 2 },

  // Exercise. Mon run 30m, Tue lift 45m, Fri run 60m. Total 135 minutes, 3 distinct days.
  { id: 'x1', trackId: 'run', start: z('05', '17:00'), end: z('05', '17:30') },
  { id: 'x2', trackId: 'lift', start: z('06', '18:00'), end: z('06', '18:45') },
  { id: 'x3', trackId: 'run', start: z('09', '07:00'), end: z('09', '08:00') },

  // Meds taken Mon, Tue, Thu -- deliberately missed on Wed.
  { id: 'm1', trackId: 'vitamind', start: z('05', '09:00') },
  { id: 'm2', trackId: 'vitamind', start: z('06', '09:00') },
  { id: 'm3', trackId: 'vitamind', start: z('08', '09:05') },

  // One drink, on Tuesday.
  { id: 'a1', trackId: 'alcohol', start: z('06', '20:00') },

  // Bedtime anchors, and a phone session inside the hour before Tuesday's.
  { id: 'b1', trackId: 'bedtime', start: z('05', '23:00') },
  { id: 'b2', trackId: 'bedtime', start: z('06', '23:00') },
  { id: 'p1', trackId: 'phone', start: z('06', '22:30'), end: z('06', '22:50') },
]

const daily = { t: ScheduleKind.Calendar, unit: CalendarUnit.Day, tz: TZ } as const
const weekly = { t: ScheduleKind.Calendar, unit: CalendarUnit.Week, tz: TZ } as const

/** The encoding table from the plan, as executable goals. */
export const goals: Record<string, Goal> = {
  caffeineUnder400: {
    id: 'g-caffeine',
    name: 'Total caffeine under 400mg/day',
    what: { t: SelectorKind.Tag, tags: ['caffeine'], match: 'any' },
    when: daily,
    aggregate: AggregateFn.Sum,
    compare: Comparator.Lte,
    target: 400,
    unit: 'mg',
  },
  exercise150Weekly: {
    id: 'g-exercise',
    name: '150 minutes of exercise per week',
    what: { t: SelectorKind.Tag, tags: ['exercise'], match: 'any', transitive: true },
    when: weekly,
    aggregate: AggregateFn.Duration,
    compare: Comparator.Gte,
    target: 150,
  },
  medsToday: {
    id: 'g-meds',
    name: 'Did I take my meds today',
    what: { t: SelectorKind.Tag, tags: ['meds'], match: 'any' },
    when: daily,
    aggregate: AggregateFn.Exists,
    compare: Comparator.Gt,
    target: 0,
  },
  noDrinkThisWeek: {
    id: 'g-dry',
    name: 'Did I NOT drink this week',
    what: { t: SelectorKind.Track, ids: ['alcohol'] },
    when: weekly,
    aggregate: AggregateFn.Exists,
    compare: Comparator.Eq,
    target: 0,
  },
  gymThreeDistinctDays: {
    id: 'g-gym',
    name: 'Exercise on 3 distinct days a week',
    what: { t: SelectorKind.Tag, tags: ['exercise'], match: 'any', transitive: true },
    when: weekly,
    aggregate: AggregateFn.DistinctDays,
    compare: Comparator.Gte,
    target: 3,
  },
  noScreensBeforeBed: {
    id: 'g-screens',
    name: 'No screens 1h before bedtime',
    what: { t: SelectorKind.Tag, tags: ['screens'], match: 'any' },
    when: { t: ScheduleKind.Derived, fromTrack: 'bedtime', before: 'PT1H' },
    aggregate: AggregateFn.Exists,
    compare: Comparator.Eq,
    target: 0,
  },
  weekdayMedsOnly: {
    id: 'g-weekday-meds',
    name: 'Meds on weekdays only',
    what: { t: SelectorKind.Tag, tags: ['meds'], match: 'any' },
    when: { t: ScheduleKind.Filter, of: daily, pred: PredicateRef.IsWeekday, tz: TZ },
    aggregate: AggregateFn.Exists,
    compare: Comparator.Gt,
    target: 0,
  },
}

export function week(): Interval {
  return {
    start: Temporal.PlainDate.from('2026-01-05').toZonedDateTime({ timeZone: TZ, plainTime: '00:00' }).toInstant(),
    end: Temporal.PlainDate.from('2026-01-12').toZonedDateTime({ timeZone: TZ, plainTime: '00:00' }).toInstant(),
  }
}

/** Fixed clock well after the fixture week, so closed windows resolve Met/Missed. */
export const AFTER = Temporal.Instant.from('2026-02-01T00:00:00Z')
/** Fixed clock before it, so every window is Scheduled. */
export const BEFORE = Temporal.Instant.from('2025-12-01T00:00:00Z')
