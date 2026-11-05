// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EmailComposer } from './EmailComposer'
import type { EmailComposition } from '../../lib/emailRichText'

afterEach(cleanup)
const base = { from: 'im@ivanmanfredi.com', to: 'alex@example.com', subject: 'Re: Store review', busy: false, onSend: vi.fn() }

it('keeps the reply subject fixed and previews the exact edited body including a typed Subject line', () => {
  const body = 'Subject: This belongs to the body\n\nHi Alex,\n\nhttps://example.com/review\n\nIvan\n'
  function Editor() {
    const [value, setValue] = useState('')
    return <EmailComposer {...base} value={value} setValue={setValue} />
  }
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: 'Email details' }))
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
  expect(screen.getByText(/Loading recipient\.\.\./)).toBeTruthy()
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

it('shows and removes the verified sender signature while previewing the same rich document', () => {
  function Editor() {
    const [value, setValue] = useState('Hello')
    const [composition, setComposition] = useState<EmailComposition | null>(null)
    return <EmailComposer {...base} from="davorin@madebyarch.com" value={value} setValue={setValue} composition={composition}
      onRichChange={(text, next) => { setValue(text); setComposition(next) }} />
  }
  render(<Editor />)
  expect(screen.getByText('Davorin Šmit')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove signature' }))
  expect(screen.getByText('No signature')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  const preview = screen.getByRole('region', { name: 'Email preview' })
  expect(preview.textContent).toContain('Hello')
  expect(preview.textContent).not.toContain('Davorin Šmit')
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reset signature' }))
  expect(screen.getByText('Davorin Šmit')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Edit signature' }))
  expect(screen.getByRole('textbox', { name: 'Email signature' }).textContent).toContain('Davorin Šmit')
})

it('shows the selected reply source and expands its excerpt', () => {
  const sourceBody = 'A long source email asking about the launch timeline and next steps for the store. '.repeat(4)
  render(<EmailComposer {...base} value="Reply" setValue={() => {}} replyContext={{ from: 'alex@example.com', fromName: 'Alex', date: '2026-10-25T13:00:00Z', subject: 'Original question', body: sourceBody, isLatest: false, selection: 'specific' }} onViewOriginal={vi.fn()} onReplyLatest={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Email details' }))
  expect(screen.getByText('Earlier email in this thread')).toBeTruthy()
  expect(screen.getByText('Original question')).toBeTruthy()
  expect(screen.getByText(/A long source email/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
  expect(screen.getByText(sourceBody.trim())).toBeTruthy()
  expect(screen.getByRole('button', { name: 'View original' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Reply to latest' })).toBeTruthy()
})

it('keeps the rich-editor send shortcut in the existing send gate', () => {
  const onSend = vi.fn()
  render(<EmailComposer {...base} from="davorin@madebyarch.com" value="Hello" setValue={() => {}} onRichChange={() => {}} onSend={onSend} noSend />)
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Email reply' }), { key: 'Enter', ctrlKey: true })
  expect(onSend).toHaveBeenCalledOnce()
})

it('keeps body formatting when the caller explicitly rebases a resolved reply subject', () => {
  const composition: EmailComposition = { version: 1, source_text: 'Subject: \n\nHello',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }] }] }, signature: null }
  const props = { ...base, subject: '', value: 'Hello', setValue: () => {}, composition, onRichChange: () => {} }
  const view = render(<EmailComposer {...props} />)
  view.rerender(<EmailComposer {...props} subject="Re: Store review" composition={{ ...composition, source_text: 'Subject: Re: Store review\n\nHello' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByRole('region', { name: 'Email preview' }).querySelector('strong')?.textContent).toBe('Hello')
})

it('shows a blocking error for a malformed saved rich document', () => {
  const send = vi.fn()
  const malformed = { version: 1, source_text: 'Subject: Re: Store review\n\nHello',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'script' }] }] }] }, signature: null } as EmailComposition
  render(<EmailComposer {...base} value="Hello" setValue={() => {}} composition={malformed} onRichChange={() => {}} onSend={send} />)
  expect(screen.getByRole('alert').textContent).toBe('Saved email formatting changed. Refresh email details before editing or sending.')
  expect(screen.queryByRole('textbox', { name: 'Email reply' })).toBeNull()
  expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(true)
  expect(send).not.toHaveBeenCalled()
})

