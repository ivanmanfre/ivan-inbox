// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { RichEmailEditor } from './RichEmailEditor'
import { renderEmailDocument, type EmailRichNode } from '../../lib/emailRichText'

afterEach(cleanup)
beforeAll(() => {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList)
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) })
})

const initial: EmailRichNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }

it('wraps the current paragraph in a bullet list and reports structured content', async () => {
  const onChange = vi.fn()
  render(<RichEmailEditor value={initial} label="Email body" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
  await waitFor(() => expect(onChange).toHaveBeenCalled())
  expect(onChange.mock.lastCall?.[0]).toMatchObject({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem' }] }] })
})

it('inserts a labelled link and blocks unsafe URL input', async () => {
  const onChange = vi.fn()
  render(<RichEmailEditor value={initial} label="Email body" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Insert or edit link' }))
  fireEvent.change(screen.getByLabelText('Link text'), { target: { value: 'the brief' } })
  fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'javascript:alert(1)' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
  expect(screen.getByRole('alert').textContent).toBe('Use an http, https, or mailto link.')
  fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://example.com/brief' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
  await waitFor(() => expect(onChange.mock.lastCall?.[0]).toMatchObject({ type: 'doc', content: [{ type: 'paragraph' }] }))
  expect(JSON.stringify(onChange.mock.lastCall?.[0])).toContain('https://example.com/brief')
  expect(JSON.stringify(onChange.mock.lastCall?.[0])).toContain('the brief')
})

it('creates a renderer-compatible link with Tiptap link attributes', async () => {
  const onChange = vi.fn((document: EmailRichNode) => renderEmailDocument(document))
  render(<RichEmailEditor value={initial} label="Email body" onChange={onChange} />)
  const textbox = screen.getByRole('textbox', { name: 'Email body' })
  const text = textbox.querySelector('p')?.firstChild
  expect(text).toBeTruthy()
  const range = document.createRange()
  range.setStart(text!, 0)
  range.setEnd(text!, 5)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  fireEvent.mouseUp(textbox)
  fireEvent.click(screen.getByRole('button', { name: 'Insert or edit link' }))
  fireEvent.change(screen.getByLabelText('Link text'), { target: { value: 'my calendar' } })
  fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://meetings.hubspot.com/arch/test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
  await waitFor(() => expect(onChange).toHaveBeenCalled())
  const saved = onChange.mock.lastCall![0]
  expect(saved).toMatchObject({ type: 'doc' })
  expect(renderEmailDocument(saved).text).toContain('my calendar (https://meetings.hubspot.com/arch/test)')
  expect(JSON.stringify(saved)).not.toContain('"title"')
})

it('uses Control+Enter to send without adding a newline', () => {
  const onChange = vi.fn()
  const onSendShortcut = vi.fn()
  render(<RichEmailEditor value={initial} label="Email body" onChange={onChange} onSendShortcut={onSendShortcut} />)
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Email body' }), { key: 'Enter', ctrlKey: true })
  expect(onSendShortcut).toHaveBeenCalledOnce()
  expect(onChange).not.toHaveBeenCalled()
})

it('hydrates an external document change without echoing an edit', async () => {
  const onChange = vi.fn()
  const view = render(<RichEmailEditor value={initial} label="Email body" onChange={onChange} />)
  view.rerender(<RichEmailEditor value={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Outside edit' }] }] }} label="Email body" onChange={onChange} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Email body' }).textContent).toBe('Outside edit'))
  expect(onChange).not.toHaveBeenCalled()
})

it('updates the editable label when the field purpose changes', () => {
  const onChange = vi.fn()
  const view = render(<RichEmailEditor value={initial} label="Email body" onChange={onChange} />)
  view.rerender(<RichEmailEditor value={initial} label="Signature" onChange={onChange} />)
  expect(screen.getByRole('textbox', { name: 'Signature' })).toBeTruthy()
})

it('filters pasted HTML to supported formatting and safe links', async () => {
  const onChange = vi.fn()
  render(<RichEmailEditor value={initial} label="Email body" onChange={onChange} />)
  fireEvent.paste(screen.getByRole('textbox', { name: 'Email body' }), { clipboardData: {
    types: ['text/html', 'text/plain'],
    getData: (type: string) => type === 'text/html' ? '<h1>Heading</h1><p><a href="javascript:alert(1)">unsafe</a> <strong>safe</strong></p><img src="x" onerror="alert(1)">' : 'Heading unsafe safe',
  } })
  await waitFor(() => expect(onChange).toHaveBeenCalled())
  const saved = JSON.stringify(onChange.mock.lastCall?.[0])
  expect(saved).not.toContain('javascript:')
  expect(saved).not.toContain('image')
  expect(saved).not.toContain('heading')
  expect(saved).toContain('"bold"')
})
