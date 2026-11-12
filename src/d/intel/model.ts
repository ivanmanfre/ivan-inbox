// D · Intel. Pure helpers for the assessed-video feed (writer: ~/.claude/intel-feed/run.py).

export type IntelItem = {
  id: string
  source_id: string | null
  source_name: string
  url: string
  title: string
  published_at: string | null
  duration_sec: number | null
  found_via: 'source' | 'discovery'
  verdict: 'keep' | 'drop'
  score: number
  headline: string | null
  what_new: string | null
  applies_to: string | null
  try_this: string | null
  watch_from_sec: number | null
  drop_reason: string | null
  ivan_verdict: 'useful' | 'noise' | null
  /** When Ivan was done with the card (Done, or Useful). Seen cards leave For you. */
  ivan_seen_at: string | null
  created_at: string
  /** youtube | podcast | github | reddit | blog | kyle. Old cached rows have none: they are videos. */
  kind?: string
  /** Per kind: github {stars, window, created_at}, blog {chars | words}, reddit {comments, subreddit},
   *  kyle {area, who, ran_it, calls, minutes, call_type}. */
  meta?: Record<string, unknown> | null
  /** One line copied word for word from the source. */
  quote?: string | null
}

export type IntelSource = {
  id: string
  name: string
  url: string
  topic: string | null
  status: 'core' | 'trial' | 'muted' | 'dropped'
  added_by: 'ivan' | 'discovery'
  note: string | null
  items_judged: number
  items_kept: number
  last_kept_at: string | null
  kind?: string
}

export type IntelTab = 'feed' | 'seen' | 'dropped' | 'sources'

/** Only recent videos reach For you (Ivan 10-30: "they need to be recent videos"). Matches the job's
 *  widest ingestion window (discovery hits up to 21 days old). */
export const FEED_WINDOW_DAYS = 21
export const DROP_WINDOW_DAYS = 14
/** A video the weekly search finds late (published 20 days ago) still gets a week on For you (11-07: the
 *  Semrush ghost-citation card vanished a day after it was found). */
export const FOUND_GRACE_DAYS = 7
const DAY = 86400000

function recent(i: IntelItem, now: number): boolean {
  if (!i.published_at) return false
  // A text item is as old as the day it was found: an idea from a call two months back or an article from a
  // deep read is new to Ivan when it lands (11-12: the first deep reads reach back 30 to 90 days).
  if (!isVideo(i)) return now - Date.parse(i.created_at) <= FEED_WINDOW_DAYS * DAY
  return now - Date.parse(i.published_at) <= FEED_WINDOW_DAYS * DAY || now - Date.parse(i.created_at) <= FOUND_GRACE_DAYS * DAY
}

/** Worth showing at all: a keep Ivan has not marked Noise, or a drop he rescued with Useful. */
function wanted(i: IntelItem): boolean {
  return i.verdict === 'keep' ? i.ivan_verdict !== 'noise' : i.ivan_verdict === 'useful'
}

/** For you: recent wanted videos Ivan has not gone through yet (Ivan 11-06: "i already went through
 *  these... instead of showing new stuff"). Done or Useful moves a card to Seen. */
export function inFeed(i: IntelItem, now: number = Date.now()): boolean {
  return recent(i, now) && wanted(i) && !i.ivan_seen_at
}

/** Seen: recent wanted videos Ivan is done with, so a card can be brought back. */
export function inSeen(i: IntelItem, now: number = Date.now()): boolean {
  return recent(i, now) && wanted(i) && !!i.ivan_seen_at
}

/** Dropped: the judge's drops from the last two weeks that Ivan has not rescued. */
export function inDropped(i: IntelItem, now: number = Date.now()): boolean {
  return i.verdict === 'drop' && i.ivan_verdict !== 'useful' && now - Date.parse(i.created_at) <= DROP_WINDOW_DAYS * DAY
}

export function tabOf(q: URLSearchParams): IntelTab {
  const t = q.get('tab')
  return t === 'seen' || t === 'dropped' || t === 'sources' ? t : 'feed'
}

