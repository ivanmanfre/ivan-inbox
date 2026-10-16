import { supabase } from '../../lib/supabase'
import { CLIENT_OPS_GATE } from '../../lib/content'
import { ideaOutlierSource } from './SourceBadge'
import type { IdeaItem } from './ideaModel'
import type { Lane } from './model'

export const IDEA_TOPICS = ['Content & LinkedIn', 'Sales & outreach', 'Founder life', 'Unsorted'] as const
export type IdeaTopic = typeof IDEA_TOPICS[number]
export type IdeaOrganization = { id: string; shortlisted: boolean; topic: IdeaTopic | null }
export type IdeaOrganizationMap = Record<string, IdeaOrganization>
export type IdeaView = 'new' | 'shortlisted' | 'all'

/** Suggested from the idea title only. Quotes and scoring prose are someone else's context. */
export function ideaTopic(it: IdeaItem, override?: string | null): string {
  if (override && IDEA_TOPICS.includes(override as IdeaTopic)) return override
  if (it.lane !== 'ivan') return it.client?.pillar?.trim() || 'Unsorted'
  const title = it.title.toLowerCase()
  if (/\b(warsaw|poland|polish|passport|argentin\w*|italian|sicilian|london|canary wharf|coffee|tax|taxes|moved abroad|move abroad|upwork|retainer|capacity|ten.client|10 clients|taking clients at 10|last dev client|ex ai dev|used to sell.*builds)\b/.test(title)) return 'Founder life'
  if (/\b(dm|dms|outreach|cold|prospect\w*|pipeline|sales|booking|booked|book(s|ing)? calls?|warm.intro|follow.up|reply|replies|invites?|acceptance|referrals?|trade.show|agency clients|pricing|qualified call|leads?)\b/.test(title)) return 'Sales & outreach'
  if (/\b(content|linkedin|posts?|hooks?|drafts?|writing|write|comments?|audience|engag\w*|reach|creators?|marketing|newsletter|lead.magnets?|seo|tone|prompt)\b/.test(title)) return 'Content & LinkedIn'
  return 'Unsorted'
}
export function ideaOrigin(it: IdeaItem): string {
  if (it.outlier) return `Outlier · ${it.outlier.author || 'Author unknown'}`
  const outlier = ideaOutlierSource(it)
  if (outlier) return `Outlier · ${outlier.author || 'Author unknown'}`
  if (it.src === 'Manual') return 'Your idea'
  const evidence = Array.isArray(it.ivan?.evidence) ? it.ivan.evidence[0] : null
  const author = evidence && typeof evidence === 'object' && typeof evidence.author === 'string' ? evidence.author : null
  if (author && ['X', 'LinkedIn', 'Competitor posts'].includes(it.src)) return `${it.src} · ${author}`
  return it.src === 'youtube_watch' ? 'YouTube' : it.src || 'Idea bank'
}
export function ideaAddedAt(it: IdeaItem): number {
  return Date.parse(it.ivan?.ingested_at || it.client?.created_at || it.outlier?.published_at || '')
}
export function isNewArrival(it: IdeaItem, now=Date.now()): boolean {
  const date = ideaAddedAt(it)
  return Number.isFinite(date) && date <= now && date >= now - 14 * 86400000
}
export async function fetchIdeaOrganization(lane: Lane): Promise<IdeaOrganizationMap> {
  const { data, error } = await supabase.rpc('operator_idea_organization', { p_gate: CLIENT_OPS_GATE, p_client: lane })
  if (error) throw new Error(error.message)
  if (data?.ok !== true || data.client !== lane || !Array.isArray(data.rows)) throw new Error('Your shortlist could not be read.')
  return Object.fromEntries(data.rows.map((row: IdeaOrganization) => [row.id, row]))
}
export async function saveIdeaOrganization(lane: Lane, id: string, patch: Partial<Pick<IdeaOrganization, 'shortlisted' | 'topic'>>): Promise<IdeaOrganization> {
  const { data, error } = await supabase.rpc('operator_set_idea_organization', { p_gate: CLIENT_OPS_GATE, p_client: lane, p_id: id, p_patch: patch })
  if (error) throw new Error(error.message)
  if (data?.ok !== true || data.client !== lane || data.row?.id !== id) throw new Error('Your shortlist change was not saved.')
  return data.row
}
