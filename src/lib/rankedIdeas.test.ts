import { describe, expect, it } from 'vitest'
import { parseRankedIdeas, visibleIdeas } from './rankedIdeas'
import type { IdeaItem } from '../d/content/ideaModel'
const item=(id:string):IdeaItem=>({id,lane:'ivan',title:id,score:null,src:'Calls',age:'1d',parts:[],why:null,angle:null,format:null})
describe('ranked idea source contract',()=>{
 it('rejects wrong-client, malformed, or failed payloads instead of showing empty',()=>{
  for(const d of [null,{ok:false,client:'ivan',rows:[]},{ok:true,client:'arch',rows:[]}])expect(()=>parseRankedIdeas(d,'ivan')).toThrow()
 })
 it('uses only the supplied proof and source and preserves ranked ordering',()=>{
  const rows=parseRankedIdeas({ok:true,client:'ivan',rows:[{kind:'bank',id:'a',rank:2,proof:'Stored proof',bank:{id:'a',normalized_topic:'A',source:'calls'}},{kind:'bank',id:'b',rank:1,bank:{id:'b',normalized_topic:'B',source:'manual'}}]},'ivan')
  expect(rows.map(i=>i.id)).toEqual(['a','b']);expect(rows[0].proof).toBe('Stored proof');expect(rows[1].proof).toBe('Manual')
 })
 it('keeps confirmed ids at top through source removal and dedupes fresh bank rows',()=>{
  const pick={...item('confirmed'),saved:true,outlier:{platform:'x',post_id:'123'} as never}
  expect(visibleIdeas([item('a'),item('confirmed'),item('x:123'),item('skip')],[pick],['skip']).map(i=>i.id)).toEqual(['confirmed','a'])
 })
})

it('keeps a stored eligible pattern read attached to the ranked idea without changing rank or proof', () => {
 const read = { state: 'ready', pattern: { client_id: 'ivan', dimension: 'angle', value: 'personal', n: 100, breakouts: 12, rate: .12, base_n: 1000, base_rate: .045, lift: 2.6667, computed_at: '2026-10-01', study_id: 'study' }, sentence: 'Stored niche sentence.', reason: null }
 const rows = parseRankedIdeas({ ok: true, client: 'ivan', rows: [{ kind: 'bank', id: 'a', rank: 2, proof: 'Stored proof', bank: { id: 'a', normalized_topic: 'A', source: 'calls' }, pattern_read: read }] }, 'ivan')
 expect(rows[0].patternRead?.pattern?.rate).toBe(.12)
 expect(rows[0].rank).toBe(2)
 expect(rows[0].proof).toBe('Stored proof')
})

it('carries the server ranking time so a cached list can say when it was ranked', () => {
 const rows = parseRankedIdeas({ ok: true, client: 'ivan', ranked_at: '2026-10-09T17:00:00Z', from_cache: true,
  rows: [{ kind: 'bank', id: 'a', rank: 1, bank: { id: 'a', normalized_topic: 'A', source: 'calls' } }] }, 'ivan')
 expect(rows[0].rankedAt).toBe('2026-10-09T17:00:00Z')
})
