import { describe, it, expect } from 'vitest'
import { emit, CLAUDE_ERROR_COPY, type ClaudeEvent } from './claude'

const collect = (frame: string): ClaudeEvent[] => {
  const out: ClaudeEvent[] = []
  emit(frame, (e) => out.push(e))
  return out
}

describe('emit — SSE frame parsing', () => {
  it('reads a text delta from an assistant frame', () => {
    expect(collect('data: {"type":"assistant","text":"hello"}'))
      .toEqual([{ kind: 'text', delta: 'hello' }])
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
    expect(collect('data: {"type":"assistant",\ndata: "text":"split"}'))
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
