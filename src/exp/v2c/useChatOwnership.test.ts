// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TurnRow } from '../../lib/turns'
import type { ChatRequest } from './chat/events'
import { useChat } from './useChat'

const io = vi.hoisted(() => ({ bot: vi.fn(), latest: vi.fn(), page: vi.fn(), turn: vi.fn(), stream: vi.fn(), cache: vi.fn() }))
vi.mock('../../lib/turns', async original => ({
  ...await original<typeof import('../../lib/turns')>(),
  latestThread: io.latest,
  getBotThread: io.bot,
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
  io.bot.mockResolvedValue(null)
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

it('retains a settled answer across a visibility read captured before the send', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  io.bot.mockResolvedValue({ id: a })
  const delayed = deferred<ReturnType<typeof page>>()
  let id = ''
  io.stream.mockImplementationOnce(async function* (req: ChatRequest) {
    id = req.turnId!
    yield { type: 'text', delta: 'streaming content' }
  })
  io.turn.mockImplementation(async (key: string) => row(a, key, 'saved content artifact'))
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  io.page.mockReturnValueOnce(delayed.promise)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(io.page).toHaveBeenCalledTimes(2)
  await act(async () => result.current.send('What is on my content plan this week?'))
  expect(result.current.turns.at(-1)?.text).toBe('saved content artifact')
  await act(async () => delayed.resolve(page(row(a, a))))
  expect(result.current.turns.some(t => t.turnId === id && t.text === 'saved content artifact')).toBe(true)
})

it('keeps one answer when a visibility read sees the settled row before the stream ends', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  io.bot.mockResolvedValue({ id: a })
  const done = deferred<void>()
  let id = ''
  io.stream.mockImplementationOnce(async function* (req: ChatRequest) {
    id = req.turnId!
    yield { type: 'text', delta: 'partial plan' }
    await done.promise
  })
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  let send!: Promise<void>
  act(() => { send = result.current.send('What is on my content plan this week?') })
  await waitFor(() => expect(result.current.status).toBe('streaming'))
  const saved = { ...row(a, id, 'weekly plan'), sources: [{ kind: 'content_desk', path: 'weekly-plan' }] }
  io.page.mockResolvedValueOnce(page(row(a, a), saved))
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => { done.resolve(); await send })
  const replies = result.current.turns.filter(t => t.turnId === id && t.role === 'assistant')
  expect(replies.map(t => t.text)).toEqual(['weekly plan'])
  expect(replies[0].sources).toEqual(saved.sources)
})

it('keeps the terminal receipt when an overlapping read returns the same row as running', async () => {
  io.bot.mockResolvedValue({ id: a })
  const release = deferred<void>()
  const delayed = deferred<ReturnType<typeof page>>()
  let id = ''
  io.stream.mockImplementationOnce(async function* (req: ChatRequest) {
    id = req.turnId!
    yield { type: 'text', delta: 'partial' }
    await release.promise
  })
  io.turn.mockImplementationOnce(async (key: string) => ({ ...row(a, key, 'saved'), ran_on: 'worker' }))
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  let done!: Promise<void>
  act(() => { done = result.current.send('question') })
  await waitFor(() => expect(result.current.status).toBe('streaming'))
  io.page.mockReturnValueOnce(delayed.promise)
  act(() => result.current.openThread(a, b))
  await act(async () => { release.resolve(); await done })
  await act(async () => delayed.resolve(page(row(a, a), row(a, id, '', 'running'))))
  expect(result.current.turns.at(-1)).toMatchObject({ turnId: id, role: 'assistant', text: 'saved', status: 'done' })
  expect(result.current.runningElsewhere).toBe(false)
  expect(io.turn).toHaveBeenCalledTimes(1)
})

it('acknowledges only a broker-confirmed send and distinguishes consecutive visits to one chat', async () => {
  const release = deferred<void>()
  io.stream.mockImplementationOnce(async function* (request: ChatRequest) {
    yield { type: 'turn', turnId: request.turnId, threadId: a, session: 'new', groundedOn: null }
    yield { type: 'text', delta: 'first' }
    await release.promise
  })
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  const visit = result.current.getThreadVisit()
  const accepted = vi.fn(), rejected = vi.fn()
  let done!: Promise<void>
  act(() => {
    done = result.current.send('first', undefined, undefined, undefined, accepted)
    void result.current.send('second', undefined, undefined, undefined, rejected)
    expect(accepted).not.toHaveBeenCalled()
    expect(rejected).not.toHaveBeenCalled()
  })
  await waitFor(() => expect(accepted).toHaveBeenCalledOnce())
  await act(async () => result.current.openThread(b))
  await act(async () => result.current.openThread(a))
  expect(result.current.getThreadVisit()).not.toBe(visit)
  await act(async () => { release.resolve(); await done })
})

it('keeps the composer draft when the broker refuses the turn before acknowledgement', async () => {
  io.stream.mockImplementationOnce(async function* () {
    yield { type: 'error', message: 'thread_busy', retryable: false }
  })
  const { result } = renderHook(() => useChat())
  await act(async () => result.current.openThread(a))
  const clear = vi.fn()
  await act(async () => result.current.send('Content: keep this photo', undefined, undefined, undefined, clear))
  expect(clear).not.toHaveBeenCalled()
  expect(result.current.turns.at(-1)?.error).toBeTruthy()
})
