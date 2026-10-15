// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { ContentDraft } from '../../../lib/content'
import { BRAIN_INVALIDATED } from '../../../hooks/useBrainMembers'
import { buildNow, reviewCounts } from '../weekModel'
import { HOLD_MS, steadyMerge, useSteadyRows } from './steadyRows'

// The count bug (2026-10-15): every refresh strips the Content Brain member drafts first and puts them back
// only when the re-read answers, so the seat tabs and the heading jumped on each focus or write. These
// replay that sequence: the counts must not move while a member draft is being re-read.
vi.mock('../../../lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } } }))

const NOW = Date.parse('2026-10-15T10:00:00Z')
const row = (id: string, o: Partial<ContentDraft> = {}): ContentDraft => ({
  id, client_id: null, status: 'review', type: 'text', title: id, topic: null, post_body: 'Body.', scheduled_at: null,
  published_at: null, source_post_id: null, image_urls: null, taxonomy: null, created_at: new Date(NOW - 3_600_000).toISOString(),
  updated_at: new Date(NOW - 3_600_000).toISOString(), board_visible: null, ...o,
} as ContentDraft)
const member = (id: string, o: Partial<ContentDraft> = {}) => row(id, { cb34_p2_member: true, ...o })

afterEach(cleanup)

describe('steadyMerge', () => {
  it('holds a member draft a refresh dropped, never an ordinary one', () => {
    const first = steadyMerge(new Map(), [row('n1'), member('m1')], NOW, new Set())
    const second = steadyMerge(first.next, [row('n2')], NOW + 1000, new Set())
    expect(second.rows.map(r => r.id).sort()).toEqual(['m1', 'n2'])
    expect([...second.held]).toEqual(['m1'])
  })
  it('lets go once the hold runs out, or at once on a revocation', () => {
    const first = steadyMerge(new Map(), [member('m1')], NOW, new Set())
    expect(steadyMerge(first.next, [], NOW + HOLD_MS, new Set()).rows).toEqual([])
    expect(steadyMerge(first.next, [], NOW + 10, new Set(['m1'])).rows).toEqual([])
  })
  it('a member back from the re-read is the fresh copy, not the held one', () => {
    const first = steadyMerge(new Map(), [member('m1', { title: 'old' })], NOW, new Set())
    const gap = steadyMerge(first.next, [], NOW + 500, new Set())
    const back = steadyMerge(gap.next, [member('m1', { title: 'new' })], NOW + 900, new Set())
    expect(back.rows.map(r => r.title)).toEqual(['new'])
    expect(back.held.size).toBe(0)
  })
})

function Counts({ rows }: { rows: ContentDraft[] }) {
  const steady = useSteadyRows(rows)
  const c = reviewCounts(buildNow(steady.rows, { now: NOW }))
  return <p data-testid="n">{`${c.ivan}/${c.arch}`}</p>
}

describe('useSteadyRows: the counts through a refresh', () => {
  it('the seat counts stay put while member drafts are stripped and re-read', () => {
    const full = [row('i1'), member('i2'), member('i3'), row('a1', { client_id: 'arch' }), member('a2', { client_id: 'arch' })]
    const stripped = full.filter(r => r.cb34_p2_member !== true)
    const { getByTestId, rerender } = render(<Counts rows={full} />)
    expect(getByTestId('n').textContent).toBe('3/2')
    // the refresh starts: members stripped (this is what used to read 1/1)
    rerender(<Counts rows={stripped} />)
    expect(getByTestId('n').textContent).toBe('3/2')
    // the re-read lands
    rerender(<Counts rows={[...full]} />)
    expect(getByTestId('n').textContent).toBe('3/2')
  })
  it('an explicit visibility event for a held draft takes it out at once', () => {
    const full = [row('i1'), member('i2')]
    const { getByTestId, rerender } = render(<Counts rows={full} />)
    rerender(<Counts rows={[row('i1')]} />)
    expect(getByTestId('n').textContent).toBe('2/0')
    act(() => { window.dispatchEvent(new CustomEvent(BRAIN_INVALIDATED, { detail: { client: 'ivan', draftId: 'i2' } })) })
    expect(getByTestId('n').textContent).toBe('1/0')
  })
})
