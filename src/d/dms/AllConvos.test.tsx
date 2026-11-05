// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Thread } from '../../lib/inbox'
import { AllConvos, previewLine } from './AllConvos'
import { History } from './History'
import { NOW, threads, waiting } from './fixtures'
import type { RowCtx } from './threadRows'

afterEach(cleanup)

const list = threads([
  ...waiting('douglas', { client_id: 'arch', prospect_name: 'Douglas Hare' }),
  ...waiting('ricky', { client_id: 'arch', prospect_name: 'Ricky Singh' }),
])

function Conversations() {
  const [open, setOpen] = useState<Thread | null>(null)
  const c: RowCtx = {
    selected: open?.prospect_id ?? null, open: setOpen, now: NOW,
    checked: new Set(), busy: null, setBusy: () => {}, fail: () => {}, more: () => {},
    verbs: {} as RowCtx['verbs'],
    pre: { get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false },
  }
  return <>
    <aside aria-label="Conversation list"><AllConvos threads={list} c={c}
      folds={{ isOpen: () => true, toggle: () => {} }} dated={new Map()} /></aside>
    <section aria-label="Conversation panel">{open
      ? <><h2>{open.prospect_name}</h2><History t={open} now={NOW} /></>
      : 'Pick a conversation.'}</section>
  </>
}

it.each(['click', 'Enter'])('opens All conversations in the main panel on the first %s', action => {
  render(<Conversations />)
  const rail = screen.getByRole('complementary', { name: 'Conversation list' })
  const pane = screen.getByRole('region', { name: 'Conversation panel' })
  const douglas = within(rail).getByRole('button', { name: /Douglas Hare.*waiting on them/ })
  if (action === 'click') fireEvent.click(douglas)
  else fireEvent.keyDown(douglas, { key: 'Enter' })
  expect(within(pane).getByRole('heading', { name: 'Douglas Hare' })).toBeTruthy()
  expect(within(pane).getByText('What is this about?')).toBeTruthy()
  expect(douglas.getAttribute('aria-current')).toBe('true')
  expect(within(rail).queryByText('What is this about?')).toBeNull()

  fireEvent.click(within(rail).getByRole('button', { name: /Ricky Singh.*waiting on them/ }))
  expect(within(pane).getByRole('heading', { name: 'Ricky Singh' })).toBeTruthy()
  expect(douglas.getAttribute('aria-current')).toBeNull()
})

it('never shows an unsent row as sent in the preview', () => {
  const m = (id: string, o: Record<string, unknown>) => ({ id, direction: 'outbound', sent_at: null, message_text: '', ...o }) as unknown as Thread['last']
  const theirs = m('a', { direction: 'inbound', message_text: 'Back at ya' })
  const sent = m('b', { sent_at: '2026-11-01T10:00:00Z', message_text: 'Good luck!' })
  const note = m('c', { message_text: 'No reply recommended. Jesse declined.' })
  const t = (messages: Thread['last'][], draft: Thread['last'] | null = null) => ({ messages, last: messages.at(-1)!, draft }) as unknown as Thread
  expect(previewLine(t([sent, theirs, note]))).toBe('Back at ya')
  expect(previewLine(t([theirs, sent, m('d', {})]))).toBe('You: Good luck!')
  const live = m('e', { message_text: 'Thanks a lot Éléa' })
  expect(previewLine(t([sent, theirs, live], live))).toBe('Draft: Thanks a lot Éléa')
})
