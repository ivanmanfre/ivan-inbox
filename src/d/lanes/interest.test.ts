import { describe, expect, it } from 'vitest'
import { interestSource } from './interest'

describe('person-level interest source', () => {
  it('separates own-post, creator and content interest for Ivan without campaign-name guesses', () => {
    expect(interestSource('ivan', { trigger_type: 'engaged_post', lane: 'own_post_engager' })).toBe('own_post_engager')
    expect(interestSource('ivan', { trigger_type: 'content_engagement', source: 'engagement_harvest' })).toBe('competitor_engager')
    expect(interestSource('ivan', { trigger_type: 'content_signal' })).toBe('content_signal')
    expect(interestSource('ivan', { source: 'profile_view' })).toBe('profile_view')
    expect(interestSource('ivan', { trigger_type: 'hiring' })).toBeNull()
  })
  it('requires a target-person reaction for the RISE warm source, including company-first discoveries', () => {
    const target = { source: 'rise_warm_engager', engagement_kind: 'reaction', post_id: 'post', anchor: 'creator' }
    expect(interestSource('risedtc', target)).toBe('competitor_engager')
    expect(interestSource('risedtc', { ...target, company_first: true })).toBe('competitor_engager')
    expect(interestSource('risedtc', { source: 'rise_warm_engager', company_first: true })).toBeNull()
    expect(interestSource('risedtc', { ...target, engagement_kind: null })).toBeNull()
    expect(interestSource('risedtc', { source: 'competitor_engager_mega_r3_apify' })).toBe('competitor_engager')
    expect(interestSource('risedtc', { source: 'rise_partner_search' })).toBeNull()
  })
  it('uses ARCH provenance even when a warm engager is in the Cold campaign', () => {
    expect(interestSource('arch', { source_kind: 'competitor_post_engager', lane: 'engager_warm' })).toBe('competitor_engager')
    expect(interestSource('arch', { source_kind: 'own_post_engager' })).toBe('own_post_engager')
    expect(interestSource('arch', { source_kind: 'profile_view_warm' })).toBe('profile_view')
    expect(interestSource('arch', { source_kind: 'hiring_signal', lane: 'engager_warm' })).toBeNull()
  })
  it('keeps SwishDM anchor engagement and excludes its generic free pool', () => {
    expect(interestSource('swishdm', { source: 'swishdm_anchor_engager' })).toBe('competitor_engager')
    expect(interestSource('swishdm', { source: 'swishdm_free_pool' })).toBeNull()
  })
})
