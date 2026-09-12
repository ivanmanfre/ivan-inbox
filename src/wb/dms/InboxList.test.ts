/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dmsEmptyKind, rowVerb } from './InboxList'

// W2-5 (absorbs GAPS-3): a screen with 0 rows on it is not always genuinely
// empty. Only a host that has established the fetch resolved (`verifiedAt`
// not null) may claim "nothing waiting on you".
describe('dmsEmptyKind', () => {
  it('renders rows, not an empty state, when there are any', () => {
    expect(dmsEmptyKind(3, '', null)).toBe('none')
  })

  it('shows the row skeleton before the first fetch resolves, cold open', () => {
    expect(dmsEmptyKind(0, '', null)).toBe('loading')
  })

  it('shows the honest empty claim once verifiedAt is a real timestamp', () => {
    expect(dmsEmptyKind(0, '', '2026-09-08T10:00:00Z')).toBe('verified')
  })

  it('a search with no matches wins over the loading state', () => {
    expect(dmsEmptyKind(0, 'nobody', null)).toBe('search')
  })

  it('a search with no matches wins over the verified empty state too', () => {
    expect(dmsEmptyKind(0, 'nobody', '2026-09-08T10:00:00Z')).toBe('search')
  })
})

// R2 · The phone row's only affordance was `Discard`, 76x34, under the 44px
// floor, on six of eight live rows. A list is not where a draft is destroyed on
// a first tap. The fork below is the whole of that repair.
describe('rowVerb', () => {
  it('shows nothing on a row with no pending draft, either canvas', () => {
    expect(rowVerb({ mobile: true, pendingDraft: false, preRead: false })).toBe(null)
    expect(rowVerb({ mobile: false, pendingDraft: false, preRead: false })).toBe(null)
  })

  it('keeps the desktop hover Discard exactly as it was', () => {
    expect(rowVerb({ mobile: false, pendingDraft: true, preRead: false })).toBe('discard')
    expect(rowVerb({ mobile: false, pendingDraft: true, preRead: true })).toBe('discard')
  })

  it('never puts the destructive verb under the thumb', () => {
    expect(rowVerb({ mobile: true, pendingDraft: true, preRead: false })).not.toBe('discard')
    expect(rowVerb({ mobile: true, pendingDraft: true, preRead: true })).not.toBe('discard')
  })

  it('opens the thread instead, on the phone', () => {
    expect(rowVerb({ mobile: true, pendingDraft: true, preRead: false })).toBe('open')
  })

  it('leaves the one action slot to Sum up when the row already offers it', () => {
    expect(rowVerb({ mobile: true, pendingDraft: true, preRead: true })).toBe(null)
  })
})

// The capability the list registers for a pending-draft row. Read off the
// SHIPPED source rather than restated, because the rule it guards is a rule
// about what the bulk bar may ever offer: a conversation is answered one at a
// time, and the only thing a list may run in bulk is a discard, which sends
// nothing. An `approve` or `send` appearing here would be a one-tap send from a
// list.
describe('the list exposes no approve/send capability', () => {
  const src = readFileSync(join(process.cwd(), 'src/wb/dms/InboxList.tsx'), 'utf8')
  it("caps on a pending-draft row is ['discard'] and nothing else", () => {
    expect(src).toContain("caps={pendingDraft ? ['discard'] : []}")
    const caps = [...src.matchAll(/caps=\{([^}]*)\}/g)].map(m => m[1])
    expect(caps).toHaveLength(1)
    for (const c of caps) {
      expect(c).not.toMatch(/approve|send|promote/)
    }
  })
})
