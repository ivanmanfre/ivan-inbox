import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [react(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
    registerType: 'autoUpdate',
    manifest: {
      name: 'Inbox', short_name: 'Inbox', display: 'standalone',
      // Left unset until the dock existed, because the answer depended on the
      // layout. It is now a single column with a bottom-anchored control: in
      // landscape on a phone the transcript is two lines tall and the dock eats
      // the rest, so the useful orientation is the only one declared.
      orientation: 'portrait',
      background_color: '#000000', theme_color: '#000000', start_url: './',
      icons: [
        { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
  })],
})
