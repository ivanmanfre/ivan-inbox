// @vitest-environment jsdom
// Parity pass 09-27: the quick batch never touches a gate-held (approved) comment, cannot double-fire,
// works per item with its own gate note; destructive confirms are danger; Arch comments without a
// comment_id keep Needs Davor / Mark handled / the why; a reply confirm names the person.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

vi.mock('../../wb/ops/batchActs', async orig => {
  const real = await orig<typeof import('../../wb/ops/batchActs')>()
  return { ...real, dispatchApprove: vi.fn(async () => ({ ok: true })), dispatchDiscard: vi.fn(async () => {}) }
})
vi.mock('../../lib/ops', async orig => {
  const real = await orig<typeof import('../../lib/ops')>()
  return { ...real, markNeedsDavor: vi.fn(async () => {}), markCommentHandled: vi.fn(async () => {}), discardOpsDraft: vi.fn(async () => {}) }
})

import * as acts from '../../wb/ops/batchActs'
import * as lib from '../../lib/ops'
import type { OpsDraft } from '../../lib/ops'
import { Batch } from './Batch'
import { OpsCard } from './Card'

let n = 0
const row = (kind: OpsDraft['kind'], client_id: string, extra: Partial<OpsDraft> = {}, context: Record<string, unknown> = {}): OpsDraft => ({
  id: `p${++n}`, client_id, kind, slack_channel: '', body: `body ${n}`, context: { posted_at: new Date().toISOString(), ...context },
  created_at: new Date().toISOString(), approved_at: null, sent_at: null, send_blocked_reason: null, ...extra,
})
const gate = { approve_url: 'https://gate.example/approve', skip_url: 'https://gate.example/skip' }
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement
const refresh = vi.fn()

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('Quick batch', () => {
  it('leaves a gate-held (already approved) comment out of Discard all, and the danger confirm counts only the pending ones', async () => {
    const held = row('comment_outbound', 'ivan', { approved_at: new Date().toISOString(), sent_at: new Date().toISOString() }, gate)
    const a = row('comment_outbound', 'ivan', {}, gate)
    const b = row('comment_outbound', 'ivan', {}, gate)
    renderInFrame(<Batch lane="ivan" cards={[held, a, b]} refresh={refresh} />, { hash: '#exp/d/ops' })
    expect(document.body.textContent).toContain('2 comments')
    fireEvent.click(key('batch-discard'))
    await waitFor(() => expect(document.querySelector('.d-confirm-danger')).toBeTruthy())
    expect(document.querySelector('.d-confirm h3')!.textContent).toBe('Discard these 2?')
    // Enter never confirms a danger box (on the focused cancel key it cancels).
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(document.querySelector('.d-confirm')).toBeNull())
    expect(acts.dispatchDiscard).not.toHaveBeenCalled()
    fireEvent.click(key('batch-discard'))
    fireEvent.click(await waitFor(() => key('confirm')))
    await waitFor(() => expect(acts.dispatchDiscard).toHaveBeenCalledTimes(2))
    expect((acts.dispatchDiscard as ReturnType<typeof vi.fn>).mock.calls.map(c => (c[0] as OpsDraft).id)).toEqual([a.id, b.id])
    await waitFor(() => expect(document.body.textContent).toContain('2 discarded.'))
  })

  it('hides handled ids at once, so a second Approve all cannot re-fire them', async () => {
    const a = row('manual_invite', 'risedtc'); const b = row('manual_invite', 'risedtc')
    renderInFrame(<Batch lane="risedtc" cards={[a, b]} refresh={refresh} />, { hash: '#exp/d/ops' })
    fireEvent.click(key('batch-approve'))
    fireEvent.click(await waitFor(() => key('confirm')))
    await waitFor(() => expect(acts.dispatchApprove).toHaveBeenCalledTimes(2))
    // The parent's read has not landed yet (same cards passed); the batch is gone anyway.
    await waitFor(() => expect(key('batch-approve')).toBeNull())
    expect(acts.dispatchApprove).toHaveBeenCalledTimes(2)
  })

  it('opens to each body with its own Approve / Discard and prints a timing refusal as a queue position', async () => {
    const a = row('comment_outbound', 'ivan', {}, gate); const b = row('comment_outbound', 'ivan', {}, gate)
    ;(acts.dispatchApprove as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, message: 'next slot 14:20', outcome: 'timing' })
    renderInFrame(<Batch lane="ivan" cards={[a, b]} refresh={refresh} />, { hash: '#exp/d/ops' })
    fireEvent.click(key('batch-open'))
    const approves = document.querySelectorAll('[data-verb="batch-item-approve"]')
    expect(approves).toHaveLength(2)
    fireEvent.click(approves[0])
    fireEvent.click(await waitFor(() => key('confirm')))
    await waitFor(() => expect(document.body.textContent).toContain('Waiting for the send window: next slot 14:20'))
    expect(document.querySelector('.op-qbi .op-err')).toBeNull()
    fireEvent.click(document.querySelectorAll('[data-verb="batch-item-discard"]')[1])
    await waitFor(() => expect(document.querySelector('.d-confirm-danger')).toBeTruthy())
    fireEvent.click(key('confirm'))
    await waitFor(() => expect(acts.dispatchDiscard).toHaveBeenCalledWith(expect.objectContaining({ id: b.id })))
  })
})

describe('Ops card parity', () => {
  const card = (d: OpsDraft) => renderInFrame(<OpsCard d={d} refresh={refresh} layout="desktop" pos="card 1 of 1" />, { hash: '#exp/d/ops' })

  it('an Arch comment with no comment_id keeps Needs Davor, Mark handled and the why', async () => {
    card(row('comment_reply', 'arch', { body: '' }, { author_name: 'Kamran Arshad', arch_outcome: 'NEEDS_DAVOR', arch_reason: 'Pricing question, his call.' }))
    expect(document.body.textContent).toContain('Why, and what it read')
    fireEvent.click(key('more'))
    expect(key('emoji')).toBeNull()
    expect(key('like')).toBeNull()
    fireEvent.click(key('needs-davor'))
    await waitFor(() => expect(lib.markNeedsDavor).toHaveBeenCalled())
    fireEvent.click(key('mark-handled'))
    fireEvent.click(await waitFor(() => key('confirm')))
    await waitFor(() => expect(lib.markCommentHandled).toHaveBeenCalled())
  })

  it('Discard on a card is a danger confirm', async () => {
    card(row('booking', 'arch'))
    fireEvent.click(key('discard'))
    await waitFor(() => expect(document.querySelector('.d-confirm-danger')).toBeTruthy())
    expect(document.activeElement?.getAttribute('data-verb')).toBe('cancel')
  })

  it('the reply confirm names the person, not the lane; the eyebrow says whose post', async () => {
    card(row('comment_reply', 'risedtc', { body: 'Thanks' }, { comment_id: 'c9', author_name: 'Randall Nguyen' }))
    expect(document.querySelector('.op-eb')!.textContent).toBe('Reply under Mattan’s post')
    fireEvent.click(key('approve'))
    await waitFor(() => expect(document.querySelector('.d-confirm h3')!.textContent).toBe('Post this reply as Mattan Danino?'))
  })

  it('shows the tag-may-fail warning on the card itself', () => {
    card(row('comment_reply', 'risedtc', { body: 'Thanks' }, { comment_id: 'c9', author_name: 'Randall N.' }))
    expect(document.querySelector('[data-tag-warn]')?.textContent).toContain('may not stick')
  })
})
