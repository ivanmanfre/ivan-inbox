// @vitest-environment jsdom
// Parity verb wiring: warm signals (Approve DM1 = stage repair THEN approveDraft; profile viewers
// get a blank invite; Skip is a danger confirm), the stale bar, and the discarded-draft strip.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/inbox', async orig => ({
  ...(await orig<typeof import('../../lib/inbox')>()),
  approveDraft: vi.fn(async () => {}), saveDraftText: vi.fn(async () => {}), discardLegs: vi.fn(async () => []), restoreDraft: vi.fn(async () => true),
}))
vi.mock('../../wb/dms/warmSignalsData', async orig => ({ ...(await orig<typeof import('../../wb/dms/warmSignalsData')>()), decideWarm: vi.fn(async () => ({ ok: true })) }))

import * as lib from '../../lib/inbox'
import * as warm from '../../wb/dms/warmSignalsData'
import type { WarmCard } from '../../wb/dms/warmSignalsData'
import { DmAsks } from './asks'
import { drafted, msg, NOW, threads } from './fixtures'
import { RestoreStrip } from './Restore'
import { useDmVerbs, type DmVerbs } from './verbs'
import { useWarmVerbs, type WarmVerbs } from './warmVerbs'

const card = (o: Partial<WarmCard> = {}): WarmCard => ({
  prospect_id: 'w1', name: 'Wendy Warm', headline: null, company: null, title: null, country: null, city: null, icp_score: 7, stage: 'connected',
  trigger_type: 'own_post_comment', campaign_id: 'c', linkedin_url: null, connection_sent_at: '2026-09-20T09:00:00Z', connected_at: '2026-09-22T09:00:00Z',
  note_variant: null, skip_reason: null, created_at: '2026-09-19T09:00:00Z', signal_source: 'own_post_comment', signal_evidence: null,
  signal_note_draft: 'drafted note', signal_note_final: null, signal_approved_at: null, signal_invite_state: 'sent:x', signal_lint: null, view_window_ends: null,
  draft_id: 'd1', draft_text: 'the DM1', draft_model: null, draft_created_at: null, draft_approved_at: null, draft_sent_at: null, dm_sent_count: 0, ...o,
})

let wv: WarmVerbs; let dv: DmVerbs
const after = vi.fn()
const ctx = { refresh: vi.fn(), patch: vi.fn() }
function Grab() { wv = useWarmVerbs(after); dv = useDmVerbs(ctx); return null }
const mount = () => renderInFrame(<DmAsks><Grab /></DmAsks>, { hash: '#exp/d/dms' })
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

describe('warm signal verbs', () => {
  it('Approve DM1 confirms, repairs the stage, THEN approves the draft (no chat id)', async () => {
    mount()
    let r: Promise<string | null>
    act(() => { r = wv.approveDm1(card(), 'edited DM1', false) })
    fireEvent.click(await waitFor(() => key('confirm-dm1')))
    expect(await r!).toBeNull()
    expect(warm.decideWarm).toHaveBeenCalledWith('w1', 'approve_dm1_stage')
    expect(lib.approveDraft).toHaveBeenCalledWith('d1', 'edited DM1', null)
    expect(vi.mocked(warm.decideWarm).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(lib.approveDraft).mock.invocationCallOrder[0])
    expect(after).toHaveBeenCalled()
  })
  it('Approve DM1 is refused before they accept, and on an agent-managed thread', async () => {
    mount()
    expect(await wv.approveDm1(card({ stage: 'connection_sent', connected_at: null }), 'x', false)).toMatch(/accepts the invite/)
    expect(await wv.approveDm1(card(), 'x', true)).toMatch(/conversation agent/)
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })
  it('a profile viewer gets a blank invite even with a drafted note', async () => {
    mount()
    let r: Promise<string | null>
    act(() => { r = wv.approveInvite(card({ signal_source: 'profile_view', trigger_type: 'profile_view', signal_invite_state: 'pending' }), 'drafted note') })
    expect(await screen.findByText(/A blank connection request, by rule/)).toBeTruthy()
    fireEvent.click(key('confirm-invite'))
    await r!
    expect(warm.decideWarm).toHaveBeenCalledWith('w1', 'approve_invite', '')
  })
  it('an engager invite carries the exact note; an empty or 201-char note is refused', async () => {
    mount()
    const c = card({ signal_invite_state: 'pending' })
    expect(await wv.approveInvite(c, '  ')).toBe('Write the note first, or skip this one.')
    expect(await wv.approveInvite(c, 'x'.repeat(201))).toMatch(/200 characters/)
    let r: Promise<string | null>
    act(() => { r = wv.approveInvite(c, 'my note') })
    fireEvent.click(await waitFor(() => key('confirm-invite')))
    await r!
    expect(warm.decideWarm).toHaveBeenCalledWith('w1', 'approve_invite', 'my note')
  })
  it('Skip is a danger confirm', async () => {
    mount()
    let r: Promise<string | null>
    act(() => { r = wv.skip(card()) })
    const red = await waitFor(() => key('confirm-skip'))
    expect(red.className).toContain('d-key-d')
    fireEvent.click(red)
    await r!
    expect(warm.decideWarm).toHaveBeenCalledWith('w1', 'skip')
  })
})

