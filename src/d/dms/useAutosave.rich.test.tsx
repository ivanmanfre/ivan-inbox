// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAutosave, AUTOSAVE_MS } from './useAutosave'
import type { Edits } from './verbs'
import type { Thread } from '../../lib/inbox'
import type { EmailComposition } from '../../lib/emailRichText'

afterEach(() => vi.useRealTimers())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

it('saves a formatting-only email change when its plain text is unchanged', async () => {
  vi.useFakeTimers()
  const plain: EmailComposition = { version: 1, source_text: 'Subject: Hi\n\nHello', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }, signature: null }
  const bold: EmailComposition = { ...plain, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }] }] } }
  const base: Edits = { main: plain.source_text, email: null, companion: null, mainComposition: plain }
  const save = vi.fn(async () => null)
  const thread = { draft: { id: 'draft-1' } } as Thread
  const { rerender } = renderHook(({ edits }) => useAutosave(thread, edits, base, save), { initialProps: { edits: base } })
  rerender({ edits: { ...base, mainComposition: bold } })
  await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS); await Promise.resolve() })
  expect(save).toHaveBeenCalledWith(thread, expect.objectContaining({ mainComposition: bold }))
})

it('serializes a later local edit behind a slow save and rebases it on that saved row', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const base: Edits = { main: 'Original', email: null, companion: null }
  const original = { id: 'draft-1', message_text: 'Original', email_mirror_text: null, draft_evidence: null }
  const thread = { draft: original, companionDraft: null } as Thread
  const savedThread = { ...thread, draft: { ...original, message_text: 'First edit' } } as Thread
  const first = deferred<{ thread: Thread }>(), second = deferred<{ thread: Thread }>()
  const save = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const { rerender, result } = renderHook(({ edits }) => useAutosave(thread, edits, base, save), { initialProps: { edits: base } })
  rerender({ edits: { ...base, main: 'First edit' } })
  await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS); await Promise.resolve() })
  expect(save).toHaveBeenCalledTimes(1)
  rerender({ edits: { ...base, main: 'Second edit' } })
  let queuedFlush!: Promise<void>
  act(() => { queuedFlush = result.current.flush() })
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => { first.resolve({ thread: savedThread }); await Promise.resolve() })
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[1][0].draft.message_text).toBe('First edit')
  expect(save.mock.calls[1][1].main).toBe('Second edit')
  await act(async () => { second.resolve({ thread: { ...savedThread, draft: { ...original, message_text: 'Second edit' } } as Thread }); await queuedFlush })
})

it('keeps an external refresh baseline so a queued write still conflicts', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const base: Edits = { main: 'Original', email: null, companion: null }
  const original = { id: 'draft-2', message_text: 'Original', email_mirror_text: null, draft_evidence: null }
  const thread = { draft: original, companionDraft: null } as Thread
  const external = { ...thread, draft: { ...original, message_text: 'External change' } } as Thread
  const first = deferred<{ thread: Thread }>()
  const save = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValueOnce('The email draft changed. Refresh before saving.')
  const { rerender } = renderHook(({ t, edits }) => useAutosave(t, edits, base, save), { initialProps: { t: thread, edits: base } })
  rerender({ t: thread, edits: { ...base, main: 'First edit' } })
  await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS); await Promise.resolve() })
  rerender({ t: external, edits: { ...base, main: 'Second edit' } })
  await act(async () => { first.resolve({ thread: { ...thread, draft: { ...original, message_text: 'First edit' } } as Thread }); await Promise.resolve() })
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls[1][0].draft.message_text).toBe('External change')
})
