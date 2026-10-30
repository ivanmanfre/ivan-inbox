// Signals (Ivan 09-27): "then he came back with no reply... flag this as a signal from the name" and
// "warm signals... should be part of signals overall". Two pure maps:
//   · cameTag: a came-back card -> the quiet "came back · 2d" tag shown beside the person's name
//     wherever a thread of theirs is listed (and in the thread head), its tooltip what they came
//     back to (today's card line).
//   · signalItems: ONE Signals list per seat holding every pre-reply interest signal: today's warm
//     cards (every seat since 2026-10-30, db/298), agent-only conversations (Ivan's seat), and came-back people who have no conversation
//     yet (they would be lost otherwise). Each labelled by kind in words.
import { isConversation, type Thread } from '../../lib/inbox'
import { cameBackLine, firstComment, interestLabel, sentLine, type CameBackCard } from '../../wb/dms/cameBackData'
import type { ConversationAgentCard } from '../../wb/dms/conversationAgentData'
import { warmGroup, type ViewSeen, type WarmCard } from '../../wb/dms/warmSignalsData'
import { seatOf, type Seat } from '../seats'

const DAY = 86_400_000

export type CameTag = { pid: string; name: string; text: string; title: string; viewOnly?: boolean }

export function cameTag(c: CameBackCard, now: number = Date.now()): CameTag {
  const days = Math.max(0, Math.floor((now - Date.parse(c.last_signal_at)) / DAY))
  const comment = firstComment(c)
  return {
    pid: c.prospect_id, name: c.name,
    text: `${interestLabel(c)} · ${Number.isNaN(days) ? '?' : days === 0 ? 'today' : `${days}d`}`,
    title: `${cameBackLine(c)}. ${sentLine(c)}${comment ? ` “${comment}”` : ''}`,
  }
}

export function cameTags(cards: readonly CameBackCard[], now: number = Date.now()): Map<string, CameTag> {
  return new Map(cards.map(c => [c.prospect_id, cameTag(c, now)]))
}

const VIEW_WHY: Record<string, string> = {
  viewed_after_invite: 'The invite is still pending, so no draft.',
  viewed_after_inmail: 'The InMail is out and they are not connected, so no draft.',
  in_conversation: 'The conversation is already running, so no draft.',
  too_soon: 'Our last message is under 3 days old, so no draft yet.',
  viewed_before_last_dm: 'Our last message went out after this view, so no draft.',
}

/** db/298: views that make no draft by rule still show on the person's thread ("viewed · 2d"). A came-back tag wins. */
export function withViewTags(came: Map<string, CameTag>, seen: readonly ViewSeen[], names: ReadonlyMap<string, { prospect_name: string }>, now: number = Date.now()): Map<string, CameTag> {
  const out = new Map(came)
  for (const v of seen) {
    if (out.has(v.prospect_id) || !v.viewed_at) continue
    const days = Math.max(0, Math.floor((now - Date.parse(v.viewed_at)) / DAY))
    out.set(v.prospect_id, {
      pid: v.prospect_id, name: names.get(v.prospect_id)?.prospect_name ?? '', viewOnly: true,
      text: `viewed · ${Number.isNaN(days) ? '?' : days === 0 ? 'today' : `${days}d`}`,
      title: `Viewed the profile ${new Date(v.viewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. ${VIEW_WHY[v.kind] ?? ''}`.trim(),
    })
  }
  return out
}

/** The seat a warm card belongs to. Only a MISSING tenant (pre-298 rows) means Ivan; an unknown seat shows nowhere. */
export function warmSeat(w: Pick<WarmCard, 'tenant'>): Seat | null {
  return w.tenant == null || w.tenant === '' ? 'ivan' : seatOf(w.tenant)
}

const WARM_WORD: Record<string, string> = {
  profile_view: 'viewed your profile', commented_own_post: 'commented on your post', reacted_two_posts: 'engaged two posts',
}

export function warmWord(w: Pick<WarmCard, 'signal_source' | 'trigger_type'> & Partial<Pick<WarmCard, 'signal_kind' | 'tenant'>>): string {
  if (w.signal_kind === 'next_touch') return 'viewed, no reply yet'
  if (w.signal_kind === 'dm1_pull') return 'viewed, accepted'
  if (warmGroup(w) === 'profile_view' && w.tenant && w.tenant !== 'ivan') return 'viewed the profile'
  return WARM_WORD[warmGroup(w)] ?? 'engaged a post'
}

export type SignalItem =
  | { kind: 'warm'; pid: string; label: string; w: WarmCard }
  | { kind: 'agent'; pid: string; label: string; a: ConversationAgentCard }
  | { kind: 'came'; pid: string; label: string; c: CameBackCard; t: Thread | null }

/** One seat's Signals. Warm cards by their tenant (no tenant = Ivan, pre-298 rows); agent cards are Ivan's seat only;
 *  a came-back person joins only while they have no conversation (a conversation carries the tag). */
export function signalItems(seat: Seat, warm: readonly WarmCard[], agentOnly: readonly ConversationAgentCard[],
  came: readonly CameBackCard[], byId: ReadonlyMap<string, Thread>): SignalItem[] {
  const out: SignalItem[] = []
  const seen = new Set<string>()
  for (const w of warm) {
    if (warmSeat(w) !== seat) continue
    out.push({ kind: 'warm', pid: w.prospect_id, label: warmWord(w), w }); seen.add(w.prospect_id)
  }
  if (seat === 'ivan') {
    for (const a of agentOnly) { out.push({ kind: 'agent', pid: a.prospect_id, label: 'agent conversation', a }); seen.add(a.prospect_id) }
  }
  for (const c of came) {
    if ((c.tenant as string) !== seat || seen.has(c.prospect_id)) continue
    const t = byId.get(c.prospect_id) ?? null
    if (t && isConversation(t) && !t.spam) continue
    out.push({ kind: 'came', pid: c.prospect_id, label: interestLabel(c), c, t })
  }
  return out
}
