// Hot now (db/289): a finished, QA-passed trend draft still inside its post-by window.
// Read and Skip are operator-gated RPCs; Approve and Edit reuse the lane's existing verbs
// (setBoardVisible's SwishDM buffer path, saveClientDraftBody).
import { supabase } from './supabase'
import type { MarketValidation, EvidencePack } from '../../automation/hot-now/validation'

export type HotNowLane = 'swishdm'

export type HotNowCard = {
  validation: MarketValidation
  qa_ready: boolean
  /** The checked line on Jonathan's Slack card (db/292); null = no line passed, the card shows the headline only. */
  card_line?: string | null
  lane: HotNowLane
  event_id: string
  draft_id: string
  draft_updated_at: string
  headline: string
  summary: string | null
  reason: string | null
  primary_url: string | null
  source_published_at: string | null
  detected_at: string | null
  post_by: string
  post_body: string
  type: string | null
  image_urls: string[] | null
  taxonomy: unknown
}

/** Live hot cards, soonest deadline first. Rows past their deadline are dropped client-side too. */
export async function fetchHotNow(now = Date.now()): Promise<HotNowCard[]> {
  const { data, error } = await supabase.rpc('hot_now_cards')
  if (error) throw error
  return (Array.isArray(data) ? data as HotNowCard[] : []).filter(c => Date.parse(c.post_by) > now && c.validation?.status === 'validated' && c.validation.policy_version === 'market-v1' && Date.parse(c.validation.validated_at) <= now && now - Date.parse(c.validation.validated_at) <= 3600000)
}

/** Skip: archive the draft and mark the event killed. Refuses a draft that moved since it was read. */
export async function skipHotNow(c: Pick<HotNowCard, 'draft_id' | 'draft_updated_at'>): Promise<void> {
  const { data, error } = await supabase.rpc('hot_now_skip', { p_draft_id: c.draft_id, p_expected_updated_at: c.draft_updated_at })
  if (error) throw error
  const r = data as { ok?: boolean; error?: string } | null
  if (!r?.ok) throw new Error(r?.error === 'stale_draft' ? 'The draft changed since you opened it. Refresh and try again.' : `Skip refused: ${r?.error ?? 'unknown'}`)
}

/** "11h 20m left" / "40m left". */
export function timeLeft(postBy: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((Date.parse(postBy) - now) / 60000))
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m left` : `${m}m left`
}

/** "broke 3h ago" from the story's first signal. */
export function brokeAgo(at: string | null, now = Date.now()): string | null {
  if (!at) return null
  const m = Math.max(0, Math.round((now - Date.parse(at)) / 60000))
  return m < 60 ? `broke ${m}m ago` : `broke ${Math.round(m / 60)}h ago`
}

export type HotNowEvidence = { validation: MarketValidation; pack: EvidencePack; checked_at: string }
export async function fetchHotNowEvidence(eventId: string): Promise<HotNowEvidence> {
 const { data, error } = await supabase.rpc('hot_now_evidence', { p_event: eventId })
 if (error) throw error
 if (!data) throw new Error('Current market evidence is unavailable. Refresh and try again.')
 return data as HotNowEvidence
}
export async function recheckHotNow(c: HotNowCard): Promise<void> {
 const fresh=(await fetchHotNow()).find(x=>x.draft_id===c.draft_id)
 if (!fresh) throw new Error('This story needs fresh market evidence or its review window has ended.')
 if (fresh.draft_updated_at!==c.draft_updated_at) throw new Error('The draft changed. Refresh the review before sending.')
 if (!fresh.qa_ready) throw new Error('The edited post is waiting for a fresh quality review.')
}
export function hotNowProof(v: MarketValidation): string {
 const route=v.traction_route==='substantive_replies'?`${v.traction.replies} substantive replies`:v.traction_route==='above_baseline'?`${Number(v.traction.multiple).toFixed(1)}x usual engagement`:'discussion growing'
 return `${v.independent_people} independent voices · ${route}`
}
