import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mapAudnRows, REVIEWED_SOURCES } from './collector-observations.mjs'

const base = { id: 1, client_id: 'ivan', post_social_id: '1', canonical_post_id: 'urn:li:activity:1',
  resolution_status: 'exact', source: 'n8n:XMuGMZJlcF9pB3Db:own_post_performance_tracker',
  coverage: { impressions: true }, published_at: '2026-09-03T00:00:00Z', captured_at: '2026-09-10T00:00:00Z' }

test('missing and true zero remain distinct', () => {
  const [zero, missing] = mapAudnRows([{ ...base, impressions: 0 }, { ...base, id: 2, coverage: { impressions: false }, impressions: 0 }])
  assert.equal(zero.observed_value, 0); assert.equal(zero.unknown_reason, null)
  assert.equal(missing.observed_value, null); assert.equal(missing.unknown_reason, 'impressions_not_retained_by_source')
})

test('tenant identity, late timestamp, unresolved identity, source scope and conflict veto survive mapping', () => {
  const rows = mapAudnRows([
    { ...base, id: 3, client_id: 'arch', captured_at: '2026-09-20T00:00:00Z', impressions: 4 },
    { ...base, id: 4, canonical_post_id: null, resolution_status: 'unresolved', unresolved_reason: 'no_identity_candidate', impressions: 4 },
    { ...base, id: 5, source: 'n8n:query-video-shorts:synthetic', impressions: 0 },
  ], ['arch:3'])
  assert.equal(rows[0].client_id, 'arch'); assert.equal(rows[0].captured_at, '2026-09-20T00:00:00Z')
  assert.equal(rows[0].eligibility_veto_reason, 'conflicting_source_replay')
  assert.equal(rows[1].unknown_reason, 'no_identity_candidate')
  assert.equal(rows[2].unknown_reason, 'unreviewed_source_scope')
})

test('SQL projector and mapper use the same exact reviewed-source allowlist', () => {
  const sql = readFileSync('db/206_editorial_collector_observations.sql', 'utf8')
  const block = sql.match(/r\.source not in \(([\s\S]*?)\) then why := 'unreviewed_source_scope'/)?.[1]
  assert.ok(block)
  const sqlSources = [...block.matchAll(/'(n8n:[^']+)'/g)].map(match => match[1]).sort()
  assert.deepEqual(sqlSources, [...REVIEWED_SOURCES].sort())
  assert.doesNotMatch(sql, /r\.source not like 'n8n:%:%'/)
})
