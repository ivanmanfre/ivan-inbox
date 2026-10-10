import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

import { cameBackLine, cameBackRowLine, cardsFor, firstComment, scanReopenOnlyIvan, sentLine, tenantLabel, type CameBackCard } from './cameBackData'

const card = (over: Partial<CameBackCard>): CameBackCard => ({
  prospect_id: 'p1', tenant: 'ivan', name: 'Dave', headline: null, company: 'n8n', title: null, country: null,
  icp_score: 9, stage: 'dm_sent', campaign: null, linkedin_url: null, dm_count: 2,
  last_out_at: '2026-09-16T10:00:00Z', last_out_model: 'content_system_followup_v3', last_out_text: null,
  last_signal_at: '2026-09-16T18:00:00Z', n_views: 1, n_engagements: 0, signals: [], ...over,
})

describe('cardsFor', () => {
  const all = [card({ prospect_id: 'a', tenant: 'ivan' }), card({ prospect_id: 'b', tenant: 'risedtc' }), card({ prospect_id: 'c', tenant: 'arch' })]
  it('shows every client on All', () => expect(cardsFor(all, 'all').map(c => c.prospect_id)).toEqual(['a', 'b', 'c']))
  it('scopes to the open client lane', () => {
    expect(cardsFor(all, 'risedtc').map(c => c.prospect_id)).toEqual(['b'])
    expect(cardsFor(all, 'arch').map(c => c.prospect_id)).toEqual(['c'])
  })
  it('shows nobody on lanes with no LinkedIn seat', () => {
    expect(cardsFor(all, 'email')).toEqual([])
    expect(cardsFor(all, 'spam')).toEqual([])
  })
})

describe('scanReopenOnlyIvan', () => {
  const reopen = [{ kind: 'scan_open', at: '2026-09-16T10:00:00Z', detail: null }]
  it('drops an Ivan card whose only signal is a scan reopen (the bump drafts it instead)', () =>
    expect(scanReopenOnlyIvan(card({ n_views: 0, signals: reopen }))).toBe(true))
  it('keeps an Ivan card that also carries a profile view', () =>
    expect(scanReopenOnlyIvan(card({ n_views: 1, signals: reopen }))).toBe(false))
  it('keeps an Ivan card that also carries a post engagement', () =>
    expect(scanReopenOnlyIvan(card({ n_views: 0, n_engagements: 1, signals: [...reopen, { kind: 'reaction', at: '', detail: null }] }))).toBe(false))
  it('never touches RISE or ARCH', () => {
    expect(scanReopenOnlyIvan(card({ tenant: 'risedtc', n_views: 0, signals: reopen }))).toBe(false)
    expect(scanReopenOnlyIvan(card({ tenant: 'arch', n_views: 0, signals: reopen }))).toBe(false)
  })
})

describe('tenantLabel', () => {
  it('names the client only when several clients share the screen', () => {
    expect(tenantLabel(card({ tenant: 'risedtc' }), 'all')).toBe('Mattan Danino')
    expect(tenantLabel(card({ tenant: 'risedtc' }), 'risedtc')).toBeNull()
  })
})

describe('cameBackLine', () => {
  it('reads a single view', () => expect(cameBackLine(card({}))).toMatch(/^viewed the profile · /))
  it('names an opened scan, which rides in signals (db/097)', () => expect(cameBackLine(card({ n_views: 0, signals: [{ kind: 'scan_open', at: '2026-09-16T10:00:00Z', detail: null }] }))).toMatch(/^opened the scan again · /))
  it('counts scan-open days', () => expect(cameBackLine(card({ n_views: 0, signals: [{ kind: 'scan_open', at: '2026-09-16T10:00:00Z', detail: null }, { kind: 'scan_open', at: '2026-09-15T10:00:00Z', detail: null }] }))).toMatch(/^opened the scan again on 2 days/))
  it('counts view days, not raw captures', () => expect(cameBackLine(card({ n_views: 3 }))).toMatch(/^viewed the profile on 3 days/))
  it('joins a view and a reaction', () =>
    expect(cameBackLine(card({ n_views: 1, n_engagements: 2, signals: [{ kind: 'reaction', at: '', detail: null }] })))
      .toMatch(/^viewed the profile and reacted to 2 posts/))
  it('says commented when a comment is among the signals', () =>
    expect(cameBackLine(card({ n_views: 0, n_engagements: 1, signals: [{ kind: 'comment', at: '', detail: 'nice' }] })))
      .toMatch(/^commented on a post/))
  it('names the post they reacted to', () =>
    expect(cameBackLine(card({ n_views: 0, n_engagements: 1, signals: [{ kind: 'reaction', at: '', detail: null, post_title: 'I built a system that creates 30 post ideas' }] })))
      .toMatch(/^reacted to “I built a system that creates 30 post ideas” · /))
  it('names each post once when there are several', () =>
    expect(cameBackLine(card({ n_views: 0, n_engagements: 2, signals: [
      { kind: 'reaction', at: '', detail: null, post_title: 'A DTC brand put Instagram Stories on its homepage and conversion rate went up 15' },
      { kind: 'reaction', at: '', detail: null, post_title: "I didn't want to do this..." },
    ] }))).toMatch(/^reacted to 2 posts: “A DTC brand put Instagram Stories on its homepage and…” and “I didn't want to do this...” · /))
})

describe('sentLine / firstComment', () => {
  it('states the step and that nothing came back', () => expect(sentLine(card({ dm_count: 2 }))).toMatch(/^Message 2 went out .*No reply since\.$/))
  it('falls back when the step is unknown', () => expect(sentLine(card({ dm_count: 0 }))).toMatch(/^Last message went out/))
  it('returns the comment text when there is one', () => {
    expect(firstComment(card({ signals: [{ kind: 'view', at: '', detail: null }, { kind: 'comment', at: '', detail: 'love this' }] }))).toBe('love this')
    expect(firstComment(card({ signals: [{ kind: 'reaction', at: '', detail: null }] }))).toBeNull()
  })
})

describe('cameBackRowLine', () => {
  const sig = (at: string, title: string, kind = 'reaction') => ({ kind, at, detail: null, post_title: title, post_url: 'https://www.linkedin.com/posts/x' })
  it('leads with the newest post title and counts the earlier ones', () => {
    const c = card({ n_views: 0, n_engagements: 3, last_signal_at: '2026-10-07T13:31:09Z', signals: [sig('2026-10-07T13:31:09Z', 'Newest post'), sig('2026-10-01T13:31:09Z', 'Middle'), sig('2026-09-27T13:31:09Z', 'Oldest')] })
    expect(cameBackRowLine(c)).toBe('reacted to “Newest post” +2 earlier · Oct 7')
  })
  it('says commented when any engagement is a comment, and never counts a view as one', () => {
    const c = card({ n_views: 1, n_engagements: 1, signals: [sig('2026-09-16T18:00:00Z', 'Hello', 'comment'), { kind: 'view', at: '2026-09-16T19:00:00Z', detail: null, profile_return: false }] })
    expect(cameBackRowLine(c)).toContain('commented on “Hello”')
  })
  it('falls back to the plain line with no engagement', () => {
    const c = card({ n_views: 1, n_engagements: 0, signals: [] })
    expect(cameBackRowLine(c)).toBe(cameBackLine(c))
  })
})
