import type { EditorialClientId } from './editorialTypes'
import { EditorialContractError, isEditorialClientId } from './editorialTypes'
import type { EditorialClient } from './editorialTypes'

export type ResourceEvent = {
  id: string; lm_slug: string; event_type: string; data_version: number | null
  session_id: string | null; is_test: boolean | null; user_agent: string | null
  src?: string | null; utm_source?: string | null; email?: string | null; created_at: string
}
export type ResourceAttribution = {
  id: string | number; lm_slug: string; session_id: string | null; calendly_event_uri: string | null
  status: string; source: string | null; booked_at: string | null; updated_at: string | null
}
export type ResourceOutcome = {
  kind: 'resource'; client_id: EditorialClientId; asset_slug: string; asset_version: number
  views: number; cta_clicks: number; captures: number; active_bookings: number | 'unknown'
  direct_bookings: number | 'unknown'; assisted_bookings: number | 'unknown'
  excluded: { test: number; bot: number; wrong_version: number; duplicate: number; canceled: number }
  attribution_limitation: string; observation_end: string | 'unknown'
}
export type PostOutcome = {
  kind: 'post'; client_id: EditorialClientId; post_id: string; captured_at: string | 'unknown'
  impressions: number | 'unknown'; reactions: number | 'unknown'; comments: number | 'unknown'
  shares: number | 'unknown'; publication_id: string | null
  attribution_limitation: string
}

export type EditorialResultsRead = {
  client_id: EditorialClientId
  brief_id: string
  brief_version: number
  state: 'ready' | 'partial' | 'empty'
  post: PostOutcome | null
  resource: ResourceOutcome | null
  unknowns: string[]
}

export async function readEditorialResults(client: EditorialClient, clientId: string,
  briefId: string, version: number): Promise<EditorialResultsRead> {
  if (!isEditorialClientId(clientId) || !briefId.trim() || !Number.isInteger(version) || version < 1 || !client.functions) {
    throw new EditorialContractError('invalid_argument', 'An authenticated client and exact brief identity are required.', 'readEditorialResults')
  }
  const { data, error } = await client.functions.invoke('editorial-results', {
    body: { client_id: clientId, brief_id: briefId, version },
  })
  if (error || !data || typeof data !== 'object') {
    throw new EditorialContractError('read_failed', 'Results read failed.', error?.message ?? '')
  }
  return data as EditorialResultsRead
}

const bot = /(bot|crawler|spider|headless|monitor|preview)/i
const testSource = /^(test|operator|internal|qa|selftest)([-_:]|$)/i
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Resource events are counted only for the exact slug and current data version.
 * A known test, bot, operator and canceled booking cannot become conversion proof. */
