import { defineConfig } from 'vitest/config'

// The p4b proof, per the convention in vitest.config.ts: it reads a snapshot of
// live rows, so it stays OUT of `npm test` and can never fail a deploy gate.
// `root:` resolves against CWD, so it is absolute. Same setup file as the suite
// (jsdom, which is what lets src/lib/supabase.ts construct at import time).
const ROOT = '/Users/ivanmanfredi/Desktop/ivan-inbox-pw-b'
export default defineConfig({
  root: ROOT,
  test: {
    setupFiles: ['./src/test-setup.ts'],
    include: [`${ROOT}/goal-runs/workbench-polish-2026-08-22-out/evidence/p4b-tools/*.test.ts`],
  },
})