/** 754 -> "12:34", 3725 -> "1:02:05". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** Minutes, rounded: "24 min", "1 h 41". */
export function length(sec: number | null): string | null {
  if (!sec || sec <= 0) return null
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`
}

/** YouTube's own thumbnail for a watch URL (no API call): https://i.ytimg.com/vi/<id>/mqdefault.jpg */
export function thumbUrl(url: string): string | null {
  const id = url.match(/[?&]v=([\w-]{6,})/)?.[1] ?? url.match(/youtu\.be\/([\w-]{6,})/)?.[1]
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null
}

/** The item's kind; rows from before the column existed are videos. */
export function kindOf(i: { kind?: string | null }): string {
  return i.kind || 'youtube'
}

/** Video-style tile (thumbnail, length, "from mm:ss") only for YouTube. Everything else is a text tile. */
export const isVideo = (i: { kind?: string | null }): boolean => kindOf(i) === 'youtube'

const KIND_LABEL: Record<string, string> = { youtube: 'YouTube', github: 'GitHub', blog: 'Blog', reddit: 'Reddit', kyle: 'Kyle call', podcast: 'Podcast' }
/** An unknown kind shows as itself, so a new source type never crashes or hides. */
export function kindLabel(kind: string): string {
  return Object.prototype.hasOwnProperty.call(KIND_LABEL, kind) ? KIND_LABEL[kind] : kind
}

const OPEN_LABEL: Record<string, string> = { github: 'Open on GitHub', blog: 'Open the post', reddit: 'Open the thread', kyle: 'Open the call notes', youtube: 'Open on YouTube' }
export function openLabel(kind: string): string {
  return Object.prototype.hasOwnProperty.call(OPEN_LABEL, kind) ? OPEN_LABEL[kind] : 'Open'
}

const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null

/** The one small fact under a card: stars, comments, read time, call date, or the video length. Null when unknown. */
export function metaChip(i: Pick<IntelItem, 'kind' | 'meta' | 'published_at' | 'duration_sec'>): string | null {
  const kind = kindOf(i), m = i.meta ?? {}
  if (kind === 'youtube') return length(i.duration_sec)
  if (kind === 'github') { const n = num(m.stars); return n === null ? null : `\u2605 ${n}` }
  if (kind === 'reddit') { const n = num(m.comments); return n === null ? null : `${n} comments` }
  if (kind === 'blog') {
    const n = num(m.chars), w = num(m.words)
    if (n !== null && n > 0) return `~${Math.max(1, Math.round(n / 1100))} min read`
    return w === null || w <= 0 ? null : `~${Math.max(1, Math.round(w / 220))} min read`
  }
  if (kind === 'kyle') {
    // An idea from a call: its area, and on how many calls it was heard when more than one.
    const area = typeof m.area === 'string' && m.area ? m.area : null
    const calls = num(m.calls)
    const parts = [area, calls !== null && calls > 1 ? `${calls} calls` : null].filter(Boolean)
    if (parts.length) return parts.join(' \u00b7 ')
    const t = i.published_at ? Date.parse(i.published_at) : NaN
    return Number.isNaN(t) ? null : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return null
}

/** The item link. Only a YouTube video opens at the useful minute; other kinds open as they are.
 *  Accepts a plain url (video) or the item itself. */
export function watchUrl(src: string | Pick<IntelItem, 'url' | 'kind' | 'watch_from_sec'>, sec?: number | null): string {
  const item = typeof src === 'string' ? { url: src, kind: 'youtube', watch_from_sec: sec ?? null } : { ...src, watch_from_sec: sec === undefined ? src.watch_from_sec : sec }
  if (!isVideo(item) || !item.watch_from_sec || item.watch_from_sec <= 0) return item.url
  return `${item.url}${item.url.includes('?') ? '&' : '?'}t=${Math.floor(item.watch_from_sec)}s`
}

/** "2h ago", "3d ago", "5w ago". */
export function ago(iso: string | null, now: number = Date.now()): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.round(h / 24)
  return d < 21 ? `${d}d ago` : `${Math.round(d / 7)}w ago`
}

/** The kinds in a list with their counts, most cards first: the filter chips. */
export function kindCounts(items: { kind?: string | null }[]): [string, number][] {
  const n = new Map<string, number>()
  for (const i of items) n.set(kindOf(i), (n.get(kindOf(i)) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** One kind of a list, in reading order. Kyle's ideas come best first (their score says how usable the idea
 *  is and the call date says little); everything else stays newest first, as the list came. */
export function pickKind<T extends { kind?: string | null; score: number }>(items: T[], kind: string | null): T[] {
  if (!kind) return items
  const xs = items.filter(i => kindOf(i) === kind)
  return kind === 'kyle' ? [...xs].sort((a, b) => b.score - a.score) : xs
}

const STATUS_RANK: Record<IntelSource['status'], number> = { trial: 0, core: 1, muted: 2, dropped: 3 }

/** Sources list: new trials first (they need a look), then core, muted, dropped; by name inside. */
export function sortSources(rows: IntelSource[]): IntelSource[] {
  return [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name))
}
