import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizePostOutcome, normalizeResourceOutcomes } from './editorialOutcomes'
import type { ResourceEvent, ResourceAttribution } from './editorialOutcomes'

const output = '../../proof/outcome-normalization.json'
const fixture = JSON.parse(readFileSync('../../tools/outcome-fixture.json', 'utf8'))

describe('post and resource outcomes', () => {
  it('executes duplicate, test, bot, version and canceled controls', () => {
    const resource = normalizeResourceOutcomes({ clientId: fixture.clientId, slug: fixture.slug,
      dataVersion: fixture.dataVersion, events: fixture.events as ResourceEvent[],
      attributions: fixture.attributions as ResourceAttribution[] })
    const post = normalizePostOutcome({ clientId: 'ivan', postId: 'post-1', metrics: {
      metrics_updated_at: '2026-09-20T14:00:00Z', num_impressions: 0, num_likes: null,
      num_comments: 2, social_id: 'urn:li:post:1' } })
    expect(resource.views).toBe(1)
    expect(resource.cta_clicks).toBe(1)
    expect(resource.captures).toBe(1)
    expect(resource.active_bookings).toBe(2)
    expect(resource.direct_bookings).toBe('unknown')
    expect(resource.excluded).toEqual({ test: 1, bot: 1, wrong_version: 1, duplicate: 4, canceled: 2 })
    expect(post.impressions).toBe(0)
    expect(post.reactions).toBe('unknown')
    mkdirSync('../../proof', { recursive: true })
    writeFileSync(output, JSON.stringify({ kind: 'local-executed-fixture',
      fixture: 'tools/outcome-fixture.json', resource, post }, null, 2) + '\n')
  })
})
