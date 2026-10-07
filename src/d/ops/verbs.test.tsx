// @vitest-environment jsdom
// Verb wiring on the D Ops card and list: each key asks, then calls TODAY'S lib write with today's
// arguments. The lib writes are mocked; the rules under them are not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/ops', async orig => {
  const real = await orig<typeof import('../../lib/ops')>()
  return {
    ...real,
    approveOpsDraft: vi.fn(async () => {}), approveWeeklyReport: vi.fn(async () => {}), discardOpsDraft: vi.fn(async () => {}),
    discardPendingTasks: vi.fn(async () => 2), completeTask: vi.fn(async () => {}), markNeedsDavor: vi.fn(async () => {}), markCommentHandled: vi.fn(async () => {}),
    likeComment: vi.fn(async () => {}), postCommentReply: vi.fn(async () => ({ posted: true })),
    generateCommentDraft: vi.fn(async () => ({ drafted: true, draft: 'Drafted.' })),
  }
})

import * as lib from '../../lib/ops'
import type { OpsDraft } from '../../lib/ops'
import { OpsCard } from './Card'
import { CardV4 } from './v4/Card'
import { Tasks } from './Tasks'

const row = (kind: OpsDraft['kind'], client_id: string, body = 'Body', context: Record<string, unknown> = {}): OpsDraft => ({
  id: `id-${kind}-${client_id}`, client_id, kind, slack_channel: '', body, context: { posted_at: new Date().toISOString(), ...context },
  created_at: new Date().toISOString(), approved_at: null, sent_at: null, send_blocked_reason: null,
})
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement
const yes = async () => { await waitFor(() => expect(key('confirm')).toBeTruthy()); fireEvent.click(key('confirm')) }
const refresh = vi.fn()

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe.each([OpsCard, CardV4])('Ops card verbs (%s)', Card => {
  const card = (d: OpsDraft) => renderInFrame(<Card d={d} refresh={refresh} layout="desktop" pos="card 1 of 1" />, { hash: '#exp/d/ops' })
  it('escalation: Approve & send asks, then stamps approved_at through approveOpsDraft', async () => {
    card(row('escalation', 'rise', 'Tell Mattan'))
    fireEvent.click(key('approve')); await yes()
    await waitFor(() => expect(lib.approveOpsDraft).toHaveBeenCalledWith('id-escalation-rise', 'Tell Mattan', 'escalation'))
  })
  it('Discard asks, then discards with the kind', async () => {
    card(row('booking', 'arch'))
    fireEvent.click(key('discard')); await yes()
    await waitFor(() => expect(lib.discardOpsDraft).toHaveBeenCalledWith('id-booking-arch', 'booking'))
  })
  it('never shows more than four keys, and an Arch reply puts its extra verbs behind More', async () => {
    card(row('comment_reply', 'arch', '', { comment_id: 'c1', author_name: 'Kamran Arshad' }))
    expect(document.querySelectorAll('.op-keys .d-key')).toHaveLength(4)
    expect(key('needs-davor')).toBeNull()
    fireEvent.click(key('more'))
    fireEvent.click(key('needs-davor'))
    await waitFor(() => expect(lib.markNeedsDavor).toHaveBeenCalled())
    await waitFor(() => expect((key('mark-handled') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(key('mark-handled')); await yes()
    await waitFor(() => expect(lib.markCommentHandled).toHaveBeenCalledWith('id-comment_reply-arch'))
  })
  it('Draft it fills the box; Approve & post sends the typed reply with the tag', async () => {
    card(row('comment_reply', 'arch', '', { comment_id: 'c1', author_name: 'Kamran Arshad' }))
    fireEvent.click(key('draft'))
    await waitFor(() => expect(lib.generateCommentDraft).toHaveBeenCalledWith('id-comment_reply-arch', 'arch'))
    await waitFor(() => expect((document.querySelector('.op-card textarea') as HTMLTextAreaElement).value).toBe('Drafted.'))
    fireEvent.click(key('approve')); await yes()
    await waitFor(() => expect(lib.postCommentReply).toHaveBeenCalledWith('id-comment_reply-arch', 'Drafted.', true, true))
  })
  it('Rise reply: Like is one tap, the tag can be switched off before posting', async () => {
    card(row('comment_reply', 'risedtc', 'Thanks', { comment_id: 'c2', author_name: 'Randall Nguyen' }))
    fireEvent.click(key('more'))
    fireEvent.click(key('like'))
    await waitFor(() => expect(lib.likeComment).toHaveBeenCalledWith('id-comment_reply-risedtc'))
    fireEvent.click(key('tag'))
    fireEvent.click(key('approve')); await yes()
    await waitFor(() => expect(lib.postCommentReply).toHaveBeenCalledWith('id-comment_reply-risedtc', 'Thanks', false, false))
  })
})

describe('Your list', () => {
  const tasks = [row('task', 'ivan', 'First task'), { ...row('task', 'arch', 'Second task'), id: 't2' }]
  it('Done stamps the task without asking; remove and Clear all ask first', async () => {
    renderInFrame(<Tasks drafts={tasks} refresh={refresh} />, { hash: '#exp/d/ops' })
    fireEvent.click(document.querySelectorAll('[data-verb="tick"]')[0])
    await waitFor(() => expect(lib.completeTask).toHaveBeenCalledWith(tasks[0]))
    fireEvent.click(document.querySelectorAll('[data-verb="remove"]')[1]); await yes()
    await waitFor(() => expect(lib.discardOpsDraft).toHaveBeenCalledWith('t2', 'task'))
    fireEvent.click(key('clear-all')); await yes()
    await waitFor(() => expect(lib.discardPendingTasks).toHaveBeenCalledWith(expect.arrayContaining(['t2'])))
  })
})
