import type { EditorialClientId } from './editorialTypes.ts'
import { EditorialContractError, isEditorialClientId } from './editorialTypes.ts'
import type { EditorialClient } from './editorialTypes.ts'

export type ResourceEvent = {
  id: string; lm_id?: string | null; lm_slug: string; event_type: string; data_version: number | null
  session_id: string | null; is_test: boolean | null; user_agent: string | null
  src?: string | null; utm_source?: string | null; utm_medium?: string | null
  utm_campaign?: string | null; utm_content?: string | null; created_at: string
}
export type ResourceAttribution = {
  id: string | number; lm_slug: string; session_id: string | null; calendly_event_uri: string | null
  status: string; source: string | null; booked_at: string | null; created_at?: string | null; updated_at: string | null
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null
}
export type OutcomeCount = number | 'unknown'
export type OutcomeWindow = { start: string | null; end: string; definition: string; readComplete: boolean }
export type PromotionAttribution = {
  publication_id: string | null
  state: 'exact' | 'unknown' | 'not_applicable'
  eligible_events: OutcomeCount
  counted_bookings: OutcomeCount
  resource_credit: 0 | 1
  promotion_credit: 0 | 1
  limitation: string
}
export type ResourceOutcome = {
  kind: 'resource'; client_id: EditorialClientId; asset_id: string; asset_slug: string; asset_version: number
  scope: 'asset_version'; views: OutcomeCount; cta_clicks: OutcomeCount; captures: OutcomeCount
  active_bookings: OutcomeCount; direct_bookings: OutcomeCount; assisted_bookings: OutcomeCount
  excluded: { test: number; bot: number; wrong_version: number; wrong_asset: number
    outside_window: number; duplicate: number; canceled: number }
  observation_start: string | null; observation_end: string; observation_window_definition: string
  promotion_attribution: PromotionAttribution
  attribution_limitation: string
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
const inWindow = (value: string | null | undefined, window: OutcomeWindow) => Boolean(value) &&
  (!window.start || String(value) >= window.start) && String(value) <= window.end
/** Resource observations are asset-version scoped. Promotion attribution is a
 * separate view. Current telemetry has no canonical publication-tag field, so
 * UTM/source metadata cannot award promotion credit. */
export function normalizeResourceOutcomes(input: {
  clientId: EditorialClientId; assetClientId: EditorialClientId; assetId: string
  slug: string; dataVersion: number; observationWindow: OutcomeWindow
  promotionPublicationId?: string | null
  events: ResourceEvent[]; attributions: ResourceAttribution[]
}): ResourceOutcome {
  if (input.assetClientId !== input.clientId) {
    throw new EditorialContractError('invalid_argument', 'Exact client-owned asset identity is required.', 'normalizeResourceOutcomes')
  }
  if (!input.assetId || !input.slug || !Number.isInteger(input.dataVersion) || input.dataVersion < 1 ||
      !input.observationWindow.end || !input.observationWindow.definition) {
    throw new EditorialContractError('invalid_argument', 'Exact asset version and observation window are required.', 'normalizeResourceOutcomes')
  }
  const excluded = { test: 0, bot: 0, wrong_version: 0, wrong_asset: 0,
    outside_window: 0, duplicate: 0, canceled: 0 }
  const allEvents = input.events.filter(e => e.lm_slug === input.slug)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const seenIds = new Set<string>()
  const seenConversions = new Set<string>()
  const sessionVersions = new Map<string, Set<number | null>>()
  const eligibleEvents: ResourceEvent[] = []
  const counts: Record<string, number> = { view: 0, cta_click: 0, capture: 0 }
  for (const e of allEvents) {
    if (!inWindow(e.created_at, input.observationWindow)) { excluded.outside_window++; continue }
    if (e.lm_id && e.lm_id !== input.assetId) { excluded.wrong_asset++; continue }
    if (e.is_test === true || testSource.test(e.src ?? '') || testSource.test(e.utm_source ?? '')) {
      excluded.test++; continue
    }
    if (bot.test(e.user_agent ?? '')) { excluded.bot++; continue }
    if (seenIds.has(e.id)) { excluded.duplicate++; continue }
    seenIds.add(e.id)
    // Version ambiguity is a property of the retained session, so preserve it
    // before selecting the current asset-version events used for counts.
    if (e.session_id) {
      const versions = sessionVersions.get(e.session_id) ?? new Set<number | null>()
      versions.add(e.data_version)
      sessionVersions.set(e.session_id, versions)
    }
    if (e.data_version !== input.dataVersion) { excluded.wrong_version++; continue }
    eligibleEvents.push(e)
    if (!(e.event_type in counts)) continue
    if (e.event_type === 'view') { counts.view++; continue }
    const identity = e.session_id ? `${e.event_type}:${e.session_id}` : `${e.event_type}:event:${e.id}`
    if (seenConversions.has(identity)) { excluded.duplicate++; continue }
    seenConversions.add(identity)
    counts[e.event_type]++
  }

  const bookings = new Map<string, ResourceAttribution>()
  for (const a of input.attributions.filter(row => row.lm_slug === input.slug)) {
    const observedAt = a.booked_at ?? a.created_at
    if (!inWindow(observedAt, input.observationWindow)) { excluded.outside_window++; continue }
    if (!a.calendly_event_uri || !a.booked_at) continue
    const prior = bookings.get(a.calendly_event_uri)
    if (prior) excluded.duplicate++
    if (!prior || String(a.updated_at ?? '') > String(prior.updated_at ?? '')) bookings.set(a.calendly_event_uri, a)
  }
  let direct = 0, assisted = 0, routeUnknown = 0, linkUnknown = 0, active = 0
  for (const a of bookings.values()) {
    if (/cancel|test|spam/i.test(a.status) || testSource.test(a.source ?? '')) { excluded.canceled++; continue }
    const versions = a.session_id ? sessionVersions.get(a.session_id) : null
    const observedBeforeBooking = eligibleEvents.some(e => e.session_id === a.session_id && e.created_at <= a.booked_at!)
    if (!versions || versions.size !== 1 || !versions.has(input.dataVersion) || !observedBeforeBooking) {
      linkUnknown++; continue
    }
    active++
    const source = (a.source ?? '').toLowerCase()
    if (source === 'direct') direct++
    else if (source === 'assisted') assisted++
    else routeUnknown++
  }

  const complete = input.observationWindow.readComplete
  const count = (value: number): OutcomeCount => complete ? value : 'unknown'
  const promotionId = input.promotionPublicationId?.trim() || null
  let promotion: PromotionAttribution
  if (!promotionId) {
    promotion = { publication_id: null, state: 'not_applicable', eligible_events: 'unknown',
      counted_bookings: 'unknown', resource_credit: 1, promotion_credit: 0,
      limitation: 'No exact promotion publication identity was supplied.' }
  } else {
    promotion = { publication_id: promotionId, state: 'unknown', eligible_events: 'unknown',
      counted_bookings: 'unknown', resource_credit: 1, promotion_credit: 0,
      limitation: 'No supported publication tag field is wired through the retained event and booking producers; source and UTM metadata are not publication identities.' }
  }
  const attributionLimitation = !complete
    ? 'The retained event read is incomplete; zero and conversion totals are unknown.'
    : linkUnknown
      ? `${linkUnknown} booking(s) lack an unambiguous event-session link to this asset version; version-specific bookings remain unknown.`
      : routeUnknown
        ? `${routeUnknown} booking(s) lack a reliable direct/assisted route; no causal claim is available.`
        : 'Complete retained-row counts do not prove instrumentation coverage or that the resource or any promotion caused a booking.'
  return {
    kind: 'resource', client_id: input.clientId, asset_id: input.assetId, asset_slug: input.slug,
    asset_version: input.dataVersion, scope: 'asset_version',
    views: count(counts.view), cta_clicks: count(counts.cta_click), captures: count(counts.capture),
    active_bookings: complete && !linkUnknown ? active : 'unknown',
    direct_bookings: complete && !linkUnknown && !routeUnknown ? direct : 'unknown',
    assisted_bookings: complete && !linkUnknown && !routeUnknown ? assisted : 'unknown',
    excluded, observation_start: input.observationWindow.start, observation_end: input.observationWindow.end,
    observation_window_definition: input.observationWindow.definition,
    promotion_attribution: promotion, attribution_limitation: attributionLimitation,
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
