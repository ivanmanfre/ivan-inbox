import { describe, expect, it } from 'vitest'
import {
  PREREAD_MAX, buildPreReadMessages, parsePreRead, preReadWorthwhile, splitPreRead, waitingDays,
} from './preread'

const NOW = Date.parse('2026-08-22T12:00:00Z')

const WAITING = {
  prospect_id: 'p1',
  prospect_name: 'Bill Laurienti',
  prospect_company: 'Northstar',
  messages: [
    { direction: 'outbound', created_at: '2026-07-01T10:00:00Z', message_text: 'saw you around Kyle content' },
    { direction: 'inbound', created_at: '2026-07-20T10:00:00Z', message_text: 'what does this cost' },
  ],
}

const ANSWERED = {
  ...WAITING,
  messages: [
    ...WAITING.messages,
    { direction: 'outbound', created_at: '2026-08-21T10:00:00Z', message_text: 'two thousand a month' },
  ],
}

describe('who gets offered a pre-read at all', () => {
  it('only the threads where the ball is with Ivan', () => {
    expect(preReadWorthwhile(WAITING)).toBe(true)
    expect(preReadWorthwhile(ANSWERED)).toBe(false)
    expect(preReadWorthwhile({ ...WAITING, messages: [] })).toBe(false)
  })

  it('reports how long they have been waiting, and nothing when they are not', () => {
    expect(waitingDays(WAITING, NOW)).toBe(33)
    expect(waitingDays(ANSWERED, NOW)).toBeNull()
  })
})

describe('the prompt', () => {
  it('asks for the three parts and forbids the guess', () => {
    const [m] = buildPreReadMessages(WAITING)
    expect(m.role).toBe('user')
    expect(m.content).toContain('what they want · what is blocking · what was promised')
    expect(m.content).toContain('not stated')
    expect(m.content).toContain('Never guess')
  })

  it('names both speakers and dates every line, so nothing is attributed by guess', () => {
    const [m] = buildPreReadMessages(WAITING)
    expect(m.content).toContain('2026-07-20 Bill Laurienti: what does this cost')
    expect(m.content).toContain('2026-07-01 Ivan: saw you around Kyle content')
  })

  it('carries at most the last ten messages', () => {
    const many = {
      ...WAITING,
      messages: Array.from({ length: 30 }, (_, i) => ({
        direction: 'inbound', created_at: '2026-08-01T00:00:00Z', message_text: `msg${i}`,
      })),
    }
    const [m] = buildPreReadMessages(many)
    expect(m.content).not.toContain('msg19')
    expect(m.content).toContain('msg29')
  })
})

describe('the reply, made safe to print', () => {
  it('strips the machine escalation line the fast lane can emit', () => {
    const out = parsePreRead('<<ESCALATE: go check the pipeline>>\nWants pricing · not stated · a call')
    expect(out).not.toContain('ESCALATE')
    expect(out).toBe('Wants pricing · not stated · a call')
  })

  it('keeps one line out of a paragraph, and drops the markdown', () => {
    expect(parsePreRead('**Wants pricing** · not stated · a call\n\nWould you like me to draft one?'))
      .toBe('Wants pricing · not stated · a call')
  })

  it('caps the length rather than letting a row grow', () => {
    expect(parsePreRead('x'.repeat(500)).length).toBe(PREREAD_MAX)
  })

  it('an empty answer stays empty, so the caller can say so instead of printing a blank', () => {
    expect(parsePreRead('   \n  ')).toBe('')
    expect(parsePreRead('<<ESCALATE: nothing>>')).toBe('')
  })
})

describe('the line, taken apart for the bubble', () => {
  it('splits the three parts the prompt asked for and labels them', () => {
    const parts = splitPreRead('Wants pricing for the DM lane · waiting on a number · a call this week')
    expect(parts).toEqual([
      { label: 'What they want', text: 'Wants pricing for the DM lane', stated: true },
      { label: 'What is blocking', text: 'waiting on a number', stated: true },
      { label: 'What was promised', text: 'a call this week', stated: true },
    ])
  })

  it('marks "not stated" as unstated rather than as content', () => {
    const parts = splitPreRead('Wants pricing · not stated · Not Stated.')
    expect(parts?.map(p => p.stated)).toEqual([true, false, false])
    expect(parts?.[1].text).toBe('not stated')
  })

  it('treats a blank part as unstated, and never invents one', () => {
    const parts = splitPreRead('Wants pricing ·   · a call')
    expect(parts?.[1]).toEqual({ label: 'What is blocking', text: 'not stated', stated: false })
    expect(parts).toHaveLength(3)
  })

  it('tolerates a missing space around the separator', () => {
    expect(splitPreRead('a·b·c')?.map(p => p.text)).toEqual(['a', 'b', 'c'])
  })

  it('returns null when it did not come back in three, so the caller prints the whole line', () => {
    expect(splitPreRead('Wants pricing · not stated')).toBeNull()
    expect(splitPreRead('He asked what it costs and never heard back')).toBeNull()
    expect(splitPreRead('one · two · three · four')).toBeNull()
    expect(splitPreRead('   ')).toBeNull()
  })
})
