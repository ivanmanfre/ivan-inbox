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

const LIVE_SHOWN_MS = 24 * 3600_000
const FAILED_SHOWN_MS = 72 * 3600_000

const articleState = (s: XArticleStatus): XFlagItem['state'] =>
  s === 'review' ? 'waiting' : s === 'approved' || s === 'publishing' ? 'moving' : s === 'published' ? 'live' : 'failed'
const quoteState = (s: XQuoteStatus): XFlagItem['state'] =>
  s === 'draft' ? 'waiting' : s === 'approved' || s === 'posting' ? 'moving' : s === 'posted' ? 'live' : 'failed'

const stamp = (...v: (string | null | undefined)[]) => {
  for (const x of v) { const t = x ? Date.parse(x) : NaN; if (Number.isFinite(t)) return t }
  return 0
}

/**
 * Everything the flag shows, waiting first. Live items stay a day, failed ones three days
 * (quotes carry only created_at, so their age counts from creation).
 */
export function xFlagItems(l: XReviewList | null, now: number = Date.now()): XFlagItem[] {
  if (!l) return []
  const out: XFlagItem[] = []
  for (const a of l.articles) {
    const state = articleState(a.status)
    out.push({ id: a.id, kind: 'article', state, title: a.title?.trim() || 'Untitled article', url: a.x_url, error: a.error, at: stamp(a.updated_at, a.created_at) })
  }
  for (const q of l.quotes) {
    const state = quoteState(q.status)
    out.push({ id: q.id, kind: 'quote', state, title: q.hook?.trim() || q.article_title?.trim() || 'Quote post', url: q.posted_url, error: q.error, at: stamp(q.created_at) })
  }
  const rank = { waiting: 0, moving: 1, failed: 2, live: 3 } as const
  return out
    .filter(i => i.state === 'waiting' || i.state === 'moving'
      || (i.state === 'live' && now - i.at < LIVE_SHOWN_MS)
      || (i.state === 'failed' && now - i.at < FAILED_SHOWN_MS))
    .sort((a, b) => rank[a.state] - rank[b.state] || b.at - a.at)
}

/** How many X items wait on Ivan (articles in review + quote drafts). Counts in the Ops number. */
export function xWaitingCount(l: XReviewList | null): number {
  if (!l) return 0
  return l.articles.filter(a => a.status === 'review').length + l.quotes.filter(q => q.status === 'draft').length
}
