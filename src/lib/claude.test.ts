import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  emit, sendToClaude, CLAUDE_ERROR_COPY, CLAUDE_MODELS,
  type ClaudeEvent, type ModelChoice,
} from './claude'

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'jwt' } } }) } },
}))

const collect = (frame: string): ClaudeEvent[] => {
  const out: ClaudeEvent[] = []
  emit(frame, (e) => out.push(e))
  return out
}

// One turn against a stubbed broker. The response is a closed, empty SSE stream —
// enough to reach the header read and the clean end, which is all these assert.
function stubBroker(headers: Record<string, string>) {
  const calls: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)))
    const body = new ReadableStream<Uint8Array>({ start(c) { c.close() } })
    return Promise.resolve(new Response(body, { status: 200, headers }))
  }))
  return calls
}

async function runWithHeaders(headers: Record<string, string>, model: ModelChoice): Promise<ClaudeEvent[]> {
  stubBroker(headers)
  const out: ClaudeEvent[] = []
  await sendToClaude('hi', { model, onEvent: e => out.push(e) })
  return out
}

async function captureRequest(model: ModelChoice | undefined): Promise<Record<string, unknown>> {
  const calls = stubBroker({ 'x-broker-model': 'container-default' })
  await sendToClaude('hi', { ...(model === undefined ? {} : { model }), onEvent: () => {} })
  return calls[0]
}

afterEach(() => { vi.unstubAllGlobals() })

describe('emit — SSE frame parsing', () => {
  it('reads text out of a REAL assistant frame (nested message.content)', () => {
    // Pinned against a live /chat/stream capture 2026-08-02 — the CLI nests its
    // payload; a top-level `text` on an assistant frame does not exist in the
    // real stream (the pre-fix parser read only that, and dropped every reply).
    expect(collect('data: {"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}'))
      .toEqual([{ kind: 'text', delta: 'hello' }])
  })

  it('reads a nested tool_use item from an assistant frame', () => {
    expect(collect('data: {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}'))
      .toEqual([{ kind: 'tool', name: 'Bash', detail: '{"command":"ls"}' }])
  })

  it('an assistant frame with both text and tool_use emits both, in order', () => {
    expect(collect('data: {"type":"assistant","message":{"content":[{"type":"text","text":"running"},{"type":"tool_use","name":"Read","input":{}}]}}'))
      .toEqual([
        { kind: 'text', delta: 'running' },
        { kind: 'tool', name: 'Read', detail: '{}' },
      ])
  })

  it('treats non-JSON data as raw text rather than dropping it', () => {
    expect(collect('data: plain words')).toEqual([{ kind: 'text', delta: 'plain words' }])
  })

  it('ignores [DONE] sentinels', () => {
    expect(collect('data: [DONE]')).toEqual([])
  })

  it('ignores a frame with no data lines', () => {
    expect(collect('event: ping')).toEqual([])
  })

  it('joins multi-line data payloads before parsing', () => {
    expect(collect('data: {"type":"text",\ndata: "text":"split"}'))
      .toEqual([{ kind: 'text', delta: 'split' }])
  })

  it('surfaces a broker error frame as an error event', () => {
    expect(collect('data: {"error":"relay_broken","detail":"socket closed"}'))
      .toEqual([{ kind: 'error', code: 'relay_broken', detail: 'socket closed' }])
  })

  it('maps a tool_use frame', () => {
    expect(collect('data: {"type":"tool_use","tool_name":"Bash"}'))
      .toEqual([{ kind: 'tool', name: 'Bash', detail: undefined }])
  })

  it('maps a system frame to a status line', () => {
    expect(collect('data: {"type":"system","subtype":"init"}'))
      .toEqual([{ kind: 'status', text: 'init' }])
  })

  it('maps a result frame to done', () => {
    expect(collect('data: {"type":"result"}')).toEqual([{ kind: 'done' }])
  })

  it('emits nothing for an assistant frame carrying no text', () => {
    expect(collect('data: {"type":"assistant","text":""}')).toEqual([])
  })

  it('ignores frame types it does not understand instead of guessing', () => {
    expect(collect('data: {"type":"something_new","payload":1}')).toEqual([])
  })
})

describe('error copy', () => {
  it('names the unarmed-broker case specifically', () => {
    // This is the state the app ships in until the container key is set, so the
    // message has to say that rather than "something went wrong".
    expect(CLAUDE_ERROR_COPY.upstream_not_armed).toMatch(/not armed|key is not set/i)
  })

  it('has copy for every error code', () => {
    for (const [code, copy] of Object.entries(CLAUDE_ERROR_COPY)) {
      expect(copy, code).toBeTruthy()
      expect(copy.length, code).toBeGreaterThan(4)
    }
  })
})

