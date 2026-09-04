import { describe, expect, it } from 'vitest'
import { assistantFromRow, groundingOf, mergeRow, turnsFromRows } from './useChat'
import { CLAUDE_ERROR_COPY } from '../../lib/claude'
import type { TurnRow } from '../../lib/turns'
import type { Turn } from './chat/events'

// db/049: the stream is the fast path, the ROW is the truth. These are the pure
// half of that — rows becoming a transcript on a cold launch, and a row landing
// on a transcript the stream already half-wrote.

const row = (o: Partial<TurnRow>): TurnRow => ({
  id: 'r1', thread_id: 'th', prompt: 'why', context: null, context_chars: null,
  model: null, ran_on: 'claude-opus-4-8', status: 'done', answer: 'because',
  tool_events: [], sources: [], grounding: null, resumed: false,
  cost_usd: null, duration_ms: null, client_gone_at: null,
  error_code: null, error_detail: null,
  created_at: '2026-09-04T09:00:00.000Z', started_at: null, finished_at: null, ...o,
})

describe('turnsFromRows', () => {
  it('reads a finished row back as the exchange it was', () => {
    const out = turnsFromRows([row({
      prompt: 'why is the pill clipped', answer: 'white-space:nowrap',
      cost_usd: 0.04, duration_ms: 4180,
      sources: [{ kind: 'memory', path: 'project/MEMORY.md', at: '2026-09-03' }],
      tool_events: [{ t: 1, name: 'Read', summary: 'file_path=x' }],
    })])
    expect(out.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(out[0].text).toBe('why is the pill clipped')
    expect(out[1].text).toBe('white-space:nowrap')
    expect(out[1].tools).toEqual([{ id: 'r1:0', tool: 'Read', input: { detail: 'file_path=x' } }])
    expect(out[1].sources).toEqual([{ kind: 'memory', path: 'project/MEMORY.md', at: '2026-09-03' }])
    expect(out[1].costUsd).toBe(0.04)
    expect(out[1].durationMs).toBe(4180)
    // Both halves carry the row id: it is the handle the poll updates in place.
    expect(out[0].turnId).toBe('r1')
    expect(out[1].turnId).toBe('r1')
  })

  it('a still-running row contributes its QUESTION only', () => {
    // The phone-was-locked state. An empty assistant bubble reads as a failure
    // rather than as work still in progress.
    const out = turnsFromRows([row({ status: 'running', answer: null })])
    expect(out.map(t => t.role)).toEqual(['user'])
    expect(out[0].status).toBe('running')
  })

  it('turns a named error code into the sentence the pane already has for it', () => {
    const out = turnsFromRows([row({ status: 'error', answer: null, error_code: 'upstream_timeout' })])
    expect(out[1].error).toEqual({
      message: CLAUDE_ERROR_COPY.upstream_timeout,
      retryable: true,
    })
  })

  it('an unrecognised error code still says something, and does not offer a retry it cannot honour', () => {
    const out = turnsFromRows([row({ status: 'error', answer: null, error_code: 'lost' })])
    expect(out[1].error?.message).toBe(CLAUDE_ERROR_COPY.unknown)
  })

  it('marks an aborted row aborted rather than failed', () => {
    const out = turnsFromRows([row({ status: 'aborted', answer: 'half an ans' })])
    expect(out[1].aborted).toBe(true)
    expect(out[1].error).toBeNull()
    expect(out[1].text).toBe('half an ans')
  })

  it('is empty for no rows', () => {
    expect(turnsFromRows([])).toEqual([])
  })
})

describe('mergeRow — the row wins, but never blanks what streamed', () => {
  const streamed = (o: Partial<Turn> = {}): Turn[] => ([
    { id: 'u', role: 'user', text: 'why', tools: [], error: null, turnId: 'r1' },
    {
      id: 'a', role: 'assistant', text: 'partial', tools: [{ id: 's:0', tool: 'Read', input: {} }],
      error: null, turnId: 'r1', costUsd: null, durationMs: 900, ...o,
    },
  ])

  it('replaces the streamed answer with the row answer, in place', () => {
    const out = mergeRow(streamed(), row({ answer: 'the whole answer', cost_usd: 0.27, duration_ms: 3105 }))
    expect(out).toHaveLength(2)
    // The React key is kept so the bubble does not remount and lose its scroll.
    expect(out[1].id).toBe('a')
    expect(out[1].text).toBe('the whole answer')
    expect(out[1].costUsd).toBe(0.27)
    expect(out[1].durationMs).toBe(3105)
    expect(out[1].status).toBe('done')
  })

  it('keeps the half-answer when the row failed carrying none', () => {
    // The rule this file has held since it was written: discarding half an
    // answer to show a red box loses the useful part of the turn.
    const out = mergeRow(streamed(), row({ status: 'error', answer: null, error_code: 'relay_broken' }))
    expect(out[1].text).toBe('partial')
    expect(out[1].error?.message).toBe(CLAUDE_ERROR_COPY.relay_broken)
  })

  it('keeps the streamed tool list when the webhook reported none', () => {
    const out = mergeRow(streamed(), row({ tool_events: [] }))
    expect(out[1].tools).toEqual([{ id: 's:0', tool: 'Read', input: {} }])
  })

  it('inserts the answer under its own question when the tab never streamed one', () => {
    // The poll landing on a turn hydrated as a lone question: the phone came
    // back and the answer belongs where the question is, not at the bottom.
    const t: Turn[] = [
      { id: 'u0', role: 'user', text: 'older', tools: [], error: null, turnId: 'r0' },
      { id: 'a0', role: 'assistant', text: 'older answer', tools: [], error: null, turnId: 'r0' },
      { id: 'u1', role: 'user', text: 'why', tools: [], error: null, turnId: 'r1' },
    ]
    const out = mergeRow(t, row({ answer: 'landed' }))
    expect(out.map(x => x.text)).toEqual(['older', 'older answer', 'why', 'landed'])
  })

  it('appends a row it cannot place rather than dropping it', () => {
    const out = mergeRow([], row({ answer: 'orphan' }))
    expect(out.map(x => x.text)).toEqual(['orphan'])
  })

  it('does not mutate the transcript it was given', () => {
    const t = streamed()
    mergeRow(t, row({ answer: 'new' }))
    expect(t[1].text).toBe('partial')
  })
})

describe('groundingOf', () => {
  it('reads the session state and the day the memory was built from', () => {
    expect(groundingOf(row({ resumed: true, grounding: { summary_date: '2026-09-03' } })))
      .toEqual({ session: 'resumed', groundedOn: '2026-09-03' })
  })

  it('says new, and null, rather than guessing', () => {
    expect(groundingOf(row({ resumed: null, grounding: null })))
      .toEqual({ session: 'new', groundedOn: null })
  })
})

describe('assistantFromRow', () => {
  it('gives every turn a distinct React key even from the same row', () => {
    expect(assistantFromRow(row({})).id).not.toBe(assistantFromRow(row({})).id)
  })
})
