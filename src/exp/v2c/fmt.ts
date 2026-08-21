import { label } from '../../lib/labels'

// Shared formatting for the Content tab. Extracted in round 2 because the
// queue card and the draft detail screen now render the same timestamps and
// the same type chip — two copies of relTime() is how two surfaces start
// disagreeing about how old the same row is.

export function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// A schedule in the future reads "in 3d", not "0m ago" — the dates row on the
// detail screen shows scheduled_at, which is usually ahead of now.
export function relOrAhead(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = t - Date.now()
  if (diff <= 0) return relTime(iso)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'in <1m'
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

// WHEN IT POSTS, as a clock time (2026-08-10, Ivan: "i cant really see post
// time"). Every surface that showed a scheduled row showed `updated_at` as
// "1d ago" — how old the ROW is, which is not a fact anyone schedules around.
// Weekday and clock, because the two questions asked of an armed draft are
// "which day" and "what time"; the date is only spelled out once the post is
// further away than a week, when the weekday alone stops locating it.
export function postTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const within7d = Math.abs(d.getTime() - Date.now()) < 7 * 864e5
  return d.toLocaleString(undefined, {
    weekday: 'short',
    ...(within7d ? {} : { month: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Absolute, local, no year unless it isn't this one — the detail screen shows
// both forms because "3d ago" is useless when you're reconstructing what an
// agent did at 12:00:08.
export function absTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

const TYPE_LABEL: Record<string, string> = { text: 'Text', single_image: 'Image', carousel: 'Carousel' }

export function typeLabel(t: string | null): string {
  if (!t) return 'Text'
  return TYPE_LABEL[t] ?? t
}

// taxonomy.source slugs → a reading label, the same vocabulary dashboard-v2
// uses on its ideas table (ideaProjection.ts SOURCE_LABEL). An unknown slug
// renders as itself — the roster is the data's, never this map's.
const SOURCE_LABEL: Record<string, string> = {
  calls: 'Call',
  kyle_call: 'Kyle call',
  ivan_call: 'Call',
  slack: 'Slack',
  hacker_news: 'Hacker News',
  search_demand: 'Search demand',
  reddit_se: 'Reddit',
  breaking_news: 'News',
  model_launch: 'Model launch',
  x_search: 'X search',
  claude_sessions: 'Claude session',
  client_work: 'Client work',
}

export function sourceLabel(s: string): string {
  // phase2: an unmapped slug used to reach the screen raw (youtube_watch).
  // The curated names above stay first; anything this map has not seen falls
  // through to the shared degrade path instead of rendering as itself.
  return SOURCE_LABEL[s] ?? label(s)
}

// A raw taxonomy slug ('case_study', 'reach') as a reading label ('Case Study',
// 'Reach'). Generic on purpose: the pillar and funnel vocabularies are the
// engine's to grow, and an unmapped value must render, not vanish.
export function tagLabel(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
