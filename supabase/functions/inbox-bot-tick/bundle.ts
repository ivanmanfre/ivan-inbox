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
 *  events, and a health reminder is personal, not work.
 *
 *  `bot` joined the list on 2026-09-12, when an actionable bot message started
 *  writing its own notification row (decision D5). Without it the next tick
 *  would hand the bot its OWN push as a feed row to comment on, and it would
 *  answer itself every 30 minutes forever. */
export const MUTED_FAMILIES = ['chat', 'claude_turn', 'health_reminder', 'bot'] as const

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

/** The parts of a row's line, without the count. A dedupe repeat bumps only the
 *  count, so this is what says whether the bot was already told the same thing. */
function rowParts(r: FeedRow): { tag: string; rest: string } {
  const tenant = (r.tenant ?? '').trim() || 'ivan'
  const severity = (r.severity ?? '').trim() || 'info'
  const body = (r.body ?? '').replace(/\s+/g, ' ').trim().slice(0, BODY_CLIP_CHARS)
  const url = (r.url ?? '').trim()
  return {
    tag: `${r.family} · ${severity} · ${tenant}`,
    rest: `${r.title.trim()}${body ? ` : ${body}` : ''}${url ? ` (${url})` : ''}`,
  }
}

/** One feed row as one line the bot reads. */
export function renderRow(r: FeedRow): string {
  const { tag, rest } = rowParts(r)
  const count = typeof r.count === 'number' && r.count > 0 ? r.count : 1
  return `[${tag} · ${count}x] ${rest}`
}

/** A row's line with the count left out: the key a past prompt is checked against. */
export function toldKey(r: FeedRow): string {
  const { tag, rest } = rowParts(r)
  return `[${tag}] ${rest}`
}

/** How far back a past bot prompt counts as "already told". Same as the
 *  feed's 24h dedupe window: a repeat after that is a new telling anyway. */
export const TOLD_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The keys of every row line in past bot prompts. Only prompts of turns that
 * finished (status done) may be passed in: an errored turn told nobody.
 */
export function toldKeys(prompts: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const p of prompts) {
    for (const line of p.split('\n')) {
      const m = /^\[(.+?) · \d+x\] (.*)$/.exec(line)
      if (m) out.add(`[${m[1]}] ${m[2]}`)
    }
  }
  return out
}

/**
 * Split the selectable rows into the ones the bot has not been told and the
 * repeats it has. A row is a repeat only when the same line (family, severity,
 * tenant, title, clipped body, url) sat in a finished bot prompt: a dedupe
 * repeat whose title, body or severity changed is new. A row that never fitted
 * a bundle was never in a prompt, so it is new too.
 */
export function splitTold(rows: FeedRow[], told: Set<string>): { fresh: FeedRow[]; repeats: FeedRow[] } {
  const fresh: FeedRow[] = []
  const repeats: FeedRow[] = []
  for (const r of rows) (told.has(toldKey(r)) ? repeats : fresh).push(r)
  return { fresh, repeats }
}

/**
 * How many bot turns may have started by `now`, so the daily cap lasts the
 * whole UTC day instead of running out by late morning. One turn per hour on
 * a cap of 24: ceil(cap * (minutes since 00:00 + 30) / 1440), never above the
 * cap. A quiet hour leaves its turn unspent, so a busy hour after it can catch
 * up on consecutive ticks.
 */
export function paceAllowance(cap: number, now: Date): number {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return Math.min(cap, Math.ceil((cap * (minutes + 30)) / 1440))
}

/**
 * The prompt: the rows the bot has not seen, oldest first, then the repeats of
 * rows it already told (count went up), oldest first, plus the head of what it
 * said last time so it does not restate a row it already folded.
 *
 * New rows go first so a backlog of repeats can never push them out of the
 * bundle. Rows are added until the text would pass BUNDLE_MAX_CHARS; the rest
 * stay unread and ride the next tick.
 */
export function buildBundle(rows: FeedRow[], lastHead: string | null, repeats: FeedRow[] = []): Bundle {
  const budget = BUNDLE_MAX_CHARS - TAIL_RESERVE_CHARS
  const lines: string[] = []
  const included: string[] = []
  let used = 0
  let freshIn = 0
  let full = false
  for (const [list, isFresh] of [[rows, true], [repeats, false]] as const) {
    for (const r of list) {
      if (full) break
      const line = renderRow(r)
      if (used + line.length + 1 > budget) { full = true; break }
      lines.push(line)
      included.push(r.id)
      used += line.length + 1
      if (isFresh) freshIn++
    }
  }

  const repeatIn = included.length - freshIn
  const head = repeatIn === 0
    ? `Feed rows since my last message (${included.length} rows, oldest first):`
    : `Feed rows since my last message (${included.length} rows: ${freshIn} new, then ${repeatIn} repeats of rows I already told, oldest first in each):`
  const last = (lastHead ?? '').trim().slice(0, LAST_HEAD_CHARS)
  const tail = `\n\nWhat I said last time (first ${LAST_HEAD_CHARS} chars):\n${last || '(nothing yet)'}`
  const text = `${head}\n${lines.join('\n')}${tail}`
  return { text, included }
}
