import { describe, expect, it, vi } from 'vitest'
import { readEditorialWeeklyReview } from './editorialWeeklyRead'
import type { EditorialClient } from './editorialTypes'
const packet = () => ({ state:'ready', client_id:'arch', manifest_hash:'a'.repeat(64), frozen_at:'2026-09-23', available_weeks:['2026-09-28'], manifest:{ client_id:'arch', direction_version:'v3', week_start:'2026-09-28', slots:[{slot_id:'s1',client_id:'arch',direction_version:'v3',week_start:'2026-09-28'}]}, links:[{slot_id:'s1',brief_id:'brief-1',brief_version:2,linked_at:'2026-09-23'}] })
function client(data:unknown) { return {rpc:vi.fn(async()=>({data,error:null}))} as unknown as EditorialClient }
describe('exact saved weekly review',()=>{
  it('reads frozen proposed weeks and exact version links without writes',async()=>{const c=client(packet());const r=await readEditorialWeeklyReview(c,'arch');expect(r.links[0].brief_version).toBe(2);expect(c.rpc).toHaveBeenCalledExactlyOnceWith('editorial_read_weekly_review',{p_gate:'clientops',p_client_id:'arch',p_week_start:null,p_manifest_hash:null})})
  it('rejects wrong-client, wrong-week and orphan links instead of guessing by ordinal',async()=>{const p=packet(); await expect(readEditorialWeeklyReview(client({...p,client_id:'ivan'}),'arch')).rejects.toThrow();await expect(readEditorialWeeklyReview(client(p),'arch','2026-09-21')).rejects.toThrow();await expect(readEditorialWeeklyReview(client({...p,links:[{...p.links[0],slot_id:'other'}]}),'arch')).rejects.toThrow()})
  it('keeps an empty saved week distinct from failed transport',async()=>{expect((await readEditorialWeeklyReview(client({state:'empty',client_id:'arch',manifest:null,links:[],available_weeks:[]}),'arch')).state).toBe('empty');await expect(readEditorialWeeklyReview(client(null),'arch')).rejects.toThrow()})
  it('refuses unregistered clients before any RPC',async()=>{const c=client(packet());await expect(readEditorialWeeklyReview(c,'wrong')).rejects.toThrow();expect(c.rpc).not.toHaveBeenCalled()})
})
