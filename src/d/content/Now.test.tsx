// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { SubNav, contentRedirect, subOf } from './SubNav'
import { buildNow } from './weekModel'
import type { ContentDraft } from '../../lib/content'
const NOW = Date.parse('2026-09-30T10:00:00Z')
const row = (id: string, extra: Partial<ContentDraft> = {}) => ({ id, client_id: null, status: 'review', type: 'text', title: id, post_body: 'Body', created_at: '2026-09-30T09:00:00Z', updated_at: '2026-09-30T09:00:00Z', scheduled_at: null, published_at: null, board_visible: false, ...extra } as ContentDraft)
afterEach(cleanup)
describe('Now actionable content', () => {
  it('keeps errors and stalled generation first, then drafts by date, without published, armed or client-on-board cards', () => {
    const w = buildNow([
      row('undated'), row('later', { scheduled_at: '2026-10-05T09:00:00Z' }), row('first', { scheduled_at: '2026-10-01T09:00:00Z' }),
      row('error', { status: 'error' }), row('stalled', { status: 'generating', updated_at: '2026-09-30T08:00:00Z' }),
      row('armed', { status: 'scheduled', scheduled_at: '2026-10-01T09:00:00Z' }), row('published', { status: 'published', published_at: '2026-09-30T09:00:00Z' }),
      row('board', { client_id: 'risedtc', board_visible: true }), row('arch', { client_id: 'arch' }),
    ], { now: NOW })
    expect(w.ids).toEqual(['error', 'stalled', 'first', 'later', 'undated', 'arch'])
    const arch = w.groups.flatMap(g => g.cards).find(c => c.r.id === 'arch')!
    // 2026-10-08: Arch edits like Rise (its publisher waits for Davorin's panel approval).
    expect(arch.primary).toBe('board'); expect(arch.canDate).toBe(true)
  })
  it('shows ancient failures and undated approved drafts that still need a date', () => {
    const w = buildNow([row('old', { status: 'scheduled', scheduled_at: '2026-07-01T09:00:00Z' }), row('date', { status: 'approved' })], { now: NOW })
    expect(w.ids).toEqual(['old', 'date'])
  })
  it('held approval leaves Now until the undo or persisted read, without exposing an immediate schedule key', () => {
    const w = buildNow([row('held', { scheduled_at: '2026-10-01T09:00:00Z' })], { now: NOW, pending: new Map([['held', 'approve']]) })
    expect(w.ids).toEqual([])
  })
})
describe('Content navigation', () => {
  it.each(['desktop', 'phone'] as const)('shows the generation flow and visible planning tools on %s', layout => {
    renderInFrame(<SubNav on="now" attention lane="arch" />, { layout })
    const nav = screen.getByRole('navigation', { name: 'Content places' })
    expect([...nav.querySelectorAll('a')].map(a => a.textContent)).toEqual(['Content Brain', 'Calendar', 'Ideas', 'Review', 'Lead magnets'])
    expect(screen.getAllByLabelText('Needs a tap').length).toBeGreaterThan(0)
    // Run 51: the planning row keeps only More; Strategy, the saved week and Outliers live there now.
    const tools = screen.getByRole('navigation', { name: 'Content planning' })
    expect([...tools.querySelectorAll('a')]).toHaveLength(0)
    expect(nav.querySelector('a')?.getAttribute('href')).toBe('#exp/d/content/brain?lane=arch')
    fireEvent.click(screen.getByRole('button', { name: 'More in Content' }))
    expect(screen.getByRole('link', { name: /Styles/ })).toBeTruthy()
  })
  it.each([
    ['markets', '#exp/d/content/inputs?lane=arch&draft=x'], ['queue', '#exp/d/content/calendar?lane=arch&draft=x'],
    ['planner', '#exp/d/content/calendar?lane=arch&draft=x'], ['errors', '#exp/d/content/now?lane=arch&draft=x&view=posts'],
    ['review', '#exp/d/content/now?lane=arch&draft=x'],
  ])('redirects %s while keeping deep-link identities', (old, want) => {
    expect(contentRedirect(old, new URLSearchParams('lane=arch&draft=x'))).toBe(want)
  })
  it('maps old tabs to primary selection and leaves canonical URLs alone', () => {
    expect(subOf('inputs')).toBe('inputs'); expect(subOf('errors')).toBe('now'); expect(subOf(null)).toBe('calendar'); expect(subOf('planner')).toBe('calendar')
    expect(contentRedirect('inputs', new URLSearchParams('lane=arch'))).toBeNull()
    expect(contentRedirect('magnets', new URLSearchParams('magnet=x'))).toBeNull()
    expect(contentRedirect(null, new URLSearchParams('lane=arch'))).toBe('#exp/d/content/calendar?lane=arch')
    expect(contentRedirect('now', new URLSearchParams('view=planner&draft=x&from=plan'))).toBe('#exp/d/content/calendar?draft=x')
    expect(contentRedirect('calendar', new URLSearchParams('lane=arch'))).toBeNull()
    expect(contentRedirect(null, new URLSearchParams('draft=x'))).toBe('#exp/d/content/now?draft=x')
    expect(contentRedirect(null, new URLSearchParams('magnet=x'))).toBe('#exp/d/content/magnets?magnet=x')
    expect(contentRedirect('now', new URLSearchParams('draft=x'))).toBeNull()
  })
})
