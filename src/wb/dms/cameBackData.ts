/* ==========================================================================
   src/wb/dms/cameBackData.ts — the data and the pure helpers behind the
   "Came back" section. The component lives in ./CameBack.tsx.

   Reads: rpc came_back_cards() (db/087), all three tenants.
   Writes: rpc came_back_dismiss() (db/087) — one jsonb stamp, never a send and
   never a stage move. The scheduled next step of the sequence is untouched.
   ========================================================================== */
import { supabase } from '../../lib/supabase'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import type { Filter } from '../../lib/inbox'
import { dayOf } from './warmSignalsData'

export type CameBackSignal = { kind: string; at: string; detail: string | null }

export type CameBackCard = {
  prospect_id: string
  tenant: ContentLane
  name: string
  headline: string | null
  company: string | null
  title: string | null
  country: string | null
  icp_score: number | null
  stage: string
  campaign: string | null
  linkedin_url: string | null
  dm_count: number
  last_out_at: string
  last_out_model: string | null
  last_out_text: string | null
  last_signal_at: string
  n_views: number
  n_engagements: number
  signals: CameBackSignal[] | null
}

/** The section follows the DMs lane switch: one client's people on that
    client's lane, everybody on All. Email and Spam have no LinkedIn seat. */
export function cardsFor(cards: CameBackCard[], filter: Filter): CameBackCard[] {
  if (filter === 'all') return cards
  if (filter === 'ivan' || filter === 'risedtc' || filter === 'arch') return cards.filter(c => c.tenant === filter)
  return []
}

/** The client chip is only worth its space when more than one client is on screen. */
export function tenantLabel(c: Pick<CameBackCard, 'tenant'>, filter: Filter): string | null {
  return filter === 'all' ? LANE_LABEL[c.tenant] : null
}

/** The one line that says what the person did and when. */
export function cameBackLine(c: Pick<CameBackCard, 'n_views' | 'n_engagements' | 'last_signal_at' | 'signals'>): string {
  const parts: string[] = []
  // db/097: they opened the scan we sent. Rides in `signals`, so the RPC's return type never changed.
  const scans = scanOpenDays(c)
  // db/211: a scan_open signal is now a REOPEN (the first open never reaches this list), so say so.
  if (scans > 0) parts.push(scans === 1 ? 'opened the scan again' : `opened the scan again on ${scans} days`)
  if (c.n_views > 0) parts.push(c.n_views === 1 ? 'viewed the profile' : `viewed the profile on ${c.n_views} days`)
  if (c.n_engagements > 0) {
    const commented = (c.signals ?? []).some(s => s.kind === 'comment')
    const word = commented ? 'commented on' : 'reacted to'
    parts.push(c.n_engagements === 1 ? `${word} a post` : `${word} ${c.n_engagements} posts`)
  }
  const when = dayOf(c.last_signal_at)
  return `${parts.join(' and ') || 'came back'}${when ? ` · ${when}` : ''}`
}

export function scanOpenDays(c: Pick<CameBackCard, 'signals'>): number {
  return (c.signals ?? []).filter(s => s.kind === 'scan_open').length
}

/** Where the sequence stands, in words. */
export function sentLine(c: Pick<CameBackCard, 'dm_count' | 'last_out_at'>): string {
  const n = c.dm_count > 0 ? `Message ${c.dm_count}` : 'Last message'
  return `${n} went out ${dayOf(c.last_out_at)}. No reply since.`
}

export function firstComment(c: Pick<CameBackCard, 'signals'>): string | null {
  return (c.signals ?? []).find(s => s.kind === 'comment' && s.detail)?.detail ?? null
}

export async function fetchCameBack(): Promise<CameBackCard[]> {
  const { data, error } = await supabase.rpc('came_back_cards')
  if (error) throw error
  return (data ?? []) as CameBackCard[]
}

export async function dismissCameBack(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('came_back_dismiss', { p_prospect_id: id })
  if (error) throw error
  return (data as { ok?: boolean } | null)?.ok === true
}
