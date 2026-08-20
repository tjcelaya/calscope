import { Temporal } from 'temporal-polyfill'
import { AggregateFn, Comparator, GoalStatus, ValueType } from '../model/enums.js'
import type { Entry, Goal, GoalResult, Tag, Track, TrackId } from '../model/types.js'
import { occurrences } from '../schedule/evaluate.js'
import { resolve } from '../select/resolve.js'
import { areConvertible, convert } from '../select/units.js'
import { parseZoned } from '../time/calendar.js'
import { type Interval, contains, overlaps, toIso } from '../time/interval.js'

export type EvaluateOptions = {
  /** Injectable so tests are deterministic; defaults to the real clock. */
  now?: Temporal.Instant
}

type Resolved = { entry: Entry; track: Track; start: Temporal.Instant; end: Temporal.Instant }

/**
 * ONE function feeds every view: cell colours in the year grid, arc fills in the radial
 * view, streak counts. Pure -- same inputs, same output.
 */
export function evaluateGoal(
  goal: Goal,
  entries: readonly Entry[],
  tracks: readonly Track[],
  range: Interval,
  tags: readonly Tag[] = [],
  options: EvaluateOptions = {},
): GoalResult[] {
  const now = options.now ?? Temporal.Now.instant()

  const selected = resolve(goal.what, tracks, tags)
  const { usable, excludedTrackIds } = partitionByUnit(goal, selected)
  const usableIds = new Set(usable.map((t) => t.id))
  const byId = new Map(usable.map((t) => [t.id, t]))

  const resolvedEntries: Resolved[] = []
  for (const entry of entries) {
    const track = byId.get(entry.trackId)
    if (!track || !usableIds.has(entry.trackId)) continue
    try {
      const start = parseZoned(entry.start).toInstant()
      const end = entry.end ? parseZoned(entry.end).toInstant() : start
      resolvedEntries.push({ entry, track, start, end })
    } catch {
      // A timestamp inside a skipped hour is rejected at the import boundary; if one
      // reaches here it is corrupt data and must not take down the whole evaluation.
      continue
    }
  }

  const windows = occurrences(goal.when, range, { entries })

  return windows.map((window) => {
    const hits = resolvedEntries.filter((r) => inWindow(r, window))
    const actual = aggregate(goal, hits)

    return {
      window: toIso(window),
      actual,
      target: goal.target,
      status: statusFor(goal, actual, window, now, usable.length),
      contributingEntryIds: hits.map((h) => h.entry.id),
      excludedTrackIds,
    }
  })
}

/** An instant belongs to the window containing it; a span belongs if it overlaps. */
function inWindow(r: Resolved, window: Interval): boolean {
  return Temporal.Instant.compare(r.start, r.end) === 0
    ? contains(window, r.start)
    : overlaps({ start: r.start, end: r.end }, window)
}

function partitionByUnit(
  goal: Goal,
  selected: readonly Track[],
): { usable: Track[]; excludedTrackIds: TrackId[] } {
  // Only Sum mixes magnitudes across tracks, so only Sum needs unit coherence.
  if (goal.aggregate !== AggregateFn.Sum || !goal.unit) {
    return { usable: [...selected], excludedTrackIds: [] }
  }

  const usable: Track[] = []
  const excludedTrackIds: TrackId[] = []
  for (const track of selected) {
    if (track.unit && areConvertible(track.unit, goal.unit)) usable.push(track)
    else excludedTrackIds.push(track.id)
  }
  return { usable, excludedTrackIds }
}

function aggregate(goal: Goal, hits: readonly Resolved[]): number {
  switch (goal.aggregate) {
    case AggregateFn.Count:
      return hits.length

    case AggregateFn.Exists:
      return hits.length > 0 ? 1 : 0

    case AggregateFn.Sum:
      return hits.reduce((sum, h) => sum + convertedValue(h, goal.unit), 0)

    case AggregateFn.Duration:
      return hits.reduce(
        (sum, h) => sum + (h.end.epochMilliseconds - h.start.epochMilliseconds) / 60_000,
        0,
      )

    case AggregateFn.Max:
      return hits.length === 0 ? 0 : Math.max(...hits.map((h) => convertedValue(h, goal.unit)))

    case AggregateFn.Min:
      return hits.length === 0 ? 0 : Math.min(...hits.map((h) => convertedValue(h, goal.unit)))

    case AggregateFn.DistinctDays: {
      const days = new Set(
        hits.map((h) => parseZoned(h.entry.start).toPlainDate().toString()),
      )
      return days.size
    }

    default: {
      const exhaustive: never = goal.aggregate
      throw new Error(`unhandled aggregate: ${String(exhaustive)}`)
    }
  }
}

function convertedValue(h: Resolved, goalUnit: string | undefined): number {
  // A binary track has no magnitude; each occurrence counts as one.
  const raw = h.entry.value ?? (h.track.valueType === ValueType.Binary ? 1 : 0)
  if (!goalUnit || !h.track.unit) return raw
  return convert(raw, h.track.unit, goalUnit) ?? 0
}

function satisfies(actual: number, compare: Comparator, target: number): boolean {
  switch (compare) {
    case Comparator.Gte:
      return actual >= target
    case Comparator.Lte:
      return actual <= target
    case Comparator.Gt:
      return actual > target
    case Comparator.Lt:
      return actual < target
    case Comparator.Eq:
      return actual === target
    case Comparator.Neq:
      return actual !== target
    default: {
      const exhaustive: never = compare
      throw new Error(`unhandled comparator: ${String(exhaustive)}`)
    }
  }
}

/**
 * The distinction that keeps the UI honest:
 *   - a window that has not started yet is Scheduled, not Missed
 *   - a window still open is Pending unless already satisfied
 *   - only a CLOSED window can be Missed
 */
function statusFor(
  goal: Goal,
  actual: number,
  window: Interval,
  now: Temporal.Instant,
  usableTrackCount: number,
): GoalStatus {
  if (usableTrackCount === 0) return GoalStatus.NotApplicable

  const met = satisfies(actual, goal.compare, goal.target)

  if (Temporal.Instant.compare(now, window.start) < 0) return GoalStatus.Scheduled
  if (Temporal.Instant.compare(now, window.end) < 0) {
    // Already satisfied mid-window counts as met -- but a not-yet-satisfied open window
    // is Pending, never Missed.
    return met ? GoalStatus.Met : GoalStatus.Pending
  }
  return met ? GoalStatus.Met : GoalStatus.Missed
}
