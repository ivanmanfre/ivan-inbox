/* ==========================================================================
   CB-22: Content > Inputs read + the "Content brain · Outlier" source badge.

   `cb22_inputs(p_gate, p_client)` returns, for one client: the top outliers of
   the last 21 days (<= 5, ranked: in review, recommended, then the strategy-fit
   judge, then lift) and the buyer-fit people (ICP 7+) who engaged with the
   client's own posts in the last 7 days. Correlation only: an engager is who
   reacted or commented, never what a post caused.

   The badge is drawn from source_ref ONLY: `outlier:<platform>:<id>` (a "Use
   this" tap, or the weekly promotion, which stamps promoted_by 'cb22'; `cb22:`
   is read defensively). Any other source gets no badge.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'

export type InputsState = 'in_review' | 'recommended' | 'decided' | null
export type InputsSource = 'outlier' | 'steady' | 'search'
export type InputsSeller = { seller: 'true' | 'false' | 'unclear'; sells: string | null; reason: string }
export type InputsOutlier = {
  rank: number; platform: 'linkedin' | 'x'; post_id: string; author: string; author_url: string | null; url: string | null
  text: string; published_at: string | null; lift: number | null; likes: number | null; comments: number | null; views: number | null
  is_5x: boolean; fit: number | null; purpose: string | null; lane: string | null; reason: string | null
  state: InputsState; idea: { id: string; status?: string; table?: string; source_ref?: string } | null
  // CB-27 (risedtc / arch only; absent for Ivan): where the row came from, the seller check, a calendar hint, a likes line
  sources?: InputsSource[]; seller?: InputsSeller | null; calendar_note?: string | null; likes_line?: number | null
}
export type InputsBuyer = {
  name: string; headline: string | null; icp: number; why: string | null; url: string | null
  posts: number; commented: boolean; last_seen: string | null; post_title: string | null
}
export type InputsPayload = {
  client: string; week_start: string; top: InputsOutlier[]; buyers: InputsBuyer[]
  counts: { window: number; recommended: number; in_review: number; judged: number; on_strategy?: number; outliers: number; buyers: number; search?: number; steady?: number; seller?: number }
  last_run: { run_key: string; finished_at: string | null } | null
  rule: string
}
export type InputsRead = { kind: 'ready'; data: InputsPayload } | { kind: 'failed'; message: string }

const num = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null }
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export function parseInputs(data: unknown): InputsRead {
  const d = data as Record<string, unknown> | null
  if (!d || d.ok !== true || !Array.isArray(d.top) || !Array.isArray(d.buyers)) return { kind: 'failed', message: 'The inputs read came back in a shape this app does not know.' }
  const top: InputsOutlier[] = []
  for (const x of d.top as Record<string, unknown>[]) {
    const platform = x.platform === 'x' ? 'x' : x.platform === 'linkedin' ? 'linkedin' : null
    const lift = num(x.lift)
    const sources = Array.isArray(x.sources) ? (x.sources as unknown[]).filter((v): v is InputsSource => v === 'outlier' || v === 'steady' || v === 'search') : null
    // a pure search row has no lift (null); every other row still needs one
    const liftless = lift === null && sources !== null && sources.length > 0 && !sources.includes('outlier')
    if (!platform || typeof x.post_id !== 'string' || (lift === null && !liftless)) continue
    const sl = x.seller && typeof x.seller === 'object' ? x.seller as Record<string, unknown> : null
    const seller: InputsSeller | null = sl && (sl.seller === 'true' || sl.seller === 'false' || sl.seller === 'unclear') ? { seller: sl.seller, sells: str(sl.sells), reason: typeof sl.reason === 'string' ? sl.reason : '' } : null
    const idea = x.idea && typeof x.idea === 'object' ? (x.idea as InputsOutlier['idea']) : null
    top.push({
      rank: num(x.rank) ?? top.length + 1, platform, post_id: x.post_id, author: str(x.author) ?? 'Unknown author', author_url: str(x.author_url),
      url: str(x.url), text: typeof x.text === 'string' ? x.text : '', published_at: str(x.published_at), lift,
      likes: num(x.likes), comments: num(x.comments), views: num(x.views), is_5x: x.is_5x === true,
      fit: num(x.fit), purpose: str(x.purpose), lane: str(x.lane), reason: str(x.reason),
      state: x.state === 'in_review' || x.state === 'recommended' || x.state === 'decided' ? x.state : null, idea,
      ...(sources ? { sources } : {}), ...(seller ? { seller } : {}),
      ...(str(x.calendar_note) ? { calendar_note: str(x.calendar_note) } : {}), ...(num(x.likes_line) !== null ? { likes_line: num(x.likes_line) } : {}),
    })
  }
  const buyers: InputsBuyer[] = []
  for (const b of d.buyers as Record<string, unknown>[]) {
    const icp = num(b.icp)
    if (!str(b.name) || icp === null) continue
    buyers.push({ name: str(b.name) as string, headline: str(b.headline), icp, why: str(b.why), url: str(b.url), posts: num(b.posts) ?? 1,
      commented: b.commented === true, last_seen: str(b.last_seen), post_title: str(b.post_title) })
  }
  const c = (d.counts ?? {}) as Record<string, unknown>
  const lr = d.last_run && typeof d.last_run === 'object' ? d.last_run as Record<string, unknown> : null
  return { kind: 'ready', data: {
    client: String(d.client ?? ''), week_start: String(d.week_start ?? ''), top, buyers,
    counts: { window: num(c.window) ?? 0, recommended: num(c.recommended) ?? 0, in_review: num(c.in_review) ?? 0, judged: num(c.judged) ?? 0,
      on_strategy: num(c.on_strategy) ?? undefined, outliers: num(c.outliers) ?? 0, buyers: num(c.buyers) ?? buyers.length,
      ...(num(c.search) !== null ? { search: num(c.search) as number } : {}), ...(num(c.steady) !== null ? { steady: num(c.steady) as number } : {}), ...(num(c.seller) !== null ? { seller: num(c.seller) as number } : {}) },
    last_run: lr && typeof lr.run_key === 'string' ? { run_key: lr.run_key, finished_at: str(lr.finished_at) } : null,
    rule: str(d.rule) ?? '',
  } }
}

export async function fetchInputs(lane: string): Promise<InputsRead> {
  const { data, error } = await supabase.rpc('cb22_inputs', { p_gate: CLIENT_OPS_GATE, p_client: lane })
  if (error) return { kind: 'failed', message: error.message }
  return parseInputs(data)
}

/** The seat switch's per-client counts: ONE light call (`p_client: 'counts'`), so a page load needs one heavy read, not three. A missing lane is absent. */
export type InputsCounts = Partial<Record<string, { in_review: number; recommended: number }>>

