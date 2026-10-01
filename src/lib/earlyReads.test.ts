import { describe, expect, it } from 'vitest'
import { holdoutText, parseDraftReads, parsePatternRead, parseResults, readReasonText } from './earlyReads'
const pattern = { client_id: 'ivan', dimension: 'angle', value: 'personal', n: 100, breakouts: 12, rate: .12, base_n: 1000, base_rate: .045, lift: 2.6667, computed_at: '2026-10-01', study_id: 'study' }
describe('stored niche reads', () => {
 it('suppresses subthreshold and malformed chances rather than manufacturing a read', () => {
  for (const p of [{ ...pattern, n: 24 }, { ...pattern, rate: 2 }, { ...pattern, n: null }]) {
   const read = parsePatternRead({ state: 'ready', pattern: p, sentence: 'Stored.' })
   expect(read.state).toBe('no_read_yet'); expect(read.pattern).toBeNull()
  }
  expect(parsePatternRead({ state: 'ready', pattern: { ...pattern, n: 25, rate: 0, breakouts: 0 }, sentence: 'Stored zero.' }).pattern?.rate).toBe(0)
 })
 it('preserves explicit no-read reasons and stale state', () => {
  expect(parsePatternRead({ state: 'no_read_yet', reason: 'body changed', sentence: null, pattern: null }).reason).toBe('body changed')
  expect(parsePatternRead(null).state).toBe('no_read_yet')
 })
 it('rejects cross-client and foreign draft rows', () => {
  expect(() => parseDraftReads({ ok: true, client: 'arch', reads: [] }, 'ivan', ['a'])).toThrow()
  expect(() => parseDraftReads({ ok: true, client: 'ivan', reads: [{ draft_id: 'other', state: 'no_read_yet', reason: 'queued' }] }, 'ivan', ['a'])).toThrow()
 })
 it('accepts current-body data without converting recipe fit into probability', () => {
  const rows = parseDraftReads({ ok: true, client: 'ivan', reads: [{ draft_id: 'a', client_id: 'ivan', body_hash: 'abc', state: 'ready', pattern, sentence: 'Stored chance.', recipe_fit: { score: 3.2, validated: true, stage: 'idea' } }] }, 'ivan', ['a'])
  expect(rows[0].pattern?.rate).toBe(.12); expect(rows[0].recipeFit?.score).toBe(3.2)
  expect(rows[0].recipeFit?.stage).toBe('idea')
 })
 it('fails a malformed Results envelope and filters subthreshold rows in ordered lists', () => {
  expect(() => parseResults({ ok: true, client: 'arch' }, 'ivan')).toThrow()
  const r = parseResults({ ok: true, client: 'ivan', computed_at: '2026-10-01', patterns: [pattern], top_patterns: [{ ...pattern, n: 24 }, pattern], bottom_patterns: [], holdout: { state: 'not_confirmed', reason: 'Stored recent-post caveat.', top: { n: 20 }, bottom: { n: 20 } } }, 'ivan')
  expect(r.topPatterns).toHaveLength(1); expect(r.holdout?.reason).toBe('Stored recent-post caveat.')
 })
 it('keeps the accepted retrospective outcome and translates known absence codes for display', () => {
  const r = parsePatternRead({ state: 'no_read_yet', reason: 'body_changed', holdout: { state: 'confirmed', reason: 'recent-post check passed' } })
  expect(holdoutText(r.holdout!)).toBe('recent-post check passed')
  expect(readReasonText(r.reason)).toMatch(/body changed/i)
  expect(r.reason).toBe('body_changed')
 })
})
