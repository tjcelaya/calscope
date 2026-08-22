import { HlcClock } from './core'
import type { ActorId } from './core'

const ACTOR_STORAGE_KEY = 'calscope.actor'

let cachedActor: ActorId | null = null
let cachedClock: HlcClock | null = null

/**
 * Stable identity for this browser profile, persisted in localStorage so ops written
 * across sessions carry the same actor and the HLC total order stays deterministic.
 * localStorage can throw (private windows, storage disabled, non-browser test runs);
 * then the id is stable for the session only -- a fresh actor per session is harmless,
 * the fold does not care how many actors exist.
 */
export function actorId(): ActorId {
  if (cachedActor !== null) return cachedActor
  let stored: string | null = null
  try {
    stored = globalThis.localStorage?.getItem(ACTOR_STORAGE_KEY) ?? null
  } catch {
    stored = null
  }
  const actor = stored ?? crypto.randomUUID()
  if (stored === null) {
    try {
      globalThis.localStorage?.setItem(ACTOR_STORAGE_KEY, actor)
    } catch {
      // Best-effort; see above.
    }
  }
  cachedActor = actor
  return actor
}

/** The app-wide clock, lazily bound to this profile's actor id. */
export function actorClock(): HlcClock {
  cachedClock ??= new HlcClock(actorId())
  return cachedClock
}
