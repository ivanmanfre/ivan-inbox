// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Draft } from './Draft'
import { drafted, threads, NOW } from './fixtures'
vi.mock('./Explain', () => ({ Explain: () => null }))
afterEach(cleanup)
it.each([false, true])('offers email opt-out on layout v4=%s and keeps the off choice visible', v4 => {
  const [t] = threads(drafted('anthony', { client_id: 'risedtc', recipient_email: 'anthony@example.com', email_mirror_text: 'Subject: Call\n\nWednesday works?' }))
  const toggle = vi.fn()
  const props = { t, edits: { main: t.draft!.message_text, email: t.draft!.email_mirror_text!, companion: null }, setEdits: vi.fn(), save: 'saved' as const,
    onBlur: vi.fn(), onRetrySave: vi.fn(), now: NOW, onRetry: vi.fn(), v4, onEmailDelivery: toggle }
  const view = render(<Draft {...props} />)
  const checkbox = screen.getByRole('checkbox', { name: 'Send email too' }) as HTMLInputElement
  expect(checkbox.checked).toBe(true)
  fireEvent.click(checkbox)
  expect(toggle).toHaveBeenCalledWith(false)
  view.rerender(<Draft {...props} t={{ ...t, draft: { ...t.draft!, recipient_email: null, email_delivery_recipient: 'anthony@example.com' } }} />)
  expect((screen.getByRole('checkbox', { name: 'Send email too' }) as HTMLInputElement).checked).toBe(false)
  expect(screen.getByText('Only the LinkedIn DM will be sent.')).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: 'The email that goes with it' })).toBeNull()
})
it('disables the checkbox while saving delivery', () => {
  const [t] = threads(drafted('anthony', { recipient_email: 'anthony@example.com', email_mirror_text: 'Email' }))
  render(<Draft t={t} edits={{ main: '', email: 'Email', companion: null }} setEdits={vi.fn()} save="saved" onBlur={vi.fn()} onRetrySave={vi.fn()} now={NOW} onRetry={vi.fn()} onEmailDelivery={vi.fn()} deliveryBusy />)
  expect((screen.getByRole('checkbox', { name: 'Send email too' }) as HTMLInputElement).disabled).toBe(true)
})
