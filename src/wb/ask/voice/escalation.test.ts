import { describe, expect, it } from 'vitest'
import type { Turn } from '../../../exp/v2c/chat/events'
import { chatBusy, countUserTurns, dispatched, resultToSpeak, settledAnswer } from './escalation'

const u = (text: string): Turn => ({ role: 'user', text } as unknown as Turn)
const a = (text: string, status = 'done', extra: Record<string, unknown> = {}): Turn =>
  ({ role: 'assistant', text, status, ...extra } as unknown as Turn)

describe('voice escalation', () => {
  it('counts only user turns with the exact task text', () => {
    const turns = [u('what needs me'), a('x'), u(' what needs me '), a('y'), u('other')]
    expect(countUserTurns(turns, 'what needs me')).toBe(2)
  })

  it('is busy while the last turn is an unanswered user turn', () => {
    expect(chatBusy([])).toBe(false)
    expect(chatBusy([u('a')])).toBe(true)
    expect(chatBusy([u('a'), a('b')])).toBe(false)
  })

  it('waits for OUR dispatch, never an older identical ask', () => {
    const before = [u('failed today'), a('old answer')]
    const n = countUserTurns(before, 'failed today')
    expect(dispatched(before, 'failed today', n)).toBe(false)
    expect(settledAnswer(before, 'failed today', n)).toBeNull()
    const after = [...before, u('failed today')]
    expect(dispatched(after, 'failed today', n)).toBe(true)
    expect(settledAnswer(after, 'failed today', n)).toBeNull()
  })

  it('does not settle while the answer is queued or running', () => {
    const turns = [u('run a scan'), a('partial', 'running')]
    expect(settledAnswer(turns, 'run a scan', 0)).toBeNull()
    expect(settledAnswer([u('run a scan'), a('', 'queued')], 'run a scan', 0)).toBeNull()
  })

  it('settles with the new answer and speaks it', () => {
    const turns = [u('q'), a('old'), u('q'), a('Three drafts are waiting.')]
    const s = settledAnswer(turns, 'q', 1)
    expect(s).toEqual({ text: 'Three drafts are waiting.', error: null })
    expect(resultToSpeak(s!)).toContain('Three drafts are waiting')
  })

  it('reports an error or a stop instead of inventing an answer', () => {
    const err = settledAnswer([u('q'), a('', 'error', { error: { message: 'proxy busy' } })], 'q', 0)
    expect(err?.error).toBe('proxy busy')
    expect(resultToSpeak(err!)).toContain('proxy busy')
    const stopped = settledAnswer([u('q'), a('half', 'done', { aborted: true })], 'q', 0)
    expect(stopped?.error).toBe('stopped')
  })

  it('never speaks an em dash', () => {
    const s = settledAnswer([u('q'), a('A — B')], 'q', 0)!
    expect(resultToSpeak(s)).not.toContain('—')
  })
})
