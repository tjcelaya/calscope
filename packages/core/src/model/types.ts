import type {
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
} from './enums.js'

export type TagId = string
export type TrackId = string
export type EntryId = string
export type GoalId = string
export type RoutineId = string
export type OpId = string
export type ActorId = string

/** Unit symbol. Convertibility is decided by the table in select/units.ts. */
export type Unit = string

export type Tag = {
  id: TagId
  name: string
  /** Selection is transitive: selecting 'exercise' also selects 'cardio' beneath it. */
  parentId?: TagId
  color?: string
}

export type Track = {
  id: TrackId
  name: string
  valueType: ValueType
  /** The "type of thing" axis -- what goal selectors match on. */
  tags: TagId[]
  unit?: Unit
  polarity?: Polarity
  color: string
  sortOrder?: number
  archivedAt?: string
  /** Routes writes to a specific Google calendar. */
  calendarId?: string
  /** Historic title forms ('[S] Coffee', '. Coffee') so re-import stays idempotent. */
  legacyTitles?: string[]
  /**
   * Entries on this track claim the span back to the previous event's end (any track):
   * a sleep instant logged at wake-up becomes the whole night. Applied as a derivation
   * (expandGapFill), never rewritten into the stored entry.
   */
  fillsGapBefore?: boolean
}

export type Entry = {
  id: EntryId
  trackId: TrackId
  /**
   * ISO ZonedDateTime WITH offset, e.g. 2026-11-01T01:30:00-04:00[America/New_York].
   * The offset is what distinguishes the two 1:30ams of a fall-back night.
   */
  start: string
  end?: string
  value?: number
  tags?: TagId[]
  note?: string
  /** Set when this entry mirrors a Google Calendar event. */
  gcalEventId?: string
  gcalCalendarId?: string
  /** Google's `updated` timestamp; wins over local HLC for gcal-backed entries. */
  gcalUpdated?: string
}

/** ISO 8601 duration, e.g. 'PT30M', 'P1D'. */
export type IsoDuration = string

export type Schedule =
  | { t: typeof ScheduleKind.Calendar; unit: CalendarUnit; tz: string; weekStart?: number }
  | { t: typeof ScheduleKind.Rrule; rrule: string; duration?: IsoDuration; tz: string }
  | { t: typeof ScheduleKind.Dates; dates: string[]; duration?: IsoDuration; tz: string }
  | { t: typeof ScheduleKind.Span; start: string; end: string }
  | { t: typeof ScheduleKind.Union; of: Schedule[] }
  | { t: typeof ScheduleKind.Intersect; of: Schedule[] }
  | { t: typeof ScheduleKind.Difference; from: Schedule; minus: Schedule }
  | { t: typeof ScheduleKind.Shift; of: Schedule; by: IsoDuration; tz: string }
  | { t: typeof ScheduleKind.Clip; of: Schedule; to: Schedule }
  | { t: typeof ScheduleKind.Filter; of: Schedule; pred: PredicateRef; tz: string }
  | { t: typeof ScheduleKind.Derived; fromTrack: TrackId; before?: IsoDuration; after?: IsoDuration }

export type TrackSelector =
  | { t: typeof SelectorKind.Track; ids: TrackId[] }
  | { t: typeof SelectorKind.Tag; tags: TagId[]; match: 'any' | 'all'; transitive?: boolean }
  | { t: typeof SelectorKind.ValueType; valueTypes: ValueType[] }
  | { t: typeof SelectorKind.All }
  | { t: typeof SelectorKind.Union; of: TrackSelector[] }
  | { t: typeof SelectorKind.Intersect; of: TrackSelector[] }
  | { t: typeof SelectorKind.Except; from: TrackSelector; minus: TrackSelector }

export type Goal = {
  id: GoalId
  name: string
  /** WHAT is measured -- a selector, never a fixed id list, so new tracks join automatically. */
  what: TrackSelector
  /** WHEN it is measured -- generates one evaluation window per occurrence. */
  when: Schedule
  aggregate: AggregateFn
  compare: Comparator
  target: number
  /** Required when aggregate is Sum; tracks whose unit cannot convert are excluded. */
  unit?: Unit
  grace?: number
  rollup?: Schedule
  archivedAt?: string
}

export type Routine = {
  id: RoutineId
  name: string
  when: Schedule
  goals: GoalId[]
  ordered?: boolean
  archivedAt?: string
}

export type GoalResult = {
  window: { start: string; end: string }
  actual: number
  target: number
  status: GoalStatus
  contributingEntryIds: EntryId[]
  /** Matched the selector but the unit could not convert -- reported, never silently summed. */
  excludedTrackIds: TrackId[]
}

export type Op = {
  id: OpId
  /** Hybrid logical clock timestamp; sorts total across actors. */
  hlc: string
  actor: ActorId
  type: OpType
  payload: unknown
}

export type Snapshot = {
  tags: Record<TagId, Tag>
  tracks: Record<TrackId, Track>
  entries: Record<EntryId, Entry>
  goals: Record<GoalId, Goal>
  routines: Record<RoutineId, Routine>
}
