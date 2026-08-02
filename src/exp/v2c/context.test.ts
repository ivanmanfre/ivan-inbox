import { describe, expect, it } from 'vitest'
import { CONTEXT_TURNS, buildContext } from './useChat'
import type { Turn } from './chat/events'

const turn = (role: Turn['role'], text: string): Turn =>
  ({ id: text, role, text, tools: [], error: null })

describe('buildContext — what actually leaves the browser', () => {
  it('is undefined when there is nothing to carry', () => {
    expect(buildContext([])).toBeUndefined()
  })

  it('names what the operator is looking at, as prose', () => {
    const out = buildContext([], 'The agency that could…')
    expect(out).toBe('The operator is looking at: The agency that could…')
  })

  it('replays the transcript, because the upstream never resumes a session', () => {
    const out = buildContext([turn('user', 'why'), turn('assistant', 'because')])
    expect(out).toContain('Ivan: why')
    expect(out).toContain('You: because')
  })

  it('is bounded — a replay is billed, so it cannot grow without limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => turn('user', `q${i}`))
    const out = buildContext(many) ?? ''
    expect(out.split('\n\n')).toHaveLength(CONTEXT_TURNS)
    expect(out).toContain('q39')
    expect(out).not.toContain('q0:')
  })

  it('carries NO instance-scoping field of any kind', () => {
    // phase0's fence: the browser may not hand the broker anything that scopes an
    // instance. This asserts the shape of what we send, not just our intent.
    const out = buildContext([turn('user', 'hello')], 'a draft') ?? ''
    expect(out).not.toMatch(/working_directory|client_id|workspace/i)
    expect(typeof out).toBe('string')
  })

  it('skips empty turns rather than emitting a bare speaker label', () => {
    const out = buildContext([turn('assistant', '   '), turn('user', 'real')])
    expect(out).toBe('Ivan: real')
  })
})
