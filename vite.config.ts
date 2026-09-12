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
      // goal run inbox-agent-drawer-2026-09-12 (Seat B): `id` pins the
      // installed app's identity to this scope regardless of a later
      // `start_url` change, and `display_override` asks for the desktop
      // window's own titlebar controls where the platform grants them,
      // falling back to `standalone` (the `display` above) everywhere else —
      // an installed desktop window with Chrome's own tab strip painted over
      // it read as two apps stacked.
      id: './',
      display_override: ['window-controls-overlay', 'standalone'],
      // Left unset until the dock existed, because the answer depended on the
      // layout. It is now a single column with a bottom-anchored control: in
      // landscape on a phone the transcript is two lines tall and the dock eats
      // the rest, so the useful orientation is the only one declared. Desktop
      // ignores `orientation` entirely (it is a phone/tablet-only hint), so
      // this stays portrait for the surface it actually constrains.
      orientation: 'portrait',
      background_color: '#000000', theme_color: '#000000', start_url: './',
      icons: [
        { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
        // Full-bleed ground with the mark inside the safe zone, so Android can
        // cut its own shape without clipping the pill.
        { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      // The three destinations a long-press (Android) or right-click (desktop
      // PWA) on the dock/taskbar icon jumps straight to, on the 192 icon: no
      // separate shortcut art exists, and the app icon is already the mark
      // every one of these places lands inside.
      shortcuts: [
        { name: 'Sales', url: './#exp/brain-b/sales', icons: [{ src: './icon-192.png', sizes: '192x192', type: 'image/png' }] },
        { name: 'Orbit', url: './#exp/brain-b/orbit', icons: [{ src: './icon-192.png', sizes: '192x192', type: 'image/png' }] },
        { name: 'Claude', url: './#exp/brain-b/ask', icons: [{ src: './icon-192.png', sizes: '192x192', type: 'image/png' }] },
      ],
      // The install-picker screenshots (Chrome/Android and desktop both read
      // these): one per `form_factor` so each surface shows its own shape
      // rather than a phone shot stretched into the desktop picker or vice
      // versa. Captured off a local preview of this build with the drawer
      // open (wide) and the phone chip visible (narrow) — see
      // goal-runs/inbox-agent-drawer-2026-09-12-out/REPORT-B.md.
      screenshots: [
        { src: './shot-wide.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide', label: 'Inbox on the desktop' },
        { src: './shot-narrow.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: 'Inbox on the phone' },
      ],
    },
  })],
})
