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
  return [...known, ...other].map(k => ({ key: k, label: LABEL[k] ?? k, cards: orderLane(by.get(k)!) }))
}

/** 'Ivan' | 'Rise' | 'Arch', or the raw id for any other client. */
export function laneLabel(clientId: string | null | undefined): string {
  const k = laneKeyOf(clientId)
  return LABEL[k] ?? k
}

/**
 * Inside a lane: escalations first (Mattan answers those by hand), then
 * newsjacks by time left, soonest first, then everything else in the order it
 * came. Stable, so equal cards keep their arrival order. A newsjack with no
 * expiry sorts after the ones that have one.
 */
export function orderLane(cards: OpsDraft[]): OpsDraft[] {
  const rank = (d: OpsDraft) => d.kind === 'escalation' ? 0 : d.kind === 'newsjack' ? 1 : 2
  const exp = (d: OpsDraft) => {
    const t = new Date(d.context?.expires_at ?? '').getTime()
    return Number.isFinite(t) ? t : Infinity
  }
  return cards
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d)
      || (rank(a.d) === 1 ? exp(a.d) - exp(b.d) : 0)
      || a.i - b.i)
    .map(x => x.d)
}

/**
 * The board's first line, the same number the Ops icon shows:
 * "7 waiting on you: 3 comment replies, 3 comments for today, 1 newsjack."
 * `items` is everything counted (cards and pending tasks, minus the comment
 * ideas that wait for later). Null when nothing waits.
 */
export function answerLine(items: OpsDraft[]): string | null {
  if (items.length === 0) return null
  return `${items.length} waiting on you: ${kindsLine(items, true)}.`
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
export function kindsLine(cards: OpsDraft[], forToday = false): string {
  const counts = new Map<OpsKind, number>()
  for (const d of cards) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const words = ranked.slice(0, KINDS_SHOWN).map(([k, n]) => {
    const [one, many] = KIND_WORDS[k] ?? [k, k]
    const tail = forToday && k === 'comment_outbound' ? ' for today' : ''
    return `${n} ${n === 1 ? one : many}${tail}`
  })
  const rest = ranked.length - KINDS_SHOWN
  if (rest > 0) words.push(`and ${rest} more ${rest === 1 ? 'kind' : 'kinds'}`)
  return words.join(', ')
}

export type QuickBatch = {
  key: string
  kind: 'manual_invite' | 'comment_outbound'
  client: string
  cards: OpsDraft[]
  /** "3 comments · Ivan" */
  label: string
}

const BATCH_NOUN: Record<QuickBatch['kind'], [string, string]> = {
  manual_invite: ['invite', 'invites'], comment_outbound: ['comment', 'comments'],
}

/**
 * The quick batch that moved from Today to the top of Ops: two or more
 * batchable cards of one kind in one lane (focus.ts `isBatchable`: manual
 * invites, and Ivan-lane comments that go through the poster's gate). Built
 * from the cards the board counts for today, so a batch can never approve a
 * comment idea that waits for later. Lanes in board order.
 */
export function quickBatches(cards: OpsDraft[], batchable: (d: OpsDraft) => boolean): QuickBatch[] {
  const out: QuickBatch[] = []
  for (const lane of groupOpsByLane(cards.filter(batchable))) {
    for (const kind of ['comment_outbound', 'manual_invite'] as const) {
      const list = lane.cards.filter(d => d.kind === kind)
      if (list.length < 2) continue
      const [one, many] = BATCH_NOUN[kind]
      out.push({ key: `${kind}:${lane.key}`, kind, client: lane.key, cards: list, label: `${list.length} ${list.length === 1 ? one : many} · ${lane.label}` })
    }
  }
  return out
}
