/**
 * Thin wrapper over Google Identity Services' implicit-flow token client.
 *
 * The GIS global (`google.accounts.oauth2`) is injected rather than read off `window`,
 * so tests can fake it and this module stays loadable in Node. Browser-only OAuth gets
 * no refresh token (see plan section 7): tokens live for ~an hour and only while the app
 * is open, hence the silent-renew-then-consent dance on every `getToken` call.
 */

/** M1.5 is read-only; requesting anything wider here would be a bug, not a convenience. */
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export type GisTokenResponse = {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export type GisTokenClient = {
  requestAccessToken(overrides?: { prompt?: string }): void
}

export type GisTokenClientConfig = {
  client_id: string
  scope: string
  callback: (response: GisTokenResponse) => void
  error_callback?: (error: { type?: string; message?: string }) => void
}

/** The shape of `google.accounts.oauth2` that we depend on. */
export type GisOauth2 = {
  initTokenClient(config: GisTokenClientConfig): GisTokenClient
}

export class AuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AuthError'
  }
}

export type TokenProvider = {
  getToken(clientId: string): Promise<string>
}

export function createTokenProvider(oauth2: GisOauth2): TokenProvider {
  return {
    async getToken(clientId: string): Promise<string> {
      // prompt: '' asks GIS to reuse the existing Google session without UI; it fails
      // when there is no session or no prior grant, in which case we escalate to a
      // visible consent prompt rather than failing the pull outright.
      try {
        return await requestAccessToken(oauth2, clientId, '')
      } catch {
        try {
          return await requestAccessToken(oauth2, clientId, 'consent')
        } catch (consentError) {
          throw new AuthError('token request failed after silent and consent attempts', {
            cause: consentError,
          })
        }
      }
    },
  }
}

function requestAccessToken(oauth2: GisOauth2, clientId: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // GIS can report failure through BOTH callbacks (error responses via `callback`,
    // popup failures via `error_callback`); guard so only the first settles the promise.
    let settled = false
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true
        fn()
      }
    }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: CALENDAR_READONLY_SCOPE,
      callback: (response) =>
        settle(() => {
          if (response.error !== undefined) {
            reject(new AuthError(`${response.error}: ${response.error_description ?? ''}`))
          } else if (response.access_token !== undefined) {
            resolve(response.access_token)
          } else {
            reject(new AuthError('token response carried neither access_token nor error'))
          }
        }),
      error_callback: (error) =>
        settle(() => reject(new AuthError(error.message ?? error.type ?? 'token request failed'))),
    })
    client.requestAccessToken({ prompt })
  })
}