describe('model plumbing — never a silent fallback', () => {
  it('offers only models the broker will forward', () => {
    // The broker's ALLOWED_MODELS is the enforcing copy (a superset); this list
    // decides what is OFFERED — the deduped truthful set probed 2026-08-03:
    // opus-4-7/4-6 map to the same upstream "opus" alias as opus-4-8, so they
    // were the same model under three names (phase4-model-probes.md).
    expect(CLAUDE_MODELS.map(m => m.id)).toEqual([
      'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5',
    ])
  })

  it('sends no model field at all when the choice is the container default', async () => {
    const seen = await captureRequest(undefined)
    expect(seen).not.toHaveProperty('model')
  })

  it('sends the model when one is chosen', async () => {
    const seen = await captureRequest('claude-haiku-4-5')
    expect(seen.model).toBe('claude-haiku-4-5')
  })

  it('reports what the turn RAN on from the broker header, not the request', async () => {
    const events = await runWithHeaders(
      { 'x-broker-model': 'container-default', 'x-broker-context-chars': '40621' },
      'claude-haiku-4-5',
    )
    const m = events.find(e => e.kind === 'model')
    // Asked for Haiku, told "container-default" — the whole point. If this echoed
    // the request back, a dropped model choice would be invisible.
    expect(m).toEqual({ kind: 'model', model: 'container-default', contextChars: 40621, shed: [] })
  })

  it('carries the shed list through when the assembler dropped blocks', async () => {
    const events = await runWithHeaders(
      { 'x-broker-model': 'container-default', 'x-broker-context-chars': '46000', 'x-broker-context-shed': 'B8,B9' },
      null,
    )
    expect(events.find(e => e.kind === 'model')).toMatchObject({ shed: ['B8', 'B9'] })
  })

  it('has distinct copy for each of the three model refusals', () => {
    const copies = [
      CLAUDE_ERROR_COPY.model_not_allowed,
      CLAUDE_ERROR_COPY.model_not_supported_upstream,
      CLAUDE_ERROR_COPY.model_support_unknown,
    ]
    expect(new Set(copies).size).toBe(3)
    // Two of them tell the operator the action that actually works.
    expect(CLAUDE_ERROR_COPY.model_not_supported_upstream).toMatch(/Claude default/i)
    expect(CLAUDE_ERROR_COPY.model_support_unknown).toMatch(/Claude default/i)
  })

  it('names the context-assembly failure as its own state', () => {
    expect(CLAUDE_ERROR_COPY.context_assembly_failed).toMatch(/memory context/i)
    expect(CLAUDE_ERROR_COPY.context_assembly_failed).not.toMatch(/something went wrong/i)
  })
})

// db/049: a turn is a ROW that outlives this tab. These pin the two halves of
// that — what the client sends so the broker can write the row, and what it
// reads back off the response so it can go and fetch it later.
describe('thread and turn plumbing', () => {
  it('sends no thread_id or turn_id when there is no thread yet', async () => {
    const calls = stubBroker({ 'x-broker-model': 'container-default' })
    await sendToClaude('hi', { onEvent: () => {} })
    expect(calls[0]).not.toHaveProperty('thread_id')
    expect(calls[0]).not.toHaveProperty('turn_id')
  })

  it('sends the snake_case ids the broker reads', async () => {
    const calls = stubBroker({ 'x-broker-model': 'container-default' })
    await sendToClaude('hi', { threadId: 'th-1', turnId: 'tu-1', onEvent: () => {} })
    expect(calls[0]).toMatchObject({ thread_id: 'th-1', turn_id: 'tu-1' })
  })

  it('names the row off the response headers, before the first token', async () => {
    const events = await runWithHeaders({
      'x-broker-turn-id': 'tu-1', 'x-broker-thread-id': 'th-1',
      'x-broker-session': 'resumed', 'x-broker-grounded-on': '2026-09-03',
      'x-broker-model': 'container-default',
    }, null)
    expect(events[0]).toEqual({
      kind: 'turn', turnId: 'tu-1', threadId: 'th-1', session: 'resumed', groundedOn: '2026-09-03',
    })
    // The row's identity lands before "what am I talking to": everything that
    // survives the tab closing is keyed on it.
    expect(events.findIndex(e => e.kind === 'turn'))
      .toBeLessThan(events.findIndex(e => e.kind === 'model'))
  })

  it('treats a missing session header as a fresh session, never a guess at resumed', async () => {
    const events = await runWithHeaders(
      { 'x-broker-turn-id': 'tu-2', 'x-broker-thread-id': 'th-2' }, null,
    )
    expect(events.find(e => e.kind === 'turn'))
      .toEqual({ kind: 'turn', turnId: 'tu-2', threadId: 'th-2', session: 'new', groundedOn: null })
  })

  it('says nothing at all when only half the identity arrived', async () => {
    // A thread the client cannot fetch a turn from is worse than no thread: it
    // would be persisted to localStorage and painted on every later launch.
    const events = await runWithHeaders({ 'x-broker-thread-id': 'th-3' }, null)
    expect(events.some(e => e.kind === 'turn')).toBe(false)
  })

  it('reads the container broker frame as the session status it is', () => {
    expect(collect('data: {"type":"broker","resumed":true,"session_id":"s"}'))
      .toEqual([{ kind: 'status', text: 'resumed' }])
    expect(collect('data: {"type":"broker","resumed":false,"session_id":"s"}'))
      .toEqual([{ kind: 'status', text: 'fresh session' }])
  })
})
