import { supabase } from './supabase'
import { LANE_SHORT, localDay, type ContentLane } from './content'

// ---------------------------------------------------------------------------
// THE CONTENT VERDICT LINE (rebuild, blueprint v3 "Everything Content carries").
//
// One sentence on top of Posts: when Ivan's next post goes out, how far each
// client's board is covered, and whether the publisher has stopped anything.
// Every date is read with the rule the publisher itself uses, never by status
// alone (check2-content row 60):
//   · Ivan: his drafts at `scheduled` with a future time, plus pending rows in
//     the publish queue (scheduled_posts has no client column, so it is his).
//   · a client: a board-visible, unpublished row at review or scheduled with a
//     date (clientScheduleArmed). That is what RISE's and ARCH's publishers pick.
// A board with fewer than 3 days scheduled turns red.
// ---------------------------------------------------------------------------

export type VerdictDraft = {
  client_id: string | null
  status: string
  board_visible: boolean | null
  scheduled_at: string | null
  published_at: string | null
}
export type VerdictQueue = {
  status: string
  scheduled_at: string | null
  posted_at: string | null
  error_message: string | null
}

export type LaneCover = { lane: ContentLane; next: string | null; last: string | null; days: number; low: boolean }
export type Verdict = {
  ivan: LaneCover
  clients: LaneCover[]
  blocked: { n: number; since: string | null; lint: boolean }
}

/** Fewer scheduled days than this on a board paints it red. */
export const LOW_COVER_DAYS = 3

const QUEUE_LIVE = new Set(['pending', 'queued_v2'])
const QUEUE_STOPPED = new Set(['blocked', 'failed'])

function cover(lane: ContentLane, dates: string[]): LaneCover {
  const sorted = [...dates].sort((a, b) => Date.parse(a) - Date.parse(b))
  const days = new Set(sorted.map(d => localDay(new Date(d)))).size
  return { lane, next: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null, days, low: days < LOW_COVER_DAYS }
}

export function buildVerdict(
  drafts: VerdictDraft[], queue: VerdictQueue[],
  clients: ContentLane[] = ['risedtc', 'arch'], now: number = Date.now(),
): Verdict {
  const future = (t: string | null): t is string => !!t && Date.parse(t) >= now
  const ivanDates = [
    ...drafts.filter(d => d.client_id == null && d.status === 'scheduled' && !d.published_at && future(d.scheduled_at))
      .map(d => d.scheduled_at as string),
    ...queue.filter(q => QUEUE_LIVE.has(q.status) && !q.posted_at && future(q.scheduled_at))
      .map(q => q.scheduled_at as string),
  ]
  const clientCovers = clients.map(c => cover(c, drafts
    .filter(d => d.client_id === c && d.board_visible === true && !d.published_at
      && (d.status === 'review' || d.status === 'scheduled') && future(d.scheduled_at))
    .map(d => d.scheduled_at as string)))
  const stopped = queue.filter(q => QUEUE_STOPPED.has(q.status) && !q.posted_at)
  const since = stopped.map(q => q.scheduled_at).filter((t): t is string => !!t)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
  return {
    ivan: cover('ivan', ivanDates),
    clients: clientCovers,
    blocked: {
      n: stopped.length,
      since,
      lint: stopped.length > 0 && stopped.every(q => /^publish_lint_fail\b/i.test(q.error_message ?? '')),
    },
  }
}

export type VerdictPart = { key: string; text: string; tone?: 'urgent'; lane?: ContentLane; errors?: boolean }

const day = (t: string) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const time = (t: string) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const NUM_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const numWord = (n: number) => NUM_WORD[n] ?? String(n)

/** The line, as parts, so a part can be tapped and painted on its own. */
export function verdictParts(v: Verdict, waiting?: number, now: number = Date.now()): VerdictPart[] {
  const out: VerdictPart[] = []
  const n = v.ivan.next
  const today = localDay(new Date(now))
  const tomorrow = localDay(new Date(now + 86_400_000))
  out.push({
    key: 'ivan', lane: 'ivan',
    text: !n ? 'Nothing of yours is scheduled.'
      : localDay(new Date(n)) === today ? `Your next post goes out today at ${time(n)}.`
        : localDay(new Date(n)) === tomorrow ? `Your next post goes out tomorrow at ${time(n)}.`
          : `Nothing of yours is scheduled until ${day(n)}.`,
  })
  for (const c of v.clients) {
    const name = LANE_SHORT[c.lane]
    out.push({
      key: c.lane, lane: c.lane, tone: c.low ? 'urgent' : undefined,
      text: c.days === 0 || !c.last
        ? `${name} has nothing scheduled on the board.`
        : `${name} has ${c.days} day${c.days === 1 ? '' : 's'} on the board, to ${day(c.last)}.`,
    })
  }
  if (v.blocked.n > 0) {
    const who = v.blocked.lint ? 'the lint' : 'the publisher'
    const since = v.blocked.since ? ` since ${day(v.blocked.since)}` : ''
    out.push({
      key: 'blocked', tone: 'urgent', lane: 'ivan', errors: true,
      text: v.blocked.n === 1
        ? `One post has been blocked by ${who}${since}.`
        : `${numWord(v.blocked.n)} posts have been blocked by ${who}${since}.`,
    })
  }
  if (waiting !== undefined && waiting > 0) {
    out.push({ key: 'waiting', text: `${numWord(waiting)} ${waiting === 1 ? 'waits' : 'wait'} on your decision.` })
  }
  return out
}

export async function fetchVerdict(now: number = Date.now()): Promise<Verdict> {
  const iso = new Date(now).toISOString()
  const [d, q] = await Promise.all([
    supabase.from('carousel_drafts')
      .select('client_id, status, board_visible, scheduled_at, published_at')
      .gte('scheduled_at', iso)
      .is('published_at', null)
      .in('status', ['review', 'scheduled'])
      .limit(1000),
    supabase.from('scheduled_posts')
      .select('status, scheduled_at, posted_at, error_message')
      .in('status', ['pending', 'queued_v2', 'blocked', 'failed'])
      .is('posted_at', null)
      .limit(500),
  ])
  if (d.error) throw d.error
  if (q.error) throw q.error
  return buildVerdict((d.data ?? []) as VerdictDraft[], (q.data ?? []) as VerdictQueue[], undefined, now)
}
