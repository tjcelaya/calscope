import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * GitHub Pages serves project sites under /<repo>/, so CI sets BASE_PATH to that prefix;
 * local dev leaves it unset and the bundle stays root-relative.
 *
 * Anyone self-hosting under a subpath needs the prefix baked into asset URLs and into
 * the PWA manifest, or the page 404s on its own JS and the service worker silently
 * loses scope.
 */
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'calscope',
        short_name: 'calscope',
        description: 'Goals, events and routines on one composable model.',
        theme_color: '#11131a',
        background_color: '#11131a',
        display: 'standalone',
        // Both must track `base`: a service worker cannot control pages outside its scope,
        // so a '/' scope on a '/calscope/' deployment silently disables offline support.
        start_url: base,
        scope: base,
        // SVG covers Chromium/Android installs; iOS wants a PNG apple-touch-icon,
        // deferred until there is real branding to rasterize.
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
})
