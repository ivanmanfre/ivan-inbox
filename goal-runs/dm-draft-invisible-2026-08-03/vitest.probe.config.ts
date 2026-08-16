import { defineConfig } from 'vitest/config'
// Live probe config, per the convention in vitest.config.ts. `root:` resolves
// against CWD, so it is absolute.
const HERE = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/dm-draft-invisible-2026-08-03'
export default defineConfig({
  root: '/Users/ivanmanfredi/Desktop/ivan-inbox',
  test: { environment: 'node', setupFiles: [`${HERE}/_setup.ts`], include: [`${HERE}/*.probe.test.ts`] },
})
