import { describe, expect, it } from 'vitest'
import { createGcalClient, FullResyncRequired, GcalApiError } from '../src/client.js'
import { STALE_SYNC_TOKEN, fakeCalendarApi, fakeFetch } from './fixtures.js'

function client(fake = fakeCalendarApi()) {
  return {
    api: createGcalClient({ fetch: fake.fetchImpl, getToken: () => Promise.resolve('tok-1') }),
    fake,
  }
}

describe('listCalendars', () => {
  it('follows nextPageToken and returns both calendars in their two zones', async () => {
    const { api, fake } = client()
    const calendars = await api.listCalendars()
    expect(calendars.map((c) => c.id)).toEqual(['primary-la', 'ops-utc'])
    expect(calendars.map((c) => c.timeZone)).toEqual(['America/Los_Angeles', 'UTC'])
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[1]?.url.searchParams.get('pageToken')).toBe('cal-page-2')
  })

  it('sends a Bearer token from the injected provider', async () => {
    const { api, fake } = client()
    await api.listCalendars()
    expect(fake.calls[0]?.headers['Authorization']).toBe('Bearer tok-1')
  })
})

describe('pullEvents: windowed full pull', () => {
  it('paginates through nextPageToken, concatenating items in order', async () => {
    const { api } = client()
    const result = await api.pullEvents('primary-la', {
      timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-02-01T00:00:00Z',
    })
    expect(result.events.map((e) => e.id)).toEqual([
      'ev-timed-tz',
      'ev-timed-notz',
      'ev-allday',
      'ev-zero',
      'evrec_20260105T170000Z',
      'evrec_20260106T170000Z',
      'ev-cancelled',
    ])
  })

  it('always requests singleEvents=true (server-side recurrence expansion)', async () => {
    const { api, fake } = client()
    await api.pullEvents('primary-la', { timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-02-01T00:00:00Z' })
    for (const call of fake.calls) {
      expect(call.url.searchParams.get('singleEvents')).toBe('true')
    }
  })

  it('always requests showDeleted=true so cancelled instances arrive as deletions', async () => {
    const { api, fake } = client()
    await api.pullEvents('primary-la', { timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-02-01T00:00:00Z' })
    for (const call of fake.calls) {
      expect(call.url.searchParams.get('showDeleted')).toBe('true')
    }
  })

  it('sends timeMin/timeMax on a windowed pull, and the pageToken on page two', async () => {
    const { api, fake } = client()
    await api.pullEvents('primary-la', { timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-02-01T00:00:00Z' })
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[0]?.url.searchParams.get('timeMin')).toBe('2026-01-01T00:00:00Z')
    expect(fake.calls[0]?.url.searchParams.get('timeMax')).toBe('2026-02-01T00:00:00Z')
    expect(fake.calls[0]?.url.searchParams.get('syncToken')).toBeNull()
    expect(fake.calls[1]?.url.searchParams.get('pageToken')).toBe('events-page-2')
  })

  it('surfaces the nextSyncToken from the final page', async () => {
    const { api } = client()
    const result = await api.pullEvents('primary-la', {
      timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-02-01T00:00:00Z',
    })
    expect(result.nextSyncToken).toBe('sync-token-1')
  })

  it('expanded recurring instances arrive with distinct ids sharing recurringEventId', async () => {
    const { api } = client()
    const { events } = await api.pullEvents('primary-la', {
      timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-02-01T00:00:00Z',
    })
    const instances = events.filter((e) => e.recurringEventId === 'evrec')
    expect(instances).toHaveLength(2)
    expect(new Set(instances.map((e) => e.id)).size).toBe(2)
  })
})

describe('pullEvents: syncToken continuation', () => {
  it('sends the syncToken instead of a time window and returns the fresh token', async () => {
    const { api, fake } = client()
    const result = await api.pullEvents('primary-la', { syncToken: 'sync-token-1' })
    expect(fake.calls[0]?.url.searchParams.get('syncToken')).toBe('sync-token-1')
    expect(fake.calls[0]?.url.searchParams.get('timeMin')).toBeNull()
    expect(fake.calls[0]?.url.searchParams.get('timeMax')).toBeNull()
    expect(result.events.map((e) => e.id)).toEqual(['ev-timed-tz', 'ev-allday'])
    expect(result.events[1]?.status).toBe('cancelled')
    expect(result.nextSyncToken).toBe('sync-token-2')
  })

  it('maps 410 Gone to FullResyncRequired naming the calendar', async () => {
    const { api } = client()
    const error = await api
      .pullEvents('primary-la', { syncToken: STALE_SYNC_TOKEN })
      .then(() => null)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FullResyncRequired)
    expect((error as FullResyncRequired).calendarId).toBe('primary-la')
  })
})

describe('error handling', () => {
  it('throws GcalApiError with status and body on any other non-2xx -- never swallows', async () => {
    const { api } = client()
    const error = await api
      .pullEvents('forbidden', { timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-02-01T00:00:00Z' })
      .then(() => null)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GcalApiError)
    expect((error as GcalApiError).status).toBe(403)
    expect((error as GcalApiError).body).toContain('insufficient scope')
  })

  it('propagates a schema failure when the response body is not the expected shape', async () => {
    const fake = fakeFetch(() => ({ status: 200, body: { items: [{ summary: 'no id' }] } }))
    const api = createGcalClient({ fetch: fake.fetchImpl, getToken: () => Promise.resolve('t') })
    await expect(api.listCalendars()).rejects.toThrow()
  })
})
