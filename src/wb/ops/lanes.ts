/* ==========================================================================
   src/wb/ops/lanes.ts - the Ops board, by client lane.

   Ivan, 2026-09-26: "make sure ops are separated by client lane and start
   collapsed". The lane is the card's own `client_id`, nothing inferred: Ivan
   ('ivan' or empty), Rise ('risedtc'), Arch ('arch'), in that order, then any
   other client under its own id. A lane with nothing waiting is not drawn.
   Pure, so the grouping is a unit test rather than a screenshot.
   ========================================================================== */
import type { OpsDraft, OpsKind } from '../../lib/ops'

export type OpsLane = {
  /** 'ivan' | 'risedtc' | 'arch' | any other client id. */
  key: string
  label: string
  cards: OpsDraft[]
}

const ORDER = ['ivan', 'risedtc', 'arch'] as const
const LABEL: Record<string, string> = { ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' }

/** Ivan's rows carry 'ivan', and older ones carry nothing at all. */
export function laneKeyOf(clientId: string | null | undefined): string {
  const id = (clientId ?? '').trim()
  return id === '' ? 'ivan' : id
}

/** Lanes in the fixed order, each holding its cards in the order they came. */
export function groupOpsByLane(cards: OpsDraft[]): OpsLane[] {
  const by = new Map<string, OpsDraft[]>()
  for (const d of cards) {
    const k = laneKeyOf(d.client_id)
    const list = by.get(k)
    if (list) list.push(d)
    else by.set(k, [d])
  }
  const known = ORDER.filter(k => by.has(k))
  const other = [...by.keys()].filter(k => !(ORDER as readonly string[]).includes(k)).sort()
  return [...known, ...other].map(k => ({ key: k, label: LABEL[k] ?? k, cards: by.get(k)! }))
}

// Plain words for the closed header. Singular, plural.
const KIND_WORDS: Record<OpsKind, [string, string]> = {
  escalation: ['escalation', 'escalations'],
  update: ['update', 'updates'],
  newsjack: ['newsjack', 'newsjacks'],
  weekly_report: ['weekly report', 'weekly reports'],
  comment_reply: ['comment reply', 'comment replies'],
  comment_outbound: ['comment', 'comments'],
  booking: ['booking', 'bookings'],
  precall_email: ['pre-call email', 'pre-call emails'],
  manual_invite: ['invite', 'invites'],
  task: ['task', 'tasks'],
  leads_ballot: ['leads ballot', 'leads ballots'],
  audn_recommendation: ['audience proposal', 'audience proposals'],
  conversation_takeover: ['takeover', 'takeovers'],
}

/** At most this many kinds are spelled out; the rest are counted. */
const KINDS_SHOWN = 3

/**
 * "3 comment replies, 1 newsjack". Biggest first, ties in the order the cards
 * came. Past three kinds the line stays short: "... and 2 more kinds".
 */
export function kindsLine(cards: OpsDraft[]): string {
  const counts = new Map<OpsKind, number>()
  for (const d of cards) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const words = ranked.slice(0, KINDS_SHOWN).map(([k, n]) => {
    const [one, many] = KIND_WORDS[k] ?? [k, k]
    return `${n} ${n === 1 ? one : many}`
  })
  const rest = ranked.length - KINDS_SHOWN
  if (rest > 0) words.push(`and ${rest} more ${rest === 1 ? 'kind' : 'kinds'}`)
  return words.join(', ')
}
