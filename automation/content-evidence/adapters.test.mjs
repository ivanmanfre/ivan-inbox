// Adapter tests. Synthetic rows only. No production endpoint is contacted: the adapters take an
// injected `query` so a test can observe the exact SQL and parameters they would have sent.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdapterError,
  createAdapters,
  READERS,
  MARKET_SOURCES,
  SELFTEST_LANES,
  marketSourceFor,
  assertReadOnlySql,
} from './adapters.mjs';

// A miniature of the measured production population, 2026-09-20 (read-only SELECT):
//   competitor_posts       client_id IS NULL -> 2163 rows | client_id = 'ivan' -> 1 row
//   audn_competitor_posts  arch 439 | risedtc 655 | zz-selftest 12
const MARKET_FIXTURE = [
  ...Array.from({ length: 5 }, (_, i) => ({ client_id: null, id: `legacy-${i}` })),
  { client_id: 'ivan', id: 'tagged-ivan' },
  { client_id: 'risedtc', id: 'rise-1' },
  { client_id: 'risedtc', id: 'rise-2' },
  { client_id: 'arch', id: 'arch-1' },
  { client_id: 'zz-selftest', id: 'selftest-1' },
];

function recorder(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => { calls.push({ sql, params }); return rows; },
  };
}

test('every reader refuses to build a query without an explicit client', async () => {
  const rec = recorder();
  const a = createAdapters({ query: rec.query });
  assert.ok(READERS.length >= 4);
  for (const name of READERS) {
    await assert.rejects(() => a[name]({}), (err) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.code, 'ADAPTER_MISSING_CLIENT');
      assert.match(err.message, new RegExp(name));
      return true;
    }, `${name} must refuse a missing clientId`);
    await assert.rejects(() => a[name]({ clientId: '' }),
      (err) => err.code === 'ADAPTER_MISSING_CLIENT');
  }
  assert.equal(rec.calls.length, 0, 'no SQL may be sent without a client');
});

test('the client is passed as a bound parameter, never interpolated', async () => {
  const rec = recorder();
  const a = createAdapters({ query: rec.query });
  await a.readMarketPosts({ clientId: 'risedtc' });
  const call = rec.calls[0];
  assert.ok(call.params.includes('risedtc'));
  assert.ok(!call.sql.includes('risedtc'));
});

test('an adapter never writes: a non-select statement is refused', () => {
  assert.throws(() => assertReadOnlySql('delete from client_research_studies'),
    (err) => err.code === 'ADAPTER_WRITE_FORBIDDEN');
  assert.throws(() => assertReadOnlySql("select 1; insert into t values (1)"),
    (err) => err.code === 'ADAPTER_WRITE_FORBIDDEN');
  // column names that merely contain a verb are fine
  assert.equal(assertReadOnlySql('select updated_at, deleted_at from t'), true);
  assert.equal(assertReadOnlySql('with x as (select 1) select * from x'), true);
});

test('the adapter refuses a query the caller smuggled a write into', async () => {
  const rec = recorder();
  const a = createAdapters({ query: rec.query });
  await assert.rejects(() => a.runReadOnly({ clientId: 'ivan', sql: 'update own_posts set x = 1', params: [] }),
    (err) => err.code === 'ADAPTER_WRITE_FORBIDDEN');
});

test('ivan reads the legacy shared market table, another tenant reads its own', async () => {
  const rec = recorder();
  const a = createAdapters({ query: rec.query });
  await a.readMarketPosts({ clientId: 'ivan' });
  assert.match(rec.calls[0].sql, /from public\.competitor_posts/);
  await a.readMarketPosts({ clientId: 'risedtc' });
  assert.match(rec.calls[1].sql, /from public\.audn_competitor_posts/);
  assert.ok(!/competitor_posts\b(?!.*audn)/.test(rec.calls[1].sql.replace(/audn_competitor_posts/g, 'X')));
});

