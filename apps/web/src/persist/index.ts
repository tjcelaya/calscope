// Browser persistence for the op log: IndexedDB-backed store, stable actor identity,
// op creators, and whole-document export/import. Framework-free -- no solid-js here.
export { OpStore } from './store'
export { actorClock, actorId } from './actor'
export {
  deleteEntry,
  deleteGoal,
  deleteRoutine,
  deleteTag,
  deleteTrack,
  upsertEntry,
  upsertGoal,
  upsertRoutine,
  upsertTag,
  upsertTrack,
  type OpStamp,
} from './ops'
export { exportDocument, importDocument, type ExportDocument } from './export'
