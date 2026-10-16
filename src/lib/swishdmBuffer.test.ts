import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ rpc:vi.fn(),from:vi.fn() }))
vi.mock('./supabase',()=>({supabase:mock}))
import { setBoardVisible } from './content'
beforeEach(()=>{mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:{ok:true},error:null})})
it('routes finished Swish content with its exact reviewed timestamp to the buffer RPC',async()=>{
 await setBoardVisible('draft',true,{client_id:'swishdm',updated_at:'2026-10-16T10:00:00Z'})
 expect(mock.rpc).toHaveBeenCalledWith('swishdm_set_buffer_visibility',{p_draft_id:'draft',p_expected_updated_at:'2026-10-16T10:00:00Z',p_visible:true})
})
it('keeps other clients on their existing board RPC',async()=>{
 await setBoardVisible('draft',true,{client_id:'risedtc',updated_at:'old'})
 expect(mock.rpc).toHaveBeenCalledWith('operator_set_board_visible',{p_gate:'clientops',p_draft_id:'draft',p_visible:true})
})
it('reports stale acceptance instead of silently claiming it is on the board',async()=>{
 mock.rpc.mockResolvedValue({data:{ok:false,error:'stale_draft'},error:null})
 await expect(setBoardVisible('draft',true,{client_id:'swishdm',updated_at:'old'})).rejects.toThrow(/changed.*review/i)
})
