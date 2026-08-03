import { defineConfig } from 'vitest/config'

// Live-DB probes for the inbox-density-and-ia run. Kept OUT of `npm test`
// (vitest.config.ts includes src only) because they need the network and a
// valid session — a probe must never be able to fail a deploy gate for being
// offline. They are spec files so they run the shipped functions.
export default defineConfig({
  root: '../..',
  test: {
    setupFiles: ['./src/test-setup.ts'],
    include: ['goal-runs/inbox-density-and-ia-2026-08-03-out/*.spec.ts'],
    testTimeout: 180000,
  },
})
