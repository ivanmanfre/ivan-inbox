import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Stamped into the bundle so a screenshot can be traced to a build. Without it the
// only way to tell a stale tab from a broken fix is to argue about it.
const BUILD = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' }
})()

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
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
