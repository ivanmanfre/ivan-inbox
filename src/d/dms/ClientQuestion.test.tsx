// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { drafted, threads } from './fixtures'
import type { DmVerbs } from './verbs'
import type { OpsDraft } from '../../lib/ops'

vi.mock('../../lib/ops', async orig => ({ ...await orig<typeof import('../../lib/ops')>(),
  fetchThreadEscalations: vi.fn(), approveThreadEscalation: vi.fn(async () => {}),
}))
import * as ops from '../../lib/ops'
import { ClientQuestion } from './ClientQuestion'

const row: OpsDraft = { id: 'question', client_id: 'rise', kind: 'escalation', slack_channel: 'C0BJ72F58BY',
  body: 'Can we share the fee?', context: { prospect_id: 'lovisa' }, created_at: '2026-10-25T16:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null }
const t = () => threads(drafted('lovisa', { client_id: 'risedtc', prospect_name: 'Lovisa Walker' }))[0]
const verbs = { askOwner: vi.fn(async () => 'Prepared') } as unknown as DmVerbs
const open = () => fireEvent.click(screen.getByText('Ask Mattan (optional)'))

beforeEach(() => { vi.clearAllMocks(); vi.mocked(ops.fetchThreadEscalations).mockResolvedValue([row]) })
afterEach(cleanup)

it('reads a question only when the optional DM control opens and sends only after confirmation', async () => {
  renderInFrame(<ClientQuestion t={t()} verbs={verbs} />)
  expect(ops.fetchThreadEscalations).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Question for Mattan')).toBeNull()
  open()
  await waitFor(() => expect(screen.getByLabelText('Question for Mattan')).toBeTruthy())
  expect(ops.fetchThreadEscalations).toHaveBeenCalledWith('lovisa', 'risedtc')
  expect(ops.approveThreadEscalation).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Question for Mattan'), { target: { value: 'Could we share a range?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send to Mattan' }))
  expect(ops.approveThreadEscalation).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Approve & send' }))
  await waitFor(() => expect(ops.approveThreadEscalation).toHaveBeenCalledWith(row, 'Could we share a range?'))
  expect(screen.getByRole('status').textContent).toContain('Mattan')
})

it('keeps failed reads retryable and never prepares or sends on opening', async () => {
  vi.mocked(ops.fetchThreadEscalations).mockRejectedValueOnce(new Error('Read failed'))
  renderInFrame(<ClientQuestion t={t()} verbs={verbs} />)
  open()
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Read failed'))
  expect(verbs.askOwner).not.toHaveBeenCalled()
  expect(ops.approveThreadEscalation).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByLabelText('Question for Mattan')).toBeTruthy())
})

it('offers no owner escalation on Ivan’s own seat', () => {
  const thread = { ...t(), client_id: 'ivan' }
  renderInFrame(<ClientQuestion t={thread} verbs={verbs} />)
  expect(document.querySelector('[data-client-question]')).toBeNull()
  expect(ops.fetchThreadEscalations).not.toHaveBeenCalled()
})

it('keeps the edited question when collapsed and reopened', async () => {
  const questionDirty = { current: false }
  renderInFrame(<ClientQuestion t={t()} verbs={verbs} questionDirty={questionDirty} />)
  open()
  await waitFor(() => expect(screen.getByLabelText('Question for Mattan')).toBeTruthy())
  fireEvent.change(screen.getByLabelText('Question for Mattan'), { target: { value: 'Keep my question' } })
  expect(questionDirty.current).toBe(true)
  open(); open()
  await waitFor(() => expect((screen.getByLabelText('Question for Mattan') as HTMLTextAreaElement).value).toBe('Keep my question'))
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
})

it('shows a failed dispatch and an explicit retry action inside the DM', async () => {
  vi.mocked(ops.fetchThreadEscalations).mockResolvedValue([{ ...row, approved_at: '2026-10-25T16:00:00Z', send_blocked_reason: 'slack_failed' }])
  renderInFrame(<ClientQuestion t={t()} verbs={verbs} />)
  open()
  await waitFor(() => expect(screen.getByText(/slack_failed/)).toBeTruthy())
  expect(screen.getByRole('button', { name: 'Retry sending to Mattan' })).toBeTruthy()
})

it('shows already queued questions without a second send action', async () => {
  vi.mocked(ops.fetchThreadEscalations).mockResolvedValue([{ ...row, approved_at: '2026-10-25T16:00:00Z' }])
  renderInFrame(<ClientQuestion t={t()} verbs={verbs} />)
  open()
  await waitFor(() => expect(screen.getByText(/Question queued for Mattan/)).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'Send to Mattan' })).toBeNull()
})

it('can prepare a new question after the previous question was sent', async () => {
  vi.mocked(ops.fetchThreadEscalations).mockResolvedValue([{ ...row, sent_at: '2026-10-25T16:00:00Z' }])
  const thread = t(); thread.draft!.context_gap = { question: 'A new question', why: 'New inbound', chat_url: null }
  renderInFrame(<ClientQuestion t={thread} verbs={verbs} />)
  open()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare new question' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Prepare new question' }))
  await waitFor(() => expect(verbs.askOwner).toHaveBeenCalledWith(thread))
})

it('refreshes a queued question into its dispatch failure without discarding edits', async () => {
  vi.mocked(ops.fetchThreadEscalations).mockResolvedValueOnce([{ ...row, approved_at: '2026-10-25T16:00:00Z' }])
  renderInFrame(<ClientQuestion t={t()} verbs={verbs} />)
  open()
  await waitFor(() => expect(screen.getByText(/Question queued for Mattan/)).toBeTruthy())
  vi.mocked(ops.fetchThreadEscalations).mockResolvedValue([{ ...row, approved_at: '2026-10-25T16:00:00Z', send_blocked_reason: 'slack_failed' }])
  fireEvent.click(screen.getByRole('button', { name: 'Refresh question' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry sending to Mattan' })).toBeTruthy())
  expect(screen.queryByText(/Question queued for Mattan/)).toBeNull()
})
