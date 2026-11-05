import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['scripts/inbox-ux-layout.preview.tsx'], testTimeout: 120000 } })
