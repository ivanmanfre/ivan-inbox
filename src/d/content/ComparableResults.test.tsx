// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))
import { ComparableResults } from './ComparableResults'
afterEach(() => { cleanup(); rpc.mockReset() })
describe('comparable own-post readings', () => {
 it('shows the actual age and keeps unknown conversion data explicit', async () => {
   rpc.mockResolvedValue({ data: { status:'ok',age_days:7,eligible_posts:20,measured_posts:1,latest_collection:'2026-10-18T10:00:00Z',rows:[{post_id:'a',title:'Actual own post',url:null,purpose:'trust',actual_age_days:7.4,captured_at:'2026-10-18T10:00:00Z',impressions:123,comments:null,current_buyer_signal:{judged:5,buyer_memberships:1}}] },error:null })
   render(<ComparableResults lane="risedtc" />)
   expect(await screen.findByText('1 of 20 posts have a retained day-7 reading.')).toBeTruthy()
   expect(screen.getByText(/7.4 days old/)).toBeTruthy()
   expect(screen.getByText(/Booking and inbound DM coverage is unverified/)).toBeTruthy()
   expect(screen.getByText(/Buyer labels now: 1 of 5 judged/)).toBeTruthy()
   expect(screen.queryByText(/0 bookings/)).toBeNull()
 })
 it('shows a failed read rather than an empty dataset', async () => {
   rpc.mockResolvedValue({data:null,error:{message:'Read refused'}})
   render(<ComparableResults lane="ivan" />)
   expect(await screen.findByText('Comparable post results could not be read.')).toBeTruthy()
   expect(screen.queryByText(/0 of 0/)).toBeNull()
 })
})
