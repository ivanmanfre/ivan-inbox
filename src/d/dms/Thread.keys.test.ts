import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Siblings in the conversation column must never share a key. React keeps one of two same-key
// siblings in its reconcile map and leaks the other's DOM on every re-render, so the referral card
// stacked up ~20 frozen "Researching…" copies on Éléa G. (ARCH, 2026-11-05).
describe('Thread sibling keys', () => {
  it('gives every keyed panel in Thread.tsx a distinct key', () => {
    const src = readFileSync(new URL('./Thread.tsx', import.meta.url), 'utf8')
    const keys = [...src.matchAll(/<(ReferralCard|CalendarPanel|SwishReferral)\b[^>]*?\bkey=\{([^}]+)\}/g)]
    const byKey = new Map<string, Set<string>>()
    for (const [, tag, key] of keys) byKey.set(key, (byKey.get(key) ?? new Set()).add(tag))
    expect(keys.length).toBeGreaterThan(0)
    expect([...byKey].filter(([, tags]) => tags.size > 1)).toEqual([])
  })
})
