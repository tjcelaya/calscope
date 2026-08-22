import type { GisOauth2 } from '@calscope/gcal'

/**
 * Lazy loader for the Google Identity Services script. It is injected on first Connect
 * rather than in index.html so the app makes ZERO Google requests until the user asks
 * for the integration -- and so an offline (or sandboxed) environment fails here, at a
 * surfaced error, instead of breaking page load.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const LOAD_TIMEOUT_MS = 15_000

type GoogleGlobal = { google?: { accounts?: { oauth2?: GisOauth2 } } }

function currentGis(): GisOauth2 | undefined {
  return (globalThis as GoogleGlobal).google?.accounts?.oauth2
}

let loading: Promise<GisOauth2> | null = null

export function loadGis(doc: Document = document): Promise<GisOauth2> {
  const existing = currentGis()
  if (existing !== undefined) return Promise.resolve(existing)
  // Single-flight: a second Connect click while the script is in flight must not
  // inject a second script tag.
  loading ??= new Promise<GisOauth2>((resolve, reject) => {
    const fail = (message: string) => {
      loading = null // allow a retry after e.g. the network comes back
      reject(new Error(message))
    }
    const script = doc.createElement('script')
    script.src = GIS_SRC
    script.async = true
    const timer = setTimeout(
      () => fail(`Google Identity Services did not load within ${LOAD_TIMEOUT_MS / 1000}s -- is ${GIS_SRC} reachable from here?`),
      LOAD_TIMEOUT_MS,
    )
    script.onload = () => {
      clearTimeout(timer)
      const gis = currentGis()
      if (gis !== undefined) resolve(gis)
      else fail('the GIS script loaded but google.accounts.oauth2 is missing')
    }
    script.onerror = () => {
      clearTimeout(timer)
      fail(`could not load ${GIS_SRC} -- offline, blocked, or sandboxed?`)
    }
    doc.head.appendChild(script)
  })
  return loading
}
