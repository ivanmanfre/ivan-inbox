// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderInFrame } from '../test-utils'

afterEach(() => { cleanup() })

const today = { brief: null as unknown, counts: null, health: null as unknown, error: null as string | null, fromCache: false, degraded: false, cachedAt: null, loading: false, refreshing: false }
vi.mock('../../hooks/useToday', () => ({ useToday: () => today }))
const { TodayNotes } = await import('./TodayNotes')
const { queueHash } = await import('../shell/WorkQueue')

const brief = (over: object = {}) => ({
  generated_at: '2026-09-27T08:00:00Z', urgencies: [], needs_you: { comment_drafts: [], dm_drafts: [], feed_drafts: [] },
  today_content: { scheduled_posts: [{ id: 'p1', scheduled_at: new Date().toISOString(), status: 'cancelled', post_format: 'carousel', platform: 'linkedin' }] },
  outreach_health: { linkedin: { fresh_supply: 40, sends_today: 0, accepts_today: 3, replies_today: 2, needs_reply: 1, stuck: 2 }, cold_email: { connected: false, note: null } },
  ...over,
})

describe('Lanes: today\'s sending lines', () => {
  it('says nothing before the brief is read', () => {
    renderInFrame(<TodayNotes />)
    expect(document.querySelector('[data-today-notes]')).toBeNull()
  })

  it('carries the LinkedIn counters, cancelled slots, the cold-email note and the supply alarm', () => {
    today.brief = brief()
    today.health = { accept: [], replies: [], pipeline: [{ client_id: 'risedtc', lane: 'x', sendable: 0, sent_7d: 14 }], governor: [] }
    renderInFrame(<TodayNotes />)
    expect(document.querySelector('[data-linkedin-counters]')!.textContent).toBe('LinkedIn lane, all seats: 40 fresh supply · 0 sent today · 3 accepts · 2 replies · 1 need reply · 2 stuck')
    expect(document.querySelector('[data-cancelled-slots]')!.textContent).toMatch(/^1 slot today cancelled/)
    expect(screen.getByText('Cold email: not connected.')).toBeTruthy()
    expect(document.querySelector('[data-supply-alarm]')!.textContent).toMatch(/is out of leads\.$/)
  })

  it('a failed brief says what is missing', () => {
    today.brief = null; today.health = null; today.error = 'down'
    renderInFrame(<TodayNotes />)
    expect(screen.getByText(/Could not read today's brief/)).toBeTruthy()
  })
})

describe('Waiting on you: where a queue row opens', () => {
  const base = { tier: 1 as const, title: 't', sub: null, waitingSince: '2026-09-20T00:00:00Z', ageDays: 7 }
  it.each([
    [{ ...base, id: 'r', kind: 'reply' as const, lane: 'arch', openId: 'p1' }, '#exp/d/dms?thread=p1'],
    [{ ...base, id: 'o', kind: 'ops' as const, lane: 'ivan', openId: null }, '#exp/d/ops'],
    [{ ...base, id: 'c', kind: 'contentReview' as const, lane: 'risedtc', openId: null }, '#exp/d/content/review?lane=risedtc'],
    [{ ...base, id: 'e', kind: 'contentError' as const, lane: 'ivan', openId: null }, '#exp/d/content/errors'],
    [{ ...base, id: 'i', kind: 'ideas' as const, lane: 'arch', openId: null }, '#exp/d/content/ideas?lane=arch'],
  ])('%#', (item, hash) => { expect(queueHash(item)).toBe(hash) })
})
