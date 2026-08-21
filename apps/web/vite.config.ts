import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Deploys serve from the root of their own subdomain (Cloudflare Pages), so BASE_PATH is
 * normally unset and the bundle stays root-relative.
 *
 * It is kept because self-hosting is a stated goal of the project: anyone serving this
 * under a subpath -- https://example.com/timeslife/ -- needs the prefix baked into asset
 * URLs and into the PWA manifest, or the page 404s on its own JS and the service worker
 * silently loses scope.
 */
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'timeslife',
        short_name: 'timeslife',
        description: 'Goals, events and routines on one composable model.',
        theme_color: '#11131a',
        background_color: '#11131a',
        display: 'standalone',
        // Both must track `base`: a service worker cannot control pages outside its scope,
        // so a '/' scope on a '/timeslife/' deployment silently disables offline support.
        start_url: base,
        scope: base,
      },
    }),
  ],
})
