import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Stamped into the bundle so a screenshot can be traced to a build. Without it the
// only way to tell a stale tab from a broken fix is to argue about it.
const BUILD = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' }
})()

const workspace = '/Users/ivanmanfredi/Desktop/Ivan - Content System'
const previewFiles: Record<string, string> = {
  ivan: resolve(workspace, 'goal-runs/content-brain-01-evidence-briefs-2026-09-20-out/briefs/ivan.json'),
  risedtc: resolve(workspace, 'goal-runs/content-brain-01-evidence-briefs-2026-09-20-out/briefs/risedtc.json'),
  arch: resolve(workspace, 'goal-runs/content-brain-01-evidence-briefs-2026-09-20-out/briefs/arch.json'),
  resources: resolve(workspace, 'goal-runs/content-brain-02-workspace-generation-2026-09-20-out/inventory/resource-rows.json'),
}

export default defineConfig({
  server: { host: '127.0.0.1' },
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [{ name: 'local-editorial-preview-files', apply: 'serve', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/__editorial_preview/')) return next()
      const name = req.url.slice('/__editorial_preview/'.length).split('?')[0]
      if (process.env.VITE_EDITORIAL_PREVIEW !== '1' || !Object.hasOwn(previewFiles, name)) { res.writeHead(404).end(); return }
      try { const body = await readFile(previewFiles[name]); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(body) }
      catch { res.writeHead(500).end('Named local preview file unavailable') }
    })
  } }, react(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
    registerType: 'autoUpdate',
    // The `?wbmock=cc:<scenario>` operator fixtures are a DEVELOPMENT lever
    // (src/lib/cc-fixtures/*.json). They are never requested by the shipped app
    // — `loadScenario` refuses outside DEV — so precaching ~2.7 MB of them would
    // put the whole test corpus on every install for nobody's benefit.
    injectManifest: {
      globIgnores: ['**/{healthy,incident,unknown,partial,capacity_reached,outside_window}-*.js'],
      // The worker imports the app's Supabase client for the push-time DMs
      // prefetch (src/sw.ts). supabase-js carries a dynamic
      // `import('@opentelemetry/api')` whose bundler helper references
      // `import.meta`, which is a SyntaxError in a classic worker script: the
      // whole worker failed to evaluate and no push handler was registered
      // (caught 2026-09-14 in the Playwright gate, never shipped). The import
      // itself is already wrapped in a catch upstream; only the two
      // `import.meta` reads have to go.
      buildPlugins: { vite: [{
        name: 'sw-no-import-meta',
        renderChunk(code) {
          return code.replaceAll('import.meta.resolve', 'undefined').replaceAll('import.meta.url', 'self.location.href')
        },
      }] },
    },
    manifest: {
      name: process.env.VITE_PREVIEW === '1' ? 'Inbox (new)' : 'Inbox',
      short_name: process.env.VITE_PREVIEW === '1' ? 'Inbox new' : 'Inbox', display: 'standalone',
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
        // Rebuild: live voice in one press (blueprint, Claude "NEW"). Lands on the voice screen,
        // which asks for the tap iOS needs before the microphone opens.
        { name: 'Talk to Claude', url: './#claude/voice', icons: [{ src: './icon-192.png', sizes: '192x192', type: 'image/png' }] },
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
