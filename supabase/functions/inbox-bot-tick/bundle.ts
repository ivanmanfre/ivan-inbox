// bundle.ts - the pure half of inbox-bot-tick: which feed rows a tick reads and
// what the bot is handed as its prompt.
//
// Split out from index.ts so a unit test can pin the selection and the clipping
// without a database. Nothing here touches the network, the clock, or Deno.
//
// Two rules live here and nowhere else:
//   1. A row whose group_key points at a bot turn that is STILL OPEN is not
//      selectable. A slow turn already read it; re-selecting it would be the
//      same row told twice. A row whose turn ended (done, error, aborted) IS
//      selectable again, which is how an errored turn's rows come back.
//   2. Only the rows that fit in the bundle are returned as included, because
//      only those get stamped, and stamping a row the model never read is a lie
//      the feed cannot undo (decision D4).

/** Families the bot never reads. A live conversation and a turn receipt are not
 *  events, and a health reminder is personal, not work. */
export const MUTED_FAMILIES = ['chat', 'claude_turn', 'health_reminder'] as const

/** The broker caps a prompt at 12,000 chars. The bundle stays under this so the
 *  header and the last-answer tail always fit inside it. */
export const BUNDLE_MAX_CHARS = 10_000

/** Room kept for the header line and the "what I said last time" tail. */
const TAIL_RESERVE_CHARS = 600

/** A row body longer than this is wallpaper in a bundle of 200. */
const BODY_CLIP_CHARS = 240

/** The last answer's head, so the bot does not repeat itself. */
export const LAST_HEAD_CHARS = 300

export interface FeedRow {
  id: string
  family: string
  severity?: string | null
  tenant?: string | null
  count?: number | null
  title: string
  body?: string | null
  url?: string | null
  group_key?: string | null
  created_at: string
}

export interface Bundle {
  text: string
  /** Ids of the rows that made it into the text. These, and only these, get stamped. */
  included: string[]
}

/**
 * The rows this tick may read, oldest first.
 *
 * `openBotTurnIds` is the set of bot turns still queued or running. The SQL
 * select already drops read, dismissed and muted rows; the family filter is
 * repeated here so the rule has one definition a test can reach.
 */
export function selectRows(rows: FeedRow[], openBotTurnIds: Iterable<string>): FeedRow[] {
  const open = new Set(openBotTurnIds)
  const muted = new Set<string>(MUTED_FAMILIES)
  return rows
    .filter((r) => {
      if (muted.has(r.family)) return false
      const gk = r.group_key ?? ''
      if (gk.startsWith('bot:') && open.has(gk.slice(4))) return false
      return true
    })
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
}

/** One feed row as one line the bot reads. */
export function renderRow(r: FeedRow): string {
  const tenant = (r.tenant ?? '').trim() || 'ivan'
  const severity = (r.severity ?? '').trim() || 'info'
  const count = typeof r.count === 'number' && r.count > 0 ? r.count : 1
  const head = `[${r.family} · ${severity} · ${tenant} · ${count}x]`
  const body = (r.body ?? '').replace(/\s+/g, ' ').trim().slice(0, BODY_CLIP_CHARS)
  const url = (r.url ?? '').trim()
  return `${head} ${r.title.trim()}${body ? ` : ${body}` : ''}${url ? ` (${url})` : ''}`
}

/**
 * The prompt: the rows the bot has not seen, oldest first, plus the head of what
 * it said last time so it does not restate a row it already folded.
 *
 * Rows are added until the text would pass BUNDLE_MAX_CHARS; the rest stay
 * unread and ride the next tick.
 */
export function buildBundle(rows: FeedRow[], lastHead: string | null): Bundle {
  const budget = BUNDLE_MAX_CHARS - TAIL_RESERVE_CHARS
  const lines: string[] = []
  const included: string[] = []
  let used = 0
  for (const r of rows) {
    const line = renderRow(r)
    if (used + line.length + 1 > budget) break
    lines.push(line)
    included.push(r.id)
    used += line.length + 1
  }

  const head = `Feed rows since my last message (${included.length} rows, oldest first):`
  const last = (lastHead ?? '').trim().slice(0, LAST_HEAD_CHARS)
  const tail = `\n\nWhat I said last time (first ${LAST_HEAD_CHARS} chars):\n${last || '(nothing yet)'}`
  const text = `${head}\n${lines.join('\n')}${tail}`
  return { text, included }
}
