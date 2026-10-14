import { describe, expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn().mockResolvedValue({data:{ok:true},error:null}) } }))
import { SEATS, SEAT_NAME, seatOf, seatFilter } from './seats'
import { CONTENT_LANES, contentLaneFilter, LANE_OWNER, stageOfLane } from '../lib/content'
import { supabase } from '../lib/supabase'
import { decideClientIdea } from '../lib/clientIdeas'
import { clientWillPublish } from '../lib/clientBoardState'
import { movePublishesForClient } from '../wb/content/moveConfirm'
import { LANES, FEED } from './content/model'

describe('SwishDM client isolation', () => {
  it('recognises Jonathan as his own inbox seat', () => {
    expect(SEATS).toContain('swishdm')
    expect(seatOf('swishdm')).toBe('swishdm')
    expect(seatFilter('swishdm' as never)).toBe('client_id.eq.swishdm')
    expect(SEAT_NAME['swishdm' as never]).toBe('SwishDM')
  })
  it('keeps content reads in the SwishDM tenant', () => {
    expect(CONTENT_LANES).toContain('swishdm')
    expect(LANES).toContain('swishdm')
    expect(contentLaneFilter('swishdm' as never)).toEqual({ column: 'client_id', op: 'eq', value: 'swishdm' })
    expect(LANE_OWNER['swishdm' as never]).toBe('Jonathan')
    expect(FEED['swishdm' as never]).toBe('Jonathan’s board')
  })
  it('preserves existing tenancy and rejects unknown clients', () => {
    expect(seatOf(null)).toBe('ivan')
    expect(seatOf('rise')).toBe('risedtc')
    expect(seatOf('unregistered-client')).toBeNull()
  })
})

 it('does not approve or promise generation for the unconnected client', async () => {
   vi.mocked(supabase.rpc).mockClear()
   await expect(decideClientIdea('swish-idea','approved','swishdm')).rejects.toThrow('not connected')
   expect(supabase.rpc).not.toHaveBeenCalled()
   await decideClientIdea('swish-idea','rejected','swishdm')
   expect(supabase.rpc).toHaveBeenCalledTimes(1)
 })
 it('keeps dates on Jonathan’s board from arming a disconnected publisher', () => {
   const row={id:'swish-post',client_id:'swishdm',status:'scheduled',board_visible:true,published_at:null,scheduled_at:'2026-10-16T12:00:00Z'}
   expect(clientWillPublish(row)).toBe(false)
   expect(stageOfLane(row as never,'swishdm')).toBe('review')
   expect(movePublishesForClient(row)).toBe(false)
   expect(movePublishesForClient({...row,client_id:'risedtc'})).toBe(true)
 })
