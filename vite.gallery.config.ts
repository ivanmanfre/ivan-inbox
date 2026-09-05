import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * The design-system gallery. Its own Vite entry so it never touches the app's
 * build: no PWA plugin, no service worker, no __BUILD__ define. Root is the
 * gallery folder; the output is a static page that opens from disk.
 *
 *   npx vite build --config vite.gallery.config.ts
 *   npx vite preview --outDir dist-gallery --port 4430 --strictPort
 */
const root = fileURLToPath(new URL('./src/ds/gallery', import.meta.url))
const outDir = fileURLToPath(new URL('./dist-gallery', import.meta.url))

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: { outDir, emptyOutDir: true },
})