it('lets a sender without a default signature open an empty signature editor', () => {
  let latest: EmailComposition | null = null
  function Editor() {
    const [composition, setComposition] = useState<EmailComposition | null>(null)
    return <EmailComposer {...base} value="Hello" setValue={() => {}} composition={composition}
      onRichChange={(_, next) => { latest = next; setComposition(next) }} />
  }
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: 'Add signature' }))
  expect(screen.getByRole('textbox', { name: 'Email signature' })).toBeTruthy()
  expect(latest).toMatchObject({ signature: { type: 'doc' } })
  expect(screen.queryByRole('button', { name: 'Reset signature' })).toBeNull()
})

describe('reply-all Cc (Lou Fasulo 10-27)', () => {
  it('locks Cc while the recipient is loading and blocks Send on an invalid address', () => {
    const base = { from: 'davorin@madebyarch.com', subject: 'Re: x', value: 'hi', setValue: () => {}, busy: false, onSend: () => {}, onCcChange: () => {} }
    const { rerender } = render(<EmailComposer {...base} to={null} cc="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Email details' }))
    expect((screen.getByLabelText('Email reply CC recipients') as HTMLInputElement).disabled).toBe(true)
    rerender(<EmailComposer {...base} to="lou@starform.co" cc="margaret@starform.co, jesse@starform.co" />)
    expect((screen.getByLabelText('Email reply CC recipients') as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByText(/Cc 2/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(false)
    rerender(<EmailComposer {...base} to="lou@starform.co" cc="margaret@" />)
    expect(screen.getByText(/Check Cc/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

it('starts with a visible reply editor and a compact recipient and target, with full details on demand', () => {
  const source = { from: 'alex@example.com', fromName: 'Alex', date: '2026-10-25T13:00:00Z', subject: 'Original question', body: 'Please send me the plan.', isLatest: true, selection: 'latest' as const }
  render(<EmailComposer {...base} value="" setValue={() => {}} replyContext={source} onCcChange={() => {}} />)
  expect(screen.getByRole('textbox', { name: 'Email reply' })).toBeTruthy()
  expect(screen.getByText('To alex@example.com')).toBeTruthy()
  expect(screen.getByText('Latest email')).toBeTruthy()
  expect(screen.queryByText('Please send me the plan.')).toBeNull()
  expect(screen.queryByLabelText('Email reply CC recipients')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Email details' }))
  expect(screen.getByText('Please send me the plan.')).toBeTruthy()
  expect(screen.getByLabelText('Email reply CC recipients')).toBeTruthy()
  expect(screen.getByText('Original question')).toBeTruthy()
})

it('keeps the selected earlier target and Cc count separate from a long recipient', () => {
  render(<EmailComposer {...base} to="long.person.with.a.name@long-example-company.com" cc="one@example.com, two@example.com" onCcChange={() => {}}
    value="Reply" setValue={() => {}} replyContext={{ from: 'alex@example.com', date: null, subject: 'Earlier topic', body: 'Question', isLatest: false, selection: 'specific' }} />)
  expect(screen.getByText('To long.person.with.a.name@long-example-company.com')).toBeTruthy()
  expect(screen.getByText('Earlier email · Cc 2')).toBeTruthy()
})

it('returns to the top of the composer after details or preview changes', () => {
  const { container } = render(<EmailComposer {...base} value="Reply" setValue={() => {}} />)
  const body = container.querySelector('.dm-email-composer-body') as HTMLDivElement
  body.scrollTop = 120
  fireEvent.click(screen.getByRole('button', { name: 'Email details' }))
  expect(body.scrollTop).toBe(0)
  body.scrollTop = 120
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  expect(body.scrollTop).toBe(0)
  body.scrollTop = 120
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(body.scrollTop).toBe(0)
})
