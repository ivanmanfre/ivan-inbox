import { describe, expect, it } from 'vitest'
import { isRetryable, mockTransport, toChatEvent } from './transport'
import type { ChatEvent } from './events'
import { CLAUDE_ERROR_COPY } from '../../../lib/claude'

const T0 = 1_000_000

describe('toChatEvent — broker event → client event', () => {
  it('maps a text delta', () => {
    expect(toChatEvent({ kind: 'text', delta: 'hi' }, T0, T0 + 5, 0))
      .toEqual({ type: 'text', delta: 'hi' })
  })

  it('maps a broker status line to a named started frame, not a spinner', () => {
    expect(toChatEvent({ kind: 'status', text: 'init' }, T0, T0 + 5, 0))
      .toEqual({ type: 'status', status: 'started', note: 'init' })
  })

  it('maps a tool use, with no invented output', () => {
    const out = toChatEvent({ kind: 'tool', name: 'Bash', detail: 'npm run build' }, T0, T0, 3)
    expect(out).toEqual({ type: 'tool_use', id: '3:0', tool: 'Bash', input: { detail: 'npm run build' } })
  })

  it('measures duration client-side and leaves cost null', () => {
    // The broker reports no cost. A missing number beats an estimated one on a
    // line an operator might trust.
    expect(toChatEvent({ kind: 'done' }, T0, T0 + 4180, 0))
      .toEqual({ type: 'done', costUsd: null, durationMs: 4180 })
  })

  it('renders the UNARMED broker with its own exact sentence', () => {
    // This is the state the build ships in. It must never read as a generic
    // failure, and it must not offer a Retry that cannot work.
    const out = toChatEvent({ kind: 'error', code: 'upstream_not_armed' }, T0, T0, 0)
    expect(out).toEqual({
      type: 'error',
      message: CLAUDE_ERROR_COPY.upstream_not_armed,
      retryable: false,
    })
    expect(CLAUDE_ERROR_COPY.upstream_not_armed).toMatch(/not armed/i)
  })

  it('gives every error code its own distinct copy', () => {
    const seen = new Set<string>()
    for (const code of Object.keys(CLAUDE_ERROR_COPY)) {
      if (code === 'aborted') continue
      const out = toChatEvent({ kind: 'error', code: code as never }, T0, T0, 0)
      expect(out?.type, code).toBe('error')
      if (out && out.type === 'error') seen.add(out.message)
    }
    // not_signed_in and unauthenticated deliberately share one sentence; nothing
    // else may collapse.
    expect(seen.size).toBeGreaterThanOrEqual(Object.keys(CLAUDE_ERROR_COPY).length - 2)
  })

  it('turns an abort into the aborted frame, never an error box', () => {
    expect(toChatEvent({ kind: 'error', code: 'aborted' }, T0, T0, 0)).toEqual({ type: 'aborted' })
  })

  // db/049. The stream is the fast path; the ROW is the truth. These ids are how
  // the hook finds the row again after the connection is lost, so they must pass
  // through whole rather than being folded into the session frame.
  it('passes the row identity straight through', () => {
    expect(toChatEvent(
      { kind: 'turn', turnId: 'tu-1', threadId: 'th-1', session: 'resumed', groundedOn: '2026-09-03' },
      T0, T0, 0,
    )).toEqual({
      type: 'turn', turnId: 'tu-1', threadId: 'th-1', session: 'resumed', groundedOn: '2026-09-03',
    })
  })

  it('keeps a null grounding date null rather than inventing a day', () => {
    expect(toChatEvent(
      { kind: 'turn', turnId: 'tu-2', threadId: 'th-2', session: 'new', groundedOn: null },
      T0, T0, 0,
    )).toMatchObject({ session: 'new', groundedOn: null })
  })
})

describe('the mock transport still renders every state it exists for', () => {
  // Breaking out of the for-await closes the generator, so these stop at the
  // frame under test instead of sitting through the stub's full typing delay.
  const until = async (req: Parameters<typeof mockTransport>[0], stop: (seen: ChatEvent[]) => boolean) => {
    const out: ChatEvent[] = []
    for await (const e of mockTransport(req)) {
      out.push(e)
      if (stop(out)) break
    }
    return out
  }

  it('names a row before the first token, the way the broker does', async () => {
    const events = await until(
      { prompt: 'why is the pill clipped', sessionId: null },
      seen => seen.some(e => e.type === 'text'),
    )
    const turn = events.find(e => e.type === 'turn')
    // The hook validates the thread id before it paints or persists it, so a
    // readable placeholder here would render a working conversation as broken.
    expect(turn && turn.type === 'turn' && turn.threadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(events.findIndex(e => e.type === 'turn'))
      .toBeLessThan(events.findIndex(e => e.type === 'text'))
  })

  it('echoes the ids the client minted rather than inventing rivals', async () => {
    const events = await until({
      prompt: 'again', sessionId: null,
      threadId: '11111111-1111-4111-8111-111111111111',
      turnId: '22222222-2222-4222-8222-222222222222',
    }, seen => seen.some(e => e.type === 'turn'))
    expect(events[events.length - 1]).toEqual({
      type: 'turn',
      turnId: '22222222-2222-4222-8222-222222222222',
      threadId: '11111111-1111-4111-8111-111111111111',
      session: 'resumed',
      groundedOn: '2026-09-04',
    })
  })
})

describe('isRetryable', () => {
  it('offers retry only where a second attempt could work', () => {
    for (const c of ['upstream_timeout', 'upstream_unreachable', 'upstream_error', 'relay_broken'] as const) {
      expect(isRetryable(c), c).toBe(true)
    }
  })

  it('never offers retry on a standing condition', () => {
    for (const c of ['upstream_not_armed', 'forbidden_user', 'invalid_token',
      'broker_not_configured', 'prompt_too_long', 'not_signed_in'] as const) {
      expect(isRetryable(c), c).toBe(false)
    }
  })
})
