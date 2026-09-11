/* ==========================================================================
   OWN-POST THEMES — what this lane's posts are about, read for the tail.

   Ivan 2026-09-12: "I want to produce for outliers." The audience block
   reports medians; this one reports the theme behind the biggest posts, the
   median beside it, and who the engagers were with their fit score, so an
   outlier reads as a content bet (buyers engaged) or a reach bet (peers did).

   One RPC (`audn_themes_payload`), pure helpers, no writes.
   ========================================================================== */
import { supabase } from './supabase'
import type { ContentLane } from './content'

export type ThemePost = {
  at: string
  imp: number
  eng: number
  url: string | null
  text: string
  angle: string | null
  people: number
  fit: number
}

export type Theme = {
  theme: string
  n: number
  median_imp: number | null
  median_eng: number | null
  best_imp: number
  people: number
  fit: number
  angles: Record<string, number> | null
  posts: ThemePost[]
}

export type Themes = {
  ok: true
  client_id: string
  days: number
  read_at: string
  posts_total: number
  untagged: number
  themes: Theme[]
}

export type ThemesState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: Themes }
  | { kind: 'empty'; reason: string }
  | { kind: 'failed'; message: string }

export const THEME_LABEL: Record<string, string> = {
  poland: 'Poland',
  outreach: 'Outreach',
  ai_system: 'The AI system',
  linkedin_content: 'LinkedIn content',
  client_work: 'Client work',
  personal: 'Personal',
  industry_take: 'Industry take',
  offer: 'Offer',
  other: 'Other',
  untagged: 'Not yet read',
}

export const ANGLE_LABEL: Record<string, string> = {
  polemic: 'polemic',
  curiosity: 'curiosity',
  how_to: 'how-to',
  story: 'story',
  proof: 'proof',
  teardown: 'teardown',
  other: 'other',
  unknown: 'unread',
}

export function themeLabel(t: string): string { return THEME_LABEL[t] ?? t }
export function angleLabel(a: string | null | undefined): string { return a ? (ANGLE_LABEL[a] ?? a) : ANGLE_LABEL.unknown }

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–'
  return Math.round(v).toLocaleString('en-US')
}

/** "12 people engaged, 3 fit" / "nobody scored yet" — never a percentage on a
    handful, and never a share when nobody was scored. */
export function fitLine(people: number, fit: number): string {
  if (!people) return 'no engagers scored yet'
  const share = people >= 10 ? ` (${Math.round((100 * fit) / people)}%)` : ''
  return `${people} engaged · ${fit} fit${share}`
}

/** "polemic 4 · story 2" — the mix of moves inside a theme, biggest first. */
export function angleMix(angles: Record<string, number> | null): string {
  if (!angles) return ''
  return Object.entries(angles)
    .sort((a, b) => b[1] - a[1])
    .map(([a, n]) => `${angleLabel(a)} ${n}`)
    .join(' · ')
}

/** Best post as a multiple of the theme's own median: the outlier ratio. */
export function outlierRatio(best: number, median: number | null): string | null {
  if (!median || median <= 0 || !best) return null
  const r = best / median
  return r >= 1.5 ? `${r.toFixed(r >= 10 ? 0 : 1)}× its median` : null
}

export async function fetchThemes(lane: ContentLane): Promise<ThemesState> {
  const { data, error } = await supabase.rpc('audn_themes_payload', { p_client_id: lane, p_days: 180 })
  if (error) return { kind: 'failed', message: error.message }
  const p = data as { ok: boolean; error?: string } | null
  if (!p || p.ok !== true) return { kind: 'failed', message: p?.error ?? 'No payload came back.' }
  const t = p as Themes
  if (!t.posts_total) return { kind: 'empty', reason: 'No own posts with metrics in this window.' }
  return { kind: 'ready', data: t }
}