describe('list verbs', () => {
  it('Discard stale: danger confirm with today\'s words, every leg', async () => {
    mount()
    const ts = threads(drafted('s1', { prospect_name: 'Stale One' }))
    let r: Promise<void>
    act(() => { r = dv.discardStale(ts) })
    expect(await screen.findByText('Discard 1 stale draft?')).toBeTruthy()
    expect(screen.getByText('These threads already have your own reply after the last inbound message. Nothing is sent.')).toBeTruthy()
    fireEvent.click(key('confirm-bulk'))
    await r!
    expect(lib.discardLegs).toHaveBeenCalledWith([ts[0].draft])
  })
})

describe('RestoreStrip', () => {
  it('lists every discarded draft (no 3-day cut), reads it whole, brings it back', async () => {
    const old = msg({ prospect_id: 'r', prospect_name: 'Rita', direction: 'outbound', message_text: 'An old thrown-away draft', created_at: new Date(NOW - 40 * 86_400_000).toISOString(), send_blocked_reason: 'discarded_in_inbox', send_blocked_at: new Date(NOW - 40 * 86_400_000).toISOString() })
    const inbound = msg({ prospect_id: 'r', prospect_name: 'Rita', direction: 'inbound', message_text: 'hi', created_at: new Date(NOW - 41 * 86_400_000).toISOString() })
    const [t] = threads([inbound, old])
    function Strip() { const v = useDmVerbs(ctx); return <RestoreStrip t={t} verbs={v} /> }
    renderInFrame(<DmAsks><Strip /></DmAsks>, { hash: '#exp/d/dms' })
    expect(document.querySelectorAll('.dm-rest').length).toBe(1)
    fireEvent.click(key('read-discarded'))
    expect(screen.getByText('An old thrown-away draft')).toBeTruthy()
    fireEvent.click(key('bring-back'))
    await waitFor(() => expect(lib.restoreDraft).toHaveBeenCalledWith(old.id))
  })
})

import { History } from './History'
describe('History', () => {
  it('links are live, a sent email says To <email>, a pending invite note says Not accepted yet, bubbles split', () => {
    const rows = [
      msg({ prospect_id: 'h', prospect_name: 'Hana', prospect_stage: 'connection_sent', message_type: 'connection_note', channel: 'linkedin', message_text: 'Hi Hana', sent_at: new Date(NOW - 9e7).toISOString(), created_at: new Date(NOW - 9e7).toISOString() }),
      msg({ prospect_id: 'h', prospect_name: 'Hana', prospect_stage: 'connection_sent', channel: 'email', recipient_email: 'hana@x.com', message_text: 'See inboundonsteroids.com/scan/hana\n---\nSecond bubble', sent_at: new Date(NOW - 8e7).toISOString(), created_at: new Date(NOW - 8e7).toISOString() }),
    ]
    const [t] = threads(rows)
    renderInFrame(<History t={t} />)
    const a = document.querySelector('.dm-hist a') as HTMLAnchorElement
    expect(a.href).toBe('https://inboundonsteroids.com/scan/hana')
    const text = document.querySelector('.dm-hist')!.textContent!
    expect(text).toContain('To hana@x.com')
    expect(text).toContain('Not accepted yet')
    expect(document.querySelectorAll('.dm-bub').length).toBeGreaterThanOrEqual(2)
  })
})