test("ivan's market source is the NULL-inclusive descriptor, never client_id = 'ivan'", () => {
  const src = marketSourceFor('ivan');
  assert.equal(src.table, 'public.competitor_posts');
  assert.equal(src.includesNullTenant, true);
  assert.match(src.tenantPredicate, /client_id is null/);
  assert.equal(MARKET_SOURCES.default.includesNullTenant, false);
  assert.equal(marketSourceFor('risedtc').table, 'public.audn_competitor_posts');
});

test("a market read for ivan is never narrower than the untenanted population", () => {
  const src = marketSourceFor('ivan');
  const kept = MARKET_FIXTURE.filter((r) => src.matches(r, 'ivan'));
  const untenanted = MARKET_FIXTURE.filter((r) => r.client_id === null);
  const naiveEqualsIvan = MARKET_FIXTURE.filter((r) => r.client_id === 'ivan');
  // The exact mistake this guards: `where client_id = 'ivan'` returns 1 row out of 2164 in
  // production and reports no error.
  assert.ok(kept.length >= untenanted.length,
    `ivan market read dropped untenanted rows: kept ${kept.length}, untenanted ${untenanted.length}`);
  assert.ok(kept.length > naiveEqualsIvan.length,
    'the ivan population must be strictly larger than the rows literally tagged "ivan"');
  assert.equal(kept.length, untenanted.length + naiveEqualsIvan.length);
});

test('the SQL predicate and the in-memory predicate agree for every lane', async () => {
  for (const clientId of ['ivan', 'risedtc', 'arch']) {
    const src = marketSourceFor(clientId);
    const rec = recorder(MARKET_FIXTURE.map((r) => ({ ...r, linkedin_post_url: `https://x/${r.id}` })));
    const a = createAdapters({ query: rec.query });
    const rows = await a.readMarketPosts({ clientId });
    const expected = MARKET_FIXTURE.filter((r) => src.matches(r, clientId));
    assert.equal(rows.length, expected.length, `${clientId}: descriptor and reader disagree`);
    assert.match(rec.calls[0].sql, new RegExp(escapeRe(src.tenantPredicate)));
  }
});

test('one tenant can never see another tenant or the selftest lane', async () => {
  const rows = MARKET_FIXTURE.map((r) => ({ ...r, linkedin_post_url: `https://x/${r.id}` }));
  for (const [clientId, forbidden] of [['risedtc', ['arch', 'zz-selftest']], ['arch', ['risedtc', 'zz-selftest']]]) {
    const rec = recorder(rows);
    const a = createAdapters({ query: rec.query });
    const got = await a.readMarketPosts({ clientId });
    assert.ok(got.length > 0, `${clientId} must read its own rows`);
    for (const other of forbidden) {
      const leaked = MARKET_FIXTURE.filter((r) => r.client_id === other)
        .some((r) => got.some((g) => g.source_url === `https://x/${r.id}`));
      assert.equal(leaked, false, `${other} rows leaked into the ${clientId} market read`);
    }
    assert.match(rec.calls[0].sql, /not in \('zz-selftest'\)/);
  }
});

test('zz-selftest is excluded by name from every population; lane_allowed is not a scope test', async () => {
  assert.deepEqual(SELFTEST_LANES, ['zz-selftest']);
  assert.throws(() => marketSourceFor('zz-selftest'), (err) => {
    assert.equal(err.code, 'ADAPTER_SELFTEST_LANE');
    assert.match(err.message, /lane_allowed/);
    return true;
  });
  const rec = recorder(MARKET_FIXTURE);
  const a = createAdapters({ query: rec.query });
  for (const name of READERS) {
    await assert.rejects(() => a[name]({ clientId: 'zz-selftest', sql: 'select 1', params: [] }),
      (err) => err.code === 'ADAPTER_SELFTEST_LANE', `${name} must refuse the selftest lane`);
  }
  assert.equal(rec.calls.length, 0);
  // and the lane cannot be read as somebody else's rows either
  for (const clientId of ['ivan', 'risedtc', 'arch']) {
    assert.equal(marketSourceFor(clientId).matches({ client_id: 'zz-selftest' }, clientId), false);
  }
});

