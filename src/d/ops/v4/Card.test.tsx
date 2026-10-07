// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { OpsDraft } from '../../../lib/ops'
import { CardV4 } from './Card'
import { Batch } from '../Batch'
vi.mock('../../../lib/ops', async orig => ({ ...await orig<typeof import('../../../lib/ops')>(), approveOpsDraft: vi.fn(async () => {}), dispatchCommentGate: vi.fn(async () => ({ outcome: 'accepted', message: 'approved', retryable: false })), approveWeeklyReport: vi.fn(async () => {}), postCommentReply: vi.fn(async () => ({ posted: true })) }))
const row = (kind: OpsDraft['kind'], context: Record<string, unknown> = {}): OpsDraft => ({ id: 'a', kind, client_id: 'ivan', body: 'My words', context: { posted_at: new Date().toISOString(), ...context }, created_at: new Date().toISOString(), slack_channel: '', approved_at: null, sent_at: null, send_blocked_reason: null })
const render = (d: OpsDraft, held?: Parameters<typeof CardV4>[0]['held']) => renderInFrame(<div className="op4"><CardV4 d={d} refresh={() => {}} layout="desktop" pos="card 1 of 1" held={held} /></div>)
afterEach(cleanup)
describe('Ops v4 details', () => {
  it('outbound preview includes the tag; toggling changes the preview and confirmation', () => {
    render(row('comment_outbound', { target_name: 'Ada Smith', approve_url: 'https://gate.example/approve' }))
    expect(document.querySelector('[data-preview]')?.textContent).toContain('@Ada Smith')
    expect(document.querySelector('.op4-editornote')?.textContent).toContain('Approve queues it here')
    expect(document.querySelector('.op-kp small')?.textContent).toBe('The poster takes 3 a day, one at a time.')
    fireEvent.click(document.querySelector('.op-tagline')!)
    expect(document.querySelector('[data-preview]')?.textContent).toContain('Posts untagged:')
  })
  it('copy path shows the copy sentence and no tag control', () => {
    render(row('comment_outbound'))
    expect(document.querySelector('[data-preview]')?.textContent).toBe('Copied for you to paste from Mattan’s seat.')
    expect(document.querySelector('.op-tagline')).toBeNull()
  })
  it('reply preview names the seat and author, and request-only safety note has attention tone', () => {
    render({ ...row('comment_reply', { comment_id: 'c', author_name: 'Randall Nguyen', drafted_on_demand: true }), client_id: 'risedtc' })
    expect(document.querySelector('[data-preview]')?.textContent).toContain('Replies as Mattan Danino: @Randall Nguyen')
    expect(document.querySelector('.op4-editornote')?.getAttribute('data-tone')).toBe('attention')
    expect(document.querySelector('.op4-editornote')?.textContent).toContain('Read every word')
  })
  it('held cards retain their note and lose action keys', () => {
    render(row('comment_outbound'), { outcome: 'accepted', held: true, message: 'lane off', retryable: false })
    expect(document.body.textContent).toContain('lane off')
    expect(document.querySelector('.op-keys')).toBeNull()
  })
  it('the open card is the only primary even with a quick batch', () => {
    const a = row('comment_outbound', { approve_url: 'https://gate.example/approve' }), b = { ...a, id: 'b' }
    renderInFrame(<div className="op4"><Batch lane="ivan" cards={[a, b]} refresh={() => {}} look="v4" /><CardV4 d={a} refresh={() => {}} layout="desktop" pos="card 1 of 2" /></div>)
    expect(document.querySelectorAll('.d-key-p,.d-btn-p')).toHaveLength(1)
    fireEvent.click(document.querySelector('[data-verb=batch-open]')!)
    expect(document.querySelectorAll('.d-key-p,.d-btn-p')).toHaveLength(1)
  })
  it('Cmd+Enter asks with the same confirmation; Escape blurs', async () => {
    render(row('escalation'))
    const editor = document.querySelector('textarea')!
    editor.focus(); fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(document.querySelector('.d-confirm')).toBeTruthy())
    fireEvent.click(document.querySelector('[data-verb=cancel]')!)
    editor.focus(); fireEvent.keyDown(editor, { key: 'Escape' })
    expect(document.activeElement).not.toBe(editor)
  })
})
