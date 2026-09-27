/* ==========================================================================
   OUTLIERS — Strategy > Outliers, one read for LinkedIn + X per client.

   `operator_outliers(p_gate, p_client, p_platform, p_week)` returns the
   current study's 3x outliers per platform: lift over the author's own
   median, the recipe traits the post carries, the share of its commenters
   judged ICP 7+ where scraped, and whether it is already an idea. The view
   reads it once per lane (platform 'all', week null) and filters/sorts here.

   `operator_outlier_use(p_gate, p_client, p_platform, p_post_id)` turns one
   outlier into a not-yet-approved idea on that client's board. Idempotent
   server-side: a second tap returns the same idea.

   RPC only, never the tables. Correlation only on screen: the buyer figure
   reads as who commented, never as something the post did.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'

export type OutlierPlatform = 'linkedin' | 'x'
export type OutlierTrait = { key: string; words: string; weight: number }
export type OutlierBuyer = { judged: number; icp7: number; share: number; excluded?: number; state: 'read' | 'too_few' }
export type OutlierIdea = { id: string; status?: string; table?: string }

export type OutlierRow = {
  platform: OutlierPlatform
  post_id: string
  author: string
  author_key?: string
  author_url?: string
  text: string | null
  url: string | null
  published_at: string
  week: string
  lift: number
  baseline: number
  baseline_n: number
  score?: number
  likes: number | null
  reposts: number | null
  comments: number | null
  views: number | null
  is_5x?: boolean
  labels: Record<string, string> | null
  personal: boolean
  traits: OutlierTrait[]
  traits_note: string | null
  buyer: OutlierBuyer | null
  idea: OutlierIdea | null
}

export type OutlierStudyInfo = { study_id: string; as_of: string; scored: number; outliers: number; authors: number }

export type OutliersPayload = {
  client: string
  studies: { linkedin: OutlierStudyInfo | null; x: OutlierStudyInfo | null }
  weeks: { week: string; n: number }[]
  rows: OutlierRow[]
}

export type OutliersRead =
  | { kind: 'ready'; data: OutliersPayload }
  | { kind: 'failed'; message: string }

export type PlatformFilter = 'all' | OutlierPlatform
export type OutlierSort = 'lift' | 'buyer'
export const ALL_WEEKS = 'all'

/** Shape-guard one payload: anything that is not the RPC's shape is a failed read, never an empty one. */
export function parseOutliers(data: unknown): OutliersRead {
  const d = (data ?? null) as (Partial<OutliersPayload> & { ok?: boolean }) | null
  if (!d || typeof d !== 'object' || !Array.isArray(d.rows)) {
    return { kind: 'failed', message: 'The outlier read returned no usable payload.' }
  }
  const rows = d.rows.filter(r => r && (r.platform === 'linkedin' || r.platform === 'x') && r.post_id)
    .map(r => ({ ...r, traits: Array.isArray(r.traits) ? r.traits : [] }))
  const studies = d.studies ?? { linkedin: null, x: null }
  return {
    kind: 'ready',
    data: {
      client: String(d.client ?? ''),
      studies: { linkedin: studies.linkedin ?? null, x: studies.x ?? null },
      weeks: Array.isArray(d.weeks) ? d.weeks.filter(w => w && typeof w.week === 'string') : [],
      rows,
    },
  }
}

export async function fetchOutliers(lane: string): Promise<OutliersRead> {
  const { data, error } = await supabase.rpc('operator_outliers', {
    p_gate: CLIENT_OPS_GATE, p_client: lane, p_platform: 'all', p_week: null,
  })
  if (error) return { kind: 'failed', message: error.message || 'The outlier read failed.' }
  return parseOutliers(data)
}

export type UseResult = { ok: true; id: string; created: boolean } | { ok: false; message: string }

/** "Use this": one outlier becomes an idea on the lane's board. Not a React hook. */
export async function putOutlierOnBoard(lane: string, platform: OutlierPlatform, postId: string): Promise<UseResult> {
  const { data, error } = await supabase.rpc('operator_outlier_use', {
    p_gate: CLIENT_OPS_GATE, p_client: lane, p_platform: platform, p_post_id: postId,
  })
  if (error) return { ok: false, message: error.message || 'Could not add it to the board.' }
  const d = (data ?? {}) as { ok?: boolean; id?: string; created?: boolean }
  if (!d.ok || !d.id) return { ok: false, message: 'The board did not confirm the idea.' }
  return { ok: true, id: String(d.id), created: !!d.created }
}

/* ------------------------------------------------------------ pure pieces */

export const rowKey = (r: Pick<OutlierRow, 'platform' | 'post_id'>) => `${r.platform}:${r.post_id}`

export function filterRows(rows: OutlierRow[], platform: PlatformFilter, week: string): OutlierRow[] {
  return rows.filter(r => (platform === 'all' || r.platform === platform) && (week === ALL_WEEKS || r.week === week))
}

/** Buyer share where it was read; everything else (too few, not scraped) sorts last. */
export function buyerKey(r: OutlierRow): number {
  return r.buyer && r.buyer.state === 'read' && Number.isFinite(Number(r.buyer.share)) ? Number(r.buyer.share) : -1
}

export function sortRows(rows: OutlierRow[], sort: OutlierSort): OutlierRow[] {
  const lift = (r: OutlierRow) => Number(r.lift) || 0
  return [...rows].sort((a, b) => sort === 'buyer'
    ? (buyerKey(b) - buyerKey(a)) || (lift(b) - lift(a))
    : (lift(b) - lift(a)) || (buyerKey(b) - buyerKey(a)))
}

