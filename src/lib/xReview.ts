import { supabase } from './supabase'

// X REVIEW (2026-10-11). X Articles and their reaction-GIF quote posts wait here for Ivan's
// read. The RPCs live in Supabase (x_review_list / x_article_save / x_article_decide /
// x_quote_save / x_quote_decide). Publish and Post go live on @theivanpill within about a
// minute (runner + Zernio), so the UI asks first, every time.

export type XArticleStatus = 'review' | 'approved' | 'publishing' | 'failed' | 'published'
export type XQuoteStatus = 'draft' | 'approved' | 'posting' | 'failed' | 'posted'

export type XArticle = {
  id: string
  status: XArticleStatus
  title: string | null
  body_md: string | null
  cover_url: string | null
  images: { slot: number | string; url: string | null; alt?: string | null }[] | null
  qa: {
    lint?: string[] | null
    remaining_risks?: string[] | null
    claims_checked?: { ok?: boolean; url?: string; claim?: string }[] | null
    words?: number | null
    [k: string]: unknown
  } | null
  sources: { url: string; supports?: string | null }[] | null
  x_url: string | null
  error: string | null
  lm_slug: string | null
  lm_topic: string | null
  account: string | null
  created_at: string
  updated_at: string | null
  /** The slot an approved article waits for (null = goes on the next pass). */
  publish_after?: string | null
}

export type XQuote = {
  id: string
  status: XQuoteStatus
  hook: string | null
  media_url: string | null
  quoted_url: string | null
  dry_run_shot_url: string | null
  posted_url: string | null
  error: string | null
  account: string | null
  hook_options: string[] | null
  giphy_url: string | null
  article_title: string | null
  article_cover: string | null
  article_body_md: string | null
  created_at: string
}

export type XReviewList = { articles: XArticle[]; quotes: XQuote[] }

function fail(error: { message?: string } | null): never {
  throw new Error(error?.message || 'The database refused the request')
}

export async function fetchXReview(): Promise<XReviewList> {
  const { data, error } = await supabase.rpc('x_review_list')
  if (error) fail(error)
  const d = (data ?? {}) as Partial<XReviewList>
  return { articles: Array.isArray(d.articles) ? d.articles : [], quotes: Array.isArray(d.quotes) ? d.quotes : [] }
}

export async function saveXArticle(id: string, title: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('x_article_save', { p_id: id, p_title: title, p_body_md: body })
  if (error) fail(error)
}

export async function decideXArticle(id: string, action: 'publish' | 'discard'): Promise<void> {
  const { error } = await supabase.rpc('x_article_decide', { p_id: id, p_action: action })
  if (error) fail(error)
}

export async function saveXQuote(id: string, hook: string): Promise<void> {
  const { error } = await supabase.rpc('x_quote_save', { p_id: id, p_hook: hook })
  if (error) fail(error)
}

export async function decideXQuote(id: string, action: 'post' | 'discard'): Promise<void> {
  const { error } = await supabase.rpc('x_quote_decide', { p_id: id, p_action: action })
  if (error) fail(error)
}

// ---- the flag ----

export type XFlagItem = {
  id: string
  kind: 'article' | 'quote'
  /** waiting = needs Ivan; moving = publishing/posting now; live = went out recently; failed = did not go out. */
  state: 'waiting' | 'moving' | 'live' | 'failed'
  title: string
  url: string | null
  error: string | null
  at: number
}

// An approved item still not out this long after its slot is stuck, and says so.
const STUCK_MS = 2 * 3600_000

const quoteState = (s: XQuoteStatus): XFlagItem['state'] =>
  s === 'draft' ? 'waiting' : s === 'approved' || s === 'posting' ? 'moving' : s === 'posted' ? 'live' : 'failed'

const stamp = (...v: (string | null | undefined)[]) => {
  for (const x of v) { const t = x ? Date.parse(x) : NaN; if (Number.isFinite(t)) return t }
  return 0
}

/**
 * Everything the flag shows, waiting first (Ivan 2026-10-15: "Once you post something I don't
 * need to see this here"). Live items never show: the calendar and X itself carry them. An
 * approved article waiting for its slot is scheduled, also calendar-only: it used to read
 * "Publishing on X…" for days. Moving = publishing now; an approved article still not out
 * 2h past its slot counts as stuck. Failed and stuck items never show either (Ivan
 * 2026-10-22: "no need to see all these errors here"): the calendar rings a missed post red.
 */
export function xFlagItems(l: XReviewList | null, now: number = Date.now()): XFlagItem[] {
  if (!l) return []
  const out: XFlagItem[] = []
  for (const a of l.articles) {
    const slot = stamp(a.publish_after)
    let state: XFlagItem['state']
    let error = a.error
    if (a.status === 'review') state = 'waiting'
    else if (a.status === 'published') state = 'live'
    else if (a.status === 'failed') state = 'failed'
    else if (a.status === 'approved' && slot > now) continue // scheduled: on the calendar
    else if (now - (slot || stamp(a.updated_at, a.created_at)) > STUCK_MS) {
      state = 'failed'
      error = error || `Not out on X yet, ${Math.floor((now - (slot || stamp(a.updated_at, a.created_at))) / 3600_000)}h after it was due`
    } else state = 'moving'
    const at = state === 'failed' && !a.error ? now : stamp(a.updated_at, a.created_at)
    out.push({ id: a.id, kind: 'article', state, title: a.title?.trim() || 'Untitled article', url: a.x_url, error, at })
  }
  for (const q of l.quotes) {
    const state = quoteState(q.status)
    out.push({ id: q.id, kind: 'quote', state, title: q.hook?.trim() || q.article_title?.trim() || 'Quote post', url: q.posted_url, error: q.error, at: stamp(q.created_at) })
  }
  const rank = { waiting: 0, moving: 1, failed: 2, live: 3 } as const
  return out
    .filter(i => i.state === 'waiting' || i.state === 'moving')
    .sort((a, b) => rank[a.state] - rank[b.state] || b.at - a.at)
}

/** How many X items wait on Ivan (articles in review + quote drafts). Counts in the Ops number. */
export function xWaitingCount(l: XReviewList | null): number {
  if (!l) return 0
  return l.articles.filter(a => a.status === 'review').length + l.quotes.filter(q => q.status === 'draft').length
}

/** An X article with a day on the content calendar: scheduled, going out, out, or failed. */
export type XCalendarItem = { id: string; title: string | null; status: XArticleStatus; x_url: string | null; at: string }

export async function fetchXCalendar(from: Date, to: Date): Promise<XCalendarItem[]> {
  const { data, error } = await supabase.rpc('x_calendar', { p_from: from.toISOString(), p_to: to.toISOString() })
  if (error) fail(error)
  return (data as XCalendarItem[] | null) ?? []
}
