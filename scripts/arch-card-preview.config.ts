import { defineConfig } from 'vitest/config'

// The preview generator is NOT part of the gate: the suite in vitest.config.ts
// stays hermetic (src + supabase), and this config exists so one file under
// scripts/ can be run on demand to draw the ARCH card from fixture rows.
//
//   npx vitest run -c scripts/arch-card-preview.config.ts
//
// It renders the real component with renderToStaticMarkup, wraps it in the app's
// own stylesheets, and screenshots each page with the Playwright already in
// devDependencies. Nothing is fetched: no session, no edge function, no database.
export default defineConfig({
  test: {
    setupFiles: ['./src/test-setup.ts'],
    include: ['scripts/**/*.preview.tsx'],
    testTimeout: 120_000,
  },
})
