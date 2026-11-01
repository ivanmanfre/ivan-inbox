// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Composer } from './Keys'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// Dictation keeps one recognizer for the whole session, so each phrase must add to the box as it is NOW,
// not to the text the box held when Mic was tapped.
it('dictated phrases add up, and text typed meanwhile is kept', () => {
  let rec: { onresult: ((e: { results: { transcript: string }[][] }) => void) | null } | null = null
  class Fake { lang = ''; interimResults = false; continuous = false; onresult = null; onend = null; start() { rec = this }; stop() {} }
  vi.stubGlobal('SpeechRecognition', Fake)
  Object.assign(window, { SpeechRecognition: Fake })
  function Host() {
    const [v, setV] = useState('')
    return <Composer to="Sam" from="you" big value={v} setValue={setV} onSend={() => {}} busy={false} />
  }
  const { container } = render(<Host />)
  fireEvent.click(container.querySelector('button[aria-label="Dictate"]')!)
  const say = (s: string) => act(() => { rec!.onresult!({ results: [[{ transcript: s }]] }) })
  say('Thanks for the note.')
  fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Thanks for the note. Also, ' } })
  say(' Happy to chat Thursday.')
  expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Thanks for the note. Also,  Happy to chat Thursday.')
  delete (window as unknown as Record<string, unknown>).SpeechRecognition
})
