import type { Seat } from '../seats'

export type InterestSource = 'own_post_engager' | 'competitor_engager' | 'profile_view' | 'content_signal'
export type InterestEvidence = {
  trigger_type?: string | null; source?: string | null; source_kind?: string | null; lane?: string | null
  engagement_kind?: string | null; post_id?: string | null; anchor?: string | null; company_first?: boolean | null
}

export function interestSource(seat: Seat, e: InterestEvidence): InterestSource | null {
  if (seat === 'ivan') {
    if (e.trigger_type === 'profile_view' || e.source === 'profile_view') return 'profile_view'
    if (e.trigger_type === 'content_signal') return 'content_signal'
    if (e.trigger_type === 'engaged_post' || e.trigger_type === 'content_engagement')
      return e.lane === 'own_post_engager' || e.source_kind === 'own_post_engager' || e.source === 'own_post_engager' ? 'own_post_engager' : 'competitor_engager'
  }
  if (seat === 'risedtc') {
    if (e.source === 'profile_view') return 'profile_view'
    if (e.source === 'rise_warm_engager')
      return ['reaction', 'comment'].includes(e.engagement_kind ?? '') && e.post_id && e.anchor ? 'competitor_engager' : null
    if (e.source?.startsWith('competitor_engager_')) return 'competitor_engager'
  }
  if (seat === 'arch') {
    if (e.source_kind === 'profile_view_warm') return 'profile_view'
    if (e.source_kind === 'own_post_engager') return 'own_post_engager'
    if (e.source_kind === 'competitor_post_engager' || e.source_kind === 'pilot_anchor_post_engager') return 'competitor_engager'
    if (e.source_kind === 'hand_raise') return 'content_signal'
  }
  if (seat === 'swishdm' && e.source === 'swishdm_anchor_engager') return 'competitor_engager'
  return null
}

export const INTEREST_LABEL: Record<InterestSource, string> = {
  own_post_engager: 'Warm engagers', competitor_engager: 'Competitor / anchor engagers',
  profile_view: 'Profile views', content_signal: 'Content interest',
}