/** Newest week first; the chosen sort inside each week. */
export function groupByWeek(rows: OutlierRow[], sort: OutlierSort): [string, OutlierRow[]][] {
  const m = new Map<string, OutlierRow[]>()
  for (const r of rows) {
    const list = m.get(r.week)
    if (list) list.push(r)
    else m.set(r.week, [r])
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)).map(([w, xs]) => [w, sortRows(xs, sort)])
}

/** The weeks the RPC lists, newest first, counted for the platform in view. */
export function weekOptions(p: OutliersPayload, platform: PlatformFilter): { week: string; n: number }[] {
  const weeks = [...new Set([...p.weeks.map(w => w.week), ...p.rows.map(r => r.week)])].sort().reverse()
  return weeks.map(week => ({ week, n: p.rows.filter(r => r.week === week && (platform === 'all' || r.platform === platform)).length }))
}

export function platformCounts(rows: OutlierRow[], week: string): Record<PlatformFilter, number> {
  const inWeek = rows.filter(r => week === ALL_WEEKS || r.week === week)
  return { all: inWeek.length, linkedin: inWeek.filter(r => r.platform === 'linkedin').length, x: inWeek.filter(r => r.platform === 'x').length }
}

export type BuyerLabel =
  | { kind: 'read'; share: number; line: string; icp: number; n: number }
  | { kind: 'few'; line: string; n: number }
  | { kind: 'none'; line: string }

/** Who commented, as a share of commenters. Never a claim about what the post did. */
export function buyerLabel(r: Pick<OutlierRow, 'buyer' | 'platform'>): BuyerLabel {
  const b = r.buyer
  if (!b) return { kind: 'none', line: r.platform === 'x' ? 'Commenters not read on X yet' : 'Commenters not read yet' }
  const n = Math.round(Number(b.judged) || 0)
  if (b.state === 'too_few' || n < 5) return { kind: 'few', line: 'Too few to read', n }
  const share = Math.max(0, Math.min(1, Number(b.share) || 0))
  return { kind: 'read', share, line: `${Math.round(share * 100)}% ICP 7+`, icp: Math.round(Number(b.icp7) || 0), n }
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dayText(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? '' : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`
}
export const weekLabel = (w: string) => (w === ALL_WEEKS ? 'All recent' : `Week of ${dayText(w)}`)
/** The same week inside a sentence: "week of Sep 21" (the month keeps its capital). */
export const weekPhrase = (w: string) => (w === ALL_WEEKS ? 'all recent weeks' : `week of ${dayText(w)}`)
export const numText = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString('en-US')
export function liftText(n: number): string {
  const v = Number(n) || 0
  return v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(0) : v.toFixed(1)
}

/** The title's cap in characters: about two lines at the card's title size. */
export const HEAD_MAX = 100

/** Cut an over-long first line at a sentence end (or, failing that, a word) at or
    under HEAD_MAX. Returns [head, rest]; the rest is never dropped. */
export function capHead(line: string, max = HEAD_MAX): [string, string] {
  if (line.length <= max) return [line, '']
  const win = line.slice(0, max + 1)
  let cut = -1
  for (const m of win.matchAll(/[.!?:](?=\s)/g)) if (m.index! + 1 >= 40) cut = m.index! + 1
  if (cut > 0) return [line.slice(0, cut).trim(), line.slice(cut).trim()]
  const sp = win.lastIndexOf(' ')
  if (sp >= 40) return [`${line.slice(0, sp).trim()}…`, `…${line.slice(sp).trim()}`]
  return [`${line.slice(0, max).trim()}…`, `…${line.slice(max).trim()}`]
}

/** First line as the title (how the post read in the feed), the rest as the body.
    A first line past HEAD_MAX is cut, and what is cut off leads the body. */
export function splitText(text: string | null | undefined): [string, string] {
  const t = String(text ?? '').replace(/\r/g, '').trim()
  const i = t.indexOf('\n')
  const [line, body] = i < 0 ? [t, ''] : [t.slice(0, i).trim(), t.slice(i + 1).trim()]
  const [head, rest] = capHead(line)
  return [head, rest && body ? `${rest}\n${body}` : rest || body]
}

/** A failed "Use this", in one short plain line: the RPC's own reason, capped. */
export function boardFailText(message: string | null | undefined): string {
  const m = String(message ?? '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
  if (!m) return 'Did not reach the board.'
  const short = m.length > 100 ? `${m.slice(0, 100).replace(/\s+\S*$/, '')}…` : `${m}.`
  return `Did not reach the board: ${short}`
}

/** A body is clamped when it is long or has more lines than the clamp shows. */
export const needsClamp = (body: string) => body.length > 180 || body.split('\n').length > 4

export function freshnessLines(p: OutliersPayload): { platform: string; line: string }[] {
  const li = p.studies.linkedin
  const x = p.studies.x
  return [
    { platform: 'LinkedIn', line: li ? `read ${dayText(li.as_of)}, ${numText(li.scored)} posts from ${numText(li.authors)} authors` : 'not read yet' },
    { platform: 'X', line: x ? `read ${dayText(x.as_of)}, ${numText(x.scored)} posts from ${numText(x.authors)} authors` : 'arrives with the first weekly run' },
  ]
}

/** Our own wording of the rule (the RPC's sentence is not rendered verbatim). */
export const OUTLIER_RULE = "An outlier is a post that scored at least 3x its author's own median (likes + 3 x reposts, over up to 60 earlier posts) with 40+ likes. Who commented is the share of its commenters judged ICP 7+ of 10: it describes the people in the comments, nothing more."
export const TRAIT_RULE = "Traits come from this client's recipe. A filled trait is one the recipe reads as leaning outlier; an outlined one leans against."
