import { GoalStatus } from '../model/enums.js'
import type { Goal, GoalResult, Routine, Tag, Track, Entry } from '../model/types.js'
import { evaluateGoal, type EvaluateOptions } from './evaluate.js'
import { occurrences } from '../schedule/evaluate.js'
import type { Interval } from '../time/interval.js'
import { toIso } from '../time/interval.js'

export type RoutineResult = {
  window: { start: string; end: string }
  status: GoalStatus
  members: Array<{ goalId: string; results: GoalResult[] }>
}

/**
 * A routine is a named bundle over the same evaluation machinery -- no new engine.
 * Its status for a window is the weakest of its members, so one Missed step makes the
 * routine Missed while any still-open step keeps it Pending.
 */
export function evaluateRoutine(
  routine: Routine,
  goals: readonly Goal[],
  entries: readonly Entry[],
  tracks: readonly Track[],
  range: Interval,
  tags: readonly Tag[] = [],
  options: EvaluateOptions = {},
): RoutineResult[] {
  const byId = new Map(goals.map((g) => [g.id, g]))
  const members = routine.goals.map((id) => byId.get(id)).filter((g): g is Goal => g !== undefined)

  return occurrences(routine.when, range, { entries }).map((window) => {
    const scoped: Interval = window
    const memberResults = members.map((goal) => ({
      goalId: goal.id,
      results: evaluateGoal(goal, entries, tracks, scoped, tags, options),
    }))

    const statuses = memberResults.flatMap((m) => m.results.map((r) => r.status))
    return { window: toIso(window), status: rollup(statuses), members: memberResults }
  })
}

/** Weakest-link rollup. Order matters: Missed beats Pending beats Scheduled beats Met. */
function rollup(statuses: readonly GoalStatus[]): GoalStatus {
  if (statuses.length === 0) return GoalStatus.NotApplicable
  if (statuses.includes(GoalStatus.Missed)) return GoalStatus.Missed
  if (statuses.includes(GoalStatus.Pending)) return GoalStatus.Pending
  if (statuses.includes(GoalStatus.Scheduled)) return GoalStatus.Scheduled
  if (statuses.every((s) => s === GoalStatus.NotApplicable)) return GoalStatus.NotApplicable
  return GoalStatus.Met
}
