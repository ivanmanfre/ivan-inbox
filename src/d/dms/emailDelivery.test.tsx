// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Draft } from './Draft'
import { drafted, threads, NOW } from './fixtures'
vi.mock('./Explain', () => ({ Explain: () => null }))
afterEach(cleanup)
it.each([false, true])('offers saved channel choices on layout v4=%s and hides unused editors', v4 => {
  const [t] = threads(drafted('anthony', { client_id: 'risedtc', recipient_email: 'anthony@example.com', email_mirror_text: 'Subject: Call\n\nWednesday works?' }))
  const toggle = vi.fn()
  const props = { t, edits: { main: t.draft!.message_text, email: t.draft!.email_mirror_text!, companion: null }, setEdits: vi.fn(), save: 'saved' as const,
    onBlur: vi.fn(), onRetrySave: vi.fn(), now: NOW, onRetry: vi.fn(), v4, onSendVia: toggle }
  const view = render(<Draft {...props} />)
  const choice = screen.getByRole('combobox', { name: 'Send via' }) as HTMLSelectElement
  expect(choice.value).toBe('both')
  fireEvent.change(choice, { target: { value: 'email' } })
  expect(toggle).toHaveBeenCalledWith('email')
  view.rerender(<Draft {...props} t={{ ...t, draft: { ...t.draft!, draft_evidence: { send_via: 'email' } } }} />)
  expect(screen.queryByRole('textbox', { name: 'The draft' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'The email that goes with it' })).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Send via' }), { target: { value: 'dm' } })
  expect(toggle).toHaveBeenCalledWith('dm')
  view.rerender(<Draft {...props} t={{ ...t, draft: { ...t.draft!, recipient_email: null, email_delivery_recipient: 'anthony@example.com' } }} />)
  expect((screen.getByRole('combobox', { name: 'Send via' }) as HTMLSelectElement).value).toBe('dm')
  expect(screen.getByRole('textbox', { name: 'The draft' })).toBeTruthy()
  expect(screen.getByText('Only the LinkedIn DM will be sent.')).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'The email that goes with it' })).toBeNull()
})
it('disables channel changes while saving delivery', () => {
  const [t] = threads(drafted('anthony', { recipient_email: 'anthony@example.com', email_mirror_text: 'Email' }))
  render(<Draft t={t} edits={{ main: '', email: 'Email', companion: null }} setEdits={vi.fn()} save="saved" onBlur={vi.fn()} onRetrySave={vi.fn()} now={NOW} onRetry={vi.fn()} onSendVia={vi.fn()} deliveryBusy />)
  expect((screen.getByRole('combobox', { name: 'Send via' }) as HTMLSelectElement).disabled).toBe(true)
})
