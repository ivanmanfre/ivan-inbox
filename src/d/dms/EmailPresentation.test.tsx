// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { History } from './History'
import { Draft } from './Draft'
import { EmailDraftEditor } from './EmailDraftEditor'
import { msg, NOW, threads } from './fixtures'
import type { Edits } from './verbs'
import { renderEmailComposition } from '../../lib/emailRichText'

vi.mock('./Explain', () => ({ Explain: () => null }))
afterEach(cleanup)

it.each([
  { transport: 'native' as const, value: '\nSubject: Re: Intro\n\nHello', subject: 'Re: Intro', body: 'Hello' },
  { transport: 'mirror' as const, value: '**Subject: Intro**\n\nHello', subject: 'Fallback subject', body: '**Subject: Intro**\n\nHello' },
])('shows the $transport dispatch subject and preserves its actual body', ({ transport, value, subject, body }) => {
  render(<EmailDraftEditor value={value} onChange={() => {}} label="Body" subject="Fallback subject" from="sender@example.com" to="alex@example.com" cc="" onCcChange={() => {}} onBlur={() => {}} transport={transport} />)
  expect((screen.getByRole('textbox', { name: 'Email subject' }) as HTMLInputElement).value).toBe(subject)
  expect((screen.getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement).value).toBe(body)
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByRole('heading', { name: subject })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Email preview' }).querySelector('.dm-email-body')!.textContent).toBe(body)
})

it('shows the actual sender fallback subject when an email draft has no Subject line', () => {
  const t = threads([msg({ prospect_id: 'no-subject', channel: 'email', message_text: 'Hi Alex,\n\nA question.', recipient_email: 'alex@example.com' })])[0]
  render(<Draft t={t} edits={{ main: t.draft!.message_text, email: null, companion: null }} setEdits={() => {}} save="saved" onBlur={() => {}} onRetrySave={() => {}} now={NOW} onRetry={() => {}} v4 />)
  expect((screen.getByRole('textbox', { name: 'Email subject' }) as HTMLInputElement).value).toBe('Quick question')
})

it('renders email subject and envelope separately while preserving mixed LinkedIn chronology', () => {
  const dm = msg({ prospect_id: 'email-ui', message_text: 'LinkedIn hello', sent_at: '2026-09-26T08:00:00Z' })
  const email = msg({ prospect_id: 'email-ui', direction: 'inbound', channel: 'email', message_type: 'email', recipient_email: 'alex@example.com', prospect_name: 'Alex Rivera', message_text: 'Subject: Re: Store review\n\nHi Ivan,\n\nSee https://example.com/review\n\nThanks,\nAlex', sent_at: '2026-09-26T09:00:00Z' })
  const reply = vi.fn(), forward = vi.fn()
  const { container } = render(<History t={threads([dm, email])[0]} onReplyEmail={reply} onForwardEmail={forward} v4 />)
  const sheet = container.querySelector(`[data-msg="${email.id}"]`)!
  expect(within(sheet as HTMLElement).getByRole('heading', { name: 'Re: Store review' })).toBeTruthy()
  expect(sheet.classList.contains('dm-b')).toBe(false)
  expect(within(sheet as HTMLElement).getByText('alex@example.com')).toBeTruthy()
  const body = sheet.querySelector('.dm-email-body')!
  expect(body.textContent).toBe('Hi Ivan,\n\nSee https://example.com/review\n\nThanks,\nAlex')
  expect(within(body as HTMLElement).getByRole('link').getAttribute('href')).toBe('https://example.com/review')
  expect(container.querySelector(`[data-msg="${dm.id}"]`)!.classList.contains('dm-b')).toBe(true)
  expect([...container.querySelectorAll('[data-msg]')].map(el => el.getAttribute('data-msg'))).toEqual([dm.id, email.id])
  fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
  fireEvent.click(screen.getByRole('button', { name: 'Forward to email' }))
  expect(reply).toHaveBeenCalledOnce()
  expect(forward).toHaveBeenCalledWith(email)
})

it('shows missing historical subjects honestly and queued emails without a sent clock', () => {
  const received = msg({ prospect_id: 'unknown-subject', direction: 'inbound', channel: 'email', message_text: 'Body only', recipient_email: 'alex@example.com', sent_at: '2026-09-26T09:00:00Z' })
  const queued = msg({ prospect_id: 'unknown-subject', channel: 'email', message_text: 'Subject: Re: Review\n\nQueued words', approved_at: '2026-09-26T10:00:00Z' })
  const { container } = render(<History t={threads([received, queued])[0]} v4 />)
  expect(screen.getByRole('heading', { name: 'Subject unavailable' })).toBeTruthy()
  const sheet = container.querySelector(`[data-msg="${queued.id}"]`)!
  expect(sheet.textContent).toContain('Queued, not sent yet')
  expect(sheet.querySelector('time')).toBeNull()
})

for (const v4 of [true, false]) it(`previews the exact edited email body, subject and CC on layout v4=${v4}`, () => {
  const original = 'Subject: Re: Store review\n\nHi Alex,\n\nThanks,\nIvan'
  const t = threads([msg({ prospect_id: 'draft-preview', channel: 'email', message_type: 'email', recipient_email: 'alex@example.com', message_text: original })])[0]
  let current: Edits
  function Editor() {
    const [edits, setEdits] = useState<Edits>({ main: original, email: null, companion: null, cc: '' })
    current = edits
    return <Draft t={t} edits={edits} setEdits={setEdits} save="saved" onBlur={() => {}} onRetrySave={() => {}} now={NOW} onRetry={() => {}} v4={v4} />
  }
  render(<Editor />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Email subject' }), { target: { value: 'Re: Updated store review' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'CC recipients' }), { target: { value: 'team@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  const preview = screen.getByRole('region', { name: 'Email preview' })
  expect(within(preview).getByRole('heading', { name: 'Re: Updated store review' })).toBeTruthy()
  expect(within(preview).getByText('team@example.com')).toBeTruthy()
  expect(preview.querySelector('ul li')?.textContent).toBe('Hi Alex,')
  expect(current!.mainComposition).not.toBeNull()
  expect(current!.main).toBe(`Subject: Re: Updated store review\n\n${renderEmailComposition(current!.mainComposition!).text}`)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(screen.getByRole('textbox', { name: 'The draft' }).querySelector('ul li')?.textContent).toBe('Hi Alex,')
})

it('keeps CC editable when the scan sender generates the email at send time', () => {
  const row = msg({ prospect_id: 'generated', client_id: 'risedtc', recipient_email: 'alex@example.com', ai_model: 'rise_dm2_scan_delivery_v1' })
  let current: Edits
  function Editor() {
    const [edits, setEdits] = useState<Edits>({ main: row.message_text, email: null, companion: null, cc: '' })
    current = edits
    return <Draft t={threads([row])[0]} edits={edits} setEdits={setEdits} save="saved" onBlur={() => {}} onRetrySave={() => {}} now={NOW} onRetry={() => {}} v4 />
  }
  render(<Editor />)
  fireEvent.change(screen.getByRole('textbox', { name: 'CC recipients' }), { target: { value: 'team@example.com' } })
  expect(current!.cc).toBe('team@example.com')
  expect(screen.queryByRole('textbox', { name: 'The email that goes with it' })).toBeNull()
})