export async function fetchInputsCounts(): Promise<InputsCounts | null> {
  const { data, error } = await supabase.rpc('cb22_inputs', { p_gate: CLIENT_OPS_GATE, p_client: 'counts' })
  const d = data as Record<string, unknown> | null
  if (error || !d || d.ok !== true || !d.counts || typeof d.counts !== 'object') return null
  const out: InputsCounts = {}
  for (const [lane, v] of Object.entries(d.counts as Record<string, unknown>)) {
    const c = v && typeof v === 'object' ? v as Record<string, unknown> : null
    const in_review = c ? num(c.in_review) : null, recommended = c ? num(c.recommended) : null
    if (in_review !== null && recommended !== null) out[lane] = { in_review, recommended }
  }
  return out
}

/* ---------------------------------------------------------------- badge -- */

export type OutlierSource = {
  kind: 'use_this' | 'promoted'
  platform: 'linkedin' | 'x'
  postId: string
  author: string | null
  lift: number | null
  url: string
}

export function postUrl(platform: 'linkedin' | 'x', postId: string): string {
  return platform === 'x' ? `https://x.com/i/status/${postId}` : `https://www.linkedin.com/feed/update/urn:li:activity:${postId}/`
}

/** The badge's facts from one idea row. null = not an outlier idea (no badge). */
export function outlierSource(sourceRef: string | null | undefined, facts: { evidence?: unknown; breakdown?: Record<string, unknown> | null }): OutlierSource | null {
  const m = /^(outlier|cb22):(linkedin|x):([0-9]+)$/.exec(sourceRef ?? '')
  if (!m) return null
  const platform = m[2] as 'linkedin' | 'x'
  const ev = Array.isArray(facts.evidence) && facts.evidence[0] && typeof facts.evidence[0] === 'object' ? facts.evidence[0] as Record<string, unknown> : null
  const bd = facts.breakdown ?? null
  const author = str(ev?.author) ?? str(ev?.who) ?? str(bd?.source_author)
  const lift = num(ev?.lift) ?? num(bd?.lift)
  const url = str(ev?.url)
  // The weekly promotion writes the same outlier:* ref as a Use this tap (one post, one idea); it stamps promoted_by = 'cb22'.
  const promoted = m[1] === 'cb22' || ev?.promoted_by === 'cb22' || bd?.promoted_by === 'cb22'
  return { kind: promoted ? 'promoted' : 'use_this', platform, postId: m[3], author, lift, url: url && /^https:\/\//.test(url) ? url : postUrl(platform, m[3]) }
}
