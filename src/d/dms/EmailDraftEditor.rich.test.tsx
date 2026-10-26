// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EmailDraftEditor } from './EmailDraftEditor'
import type { EmailComposition } from '../../lib/emailRichText'

afterEach(cleanup)

it('keeps rich body formatting and the separate signature through draft preview', () => {
  let saved: EmailComposition | null = null
  function Editor() {
    const [value, setValue] = useState('Subject: Re: Intro\n\nHello')
    const [composition, setComposition] = useState<EmailComposition | null>(null)
    return <EmailDraftEditor value={value} onChange={setValue} composition={composition} onRichChange={(text, next) => { saved = next; setValue(text); setComposition(next) }}
      label="Body" from="davorin@madebyarch.com" to="alex@example.com" cc="" onCcChange={() => {}} onBlur={() => {}} />
  }
  render(<Editor />)
  fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
  expect(saved).not.toBeNull()
  expect(saved!.body.content?.[0].type).toBe('bulletList')
  expect(saved!.source_text).toBe('Subject: Re: Intro\n\n- Hello')
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  const preview = screen.getByRole('region', { name: 'Email preview' })
  expect(preview.querySelector('ul li')?.textContent).toBe('Hello')
  expect(preview.textContent).toContain('Davorin Šmit')
})

it('keeps the full subject contract when a rich draft subject changes', () => {
  const onRichChange = vi.fn()
  render(<EmailDraftEditor value={'Subject: Original\n\nHello'} onChange={() => {}} onRichChange={onRichChange}
    label="Body" from="sender@example.com" to="alex@example.com" cc="" onCcChange={() => {}} onBlur={() => {}} />)
  expect(onRichChange).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Body' }).textContent).toBe('Hello')
  fireEvent.change(screen.getByRole('textbox', { name: 'Email subject' }), { target: { value: 'Updated' } })
  expect(onRichChange.mock.lastCall?.[0]).toBe('Subject: Updated\n\nHello')
  expect(onRichChange.mock.lastCall?.[1].source_text).toBe('Subject: Updated\n\nHello')
})

it('blocks a stale saved document instead of reimporting its text and signature', () => {
  const stale: EmailComposition = { version: 1, source_text: 'Subject: Old\n\nHello',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }, signature: null }
  const onRichChange = vi.fn()
  render(<EmailDraftEditor value="Subject: New\n\nChanged externally" composition={stale} onChange={() => {}} onRichChange={onRichChange}
    label="Body" from="davorin@madebyarch.com" to="alex@example.com" cc="" onCcChange={() => {}} onBlur={() => {}} />)
  expect(screen.getByRole('alert').textContent).toBe('Saved email formatting changed. Refresh email details before editing or sending.')
  expect(screen.queryByRole('textbox', { name: 'Body' })).toBeNull()
  expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('textbox', { name: 'Email subject' }) as HTMLInputElement).disabled).toBe(true)
  expect(onRichChange).not.toHaveBeenCalled()
})
