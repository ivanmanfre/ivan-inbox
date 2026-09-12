/* ==========================================================================
   src/wb/dms/warmSignalsData.ts — the data and the pure helpers behind the Warm
   signals section (goal run warm-signal-drafts-2026-09-12). The component
   lives in ./WarmSignals.tsx; everything here is testable without a browser.

   Reads: rpc warm_signal_cards() (db/066), Ivan's tenant only.
   Writes: rpc warm_signal_decide() (db/066) — stamps and stage moves, never a
   send. The DM1 row's own approval goes through lib/inbox's approveDraft.
   ========================================================================== */
import { supabase } from '../../lib/supabase'

export type WarmCard = {
  prospect_id: string
  name: string
  headline: string | null
  company: string | null
  title: string | null
  country: string | null
  city: string | null
  icp_score: number | null
  stage: string
  trigger_type: string | null
  campaign_id: string
  linkedin_url: string | null
  connection_sent_at: string | null
  connected_at: string | null
  note_variant: string | null
  skip_reason: string | null
  created_at: string
  signal_source: string
  signal_evidence: WarmEvidence | null
  signal_note_draft: string | null
  signal_note_final: string | null
  signal_approved_at: string | null
  signal_invite_state: string
  signal_lint: unknown
  view_window_ends: string | null
  draft_id: string | null
  draft_text: string | null
  draft_model: string | null
  draft_created_at: string | null
  draft_approved_at: string | null
  draft_sent_at: string | null
  dm_sent_count: number
}

export type WarmEvidence = {
  comment?: string | null
  comment_at?: string | null
  post_urn?: string | null
  post_excerpt?: string | null
  n_posts?: number | null
  viewed_at?: string | null
  distance?: string | null
  trigger_detail?: string | null
  touches?: { kind?: string; post?: string; at?: string; comment?: string }[] | null
}

export type WarmGroupKey = 'commented_own_post' | 'reacted_two_posts' | 'profile_view'

export const WARM_GROUPS: { key: WarmGroupKey; label: string }[] = [
  { key: 'commented_own_post', label: 'Commented on your post' },
  { key: 'reacted_two_posts', label: 'Reacted to two posts' },
  { key: 'profile_view', label: 'Viewed your profile' },
]

/** Which group a card lands in. A lane row that is neither a commenter nor a
    two-post reactor (it should not exist: the rule needs a second touch) is
    shown with the reactors rather than hidden. */
export function warmGroup(c: Pick<WarmCard, 'signal_source' | 'trigger_type'>): WarmGroupKey {
  if (c.trigger_type === 'profile_view' || c.signal_source === 'profile_view') return 'profile_view'
  if (c.signal_source === 'commented_own_post') return 'commented_own_post'
  return 'reacted_two_posts'
}

/** Approve DM1 is only honest once the DM can actually be delivered: a 1st-degree
    viewer (the lane drafted straight into a DM) or an accepted invite. Poll + Send
    creates the chat at dispatch, and that call 422s for a non-connection. */
export function dm1Deliverable(c: Pick<WarmCard, 'stage' | 'connected_at'>): boolean {
  return c.connected_at !== null || c.stage === 'profile_view_dm' || c.stage === 'connected'
}

export function dayOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function distanceWord(d: string | null | undefined): string | null {
  if (!d) return null
  if (/1/.test(d)) return '1st degree'
  if (/2/.test(d)) return '2nd degree'
  if (/3/.test(d)) return '3rd degree'
  return null
}

/** The one line that says why this person is here. */
export function evidenceLine(c: Pick<WarmCard, 'signal_source' | 'trigger_type' | 'signal_evidence' | 'created_at'>): string {
  const ev = c.signal_evidence ?? {}
  const g = warmGroup(c)
  if (g === 'profile_view') {
    const parts = [`viewed your profile ${dayOf(ev.viewed_at ?? c.created_at)}`]
    const dw = distanceWord(ev.distance)
    if (dw) parts.push(dw)
    return parts.join(' · ')
  }
  if (g === 'commented_own_post') {
    const when = dayOf(ev.comment_at ?? (ev.touches ?? []).find(t => t.kind === 'comment')?.at)
    return `commented on your post${when ? ` · ${when}` : ''}`
  }
  const n = ev.n_posts ?? (ev.touches ?? []).length
  return `reacted to ${n || 2} posts`
}

export type InviteState = { kind: 'sent' | 'first_degree' | 'pending' | 'approved'; text: string }

/** The invite's state in words, for the card's invite block. */
export function inviteLine(c: Pick<WarmCard, 'signal_invite_state' | 'note_variant' | 'connection_sent_at' | 'trigger_type' | 'signal_approved_at'>): InviteState {
  if (c.signal_invite_state.startsWith('sent:')) {
    const generic = c.note_variant === 'eh_anchor' || c.note_variant === 'lm_anchor'
    return {
      kind: 'sent',
      text: `Invite sent ${dayOf(c.connection_sent_at)}${generic ? ' with the lane’s earlier generic note' : (c.trigger_type === 'profile_view' ? ' (blank, by rule)' : '')}. Waiting on their accept.`,
    }
  }
  if (c.signal_invite_state === 'first_degree') return { kind: 'first_degree', text: 'Already connected (1st degree). No invite needed.' }
  if (c.signal_approved_at) return { kind: 'approved', text: `Invite approved ${dayOf(c.signal_approved_at)}. The sender picks it up on its next hour.` }
  return { kind: 'pending', text: '' }
}

/** Which of the two decisions is the loud one on this card. */
export function primaryAction(c: Pick<WarmCard, 'signal_invite_state' | 'note_variant' | 'connection_sent_at' | 'trigger_type' | 'signal_approved_at' | 'draft_id' | 'draft_approved_at'>): 'invite' | 'dm1' | null {
  if (inviteLine(c).kind === 'pending') return 'invite'
  if (c.draft_id && !c.draft_approved_at) return 'dm1'
  return null
}

export async function fetchWarmCards(): Promise<WarmCard[]> {
  const { data, error } = await supabase.rpc('warm_signal_cards')
  if (error) throw error
  return (data ?? []) as WarmCard[]
}

export type DecideAction = 'save_note' | 'approve_invite' | 'approve_dm1_stage' | 'skip'
export type DecideResult = { ok: boolean; error?: string; stage?: string }

export async function decideWarm(id: string, action: DecideAction, text?: string | null): Promise<DecideResult> {
  const { data, error } = await supabase.rpc('warm_signal_decide', {
    p_prospect_id: id, p_action: action, p_text: text ?? null,
  })
  if (error) throw error
  return (data ?? { ok: false, error: 'no_reply' }) as DecideResult
}
