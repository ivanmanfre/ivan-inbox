// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import { parseDHash } from '../../route'
import { __resetSkinForTests } from '../../../ds/skin'
import OpsPage from '../index'
import type { OpsDraft } from '../../../lib/ops'
vi.mock('../../../hooks/useOps', () => ({ useOps: () => ({ drafts, loading, error, loadedAt: 1791410000000, refresh }) }))
vi.mock('../../../hooks/useCommentQueue', () => ({ useCommentQueue: () => ({ held: new Map(), feed: new Map(), waiting: [], cappedToday: false, positionOf: () => -1, record: vi.fn() }) }))
vi.mock('../../../hooks/useReactions', () => ({ useReactions: () => ({ ...useReactionFixture() }) }))
vi.mock('../../../lib/ops', async orig => ({ ...await orig<typeof import('../../../lib/ops')>(), approveOpsDraft: vi.fn(async () => {}), discardOpsDraft: vi.fn(async () => {}) }))
function useReactionFixture() {
  const [bodies, setBodies] = useState<Record<string, string>>({})
  return { rows: reactions, bodies, loading: false, error: '', nextSlot: new Date().toISOString(), refresh: vi.fn(), setBody: (id: string, body: string) => setBodies(old => ({ ...old, [id]: body })) }
}
let reactions: import('../../../lib/reactions').ReactionRow[] = []
const refresh = vi.fn()
const a: OpsDraft = { id: 'a', kind: 'escalation', client_id: 'ivan', body: 'First', context: { prospect_name: 'Ada' }, slack_channel: '', created_at: new Date().toISOString(), approved_at: null, sent_at: null, send_blocked_reason: null }
const b = { ...a, id: 'b', context: { prospect_name: 'Ben' } }
const rise = { ...a, id: 'rise', client_id: 'risedtc', kind: 'comment_reply' as const, context: { author_name: 'Randall Nguyen', comment_id: 'c' } }
let drafts = [a, b, rise]
let loading = false, error = ''
function Page({ phone = false }: { phone?: boolean }) {
  const [hash, setHash] = useState(phone ? '#exp/d/ops?card=a' : '#exp/d/ops')
  const [, redraw] = useState(0)
  return <><button data-reload onClick={() => redraw(x => x + 1)}>Read</button><OpsPage layout={phone ? 'phone' : 'desktop'} route={parseDHash(hash)} navigate={setHash} /></>
}
beforeEach(() => { drafts = [a, b, rise]; error = ''; loading = false; reactions = []; vi.clearAllMocks(); __resetSkinForTests(new Set(['ops'])) })
afterEach(() => { cleanup(); __resetSkinForTests() })
describe('Ops v4 page', () => {
  it('uses one seat list, keeps proper case and navigates across seats and the unknown lane', () => {
    drafts.push({ ...a, id: 'other', client_id: 'acme' })
    renderInFrame(<Page />)
    expect(document.querySelector('.op4')).toBeTruthy()
    expect(document.querySelectorAll('[data-op-row]')).toHaveLength(2)
    expect(document.body.textContent).toContain('acme')
    fireEvent.keyDown(window, { key: 'j' }); fireEvent.keyDown(window, { key: 'j' })
    expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain('Rise')
    expect(document.querySelector('.op-eb')?.textContent).toBe('Reply under Mattan’s post')
    expect(document.querySelector('[data-op-row=rise]')?.textContent).toContain('Reply under Mattan’s post')
    fireEvent.keyDown(window, { key: 'j' })
    expect(document.querySelector('[data-card]')?.getAttribute('data-card')).toBe('other')
  })
  it('selecting an empty seat clears detail, retains tasks and a quiet empty line', () => {
    renderInFrame(<Page />)
    fireEvent.click([...document.querySelectorAll('[role=tab]')].find(x => x.textContent?.includes('Arch'))!)
    expect(document.body.textContent).toContain('Nothing waiting in Arch’s lane.')
    expect(document.querySelector('[data-card]')).toBeNull()
    expect(document.querySelector('.op-strip')).toBeNull()
  })
  it.each([false, true])('own approve advances and shows receipt without stale banner (phone=%s)', async phone => {
    renderInFrame(<Page phone={phone} />, { layout: phone ? 'phone' : 'desktop' })
    fireEvent.click(document.querySelector('[data-verb=approve]')!)
    fireEvent.click(await waitFor(() => { const k = document.querySelector('.d-confirm [data-verb=confirm]'); if (!k) throw Error('confirm'); return k }))
    await waitFor(() => expect(document.querySelector('.d-confirm')).toBeNull())
    drafts = [b, rise]; fireEvent.click(document.querySelector('[data-reload]')!)
    await waitFor(() => expect(document.querySelector('[data-card]')?.getAttribute('data-card')).toBe('b'))
    await waitFor(() => expect(document.body.textContent).toContain('Approved · Ada'))
    expect(document.body.textContent).not.toContain('not waiting any more')
    expect(document.querySelector('[data-verb=undo]')).toBeNull()
  })
  it('external disappearance keeps the stale-card explanation', () => {
    renderInFrame(<Page />)
    fireEvent.click(document.querySelector('[data-op-row=a]')!)
    drafts = [b]; fireEvent.click(document.querySelector('[data-reload]')!)
    expect(document.body.textContent).toContain('not waiting any more')
  })
  it('failed read has Retry; failed refresh keeps previous rows', () => {
    error = 'read failed'; drafts = []
    renderInFrame(<Page />)
    fireEvent.click(document.querySelector('[data-verb=retry]')!)
    expect(refresh).toHaveBeenCalled()
    cleanup(); drafts = [a]; renderInFrame(<Page />)
    expect(document.querySelector('[data-op-row=a]')).toBeTruthy()
    expect(document.body.textContent).toContain('Could not refresh (showing')
  })
  it('reaction body survives switching away and back; approve is disabled until written', () => {
    reactions = [{ id: 'rx', lane: 'ivan', raw_topic: 'A found take', source_ref: null, composite_score: null, icp_fit_score: null, why_score: null, ingested_at: null, evidence: null, shot_url: null }]
    renderInFrame(<Page />)
    fireEvent.click(document.querySelector('.op4-queue [data-reaction=rx]')!)
    expect(document.querySelector<HTMLButtonElement>('[data-verb=reaction-approve]')!.disabled).toBe(true)
    fireEvent.change(document.querySelector('.op-rx textarea')!, { target: { value: 'My own reaction in enough words to approve.' } })
    expect(document.querySelector<HTMLButtonElement>('[data-verb=reaction-approve]')!.disabled).toBe(false)
    fireEvent.click(document.querySelector('[data-op-row=a]')!)
    fireEvent.click(document.querySelector('.op4-queue [data-reaction=rx]')!)
    expect(document.querySelector<HTMLTextAreaElement>('.op-rx textarea')!.value).toBe('My own reaction in enough words to approve.')
  })
  it('defaults to the old tree with the ops flag off', () => {
    __resetSkinForTests(); renderInFrame(<Page />)
    expect(document.querySelector('.op4')).toBeNull()
    expect(document.querySelector('.op-strip')).toBeTruthy()
  })
})
