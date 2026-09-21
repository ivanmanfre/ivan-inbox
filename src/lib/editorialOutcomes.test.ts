import { describe, expect, it } from 'vitest'
import { normalizePostOutcome, normalizeResourceOutcomes } from './editorialOutcomes'
import type { ResourceEvent, ResourceAttribution } from './editorialOutcomes'

const event = (over: Partial<ResourceEvent> = {}): ResourceEvent => ({
  id: 'event-1', lm_id: 'asset-1', lm_slug: 'resource', event_type: 'view', data_version: 2,
  session_id: 'session-1', is_test: false, user_agent: 'browser', src: 'linkedin',
  utm_source: null, utm_campaign: null, utm_content: null, created_at: '2026-09-20T10:00:00Z', ...over,
})
const attribution = (over: Partial<ResourceAttribution> = {}): ResourceAttribution => ({
  id: 'booking-1', lm_slug: 'resource', session_id: 'session-1', calendly_event_uri: 'cal-1',
  status: 'active', source: 'direct', booked_at: '2026-09-20T11:00:00Z',
  created_at: '2026-09-20T11:00:00Z', updated_at: '2026-09-20T11:00:00Z',
  utm_source: null, utm_campaign: null, utm_content: null, ...over,
})
const base = { clientId: 'ivan' as const, assetClientId: 'ivan' as const, assetId: 'asset-1',
  slug: 'resource', dataVersion: 2, observationWindow: { start: '2026-09-20T00:00:00Z',
    end: '2026-09-21T00:00:00Z', definition: 'complete retained rows in the declared UTC window', readComplete: true } }

describe('post and resource outcomes', () => {
  it('executes duplicate, test, bot, operator, version, window and canceled controls', () => {
    const events: ResourceEvent[] = [event(), event({ id: 'event-1' }),
      event({ id: 'click', event_type: 'cta_click' }), event({ id: 'capture', event_type: 'capture' }),
      event({ id: 'test', is_test: true }), event({ id: 'operator', src: 'operator-check' }),
      event({ id: 'bot', user_agent: 'HeadlessChrome' }), event({ id: 'version', data_version: 1 }),
      event({ id: 'asset', lm_id: 'other-asset' }), event({ id: 'late', created_at: '2026-09-22T00:00:00Z' })]
    const attributions = [attribution(), attribution({ id: 'booking-duplicate' }),
      attribution({ id: 'booking-canceled', calendly_event_uri: 'cal-2', status: 'canceled' })]
    const resource = normalizeResourceOutcomes({ ...base, events, attributions })
    const post = normalizePostOutcome({ clientId: 'ivan', postId: 'post-1', metrics: {
      metrics_updated_at: '2026-09-20T14:00:00Z', num_impressions: 0, num_likes: null,
      num_comments: 2, social_id: 'urn:li:post:1' } })
    expect(resource.views).toBe(1)
    expect(resource.cta_clicks).toBe(1)
    expect(resource.captures).toBe(1)
    expect(resource.active_bookings).toBe(1)
    expect(resource.direct_bookings).toBe(1)
    expect(resource.excluded).toEqual({ test: 2, bot: 1, wrong_version: 1, wrong_asset: 1,
      outside_window: 1, duplicate: 2, canceled: 1 })
    expect(resource.scope).toBe('asset_version')
    expect(post.impressions).toBe(0)
    expect(post.reactions).toBe('unknown')
  })

  it('keeps an incomplete read unknown instead of manufacturing a zero', () => {
    const result = normalizeResourceOutcomes({ ...base,
      observationWindow: { ...base.observationWindow, readComplete: false }, events: [], attributions: [] })
    expect(result.views).toBe('unknown')
    expect(result.active_bookings).toBe('unknown')
    expect(result.attribution_limitation).toContain('incomplete')
  })

  it('does not turn a prior-version, unlinked or assisted booking into a direct current-version result', () => {
    const prior = normalizeResourceOutcomes({ ...base, events: [event({ data_version: 1 })],
      attributions: [attribution()] })
    expect(prior.active_bookings).toBe('unknown')
    const assisted = normalizeResourceOutcomes({ ...base, events: [event()],
      attributions: [attribution({ source: 'assisted' })] })
    expect(assisted.active_bookings).toBe(1)
    expect(assisted.direct_bookings).toBe(0)
    expect(assisted.assisted_bookings).toBe(1)
  })

  it('fails closed when an asset is read through another tenant', () => {
    expect(() => normalizeResourceOutcomes({ ...base, assetClientId: 'arch', events: [], attributions: [] }))
      .toThrow('client-owned asset')
  })

  it('keeps several promotions for one asset separate and never turns an unlinked promotion into zero', () => {
    const tagged = event({ id: 'tagged', event_type: 'cta_click', utm_content: 'urn:li:post:A' })
    const booking = attribution({ utm_content: 'urn:li:post:A' })
    const exact = normalizeResourceOutcomes({ ...base, promotionPublicationId: 'urn:li:post:A',
      events: [tagged], attributions: [booking] })
    const other = normalizeResourceOutcomes({ ...base, promotionPublicationId: 'urn:li:post:B',
      events: [tagged], attributions: [booking] })
    expect(exact.promotion_attribution).toMatchObject({ state: 'exact', publication_id: 'urn:li:post:A',
      eligible_events: 1, counted_bookings: 1, resource_credit: 0, promotion_credit: 1 })
    expect(other.promotion_attribution).toMatchObject({ state: 'unknown', publication_id: 'urn:li:post:B',
      eligible_events: 'unknown', counted_bookings: 'unknown', resource_credit: 1, promotion_credit: 0 })
    expect(exact.views).toBe(other.views)
  })
})
