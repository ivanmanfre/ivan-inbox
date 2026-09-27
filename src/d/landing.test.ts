import { describe, expect, it } from 'vitest'
import { canonicalHash, dLandingHash, toDHash, todayAppHash } from './route'

const T = '11111111-1111-4111-8111-111111111111'
const U = '22222222-2222-4222-8222-222222222222'

describe('dLandingHash: every address today writes lands in D on a cold start', () => {
  it.each([
    // inbox-turn-run completion push
    [`#exp/brain-b/ask?thread=${T}&turn=${U}`, `#exp/d/claude?thread=${T}&turn=${U}`],
    // db/055 notify registry + Inbox Notify Relay + bot-actions fallback
    ['#exp/brain-b/ops', '#exp/d/ops'],
    ['#exp/brain-b/content', '#exp/d/content'],
    ['#exp/brain-b/sends', '#exp/d/lanes'],
    ['#exp/brain-b/today', '#exp/d/lanes'],
    ['#exp/brain-b/dms', '#exp/d/dms'],
    // manifest shortcuts
    ['#exp/brain-b/sales', '#exp/d/sales'],
    ['#exp/brain-b/orbit', '#exp/d/sales/orbit'],
    ['#exp/brain-b/ask', '#exp/d/claude'],
    ['#claude/voice', '#exp/d/claude?voice=1'],
    // query keys
    ['#exp/brain-b/today?feed=1', '#exp/d/lanes?feed=1'],
    ['#exp/brain-b?warm=1', '#exp/d/dms?warm=1'],
    ['#exp/brain-b/?warm=1', '#exp/d/dms?warm=1'],
    [`#exp/v2/dms?warm=${T}`, `#exp/d/dms?warm=${T}`],
    [`#exp/brain-b/today?warm=${T}`, `#exp/d/dms?warm=${T}`],
    ['#exp/brain-b/content?sources=1', '#exp/d/content/strategy?section=research'],
    ['#exp/v2?section=sources', '#exp/d/content/strategy?section=research'],
    ['#exp/v2/content?section=sales', '#exp/d/content?section=sales'],
  ])('%s -> %s', (from, to) => { expect(dLandingHash(from)).toBe(to) })

  it('leaves today\'s app reachable on purpose', () => {
    expect(dLandingHash('#exp/brain-b')).toBeNull()
    expect(dLandingHash('#exp/brain-b/sales?app=today')).toBeNull()
    expect(dLandingHash(todayAppHash('#exp/brain-b/orbit?tenant=ivan&range=30d'))).toBeNull()
  })

  it('leaves every non-old address alone', () => {
    for (const h of ['', '#', '#exp/d/dms', '#exp/stock', '#exp/off', '#doc?slug=x', '#access_token=abc', '#today']) {
      expect(dLandingHash(h)).toBeNull()
    }
  })

  it('never carries the keep-today marker into D', () => {
    expect(toDHash('#exp/brain-b/sales?app=today&slug=x')).toBe('#exp/d/sales?slug=x')
  })

  it('todayAppHash keeps the query and adds the marker once', () => {
    expect(todayAppHash('#exp/brain-b/orbit?tenant=ivan')).toBe('#exp/brain-b/orbit?tenant=ivan&app=today')
    expect(todayAppHash('#exp/brain-b/orbit?app=today')).toBe('#exp/brain-b/orbit?app=today')
  })

  it('never rewrites a sign-in token', () => {
    expect(canonicalHash('#access_token=abc&type=recovery')).toBe('#access_token=abc&type=recovery')
  })
})
