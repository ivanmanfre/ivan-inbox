// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Draft } from './Draft'
import { drafted, iso, NOW, threads } from './fixtures'
import type { Edits } from './verbs'

afterEach(cleanup)

it.each([
  ['calendar_relative_day_changed', 'The weekday wording in the message does not match the proposed date.'],
  ['calendar_slot_no_longer_available', 'The proposed time is no longer available.'],
  [null, null],
] as const)('explains why a SwishDM draft came back (%s)', (reason, expected) => {
  const rows = drafted('swish-held', { client_id: 'swishdm' })
  Object.assign(rows[2], {
    ai_model: 'swishdm_reply_writer_v1',
    send_blocked_at: iso(60_000),
    send_blocked_reason: 'awaiting_client_review',
    draft_evidence: reason ? { calendar_hold: { reason } } : null,
  })
  const [thread] = threads(rows)
  render(<Draft t={thread} edits={{ main: thread.draft!.message_text, email: null, companion: null }}
    setEdits={() => {}} save="idle" onBlur={() => {}} onRetrySave={() => {}} now={NOW} onRetry={() => {}} v4 />)

  if (expected) expect(screen.getByText(`Returned to review. ${expected}`)).toBeVisible()
  else expect(screen.queryByText(/Returned to review/)).toBeNull()
})

it('updates native email text and rich document together', () => {
  const [thread] = threads(drafted('rich-native', { client_id: 'arch', channel: 'email', message_type: 'email', recipient_email: 'alex@example.com', message_text: 'Subject: Hi\n\nHello' }))
  thread.draft!.message_text = 'Subject: Hi\n\nHello'
  let current: Edits
  function View() {
    const [edits, setEdits] = useState<Edits>({ main: thread.draft!.message_text, email: null, companion: null })
    current = edits
    return <Draft t={thread} edits={edits} setEdits={setEdits} save="idle" onBlur={() => {}} onRetrySave={() => {}} now={NOW} onRetry={() => {}} />
  }
  render(<View />)
  fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
  expect(current!.main).toBe('Subject: Hi\n\n- Hello')
  expect(current!.mainComposition?.body.content?.[0].type).toBe('bulletList')
})
