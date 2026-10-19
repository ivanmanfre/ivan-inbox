// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { History, historyRows } from './History'
import { msg, threads } from './fixtures'

afterEach(cleanup)

it('keeps superseded unsent drafts out of the delivered conversation', () => {
  const sent = msg({ prospect_id: 'doug', sent_at: '2026-10-12T11:06:56Z', message_text: 'Here are the details.' })
  const retired = msg({ prospect_id: 'doug', message_text: '', send_blocked_at: '2026-10-12T12:16:00Z', send_blocked_reason: 'superseded_by_followup_repair' })
  const oldCopy = msg({ prospect_id: 'doug', message_text: 'Abandoned draft text', send_blocked_at: '2026-10-12T12:16:00Z', send_blocked_reason: 'superseded_by_redraft' })
  const [t] = threads([sent, retired, oldCopy])
  expect(historyRows(t).map(m => m.id)).toEqual([sent.id])
  render(<History t={t} />)
  expect(screen.getByText('Here are the details.')).toBeTruthy()
  expect(screen.queryByText(/image or a file/)).toBeNull()
  expect(screen.queryByText('Abandoned draft text')).toBeNull()
})

it('describes missing delivered text without inventing an attachment', () => {
  const [t] = threads([msg({ prospect_id: 'doug', direction: 'inbound', message_text: '', sent_at: '2026-10-12T12:13:00Z' })])
  render(<History t={t} />)
  expect(screen.getByText('Message text unavailable')).toBeTruthy()
  expect(screen.queryByText(/image or a file/)).toBeNull()
})

it('preserves delivered messages even if they carry a retirement marker', () => {
  const sent = msg({ prospect_id: 'doug', sent_at: '2026-10-12T11:06:56Z', message_text: 'Delivered', send_blocked_reason: 'superseded_by_redraft' })
  expect(historyRows(threads([sent])[0]).map(m => m.id)).toEqual([sent.id])
})

// SwishDM review fixes (2026-10-19): the 18 routed InMails (approved, then routed to an invite) drew a
// red "Send failed" bubble and a "Send anyways" button in every SwishDM thread.
it('shows a SwishDM InMail routed to an invite as a muted "Not sent" line, never a failure or Send anyways', () => {
  const routed = msg({ prospect_id: 'sw', client_id: 'swishdm', message_type: 'inmail', channel: 'linkedin_inmail', prospect_stage: 'connection_sent',
    message_text: 'InMail copy', approved_at: '2026-10-18T09:00:00Z', send_blocked_at: '2026-10-18T09:05:00Z', send_blocked_reason: 'routed_to_invite: SwishDM invite sent instead' })
  const [t] = threads([routed])
  const { container } = render(<History t={t} onSendAnyways={() => {}} />)
  expect(screen.getByText('Not sent: sent an invite instead')).toBeTruthy()
  expect(screen.queryByText(/Send failed/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Send anyways' })).toBeNull()
  expect(container.querySelector('.dm-h-fail')).toBeNull()
})

it('keeps a real SwishDM failure red but offers no Send anyways on Jonathan’s seat', () => {
  const failed = msg({ prospect_id: 'sw2', client_id: 'swishdm', prospect_stage: 'swishdm_connected', message_text: 'DM copy',
    approved_at: '2026-10-18T09:00:00Z', send_blocked_at: '2026-10-18T09:05:00Z', send_blocked_reason: 'send_failed_429: check LinkedIn before retrying' })
  const [t] = threads([failed])
  render(<History t={t} onSendAnyways={() => {}} />)
  expect(screen.getByText(/^Send failed/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Send anyways' })).toBeNull()
})

it('says a SwishDM DM1 waits for the invite, then the accept, before it is queued', () => {
  const dm1 = (stage: string, extra = {}) => msg({ prospect_id: `dm1-${stage}`, client_id: 'swishdm', prospect_stage: stage, message_text: 'DM1 copy', approved_at: '2026-10-18T09:00:00Z', ...extra })
  for (const [stage, word] of [['swishdm_staged_hold', 'Waiting for invite'], ['connection_sent', 'Waiting for accept'], ['swishdm_connected', 'Queued']]) {
    const [t] = threads([dm1(stage)])
    render(<History t={t} />)
    expect(screen.getByText(word)).toBeTruthy()
    cleanup()
  }
  const [q] = threads([dm1('connection_sent', { draft_evidence: { lane: 'swishdm_first_list', dm_queue: { state: 'queued' } } })])
  render(<History t={q} />)
  expect(screen.getByText('Queued')).toBeTruthy()
})
