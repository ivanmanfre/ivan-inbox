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
  for (const [stage, word] of [['swishdm_staged_hold', 'Sends after the invite is accepted'], ['connection_sent', 'Sends after they accept'], ['swishdm_connected', 'Queued, not sent yet']]) {
    const [t] = threads([dm1(stage)])
    render(<History t={t} />)
    expect(screen.getByText(word)).toBeTruthy()
    cleanup()
  }
  const [q] = threads([dm1('connection_sent', { draft_evidence: { lane: 'swishdm_first_list', dm_queue: { state: 'queued' } } })])
  render(<History t={q} />)
  expect(screen.getByText('Queued, not sent yet')).toBeTruthy()
})

// George at BUFFS (2026-10-19): the DM1 was approved 14:07Z, the invite went out 14:15Z. The DM1 drew above the
// invite, as a sent bubble, timed at its approval.
const georgeRows = (client_id: string, stage = 'connection_sent') => {
  const base = { prospect_id: `george-${client_id}`, client_id, prospect_stage: stage, created_at: '2026-10-19T13:55:44Z', approved_at: '2026-10-19T14:07:12Z' }
  return [
    msg({ ...base, message_type: 'dm', message_text: 'Hey George, I have saved all 8 answers.', sent_at: null, draft_evidence: client_id === 'swishdm' ? { lane: 'swishdm_first_list' } : null }),
    msg({ ...base, message_type: 'connection_note', message_text: 'Hey George, I asked ChatGPT and Gemini.', sent_at: '2026-10-19T14:15:09Z' }),
  ]
}

it('puts a queued DM1 after the sent invite, dashed, with no clock and a plain wait label', () => {
  const [t] = threads(georgeRows('swishdm'))
  expect(historyRows(t).map(m => m.message_type)).toEqual(['connection_note', 'dm'])
  const { container } = render(<History t={t} />)
  const bubbles = [...container.querySelectorAll('[data-msg]')]
  expect(bubbles.map(b => b.getAttribute('data-pending') !== null)).toEqual([false, true])
  const pending = bubbles[1]
  expect(pending.classList.contains('dm-h-pending')).toBe(true)
  expect(pending.textContent).toContain('Sends after they accept')
  expect(pending.querySelector('time')).toBeNull()
  expect(bubbles[0].querySelector('time')).not.toBeNull()
  expect(bubbles[0].classList.contains('dm-h-pending')).toBe(false)
  // The approval time (14:07Z) is nowhere on screen.
  expect(container.textContent).not.toMatch(/16:07/)
  // One day line only: the pending bubble does not open a second day.
  expect(container.querySelectorAll('.dm-day').length).toBe(1)
})

it('orders pending sends after every sent item on every seat, whatever the approval time was', () => {
  for (const seat of ['ivan', 'risedtc', 'arch', 'swishdm']) {
    const rows = georgeRows(seat, seat === 'swishdm' ? 'connection_sent' : 'replied')
    // A later inbound reply and a later sent message must still come before the pending row.
    const later = [
      ...rows,
      msg({ prospect_id: rows[0].prospect_id, client_id: seat, direction: 'inbound', message_text: 'Hi back', sent_at: '2026-10-19T15:00:00Z', created_at: '2026-10-19T15:00:00Z' }),
    ]
    const [t] = threads(later)
    const order = historyRows(t).map(m => m.message_text)
    expect(order.at(-1)).toBe('Hey George, I have saved all 8 answers.')
    expect(order.slice(0, 2)).toEqual(['Hey George, I asked ChatGPT and Gemini.', 'Hi back'])
    const { container } = render(<History t={t} />)
    const pend = container.querySelector('.dm-h-pending')
    expect(pend, seat).not.toBeNull()
    expect(pend!.querySelector('time')).toBeNull()
    expect(pend!.textContent).toContain(seat === 'swishdm' ? 'Sends after they accept' : 'Queued, not sent yet')
    cleanup()
  }
})

it('shows the scheduled time on a pending send that carries one, never the approval time', () => {
  const [t] = threads([msg({ prospect_id: 'sched', approved_at: '2026-10-19T14:07:12Z', sent_at: null, message_text: 'Later today', draft_evidence: { scheduled_send: { at: '2026-10-19T17:30:00Z', timezone: 'Europe/Warsaw' } } })])
  const { container } = render(<History t={t} />)
  const time = container.querySelector('.dm-h-pending time')
  expect(time?.textContent).toBe('19:30')
  expect(container.textContent).toContain('Scheduled, not sent yet')
  expect(container.textContent).not.toMatch(/16:07/)
})

it('leaves sent items, failures and intentional stops in their chronological place', () => {
  const sent1 = msg({ prospect_id: 'chrono', sent_at: '2026-10-19T09:00:00Z', created_at: '2026-10-19T08:00:00Z', message_text: 'first' })
  const failed = msg({ prospect_id: 'chrono', approved_at: '2026-10-19T10:00:00Z', send_blocked_at: '2026-10-19T10:01:00Z', send_blocked_reason: 'send_failed_429: x', message_text: 'second' })
  const sent2 = msg({ prospect_id: 'chrono', sent_at: '2026-10-19T11:00:00Z', message_text: 'third' })
  const [t] = threads([sent2, failed, sent1])
  expect(historyRows(t).map(m => m.message_text)).toEqual(['first', 'second', 'third'])
})
