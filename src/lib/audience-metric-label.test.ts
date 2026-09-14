import { describe, expect, it } from 'vitest'
import { audienceMetricLabel } from './audience'
describe('audience metric provenance', () => {
 it('names the additive engagement measure instead of the legacy reactions column', () => {
  expect(audienceMetricLabel('matched_age_engagement_count')).toBe('engagements')
  expect(audienceMetricLabel('matched_age_reactions')).toBe('reactions')
  expect(audienceMetricLabel(null)).toBe('metric value')
 })
})
