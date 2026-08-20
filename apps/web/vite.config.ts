import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
        start_url: '/',
      },
    }),
  ],
})
