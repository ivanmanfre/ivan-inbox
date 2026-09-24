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

// post_title / post_url (db/20260924): the post a reaction or comment landed on, from our post tracker.
export type CameBackSignal = { kind: string; at: string; detail: string | null; post_title?: string | null; post_url?: string | null }

const POST_TITLE_MAX = 60

/** The distinct posts they engaged with, newest first, as short quoted titles. */
export function engagedPostTitles(c: Pick<CameBackCard, 'signals'>): string[] {
  const seen = new Set<string>()
  for (const s of c.signals ?? []) {
    if (s.kind === 'view' || s.kind === 'scan_open' || !s.post_title) continue
    const t = s.post_title.trim()
    seen.add(t.length > POST_TITLE_MAX ? `${t.slice(0, POST_TITLE_MAX).trimEnd().replace(/\s+\S*$/, '')}…` : t)
  }
  return [...seen].map(t => `“${t}”`)
}

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
    const titles = engagedPostTitles(c)
    if (c.n_engagements === 1) parts.push(`${word} ${titles[0] ?? 'a post'}`)
    else parts.push(`${word} ${c.n_engagements} posts${titles.length ? `: ${titles.join(' and ')}` : ''}`)
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

/** Ivan 09-23: on his lane a scan reopen becomes a follow-up DRAFT in the thread, not a card.
    Outreach - Stalled Conversation Bump reads the same RPC and drafts these people after 2 days of
    silence instead of 5. So an Ivan card whose ONLY signal is a scan reopen is dropped here. A profile
    view or a post engagement still shows, and RISE and ARCH cards are untouched. */
export function scanReopenOnlyIvan(c: Pick<CameBackCard, 'tenant' | 'n_views' | 'n_engagements' | 'signals'>): boolean {
  return c.tenant === 'ivan' && c.n_views === 0 && c.n_engagements === 0 && scanOpenDays(c) > 0
}

export async function fetchCameBack(): Promise<CameBackCard[]> {
  const { data, error } = await supabase.rpc('came_back_cards')
  if (error) throw error
  return ((data ?? []) as CameBackCard[]).filter(c => !scanReopenOnlyIvan(c))
}

export async function dismissCameBack(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('came_back_dismiss', { p_prospect_id: id })
  if (error) throw error
  return (data as { ok?: boolean } | null)?.ok === true
}
