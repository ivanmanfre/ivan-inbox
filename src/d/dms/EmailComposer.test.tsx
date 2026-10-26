// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EmailComposer } from './EmailComposer'

afterEach(cleanup)
const base = { from: 'im@ivanmanfredi.com', to: 'alex@example.com', subject: 'Re: Store review', busy: false, onSend: vi.fn() }

it('keeps the reply subject fixed and previews the exact edited body including a typed Subject line', () => {
  const body = 'Subject: This belongs to the body\n\nHi Alex,\n\nhttps://example.com/review\n\nIvan\n'
  function Editor() {
    const [value, setValue] = useState('')
    return <EmailComposer {...base} value={value} setValue={setValue} />
  }
  render(<Editor />)
  expect(screen.getByText('Re: Store review')).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: /subject/i })).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'Email reply' }), { target: { value: body } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  const preview = screen.getByRole('region', { name: 'Email preview' })
  expect(within(preview).getByRole('heading', { name: 'Re: Store review' })).toBeTruthy()
  expect(preview.querySelector('.dm-email-body')!.textContent).toBe(body.trim())
  expect(within(preview).getByText('im@ivanmanfredi.com')).toBeTruthy()
  expect(within(preview).getByText('alex@example.com')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect((screen.getByRole('textbox', { name: 'Email reply' }) as HTMLTextAreaElement).value).toBe(body)
})

it('leaves sending to the dock when noSend is set and retains its keyboard shortcut', () => {
  const send = vi.fn()
  render(<EmailComposer {...base} value="Exact reply" setValue={() => {}} noSend onSend={send} />)
  expect(screen.queryByRole('button', { name: 'Send email' })).toBeNull()
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Email reply' }), { key: 'Enter', ctrlKey: true })
  expect(send).toHaveBeenCalledOnce()
})

it('blocks buttons and shortcuts until the recipient loads and while sending is disabled', () => {
  const send = vi.fn(), retry = vi.fn()
  const props = { ...base, value: 'Draft words', setValue: () => {}, onSend: send, onRetry: retry }
  const view = render(<EmailComposer {...props} to={null} />)
  expect(screen.getByText('Loading recipient...')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Email reply' }), { key: 'Enter', metaKey: true })
  expect(send).not.toHaveBeenCalled()
  view.rerender(<EmailComposer {...props} disabled="This seat cannot send email." error="Could not load the email recipient." />)
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Email reply' }), { key: 'Enter', metaKey: true })
  expect(send).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('This seat cannot send email.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry email details' }))
  expect(retry).toHaveBeenCalledOnce()
  view.rerender(<EmailComposer {...props} busy />)
  expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(true)
})