test('a market row is never an own-control row (db/102, ratified 2026-09-19)', async () => {
  const rec = recorder([{ client_id: 'risedtc', linkedin_post_url: 'https://x/1', competitor_name: 'A',
    post_date: '2026-08-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z',
    likes_count: 1, comments_count: 1, reposts_count: 0, post_text: 't', post_type: 'text' }]);
  const a = createAdapters({ query: rec.query });
  const [row] = await a.readMarketPosts({ clientId: 'risedtc' });
  assert.equal(row.is_own_control, false);
});

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

test('a missing metric stays null and a real zero stays zero', async () => {
  const rec = recorder([
    { linkedin_post_url: 'https://x/1', competitor_name: 'A', linkedin_profile_url: 'https://x/a',
      post_date: '2026-08-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z',
      likes_count: 0, comments_count: null, reposts_count: 0, post_text: 'body', post_type: 'text' },
  ]);
  const a = createAdapters({ query: rec.query });
  const [row] = await a.readMarketPosts({ clientId: 'risedtc' });
  assert.equal(row.metrics.likes, 0);
  assert.equal(row.metrics.reposts, 0);
  assert.equal(row.metrics.comments, null);
});

test('publication and capture dates are distinct fields and a capture never fills a publication', async () => {
  const rec = recorder([
    { linkedin_post_url: 'https://x/1', competitor_name: 'A', linkedin_profile_url: 'https://x/a',
      post_date: null, created_at: '2026-09-01T00:00:00Z',
      likes_count: 3, comments_count: 1, reposts_count: 0, post_text: 'body', post_type: 'text' },
  ]);
  const a = createAdapters({ query: rec.query });
  const [row] = await a.readMarketPosts({ clientId: 'risedtc' });
  assert.equal(row.source_dates.published_at, null);
  assert.equal(row.capture_dates.captured_at, '2026-09-01T00:00:00.000Z');
  assert.notEqual(row.source_dates.published_at, row.capture_dates.captured_at);
});

test('own posts keep their own capture stamp separate from publication', async () => {
  const rec = recorder([
    { social_id: 'urn:li:activity:1', linkedin_url: 'https://x/own/1', post_text: 'own body',
      posted_at: '2026-08-02T00:00:00Z', metrics_updated_at: '2026-09-02T00:00:00Z',
      scraped_at: '2026-09-03T00:00:00Z',
      num_likes: 12, num_comments: 0, num_shares: null, num_impressions: null,
      profile_views_from_post: 0, post_type: 'text' },
  ]);
  const a = createAdapters({ query: rec.query });
  const [row] = await a.readOwnPosts({ clientId: 'ivan' });
  assert.equal(row.source_dates.published_at, '2026-08-02T00:00:00.000Z');
  assert.equal(row.capture_dates.captured_at, '2026-09-02T00:00:00.000Z');
  assert.equal(row.metrics.comments, 0);
  assert.equal(row.metrics.shares, null);
  assert.equal(row.metrics.impressions, null);
});

test('the audience reader is seat-scoped and keeps unknown demographics null', async () => {
  const rec = recorder([
    { seat: 'ivan', activity_id: '7', post_url: 'https://x/7', published_at: '2026-08-01T00:00:00Z',
      captured_at: '2026-09-01T00:00:00Z', impressions: null, reactions: 0, comments: 0,
      members_reached: null, demographics: null, source: 'backfill' },
  ]);
  const a = createAdapters({ query: rec.query });
  const [row] = await a.readOwnAudience({ clientId: 'ivan' });
  assert.equal(row.metrics.impressions, null);
  assert.equal(row.metrics.reactions, 0);
  assert.equal(row.demographics, null);
  assert.ok(rec.calls[0].params.includes('ivan'));
});
