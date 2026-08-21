import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * A GitHub Pages *project* site is served from https://<user>.github.io/<repo>/, not from
 * the domain root, so every asset URL needs that prefix or the deployed page 404s on its
 * own JS. CI sets BASE_PATH; local dev and `vite preview` stay at '/'.
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