export function normalizeResourceOutcomes(input: {
  clientId: EditorialClientId; slug: string; dataVersion: number
  events: ResourceEvent[]; attributions: ResourceAttribution[]
}): ResourceOutcome {
  const excluded = { test: 0, bot: 0, wrong_version: 0, duplicate: 0, canceled: 0 }
  const events = input.events.filter(e => e.lm_slug === input.slug)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const seenIds = new Set<string>()
  const seenConversions = new Set<string>()
  const sessionVersions = new Map<string, Set<number | null>>()
  for (const event of events) {
    if (!event.session_id || event.is_test === true || bot.test(event.user_agent ?? '') ||
        testSource.test(event.src ?? '') || testSource.test(event.utm_source ?? '')) continue
    const versions = sessionVersions.get(event.session_id) ?? new Set<number | null>()
    versions.add(event.data_version)
    sessionVersions.set(event.session_id, versions)
  }
  const counts: Record<string, number> = { view: 0, cta_click: 0, capture: 0 }
  let observationEnd: string | 'unknown' = 'unknown'
  for (const e of events) {
    if (e.data_version !== input.dataVersion) { excluded.wrong_version++; continue }
    if (e.is_test === true || testSource.test(e.src ?? '') || testSource.test(e.utm_source ?? '')) {
      excluded.test++; continue
    }
    if (bot.test(e.user_agent ?? '')) { excluded.bot++; continue }
    if (seenIds.has(e.id)) { excluded.duplicate++; continue }
    seenIds.add(e.id)
    if (observationEnd === 'unknown' || e.created_at > observationEnd) observationEnd = e.created_at
    if (!(e.event_type in counts)) continue
    if (e.event_type === 'view') { counts.view++; continue }
    const identity = e.session_id ? `${e.event_type}:${e.session_id}` : `${e.event_type}:event:${e.id}`
    if (seenConversions.has(identity)) { excluded.duplicate++; continue }
    seenConversions.add(identity)
    counts[e.event_type]++
  }
  const bookings = new Map<string, ResourceAttribution>()
  for (const a of input.attributions.filter(x => x.lm_slug === input.slug)) {
    if (!a.calendly_event_uri || !a.booked_at) continue
    const prior = bookings.get(a.calendly_event_uri)
    if (prior) excluded.duplicate++
    if (!prior || String(a.updated_at ?? '') > String(prior.updated_at ?? '')) bookings.set(a.calendly_event_uri, a)
  }
  let direct = 0, assisted = 0, unknown = 0, unversioned = 0
  let active = 0
  for (const a of bookings.values()) {
    if (/cancel|test|spam/i.test(a.status) || testSource.test(a.source ?? '')) { excluded.canceled++; continue }
    const versions = a.session_id ? sessionVersions.get(a.session_id) : null
    const observedBeforeBooking = events.some(e => e.session_id === a.session_id &&
      e.data_version === input.dataVersion && e.created_at <= a.booked_at! &&
      e.is_test !== true && !bot.test(e.user_agent ?? '') && !testSource.test(e.src ?? '') &&
      !testSource.test(e.utm_source ?? ''))
    if (!versions || versions.size !== 1 || !versions.has(input.dataVersion) || !observedBeforeBooking) {
      unversioned++; continue
    }
    active++
    const source = (a.source ?? '').toLowerCase()
    if (source === 'direct' && a.session_id) direct++
    else if (source === 'assisted') assisted++
    else unknown++
  }
  return {
    kind: 'resource', client_id: input.clientId, asset_slug: input.slug, asset_version: input.dataVersion,
    views: counts.view, cta_clicks: counts.cta_click, captures: counts.capture,
    active_bookings: unversioned ? 'unknown' : active, direct_bookings: unknown || unversioned ? 'unknown' : direct,
    assisted_bookings: unknown || unversioned ? 'unknown' : assisted, excluded,
    attribution_limitation: unversioned
      ? `${unversioned} booking(s) lack an unambiguous event-session link to this asset version; version-specific bookings remain unknown.`
      : unknown
      ? `${unknown} booking(s) lack a reliable direct/assisted route; no causal claim is available.`
      : 'Observed bookings are not proof that the resource caused them.',
    observation_end: observationEnd,
  }
}

/** A post remains a distinct outcome surface, even when it promotes a resource. */
export function normalizePostOutcome(input: {
  clientId: EditorialClientId; postId: string; metrics: Record<string, unknown> | null
}): PostOutcome {
  const m = input.metrics ?? {}
  const count = (x: unknown) => valid(x) ? x : 'unknown' as const
  return { kind: 'post', client_id: input.clientId, post_id: input.postId,
    captured_at: typeof (m.captured_at ?? m.metrics_updated_at ?? m.scraped_at) === 'string'
      ? String(m.captured_at ?? m.metrics_updated_at ?? m.scraped_at) : 'unknown',
    impressions: count(m.impressions ?? m.num_impressions),
    reactions: count(m.reactions ?? m.num_likes), comments: count(m.comments ?? m.num_comments),
    shares: count(m.shares ?? m.num_shares),
    publication_id: typeof m.social_id === 'string' ? m.social_id : null,
    attribution_limitation: 'Observed post metrics do not establish buyer identity or resource conversion causality.' }
}
