import { describe, expect, it } from 'vitest'
import {
  AuthError,
  CALENDAR_READONLY_SCOPE,
  createTokenProvider,
  type GisOauth2,
  type GisTokenClientConfig,
  type GisTokenResponse,
} from '../src/auth.js'

type Step =
  | { kind: 'response'; response: GisTokenResponse }
  | { kind: 'error_callback'; error: { type?: string; message?: string } }

/** Scripted fake of the injected `google.accounts.oauth2` global. */
function fakeOauth2(steps: Step[]) {
  const configs: GisTokenClientConfig[] = []
  const prompts: (string | undefined)[] = []
  const oauth2: GisOauth2 = {
    initTokenClient(config) {
      configs.push(config)
      return {
        requestAccessToken(overrides) {
          prompts.push(overrides?.prompt)
          const step = steps.shift()
          if (step === undefined) throw new Error('fake oauth2 script exhausted')
          // GIS delivers asynchronously; mirror that so settle-once logic is exercised.
          queueMicrotask(() => {
            if (step.kind === 'response') config.callback(step.response)
            else config.error_callback?.(step.error)
          })
        },
      }
    },
  }
  return { oauth2, configs, prompts }
}

describe('createTokenProvider', () => {
  it('resolves on a silent renew (prompt: "") without any consent prompt', async () => {
    const fake = fakeOauth2([{ kind: 'response', response: { access_token: 'tok-silent' } }])
    const token = await createTokenProvider(fake.oauth2).getToken('client-1')
    expect(token).toBe('tok-silent')
    expect(fake.prompts).toEqual([''])
  })

  it('requests ONLY the readonly calendar scope, with the given client id', async () => {
    const fake = fakeOauth2([{ kind: 'response', response: { access_token: 't' } }])
    await createTokenProvider(fake.oauth2).getToken('client-abc')
    expect(fake.configs).toHaveLength(1)
    expect(fake.configs[0]?.scope).toBe(CALENDAR_READONLY_SCOPE)
    expect(fake.configs[0]?.scope).toBe('https://www.googleapis.com/auth/calendar.readonly')
    expect(fake.configs[0]?.client_id).toBe('client-abc')
  })

  it('falls back to a consent prompt when the silent attempt errors', async () => {
    const fake = fakeOauth2([
      { kind: 'response', response: { error: 'interaction_required' } },
      { kind: 'response', response: { access_token: 'tok-consent' } },
    ])
    const token = await createTokenProvider(fake.oauth2).getToken('client-1')
    expect(token).toBe('tok-consent')
    expect(fake.prompts).toEqual(['', 'consent'])
  })

  it('falls back when the silent attempt dies via error_callback (popup path)', async () => {
    const fake = fakeOauth2([
      { kind: 'error_callback', error: { type: 'popup_failed_to_open' } },
      { kind: 'response', response: { access_token: 'tok-2' } },
    ])
    await expect(createTokenProvider(fake.oauth2).getToken('c')).resolves.toBe('tok-2')
  })

  it('throws AuthError when both attempts fail', async () => {
    const fake = fakeOauth2([
      { kind: 'response', response: { error: 'interaction_required' } },
      { kind: 'response', response: { error: 'access_denied', error_description: 'user said no' } },
    ])
    await expect(createTokenProvider(fake.oauth2).getToken('c')).rejects.toThrow(AuthError)
    expect(fake.prompts).toEqual(['', 'consent'])
  })

  it('rejects a token response carrying neither a token nor an error', async () => {
    const fake = fakeOauth2([
      { kind: 'response', response: {} },
      { kind: 'response', response: {} },
    ])
    const error = await createTokenProvider(fake.oauth2)
      .getToken('c')
      .then(() => null)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthError)
    // The consent-attempt failure is preserved as the cause, not swallowed.
    expect(String((error as AuthError).cause)).toContain('neither access_token nor error')
  })
})
