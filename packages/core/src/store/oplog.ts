import { OpType } from '../model/enums.js'
import type { Entry, Goal, Op, Routine, Snapshot, Tag, Track } from '../model/types.js'
import { compareHlc } from './hlc.js'

export function emptySnapshot(): Snapshot {
  return { tags: {}, tracks: {}, entries: {}, goals: {}, routines: {} }
}

type Keyed = { id: string }

/**
 * Fold an op log into current state.
 *
 * Last-writer-wins by HLC, applied per record. Crucially the log is sorted before
 * folding, so replaying ops that arrive out of order (a sync batch, an import) produces
 * the same state as receiving them in order -- which is what makes adding a relay later
 * a no-op for the data model.
 */
export function fold(ops: readonly Op[], base: Snapshot = emptySnapshot()): Snapshot {
  const state: Snapshot = {
    tags: { ...base.tags },
    tracks: { ...base.tracks },
    entries: { ...base.entries },
    goals: { ...base.goals },
    routines: { ...base.routines },
  }

  // Track the winning HLC per record so a late-arriving older op cannot overwrite a
  // newer one already applied.
  const applied = new Map<string, string>()

  const sorted = [...ops].sort((a, b) => compareHlc(a.hlc, b.hlc))

  for (const op of sorted) {
    const id = idOf(op)
    if (id === null) continue

    const key = `${op.type.split('.')[0]}:${id}`
    const previous = applied.get(key)
    if (previous !== undefined && compareHlc(op.hlc, previous) < 0) continue
    applied.set(key, op.hlc)

    switch (op.type) {
      case OpType.TagUpsert:
        state.tags[id] = op.payload as Tag
        break
      case OpType.TagDelete:
        delete state.tags[id]
        break
      case OpType.TrackUpsert:
        state.tracks[id] = op.payload as Track
        break
      case OpType.TrackDelete:
        delete state.tracks[id]
        break
      case OpType.EntryUpsert:
        state.entries[id] = op.payload as Entry
        break
      case OpType.EntryDelete:
        delete state.entries[id]
        break
      case OpType.GoalUpsert:
        state.goals[id] = op.payload as Goal
        break
      case OpType.GoalDelete:
        delete state.goals[id]
        break
      case OpType.RoutineUpsert:
        state.routines[id] = op.payload as Routine
        break
      case OpType.RoutineDelete:
        delete state.routines[id]
        break
      default: {
        const exhaustive: never = op.type
        throw new Error(`unhandled op type: ${String(exhaustive)}`)
      }
    }
  }
  return state
}

function idOf(op: Op): string | null {
  const payload = op.payload
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && typeof (payload as Keyed).id === 'string') {
    return (payload as Keyed).id
  }
  return null
}

export function entriesOf(state: Snapshot): Entry[] {
  return Object.values(state.entries)
}

export function tracksOf(state: Snapshot): Track[] {
  return Object.values(state.tracks)
}

export function tagsOf(state: Snapshot): Tag[] {
  return Object.values(state.tags)
}
