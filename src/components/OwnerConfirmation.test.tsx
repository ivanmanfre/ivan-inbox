import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmationNoteGuidance, OwnerConfirmation } from './OwnerConfirmation'
import type { InboxMessage } from '../lib/inbox'

describe('internal confirmation', () => {
  it.each([['arch', 'Davorin'], ['risedtc', 'Mattan'], ['new-seat', 'owner']])('names the actual owner on %s and gives an explicit confirmation prefix', (clientId, owner) => {
    const message = { id: 'hold', client_id: clientId, message_text: '', context_gap: { question: 'Do we accept premium games?', why: 'The company notes do not establish this.' }, draft_evidence: { brief: { they_mean: 'They ask about eligibility.', the_move: 'Confirm the policy first.', reasoning: 'PRIVATE' }, brief_raw: 'PRIVATE' } } as unknown as InboxMessage
    const html = renderToStaticMarkup(<OwnerConfirmation message={message} onAddNote={() => {}} />)
    expect(html).toContain(`Confirm with ${owner}`)
    expect(html).toContain('Do we accept premium games?')
    expect(html).toContain('AI assessment · confirmation pending')
    expect(html).toContain('Internal question · no reply is queued.')
    expect(html).not.toMatch(/PRIVATE|Send failed|Approve|Copy|textarea|Original text was not saved|generated draft/)
    const guidance = renderToStaticMarkup(<ConfirmationNoteGuidance clientId={clientId} />)
    expect(guidance).toContain(`Confirmed by ${owner}:`)
    expect(guidance).toContain('A new draft will still need approval.')
  })
  it('keeps an unreadable question visibly held', () => {
    const message = { id: 'hold', client_id: 'arch', draft_evidence_unavailable: true } as InboxMessage
    const html = renderToStaticMarkup(<OwnerConfirmation message={message} onAddNote={() => {}} onRetry={() => {}} />)
    expect(html).toContain('An answer needs confirmation')
    expect(html).toContain('Explanation could not be loaded.')
    expect(html).toContain('Try again')
  })
})


it('renders a transient retry without requesting owner notes, even when retry time has passed', () => {
  const message = { id: 'retry', client_id: 'arch', direction: 'outbound', sent_at: null, approved_at: null, send_blocked_reason: 'reply_retry_pending', draft_evidence: { retry_after: '2026-07-01T10:05:00Z' } } as InboxMessage
  const html = renderToStaticMarkup(<OwnerConfirmation message={message} onAddNote={() => {}} />)
  expect(html).toContain('Waiting for automatic retry')
  expect(html).toContain('dateTime="2026-07-01T10:05:00Z"')
  expect(html).toContain('no owner confirmation is needed')
  expect(html).not.toMatch(/Confirm with|Confirmed by|Add confirmed|Send failed|<button|<textarea/)
})
