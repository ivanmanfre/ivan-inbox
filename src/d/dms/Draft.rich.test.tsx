// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Draft } from './Draft'
import { drafted, NOW, threads } from './fixtures'
import type { Edits } from './verbs'

afterEach(cleanup)

it('updates native email text and rich document together', () => {
  const [thread] = threads(drafted('rich-native', { client_id: 'arch', channel: 'email', message_type: 'email', recipient_email: 'alex@example.com', message_text: 'Subject: Hi\n\nHello' }))
  thread.draft!.message_text = 'Subject: Hi\n\nHello'
  let current: Edits
  function View() {
    const [edits, setEdits] = useState<Edits>({ main: thread.draft!.message_text, email: null, companion: null })
    current = edits
    return <Draft t={thread} edits={edits} setEdits={setEdits} save="idle" onBlur={() => {}} onRetrySave={() => {}} now={NOW} onRetry={() => {}} />
  }
  render(<View />)
  fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
  expect(current!.main).toBe('Subject: Hi\n\n- Hello')
  expect(current!.mainComposition?.body.content?.[0].type).toBe('bulletList')
})
