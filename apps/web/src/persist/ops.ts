import { OpType } from './core'
import type {
  ActorId,
  Entry,
  EntryId,
  Goal,
  GoalId,
  HlcClock,
  Op,
  Routine,
  RoutineId,
  Tag,
  TagId,
  Track,
  TrackId,
} from './core'
import { actorClock, actorId } from './actor'

/**
 * Explicit clock/actor for tests and imports; app code omits it and gets the
 * profile-wide singleton from ./actor.
 */
export type OpStamp = { clock: HlcClock; actor: ActorId }

/** A record on its way in: the id may be absent (a create) or present (an update). */
type Draft<T extends { id: string }> = Omit<T, 'id'> & { id?: string }

function makeOp(type: OpType, payload: unknown, stamp?: OpStamp): Op {
  const clock = stamp?.clock ?? actorClock()
  const actor = stamp?.actor ?? actorId()
  return { id: crypto.randomUUID(), hlc: clock.next(), actor, type, payload }
}

export function upsertTag(tag: Draft<Tag>, stamp?: OpStamp): Op {
  return makeOp(OpType.TagUpsert, { ...tag, id: tag.id ?? crypto.randomUUID() } satisfies Tag, stamp)
}

export function upsertTrack(track: Draft<Track>, stamp?: OpStamp): Op {
  return makeOp(
    OpType.TrackUpsert,
    { ...track, id: track.id ?? crypto.randomUUID() } satisfies Track,
    stamp,
  )
}

export function upsertEntry(entry: Draft<Entry>, stamp?: OpStamp): Op {
  return makeOp(
    OpType.EntryUpsert,
    { ...entry, id: entry.id ?? crypto.randomUUID() } satisfies Entry,
    stamp,
  )
}

export function upsertGoal(goal: Draft<Goal>, stamp?: OpStamp): Op {
  return makeOp(
    OpType.GoalUpsert,
    { ...goal, id: goal.id ?? crypto.randomUUID() } satisfies Goal,
    stamp,
  )
}

export function upsertRoutine(routine: Draft<Routine>, stamp?: OpStamp): Op {
  return makeOp(
    OpType.RoutineUpsert,
    { ...routine, id: routine.id ?? crypto.randomUUID() } satisfies Routine,
    stamp,
  )
}

// Delete payloads are the bare record id -- exactly what core's fold expects.

export function deleteTag(id: TagId, stamp?: OpStamp): Op {
  return makeOp(OpType.TagDelete, id, stamp)
}

export function deleteTrack(id: TrackId, stamp?: OpStamp): Op {
  return makeOp(OpType.TrackDelete, id, stamp)
}

export function deleteEntry(id: EntryId, stamp?: OpStamp): Op {
  return makeOp(OpType.EntryDelete, id, stamp)
}

export function deleteGoal(id: GoalId, stamp?: OpStamp): Op {
  return makeOp(OpType.GoalDelete, id, stamp)
}

export function deleteRoutine(id: RoutineId, stamp?: OpStamp): Op {
  return makeOp(OpType.RoutineDelete, id, stamp)
}
