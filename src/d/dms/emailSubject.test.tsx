// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Draft } from './Draft'
import { msg, NOW, threads } from './fixtures'
import type { Edits } from './verbs'
import type { Thread } from '../../lib/inbox'

afterEach(cleanup)
const original = 'Subject: From LinkedIn - what we run\nHi Mathew,\n\nHere are the details.'
const edited = 'Subject: RISE introduction for Frase Skin\n\nHi Mathew,\n\nHere are the details.'

function editor(t: Thread, initial: Edits, v4 = true) {
  let current = initial
  function Editor() {
    const [edits, setEdits] = useState(initial)
    current = edits
    return <Draft t={t} edits={edits} setEdits={setEdits} save="idle" onBlur={() => {}} onRetrySave={() => {}} now={NOW} onRetry={() => {}} v4={v4} />
  }
  const view = render(<Editor />)
  return { ...view, value: () => current }
}

for (const v4 of [true, false]) it(`edits a mirrored email subject without changing the DM or email body (${v4 ? 'current' : 'legacy'} card)`, () => {
  const t = threads([msg({ prospect_id: 'mathew', client_id: 'risedtc', recipient_email: 'mathew@fraseskin.com.au', email_mirror_text: original, message_text: 'I’ll email those details over.' })])[0]
  const first = editor(t, { main: t.draft!.message_text, email: original, companion: null, cc: '' }, v4)
  expect((screen.getByRole('textbox', { name: 'Email subject' }) as HTMLInputElement).value).toBe('From LinkedIn - what we run')
  expect((screen.getByRole('textbox', { name: 'The email that goes with it' }) as HTMLTextAreaElement).value).toBe('Hi Mathew,\n\nHere are the details.')
  fireEvent.change(screen.getByRole('textbox', { name: 'Email subject' }), { target: { value: 'RISE introduction for Frase Skin' } })
  expect(first.value()).toMatchObject({ main: 'I’ll email those details over.', email: edited })
  first.unmount()
  editor({ ...t, draft: { ...t.draft!, email_mirror_text: edited } }, { main: t.draft!.message_text, email: edited, companion: null, cc: '' }, v4)
  expect((screen.getByRole('textbox', { name: 'Email subject' }) as HTMLInputElement).value).toBe('RISE introduction for Frase Skin')
})

it('edits the subject and exact body of a standalone email in its existing message_text', () => {
  const t = threads([msg({ prospect_id: 'tessa', client_id: 'risedtc', channel: 'email', message_type: 'email', recipient_email: 'tessa@example.com', message_text: original })])[0]
  const pane = editor(t, { main: original, email: null, companion: null, cc: '' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Email subject' }), { target: { value: 'RISE introduction for Frase Skin' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'The draft' }), { target: { value: 'Hi Mathew,\n\nExact operator words.\n' } })
  expect(pane.value().main).toBe('Subject: RISE introduction for Frase Skin\n\nHi Mathew,\n\nExact operator words.\n')
})

it('edits the subject on a paired email leg without changing its LinkedIn companion', () => {
  const base = threads([msg({ prospect_id: 'pair', client_id: 'arch', message_text: 'LinkedIn words' })])[0]
  const comp = msg({ prospect_id: 'pair', client_id: 'arch', channel: 'email', recipient_email: 'pair@example.com', message_text: original })
  const pane = editor({ ...base, companionDraft: comp }, { main: 'LinkedIn words', email: null, companion: original, companionCc: '' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Email leg subject' }), { target: { value: 'RISE introduction for Frase Skin' } })
  expect(pane.value()).toMatchObject({ main: 'LinkedIn words', companion: edited })
})
