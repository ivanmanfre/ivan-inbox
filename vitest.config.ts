import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./src/test-setup.ts'],
    // The suite is a GATE, so it stays hermetic: src only. goal-runs/ holds live
    // DB probes written as spec files — deliberately, so they exercise the
    // SHIPPED functions instead of a reimplementation that could only prove it
    // agrees with itself. Those hit the network and must never decide whether a
    // deploy is allowed. Run one with:
    //   npx vitest run -c goal-runs/<run>/vitest.probe.config.ts
    // src + the edge functions' own units (inbox-claude assembler / depth-block);
    // everything the default glob used to pick up EXCEPT goal-runs.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'supabase/**/*.{test,spec}.{ts,tsx}'],
  },
})
