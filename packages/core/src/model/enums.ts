/**
 * Every closed set of string values in the model is an `as const` object plus a derived
 * union type -- never a TypeScript `enum`.
 *
 * Enums emit runtime objects with reverse mappings, `const enum` is banned under
 * `isolatedModules` (which Vite/esbuild require), and enum members are not assignable
 * from plain strings -- which would break deserializing the op log and JSON imports,
 * both of which are load-bearing here.
 *
 * This form gives compile-time narrowing AND `Object.values(X)` for populating UI
 * dropdowns and driving exhaustiveness tests, while serializing as an ordinary string.
 */

/** What SHAPE the data is. Orthogonal to tags, which say what KIND of thing it is. */
export const ValueType = {
  Binary: 'binary',
  Quantity: 'quantity',
  Duration: 'duration',
  Interval: 'interval',
} as const
export type ValueType = (typeof ValueType)[keyof typeof ValueType]

export const Polarity = {
  MoreIsBetter: 'more-is-better',
  LessIsBetter: 'less-is-better',
  Neutral: 'neutral',
} as const
export type Polarity = (typeof Polarity)[keyof typeof Polarity]

export const AggregateFn = {
  Count: 'count',
  Sum: 'sum',
  Duration: 'duration',
  Max: 'max',
  Min: 'min',
  Exists: 'exists',
  DistinctDays: 'distinct-days',
} as const
export type AggregateFn = (typeof AggregateFn)[keyof typeof AggregateFn]

export const Comparator = {
  Gte: '>=',
  Lte: '<=',
  Gt: '>',
  Lt: '<',
  Eq: '==',
  Neq: '!=',
} as const
export type Comparator = (typeof Comparator)[keyof typeof Comparator]

/**
 * Pending vs Missed vs Scheduled is not cosmetic: a window that has not closed cannot
 * have been missed, and collapsing them makes the UI lie every morning.
 */
export const GoalStatus = {
  Met: 'met',
  Missed: 'missed',
  Pending: 'pending',
  Scheduled: 'scheduled',
  NotApplicable: 'not-applicable',
} as const
export type GoalStatus = (typeof GoalStatus)[keyof typeof GoalStatus]

export const ScheduleKind = {
  Calendar: 'calendar',
  Rrule: 'rrule',
  Dates: 'dates',
  Span: 'span',
  Union: 'union',
  Intersect: 'intersect',
  Difference: 'difference',
  Shift: 'shift',
  Clip: 'clip',
  Filter: 'filter',
  Derived: 'derived',
} as const
export type ScheduleKind = (typeof ScheduleKind)[keyof typeof ScheduleKind]

export const SelectorKind = {
  Track: 'track',
  Tag: 'tag',
  ValueType: 'value-type',
  All: 'all',
  Union: 'union',
  Intersect: 'intersect',
  Except: 'except',
} as const
export type SelectorKind = (typeof SelectorKind)[keyof typeof SelectorKind]

/** Calendar units that a Calendar schedule can align windows to. */
export const CalendarUnit = {
  Day: 'day',
  Week: 'week',
  Month: 'month',
  Year: 'year',
} as const
export type CalendarUnit = (typeof CalendarUnit)[keyof typeof CalendarUnit]

export const OpType = {
  TagUpsert: 'tag.upsert',
  TagDelete: 'tag.delete',
  TrackUpsert: 'track.upsert',
  TrackDelete: 'track.delete',
  EntryUpsert: 'entry.upsert',
  EntryDelete: 'entry.delete',
  GoalUpsert: 'goal.upsert',
  GoalDelete: 'goal.delete',
  RoutineUpsert: 'routine.upsert',
  RoutineDelete: 'routine.delete',
} as const
export type OpType = (typeof OpType)[keyof typeof OpType]

/** Named predicates usable by a Filter schedule. Kept closed so schedules stay serializable. */
export const PredicateRef = {
  IsWeekday: 'is-weekday',
  IsWeekend: 'is-weekend',
} as const
export type PredicateRef = (typeof PredicateRef)[keyof typeof PredicateRef]
