import { describe, expect, it } from 'vitest'
import {
  detectEscalation, drainSentences, LIVE_HISTORY_TURNS, LIVE_TURN_CAP, parseFastFrame,
  resultFeed, RESULT_FEED_CHARS, speechFrontier, splitSseBuffer, trimHistory, type LiveMsg,
} from './live'

// The escalation contract these tests pin is the one inbox-fast's DEPLOYED
// system prompt states: one `<<ESCALATE: task>>` line inside a short spoken
// reply. The token is machine-read — it must never be spoken and never
// rendered, so detectEscalation returns the reply with it REMOVED.

describe('detectEscalation', () => {
  it('splits the spoken acknowledgment from the machine task', () => {
    const r = detectEscalation(
      "On it — I'm sending that to the workbench now.\n<<ESCALATE: Check why the RISE cold email lane sent 0 yesterday>>',",
    )
    expect(r?.task).toBe('Check why the RISE cold email lane sent 0 yesterday')
    expect(r?.spoken).toContain('sending that to the workbench')
    expect(r?.spoken).not.toContain('ESCALATE')
    expect(r?.spoken).not.toContain('<<')
  })

  it('returns null for pure conversation', () => {
    expect(detectEscalation('The queue looked fine last I heard.')).toBeNull()
  })

  it('an empty task is not an escalation', () => {
    expect(detectEscalation('Sure. <<ESCALATE: >>')).toBeNull()
  })

  it('tolerates the token mid-sentence and multiline tasks', () => {
    const r = detectEscalation('Kicking it off. <<ESCALATE: Audit the\ncomment lane caps>> Anything else?')
    expect(r?.task).toBe('Audit the\ncomment lane caps')
    expect(r?.spoken).toBe('Kicking it off. Anything else?')
  })

  it('strips EVERY token occurrence from the spoken text (belt and braces)', () => {
    const r = detectEscalation('Go. <<ESCALATE: task one>> and <<ESCALATE: task two>>')
    // First task wins; no token fragment survives into speech.
    expect(r?.task).toBe('task one')
    expect(r?.spoken).not.toContain('<<')
    expect(r?.spoken).not.toContain('>>')
  })
})

describe('trimHistory', () => {
  const mk = (n: number): LiveMsg[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `m${i}`,
    }))

  it('keeps the newest turns up to the cap', () => {
    const out = trimHistory(mk(20))
    expect(out.length).toBeLessThanOrEqual(LIVE_HISTORY_TURNS)
    expect(out[out.length - 1].content).toBe('m19')
  })

  it('never starts on an assistant turn (API requirement)', () => {
    // Slicing an even-length alternating list to an even cap lands on an
    // assistant head; trimHistory must shift it off.
    const out = trimHistory(mk(21))
    expect(out[0].role).toBe('user')
  })

  it('short histories pass through untouched', () => {
    const msgs = mk(3)
    expect(trimHistory(msgs)).toEqual(msgs)
  })
})

describe('resultFeed', () => {
  it('prefixes with the marker the fast lane system prompt names', () => {
    expect(resultFeed('Queue fixed.')).toBe('[work result] Queue fixed.')
  })

  it('hard-caps long results — a 4,000-char CLI answer must not be read back', () => {
    const fed = resultFeed('x'.repeat(5000))
    expect(fed.length).toBeLessThanOrEqual('[work result] '.length + RESULT_FEED_CHARS + 1)
    expect(fed.endsWith('…')).toBe(true)
  })

  it('code blocks are omitted, not recited', () => {
    const fed = resultFeed('Fixed it.\n```sql\nSELECT 1;\n```\nDone.')
    expect(fed).not.toContain('SELECT')
    expect(fed).toContain('(code omitted)')
  })
})

describe('LIVE_TURN_CAP', () => {
  it('is the documented 30-turn ceiling', () => {
    expect(LIVE_TURN_CAP).toBe(30)
  })
})

