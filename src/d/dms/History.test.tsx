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
