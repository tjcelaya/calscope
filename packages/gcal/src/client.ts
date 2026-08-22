import * as v from 'valibot'
import {
  GcalCalendarListResponseSchema,
  GcalEventsPageSchema,
  type GcalCalendarListEntry,
  type GcalEvent,
} from './types.js'

export const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3'

/** Non-2xx from the API. Body text is preserved -- never swallowed or truncated. */
export class GcalApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(message: string, status: number, body: string) {
    super(`${message} (HTTP ${status}): ${body}`)
    this.name = 'GcalApiError'
    this.status = status
    this.body = body
  }
}

/**
 * 410 Gone on an events pull means Google expired the syncToken. Deliberately its own
 * type: the caller must drop the token and re-pull the full window, which is a sync-state
 * decision this client has no business making on its own.
 */
export class FullResyncRequired extends Error {
  readonly calendarId: string
  constructor(calendarId: string) {
    super(`sync token expired for calendar ${calendarId}; a full resync is required`)
    this.name = 'FullResyncRequired'
    this.calendarId = calendarId
  }
}

/**
 * Structural subset of fetch, so tests inject a plain object and the browser passes
 * `fetch` unchanged (the real signature is wider, which is assignable).
 */
export type HttpResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}
export type HttpFetch = (url: string, init: { headers: Record<string, string> }) => Promise<HttpResponse>

export type GcalClientDeps = {
  fetch: HttpFetch
  getToken: () => Promise<string>
  baseUrl?: string
}

/** Either an incremental pull (syncToken) or a windowed full pull -- never both. */
export type PullOptions = { syncToken: string } | { timeMin: string; timeMax: string }

export type PullResult = {
  events: GcalEvent[]
  /** Token for the next incremental pull; present once the last page has been consumed. */
  nextSyncToken?: string
}

export type GcalClient = {
  listCalendars(): Promise<GcalCalendarListEntry[]>
  pullEvents(calendarId: string, options: PullOptions): Promise<PullResult>
}

export function createGcalClient(deps: GcalClientDeps): GcalClient {
  const base = deps.baseUrl ?? GCAL_API_BASE

  async function doFetch(path: string, params: URLSearchParams): Promise<HttpResponse> {
    const token = await deps.getToken()
    return deps.fetch(`${base}${path}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  return {
    async listCalendars(): Promise<GcalCalendarListEntry[]> {
      const items: GcalCalendarListEntry[] = []
      let pageToken: string | undefined
      do {
        const params = new URLSearchParams()
        if (pageToken !== undefined) params.set('pageToken', pageToken)
        const res = await doFetch('/users/me/calendarList', params)
        if (!res.ok) throw new GcalApiError('calendarList.list failed', res.status, await res.text())
        const page = v.parse(GcalCalendarListResponseSchema, await res.json())
        items.push(...(page.items ?? []))
        pageToken = page.nextPageToken
      } while (pageToken !== undefined)
      return items
    },

    async pullEvents(calendarId: string, options: PullOptions): Promise<PullResult> {
      const events: GcalEvent[] = []
      let pageToken: string | undefined
      let nextSyncToken: string | undefined
      do {
        // singleEvents=true on EVERY request: recurrence expansion is the server's job
        // (plan: do not reimplement RRULE for read), and a syncToken is only valid for
        // requests shaped like the one that minted it. showDeleted=true for the same
        // shape-consistency reason, and because cancelled single instances of recurring
        // events only arrive with it -- the mapper turns cancelled into deletions.
        const params = new URLSearchParams({
          singleEvents: 'true',
          showDeleted: 'true',
          maxResults: '2500',
        })
        if ('syncToken' in options) {
          params.set('syncToken', options.syncToken)
        } else {
          params.set('timeMin', options.timeMin)
          params.set('timeMax', options.timeMax)
        }
        if (pageToken !== undefined) params.set('pageToken', pageToken)
        const res = await doFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, params)
        if (res.status === 410) throw new FullResyncRequired(calendarId)
        if (!res.ok) {
          throw new GcalApiError(`events.list failed for ${calendarId}`, res.status, await res.text())
        }
        const page = v.parse(GcalEventsPageSchema, await res.json())
        events.push(...(page.items ?? []))
        pageToken = page.nextPageToken
        if (pageToken === undefined) nextSyncToken = page.nextSyncToken
      } while (pageToken !== undefined)

      const result: PullResult = { events }
      if (nextSyncToken !== undefined) result.nextSyncToken = nextSyncToken
      return result
    },
  }
}
