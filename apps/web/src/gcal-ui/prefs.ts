/**
 * The ONLY things gcal-ui persists: the OAuth client id and per-calendar syncTokens.
 * Everything else (token, calendar list, pulled events, cluster decisions) is
 * deliberately session-local panel state.
 *
 * syncTokens live in localStorage rather than the op log because they are DEVICE state,
 * not document state: a token minted for this browser's pull sequence is meaningless on
 * another device, and shipping it through a future sync relay would poison other
 * replicas' pulls. localStorage access is guarded throughout -- private windows and
 * disabled storage degrade to session-only behavior, never a crash.
 */

const CLIENT_ID_KEY = 'calscope.gcal.clientId'
const SYNC_TOKEN_PREFIX = 'calscope.gcal.syncToken.'

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, value)
  } catch {
    // Best-effort; see module comment.
  }
}

/** Build-time default (a public web-client id is not a secret); a saved value wins. */
function envClientId(): string {
  const v = import.meta.env?.VITE_GOOGLE_CLIENT_ID as unknown
  return typeof v === 'string' ? v : ''
}

export function loadClientId(): string {
  return read(CLIENT_ID_KEY) ?? envClientId()
}

export function saveClientId(clientId: string): void {
  write(CLIENT_ID_KEY, clientId.trim() === '' ? null : clientId.trim())
}

export function loadSyncToken(calendarId: string): string | null {
  return read(SYNC_TOKEN_PREFIX + calendarId)
}

export function saveSyncToken(calendarId: string, token: string): void {
  write(SYNC_TOKEN_PREFIX + calendarId, token)
}

/** Called when the API answers 410 Gone: the stored token is dead, drop it. */
export function clearSyncToken(calendarId: string): void {
  write(SYNC_TOKEN_PREFIX + calendarId, null)
}
