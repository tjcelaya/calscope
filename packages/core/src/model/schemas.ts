import * as v from 'valibot'
import { Temporal } from 'temporal-polyfill'
import {
  AggregateFn,
  CalendarUnit,
  Comparator,
  OpType,
  Polarity,
  PredicateRef,
  ScheduleKind,
  SelectorKind,
  ValueType,
} from './enums.js'

/** Build a Valibot picklist from an as-const enum -- one source of truth, no drift. */
function fromEnum<T extends Record<string, string>>(e: T) {
  return v.picklist(Object.values(e) as [T[keyof T], ...T[keyof T][]])
}

export const ValueTypeSchema = fromEnum(ValueType)
export const PolaritySchema = fromEnum(Polarity)
export const AggregateFnSchema = fromEnum(AggregateFn)
export const ComparatorSchema = fromEnum(Comparator)
export const CalendarUnitSchema = fromEnum(CalendarUnit)
export const PredicateRefSchema = fromEnum(PredicateRef)
export const OpTypeSchema = fromEnum(OpType)

/**
 * A wall-clock time inside a skipped hour must be REJECTED here, not silently snapped
 * to a neighbouring instant. This is the boundary where corrupt DST data gets caught.
 */
export const ZonedIsoSchema = v.pipe(
  v.string(),
  v.check((value) => {
    try {
      Temporal.ZonedDateTime.from(value, { disambiguation: 'reject', offset: 'reject' })
      return true
    } catch {
      return false
    }
  }, 'not a valid ZonedDateTime (a wall-clock time inside a DST-skipped hour, or an offset that does not match the zone, is rejected)'),
)

export const IsoDurationSchema = v.pipe(
  v.string(),
  v.check((value) => {
    try {
      Temporal.Duration.from(value)
      return true
    } catch {
      return false
    }
  }, 'not a valid ISO 8601 duration'),
)

export const TagSchema = v.object({
  id: v.string(),
  name: v.string(),
  parentId: v.optional(v.string()),
  color: v.optional(v.string()),
})

export const TrackSchema = v.object({
  id: v.string(),
  name: v.string(),
  valueType: ValueTypeSchema,
  tags: v.array(v.string()),
  unit: v.optional(v.string()),
  polarity: v.optional(PolaritySchema),
  color: v.string(),
  sortOrder: v.optional(v.number()),
  archivedAt: v.optional(v.string()),
  calendarId: v.optional(v.string()),
  legacyTitles: v.optional(v.array(v.string())),
})

export const EntrySchema = v.object({
  id: v.string(),
  trackId: v.string(),
  start: ZonedIsoSchema,
  end: v.optional(ZonedIsoSchema),
  value: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  note: v.optional(v.string()),
  gcalEventId: v.optional(v.string()),
  gcalCalendarId: v.optional(v.string()),
  gcalUpdated: v.optional(v.string()),
})

export const ScheduleSchema: v.GenericSchema<unknown> = v.lazy(() =>
  v.variant('t', [
    v.object({
      t: v.literal(ScheduleKind.Calendar),
      unit: CalendarUnitSchema,
      tz: v.string(),
      weekStart: v.optional(v.number()),
    }),
    v.object({
      t: v.literal(ScheduleKind.Rrule),
      rrule: v.string(),
      duration: v.optional(IsoDurationSchema),
      tz: v.string(),
    }),
    v.object({
      t: v.literal(ScheduleKind.Dates),
      dates: v.array(v.string()),
      duration: v.optional(IsoDurationSchema),
      tz: v.string(),
    }),
    v.object({ t: v.literal(ScheduleKind.Span), start: v.string(), end: v.string() }),
    v.object({ t: v.literal(ScheduleKind.Union), of: v.array(ScheduleSchema) }),
    v.object({ t: v.literal(ScheduleKind.Intersect), of: v.array(ScheduleSchema) }),
    v.object({
      t: v.literal(ScheduleKind.Difference),
      from: ScheduleSchema,
      minus: ScheduleSchema,
    }),
    v.object({
      t: v.literal(ScheduleKind.Shift),
      of: ScheduleSchema,
      by: IsoDurationSchema,
      tz: v.string(),
    }),
    v.object({ t: v.literal(ScheduleKind.Clip), of: ScheduleSchema, to: ScheduleSchema }),
    v.object({
      t: v.literal(ScheduleKind.Filter),
      of: ScheduleSchema,
      pred: PredicateRefSchema,
      tz: v.string(),
    }),
    v.object({
      t: v.literal(ScheduleKind.Derived),
      fromTrack: v.string(),
      before: v.optional(IsoDurationSchema),
      after: v.optional(IsoDurationSchema),
    }),
  ]),
)

export const TrackSelectorSchema: v.GenericSchema<unknown> = v.lazy(() =>
  v.variant('t', [
    v.object({ t: v.literal(SelectorKind.Track), ids: v.array(v.string()) }),
    v.object({
      t: v.literal(SelectorKind.Tag),
      tags: v.array(v.string()),
      match: v.picklist(['any', 'all']),
      transitive: v.optional(v.boolean()),
    }),
    v.object({ t: v.literal(SelectorKind.ValueType), valueTypes: v.array(ValueTypeSchema) }),
    v.object({ t: v.literal(SelectorKind.All) }),
    v.object({ t: v.literal(SelectorKind.Union), of: v.array(TrackSelectorSchema) }),
    v.object({ t: v.literal(SelectorKind.Intersect), of: v.array(TrackSelectorSchema) }),
    v.object({
      t: v.literal(SelectorKind.Except),
      from: TrackSelectorSchema,
      minus: TrackSelectorSchema,
    }),
  ]),
)

export const GoalSchema = v.pipe(
  v.object({
    id: v.string(),
    name: v.string(),
    what: TrackSelectorSchema,
    when: ScheduleSchema,
    aggregate: AggregateFnSchema,
    compare: ComparatorSchema,
    target: v.number(),
    unit: v.optional(v.string()),
    grace: v.optional(v.number()),
    rollup: v.optional(ScheduleSchema),
    archivedAt: v.optional(v.string()),
  }),
  // Summing without a declared unit is how mixed-dimension garbage gets in.
  v.check(
    (goal) => goal.aggregate !== AggregateFn.Sum || typeof goal.unit === 'string',
    'a Sum goal must declare a unit',
  ),
)

export const RoutineSchema = v.object({
  id: v.string(),
  name: v.string(),
  when: ScheduleSchema,
  goals: v.array(v.string()),
  ordered: v.optional(v.boolean()),
  archivedAt: v.optional(v.string()),
})

export const OpSchema = v.object({
  id: v.string(),
  hlc: v.string(),
  actor: v.string(),
  type: OpTypeSchema,
  payload: v.unknown(),
})

/** Whole-document shape for JSON export/import. */
export const ExportSchema = v.object({
  version: v.literal(1),
  ops: v.array(OpSchema),
})

export function parseExport(input: unknown) {
  return v.parse(ExportSchema, input)
}

export function safeParseEntry(input: unknown) {
  return v.safeParse(EntrySchema, input)
}