describe('parseFastFrame — the relayed Anthropic SSE stream', () => {
  const frame = (obj: unknown) => `event: whatever\ndata: ${JSON.stringify(obj)}`

  it('text deltas come through', () => {
    expect(parseFastFrame(frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } })))
      .toEqual({ kind: 'delta', text: 'hi' })
  })

  it('non-text deltas and other events are ignored, not guessed at', () => {
    expect(parseFastFrame(frame({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } })))
      .toEqual({ kind: 'ignore' })
    expect(parseFastFrame(frame({ type: 'message_start' }))).toEqual({ kind: 'ignore' })
    expect(parseFastFrame(frame({ type: 'ping' }))).toEqual({ kind: 'ignore' })
  })

  it('message_stop is done; error frames carry their detail', () => {
    expect(parseFastFrame(frame({ type: 'message_stop' }))).toEqual({ kind: 'done' })
    expect(parseFastFrame(frame({ type: 'error', error: { message: 'overloaded' } })))
      .toEqual({ kind: 'error', detail: 'overloaded' })
  })

  it('frames without data lines and garbage JSON are ignored', () => {
    expect(parseFastFrame('event: ping')).toEqual({ kind: 'ignore' })
    expect(parseFastFrame('data: not json')).toEqual({ kind: 'ignore' })
  })
})

describe('speechFrontier — what streaming speech may say', () => {
  it('passes plain text through', () => {
    expect(speechFrontier('On it. Two things.')).toBe('On it. Two things.')
  })

  it('removes a complete machine span', () => {
    expect(speechFrontier('Go. <<ESCALATE: check queue>> Next.')).toBe('Go.  Next.')
  })

  it('withholds everything from an unmatched << until it resolves', () => {
    expect(speechFrontier('On it. <<ESCALATE: check the')).toBe('On it. ')
    // …and a trailing single < that may become <<
    expect(speechFrontier('On it. <')).toBe('On it. ')
  })

  it('is monotonic: what was speakable stays a stable prefix as deltas land', () => {
    const raw = 'Kicking it off now. <<ESCALATE: audit the comment caps>> Done.'
    let prev = ''
    for (let i = 0; i <= raw.length; i++) {
      const f = speechFrontier(raw.slice(0, i))
      expect(f.startsWith(prev)).toBe(true)
      prev = f
    }
  })
})

describe('drainSentences — speak each sentence as it completes', () => {
  it('drains complete sentences and keeps the EXACT unfinished tail (buffer arithmetic)', () => {
    const { speak, rest } = drainSentences('First one. Second one! And the th', false)
    expect(speak).toEqual(['First one.', 'Second one!'])
    // rest is the exact leftover, whitespace included — the hook re-feeds it.
    expect(rest).toBe(' And the th')
  })

  it('a terminator at the buffer edge is NOT complete until done ("$3." vs "$3.5k")', () => {
    const mid = drainSentences('The floor is $3.', false)
    expect(mid.speak).toEqual([])
    expect(mid.rest).toBe('The floor is $3.')
    const end = drainSentences('The floor is $3.', true)
    expect(end.speak).toEqual(['The floor is $3.'])
    expect(end.rest).toBe('')
  })

  it('done flushes the remainder even without punctuation', () => {
    const { speak, rest } = drainSentences('sure thing', true)
    expect(speak).toEqual(['sure thing'])
    expect(rest).toBe('')
  })

  it('whitespace-only input yields nothing', () => {
    expect(drainSentences('  ', true)).toEqual({ speak: [], rest: '' })
    expect(drainSentences('', false)).toEqual({ speak: [], rest: '' })
  })
})

describe('splitSseBuffer', () => {
  it('returns complete frames and keeps the unfinished remainder', () => {
    const { frames, rest } = splitSseBuffer('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')
    expect(frames).toEqual(['data: {"a":1}', 'data: {"b":2}'])
    expect(rest).toBe('data: {"c"')
  })

  it('a frame straddling two reads is never shredded', () => {
    const first = splitSseBuffer('data: {"type":"content_bl')
    expect(first.frames).toEqual([])
    const second = splitSseBuffer(first.rest + 'ock_delta","delta":{"type":"text_delta","text":"x"}}\n\n')
    expect(second.frames).toHaveLength(1)
    expect(parseFastFrame(second.frames[0])).toEqual({ kind: 'delta', text: 'x' })
  })
})
