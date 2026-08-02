import { describe, expect, it } from 'vitest'
import { isRetryable, toChatEvent } from './transport'
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
