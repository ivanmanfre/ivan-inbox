// Signals (Ivan 09-27): "then he came back with no reply... flag this as a signal from the name" and
// "warm signals... should be part of signals overall". Two pure maps:
//   · cameTag: a came-back card -> the quiet "came back · 2d" tag shown beside the person's name
//     wherever a thread of theirs is listed (and in the thread head), its tooltip what they came
//     back to (today's card line).
//   · signalItems: ONE Signals list per seat holding every pre-reply interest signal: today's warm
//     cards (Ivan's seat), agent-only conversations, and came-back people who have no conversation
//     yet (they would be lost otherwise). Each labelled by kind in words.
import { isConversation, type Thread } from '../../lib/inbox'
import { cameBackLine, firstComment, interestLabel, sentLine, type CameBackCard } from '../../wb/dms/cameBackData'
import type { ConversationAgentCard } from '../../wb/dms/conversationAgentData'
import { warmGroup, type WarmCard } from '../../wb/dms/warmSignalsData'
import type { Seat } from '../seats'

const DAY = 86_400_000

export type CameTag = { pid: string; name: string; text: string; title: string }

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

const WARM_WORD: Record<string, string> = {
  profile_view: 'viewed your profile', commented_own_post: 'commented on your post', reacted_two_posts: 'engaged two posts',
}

export function warmWord(w: Pick<WarmCard, 'signal_source' | 'trigger_type'>): string {
  return WARM_WORD[warmGroup(w)] ?? 'engaged a post'
}

export type SignalItem =
  | { kind: 'warm'; pid: string; label: string; w: WarmCard }
  | { kind: 'agent'; pid: string; label: string; a: ConversationAgentCard }
  | { kind: 'came'; pid: string; label: string; c: CameBackCard; t: Thread | null }

/** One seat's Signals. Warm and agent cards are Ivan's seat only (today's reads are his lane);
 *  a came-back person joins only while they have no conversation (a conversation carries the tag). */
export function signalItems(seat: Seat, warm: readonly WarmCard[], agentOnly: readonly ConversationAgentCard[],
  came: readonly CameBackCard[], byId: ReadonlyMap<string, Thread>): SignalItem[] {
  const out: SignalItem[] = []
  const seen = new Set<string>()
  if (seat === 'ivan') {
    for (const w of warm) { out.push({ kind: 'warm', pid: w.prospect_id, label: warmWord(w), w }); seen.add(w.prospect_id) }
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
