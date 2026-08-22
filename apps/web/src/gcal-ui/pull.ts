import { FullResyncRequired, type GcalClient, type GcalEvent } from '@calscope/gcal'

/**
 * One calendar's pull, with the syncToken lifecycle handled: incremental when a token
 * exists, windowed full pull otherwise, and 410 Gone downgraded to a fresh full pull in
 * the same call (the client deliberately refuses to make that decision itself).
 * Framework-free and injected-client so it tests offline.
 */

export type PullWindow = {
  /** RFC3339 instants, as events.list expects. */
  timeMin: string
  timeMax: string
}

export type CalendarPullOutcome = {
  calendarId: string
  /** Events from THIS pull only -- fold into accumulated state via applyPullOutcome. */
  events: GcalEvent[]
  nextSyncToken?: string
  /** True when a stored syncToken had expired and a full windowed pull ran instead. */
  resynced: boolean
}

export async function pullCalendar(
  client: GcalClient,
  calendarId: string,
  window: PullWindow,
  syncToken?: string,
): Promise<CalendarPullOutcome> {
  if (syncToken !== undefined) {
    try {
      const result = await client.pullEvents(calendarId, { syncToken })
      const outcome: CalendarPullOutcome = { calendarId, events: result.events, resynced: false }
      if (result.nextSyncToken !== undefined) outcome.nextSyncToken = result.nextSyncToken
      return outcome
    } catch (error) {
      if (!(error instanceof FullResyncRequired)) throw error
      // Fall through to the full pull; the caller learns via `resynced` that the old
      // token must be discarded.
      const result = await client.pullEvents(calendarId, window)
      const outcome: CalendarPullOutcome = { calendarId, events: result.events, resynced: true }
      if (result.nextSyncToken !== undefined) outcome.nextSyncToken = result.nextSyncToken
      return outcome
    }
  }
  const result = await client.pullEvents(calendarId, window)
  const outcome: CalendarPullOutcome = { calendarId, events: result.events, resynced: false }
  if (result.nextSyncToken !== undefined) outcome.nextSyncToken = result.nextSyncToken
  return outcome
}

/**
 * Fold one pull's outcome into the accumulated per-calendar events. Incremental (and
 * first full) pulls merge; a RESYNCED full pull replaces the accumulated set outright.
 * The expired token lost exactly the cancelled stubs for events deleted during the gap,
 * so merging a resync would resurrect those deletions as live entries -- Google's 410
 * protocol is "wipe stored data, full resync", and the accumulated events are that data.
 */
export function applyPullOutcome(
  existing: readonly GcalEvent[],
  outcome: CalendarPullOutcome,
): GcalEvent[] {
  return outcome.resynced ? [...outcome.events] : mergeEvents(existing, outcome.events)
}

/**
 * Merge an incremental pull into accumulated events. Keyed by event id, incoming wins --
 * an incremental page carries the CURRENT state of each changed event (cancelled stubs
 * included), so replacement is the correct semantics, and existing order is kept stable
 * so re-renders do not reshuffle the report.
 */
export function mergeEvents(existing: readonly GcalEvent[], incoming: readonly GcalEvent[]): GcalEvent[] {
  if (existing.length === 0) return [...incoming]
  const byId = new Map(incoming.map((e) => [e.id, e]))
  const merged: GcalEvent[] = existing.map((e) => {
    const replacement = byId.get(e.id)
    if (replacement !== undefined) byId.delete(e.id)
    return replacement ?? e
  })
  for (const e of incoming) {
    const pending = byId.get(e.id)
    if (pending !== undefined) {
      merged.push(pending)
      byId.delete(e.id)
    }
  }
  return merged
}
