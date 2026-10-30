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
  created_at: string
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
}

export type IntelTab = 'feed' | 'dropped' | 'sources'

/** Only recent videos reach For you (Ivan 10-30: "they need to be recent videos"). Matches the job's
 *  widest ingestion window (discovery hits up to 21 days old). */
export const FEED_WINDOW_DAYS = 21
export const DROP_WINDOW_DAYS = 14
const DAY = 86400000

/** For you: recent keeps Ivan has not marked Noise, plus drops he rescued with Useful. */
export function inFeed(i: IntelItem, now: number = Date.now()): boolean {
  if (!i.published_at || now - Date.parse(i.published_at) > FEED_WINDOW_DAYS * DAY) return false
  return i.verdict === 'keep' ? i.ivan_verdict !== 'noise' : i.ivan_verdict === 'useful'
}

/** Dropped: the judge's drops from the last two weeks that Ivan has not rescued. */
export function inDropped(i: IntelItem, now: number = Date.now()): boolean {
  return i.verdict === 'drop' && i.ivan_verdict !== 'useful' && now - Date.parse(i.created_at) <= DROP_WINDOW_DAYS * DAY
}

export function tabOf(q: URLSearchParams): IntelTab {
  const t = q.get('tab')
  return t === 'dropped' || t === 'sources' ? t : 'feed'
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

/** The video link, opened at the useful part when the judge found one. */
export function watchUrl(url: string, sec: number | null): string {
  if (!sec || sec <= 0) return url
  return `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(sec)}s`
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

const STATUS_RANK: Record<IntelSource['status'], number> = { trial: 0, core: 1, muted: 2, dropped: 3 }

/** Sources list: new trials first (they need a look), then core, muted, dropped; by name inside. */
export function sortSources(rows: IntelSource[]): IntelSource[] {
  return [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name))
}
