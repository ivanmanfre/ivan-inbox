import type { CalendarPanel, PanelQuota, PanelSlot } from '../../../lib/contentPlanPanel'

// Words for the calendar panel (Run C). Plain labels; nothing here guesses a belief or a vehicle.
export const VEHICLE_WORD: Record<string, string> = {
  rant: 'a rant', dm_i_got: 'a DM I got', scene_dialogue: 'a scene with dialogue', scene_quote: 'a scene with a quote', receipt: 'a receipt',
  turning_point: 'a turning point', poland_place: 'a place in Poland', night_walk: 'a night walk', proof_story: 'a proof story', take: 'a take',
}
export const vehicleWord = (v: string) => VEHICLE_WORD[v] ?? v.replace(/_/g, ' ')

const KIND_WORD: Record<string, string> = {
  business_event: 'from events', own_story_or_proof: 'own story or proof', life_origin: 'life story', poland_with_him: 'Poland with you',
}
export const REASON_WORD: Record<string, string> = {
  outreach_message: 'Outreach message', profile: 'Profile', content: 'Content', resource: 'Resource', referral: 'Referral', other: 'Other',
}
export const KIND_LABEL: Record<string, string> = {
  proof: 'proof', poland_with_him: 'Poland with you', outlier_copy: 'copy', life_origin: 'life story', business_event: 'from events', other: 'other', how_to: 'how-to',
}

export type SlotLookup = { bySlot: Map<string, PanelSlot>; byDraft: Map<string, PanelSlot> }
export function lookupOf(panel: CalendarPanel | null): SlotLookup {
  const bySlot = new Map<string, PanelSlot>(), byDraft = new Map<string, PanelSlot>()
  for (const s of panel?.slots ?? []) { bySlot.set(s.slot_id, s); if (s.draft_id) byDraft.set(s.draft_id, s) }
  return { bySlot, byDraft }
}
/** Belief and vehicle for one plan item, or null when the server has none. Never a guess. */
export function chipsFor(l: SlotLookup, slotId: string | null, draftId: string | null): { belief: number | null; vehicle: string | null } | null {
  const s = (slotId && l.bySlot.get(slotId)) || (draftId && l.byDraft.get(draftId)) || null
  if (!s || (s.belief == null && !s.vehicle)) return null
  return { belief: s.belief, vehicle: s.vehicle }
}

/** The weekly target, from the quotas that run every week (extras and the every-other-week claim are not in it). */
export function weeklyQuotas(quotas: PanelQuota[]): PanelQuota[] {
  return quotas.filter(q => q.every_n_weeks === 1 && q.per_week != null && Number(q.per_week) > 0 && q.slot_kind in KIND_WORD)
}
export function quotaLine(quotas: PanelQuota[]): string {
  return weeklyQuotas(quotas).map(q => `${Number(q.per_week)} ${KIND_WORD[q.slot_kind]}`).join(', ')
}
export const weekTarget = (quotas: PanelQuota[]) => weeklyQuotas(quotas).reduce((n, q) => n + Number(q.per_week), 0)
export function claimLine(quotas: PanelQuota[]): string | null {
  const q = quotas.find(x => x.slot_kind === 'selling_claim' && x.every_n_weeks > 1)
  return q ? `Selling claim: one every ${q.every_n_weeks} weeks, in place of a post from events.` : null
}

export const pct = (n: number, base: number) => (base > 0 ? `${Math.round((n / base) * 100)}%` : 'none yet')
