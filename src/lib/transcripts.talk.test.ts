import { describe, expect, it } from 'vitest'
import { segmentCalls, talkLine, isMine, MINE_SOURCES, type CallRow } from './transcripts'

const NOW = new Date('2026-11-17T10:00:00Z')
const base: CallRow = {
  id: 'a', title: 'Call', date: '2026-11-16T10:00:00Z', duration_minutes: 30, participants: null,
  summary: null, action_items: null, topics: null, follow_up_draft: null, follow_up_sent: false,
  source: null, meeting_type: null, brief: null, talk_stats: null,
}
const row = (o: Partial<CallRow>): CallRow => ({ ...base, ...o })

describe('mine segment', () => {
  it('mine keeps only Ivan sources', () => {
    expect(segmentCalls([row({ source: 'ivan-listener' }), row({ source: 'fathom-risedtc' })], 'mine', NOW).map(c => c.source)).toEqual(['ivan-listener'])
  })
  it('mine drops calls older than 60 days', () => {
    const old = row({ id: 'old', source: 'manual', date: '2026-09-01T10:00:00Z' })
    expect(segmentCalls([old, row({ id: 'new', source: 'manual' })], 'mine', NOW).map(c => c.id)).toEqual(['new'])
  })
  it('lists the Ivan sources', () => {
    expect([...MINE_SOURCES]).toEqual(['ivan-listener', 'manual', 'manual-paste', 'fireflies'])
    expect(isMine(row({ source: 'fireflies' }))).toBe(true)
    expect(isMine(row({ source: null }))).toBe(false)
  })
})

describe('talkLine', () => {
  it('warns at 65', () => {
    expect(talkLine(row({ talk_stats: { words: { Ivan: 65, Petra: 35 }, total: 100, ivan_pct: 65 } }))).toEqual({ text: 'You 65% of the talking', warn: true })
    expect(talkLine(row({ talk_stats: { words: { Ivan: 64, Petra: 36 }, total: 100, ivan_pct: 64 } }))!.warn).toBe(false)
  })
  it('is null when the share is unknown', () => {
    expect(talkLine(row({ talk_stats: { words: { Ivan: 900 }, total: 900, ivan_pct: null } }))).toBeNull()
    expect(talkLine(row({ talk_stats: null }))).toBeNull()
  })
})
