// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TurnRow } from '../../lib/turns'
import type { ChatRequest } from './chat/events'
import { useChat } from './useChat'

const io = vi.hoisted(() => ({ latest: vi.fn(), page: vi.fn(), turn: vi.fn(), stream: vi.fn(), cache: vi.fn() }))
vi.mock('../../lib/turns', async original => ({
  ...await original<typeof import('../../lib/turns')>(),
  latestThread: io.latest,
  getBotThread: async () => null,
  getThread: async (id: string) => ({ id }),
  listTurnPage: io.page,
  getTurn: io.turn,
}))
vi.mock('./chat/transport', async original => ({
  ...await original<typeof import('./chat/transport')>(),
  getTransport: () => io.stream,
}))
vi.mock('../../lib/threadCache', async original => ({
  ...await original<typeof import('../../lib/threadCache')>(),
  writeThreadCache: io.cache,
}))

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const row = (thread: string, id: string, answer = id, status = 'done') => ({
  id, thread_id: thread, origin: 'operator', prompt: id, answer, status, created_at: '2026-11-25T12:00:00Z',
} as TurnRow)
const page = (...rows: TurnRow[]) => ({ rows, before: null, linked: null })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { resolve, promise }
}

beforeEach(() => {
  io.latest.mockResolvedValue(null)
  io.page.mockImplementation(async (thread: string) => page(row(thread, thread)))
  io.turn.mockResolvedValue(null)
})

afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks() })

it('keeps detached stream text and its finalizer out of the next chat and its offline cache', async () => {
  const release = deferred<void>()
  io.stream.mockImplementationOnce(async function* () {
    yield { type: 'text', delta: 'private to A' }
    await release.promise
    throw new DOMException('The stream was aborted', 'AbortError')
  })
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  let done!: Promise<void>
  act(() => { done = result.current.send('question A') })
  await waitFor(() => expect(result.current.status).toBe('streaming'))
  await act(async () => result.current.openThread(b))
  await act(async () => { release.resolve(); await done })
  expect(result.current.turns.map(t => t.text)).toEqual([b, b])
  expect(JSON.stringify(io.cache.mock.calls.filter(([thread]) => thread === b))).not.toContain('private to A')
})

it('can start a new stream immediately and keeps it active if an older visit to that chat finishes', async () => {
  const old = deferred<void>(), current = deferred<void>()
  io.stream.mockImplementationOnce(async function* () {
    yield { type: 'text', delta: 'old answer' }
    await old.promise
    yield { type: 'session', sessionId: 'old session', model: 'old model' }
  }).mockImplementationOnce(async function* () {
    yield { type: 'text', delta: 'new answer' }
    await current.promise
  })
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  let done!: Promise<void>, next!: Promise<void>
  act(() => { done = result.current.send('old question') })
  await waitFor(() => expect(result.current.status).toBe('streaming'))
  await act(async () => result.current.openThread(b))
  await act(async () => result.current.openThread(a))
  act(() => { next = result.current.send('new question') })
  await act(async () => { old.resolve(); await done })
  expect(result.current.status).toBe('streaming')
  expect(result.current.sessionId).toBeNull()
  await act(async () => { current.resolve(); await next })
  expect(result.current.turns.map(t => t.text)).toEqual([a, a, 'new question', 'new answer'])
})

it('ignores a settle read started in another chat and recovers the saved turn when its chat is reopened', async () => {
  const settle = deferred<TurnRow>()
  let id!: string
  io.stream.mockImplementationOnce(async function* (request: ChatRequest) {
    id = request.turnId!
    yield { type: 'text', delta: 'streamed A' }
  })
  io.turn.mockReturnValueOnce(settle.promise)
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  await act(async () => result.current.send('question A'))
  expect(io.turn).toHaveBeenCalledWith(id)
  await act(async () => result.current.openThread(b))
  const saved = row(a, id, 'saved A')
  await act(async () => settle.resolve(saved))
  expect(result.current.turns.map(t => t.text)).toEqual([b, b])
  io.page.mockResolvedValueOnce(page(saved))
  await act(async () => result.current.openThread(a))
  expect(result.current.turns.map(t => t.text)).toEqual([id, 'saved A'])
})

it('ignores an older poll for the same row after visiting another chat and returning', async () => {
  const oldPoll = deferred<TurnRow>(), currentPoll = deferred<TurnRow>()
  io.page.mockResolvedValueOnce(page(row(a, 'pending', '', 'running')))
    .mockResolvedValueOnce(page(row(b, b)))
    .mockResolvedValueOnce(page(row(a, 'pending', '', 'running')))
  io.turn.mockReturnValueOnce(oldPoll.promise).mockReturnValueOnce(currentPoll.promise)
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  await act(async () => result.current.openThread(b))
  await act(async () => result.current.openThread(a))
  expect(io.turn).toHaveBeenCalledTimes(2)
  await act(async () => oldPoll.resolve(row(a, 'pending', 'obsolete read')))
  expect(result.current.runningElsewhere).toBe(true)
  expect(result.current.turns.map(t => t.text)).not.toContain('obsolete read')
  await act(async () => currentPoll.resolve(row(a, 'pending', 'authoritative result')))
  expect(result.current.turns.map(t => t.text)).toEqual(['pending', 'authoritative result'])
})

it('keeps a new chat when the initial last-chat lookup finishes after its first reply', async () => {
  const lastChat = deferred<{ id: string }>()
  io.latest.mockReturnValueOnce(lastChat.promise)
  io.stream.mockImplementationOnce(async function* (request: ChatRequest) {
    yield { type: 'turn', turnId: request.turnId, threadId: b, session: 'new', groundedOn: null }
    yield { type: 'text', delta: 'first reply' }
  })
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.send('first question'))
  await act(async () => lastChat.resolve({ id: a }))
  expect(result.current.threadId).toBe(b)
  expect(result.current.turns.map(t => t.text)).toEqual(['first question', 'first reply'])
})

it('refuses a turn frame and settlement that name another thread', async () => {
  io.stream.mockImplementationOnce(async function* (request: ChatRequest) {
    yield { type: 'turn', turnId: request.turnId, threadId: b, session: 'new', groundedOn: null }
    yield { type: 'text', delta: 'another chat' }
  })
  io.turn.mockImplementationOnce(async (id: string) => row(b, id, 'another chat'))
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  await act(async () => result.current.send('question A'))
  expect(result.current.threadId).toBe(a)
  expect(result.current.turns.at(-1)?.error).toBeTruthy()
  expect(result.current.turns.map(t => t.text)).not.toContain('another chat')
})
