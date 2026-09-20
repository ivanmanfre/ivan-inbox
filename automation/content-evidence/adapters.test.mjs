// Adapter tests. Synthetic rows only. No production endpoint is contacted: the adapters take an
// injected `query` so a test can observe the exact SQL and parameters they would have sent, and so
// a test can hand a reader a row it must never accept.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdapterError,
  createAdapters,
  READERS,
  REMOVED_READERS,
  REGISTERED_CLIENTS,
  MARKET_SOURCES,
  OWN_POST_SOURCES,
  SELFTEST_LANES,
  marketSourceFor,
  ownPostSourceFor,
  assertReadOnlySql,
  assertRowTenancy,
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

// ---------------------------------------------------------------------------
// The audit finding: caller-supplied SQL cannot establish tenancy
// ---------------------------------------------------------------------------

test('AUDIT COUNTEREXAMPLE: the unscoped select-$1 read is rejected and returns no foreign row', async () => {
  // out/content-evidence-01-independent-check-2026-09-20/CODE-AUDIT.md finding 4, reproduced with
  // the audit's own executor: any statement in which $1 merely APPEARS used to pass the tenant
  // check, so an unfiltered `select $1 as requested_client, p.*` returned another tenant's row.
  const rec = recorder([{ client_id: 'arch', secret: 'synthetic' }]);
  const a = createAdapters({ query: rec.query });
  let returned = 'nothing-was-returned';
  await assert.rejects(
    async () => {
      returned = await a.runReadOnly({
        clientId: 'ivan',
        sql: 'select $1 as requested_client, p.* from public.client_post_metrics p',
        params: ['ivan'],
      });
    },
    (err) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.code, 'ADAPTER_FREE_SQL_FORBIDDEN');
      return true;
    });
  assert.equal(returned, 'nothing-was-returned', 'the arch row must never reach the caller');
  assert.equal(rec.calls.length, 0, 'caller SQL must never reach the executor');
});

test('runReadOnly is a removed surface: every free SQL string is refused, correctly bound or not', async () => {
  const rec = recorder([{ client_id: 'ivan' }]);
  const a = createAdapters({ query: rec.query });
  assert.deepEqual(REMOVED_READERS, ['runReadOnly']);
  assert.ok(!READERS.includes('runReadOnly'), 'a free-SQL hatch is not a reader');
  assert.equal(typeof a.runReadOnly, 'function', 'the name stays so an old caller gets a named error');
  const attempts = [
    // the shape the old check accepted
    { clientId: 'ivan', sql: 'select $1 as requested_client, p.* from public.client_post_metrics p', params: ['ivan'] },
    // a genuinely scoped statement: still refused, because the module cannot audit caller text
    { clientId: 'risedtc', sql: 'select 1 from public.client_post_metrics where client_id = $1', params: ['risedtc'] },
    // a smuggled write
    { clientId: 'ivan', sql: 'update own_posts set x = 1', params: [] },
    // no client at all
    { sql: 'select 1', params: [] },
  ];
  for (const opts of attempts) {
    await assert.rejects(() => a.runReadOnly(opts), (err) => {
      assert.equal(err.code, 'ADAPTER_FREE_SQL_FORBIDDEN');
      assert.match(err.message, /named reader/i);
      return true;
    }, `free SQL must be refused: ${opts.sql}`);
  }
  assert.equal(rec.calls.length, 0, 'no caller-supplied statement may reach the executor');
});

test('every named reader runs a module constant containing its own scope predicate', async () => {
  const rec = recorder();
  const a = createAdapters({ query: rec.query });
  for (const name of READERS) await a[name]({ clientId: 'risedtc' });
  assert.equal(rec.calls.length, READERS.length);
  for (const { sql, params } of rec.calls) {
    assert.equal(assertReadOnlySql(sql), true);
    assert.deepEqual(params, ['risedtc'], 'the client is the bound parameter of every named read');
    assert.match(sql, /\bwhere\b/i);
    assert.match(sql, /=\s*\$1/, `a named reader must filter rows by the bound client: ${sql}`);
  }
});

// ---------------------------------------------------------------------------
// Output tenancy: a foreign row is thrown on, never filtered away in silence
// ---------------------------------------------------------------------------

test('a named reader throws when the executor returns a foreign row', async () => {
  const foreign = [{ client_id: 'arch', secret: 'synthetic', social_id: 'x', post_url: 'https://x/1' }];
  const cases = [
    ['readOwnPosts', 'risedtc'],
    ['readStudyReading', 'risedtc'],
    ['readRoster', 'risedtc'],
    ['readMarketPosts', 'risedtc'],
    ['readMarketPosts', 'ivan'],
  ];
  for (const [name, clientId] of cases) {
    const rec = recorder(foreign);
    const a = createAdapters({ query: rec.query });
    await assert.rejects(() => a[name]({ clientId }), (err) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.code, 'ADAPTER_TENANCY_VIOLATION');
      assert.match(err.message, /arch/);
      return true;
    }, `${name}/${clientId} must throw on a foreign row, not filter it`);
  }
  // the seat-scoped reader has its own tenant column and the same rule
  const rec = recorder([{ seat: 'arch', activity_id: '7' }]);
  const a = createAdapters({ query: rec.query });
  await assert.rejects(() => a.readOwnAudience({ clientId: 'ivan' }),
    (err) => err.code === 'ADAPTER_TENANCY_VIOLATION');
});

test('a named reader returns same-client rows unchanged', async () => {
  const rec = recorder([
    { client_id: 'risedtc', social_id: 'urn:li:activity:9', post_url: 'https://x/9', title: 't',
      published_at: '2026-08-01T00:00:00Z', captured_at: '2026-09-01T00:00:00Z',
      impressions: 10, reactions: 0, comments: null, shares: 2 },
  ]);
  const a = createAdapters({ query: rec.query });
  const rows = await a.readOwnPosts({ clientId: 'risedtc' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].client_id, 'risedtc');
  assert.equal(rows[0].metrics.impressions, 10);
  assert.equal(rows[0].metrics.reactions, 0);
  assert.equal(rows[0].metrics.comments, null);

  const rec2 = recorder([{ client_id: 'risedtc', run_id: 'r1', reading: { a: 1 }, created_at: '2026-09-01T00:00:00Z' }]);
  const a2 = createAdapters({ query: rec2.query });
  const reading = await a2.readStudyReading({ clientId: 'risedtc' });
  assert.equal(reading.run_id, 'r1');
});

test('a tenanted row that cannot prove its tenancy is refused, not assumed', async () => {
  // A row from a tenanted table with no tenant value proves nothing. Only a source descriptor that
  // declares an untenanted population may return rows without one.
  const rec = recorder([{ social_id: 'x', post_url: 'https://x/1' }]);
  const a = createAdapters({ query: rec.query });
  await assert.rejects(() => a.readOwnPosts({ clientId: 'risedtc' }),
    (err) => err.code === 'ADAPTER_TENANCY_VIOLATION');
  // ivan's market source declares includesNullTenant, so an untagged legacy row is its corpus
  const rec2 = recorder([{ linkedin_post_url: 'https://x/1', competitor_name: 'A', client_id: null }]);
  const a2 = createAdapters({ query: rec2.query });
  assert.equal((await a2.readMarketPosts({ clientId: 'ivan' })).length, 1);
});

test('assertRowTenancy is exported and agrees with the source descriptor row by row', () => {
  for (const clientId of ['ivan', 'risedtc', 'arch']) {
    const src = marketSourceFor(clientId);
    for (const row of MARKET_FIXTURE) {
      const allowed = src.matches(row, clientId);
      if (allowed) {
        assert.equal(assertRowTenancy('readMarketPosts', src, clientId, [row]), true);
      } else {
        assert.throws(() => assertRowTenancy('readMarketPosts', src, clientId, [row]),
          (err) => err.code === 'ADAPTER_TENANCY_VIOLATION',
          `${clientId} must reject ${JSON.stringify(row)}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Scope comes from the explicit registry, never from a caller's string
// ---------------------------------------------------------------------------

test('a clientId outside the explicit registry is refused everywhere', async () => {
  assert.deepEqual([...REGISTERED_CLIENTS].sort(), ['arch', 'ivan', 'risedtc']);
  const rec = recorder(MARKET_FIXTURE);
  const a = createAdapters({ query: rec.query });
  for (const clientId of ['t-nobody', 'IVAN', 'ivan ', 'arch-staging']) {
    for (const name of READERS) {
      await assert.rejects(() => a[name]({ clientId }), (err) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.code, 'ADAPTER_UNKNOWN_CLIENT');
        return true;
      }, `${name} must refuse the unregistered client ${JSON.stringify(clientId)}`);
    }
    assert.throws(() => marketSourceFor(clientId), (err) => err.code === 'ADAPTER_UNKNOWN_CLIENT');
    assert.throws(() => ownPostSourceFor(clientId), (err) => err.code === 'ADAPTER_UNKNOWN_CLIENT');
  }
  assert.equal(rec.calls.length, 0, 'an unregistered client never reaches the executor');
});

test('own_posts is untenanted, so only the descriptor that names it can reach it', async () => {
  assert.equal(OWN_POST_SOURCES.ivan.table, 'public.own_posts');
  assert.equal(OWN_POST_SOURCES.ivan.tenantColumn, null);
  assert.equal(OWN_POST_SOURCES.ivan.untenanted, true);
  assert.equal(OWN_POST_SOURCES.ivan.onlyClient, 'ivan');
  assert.equal(OWN_POST_SOURCES.ivan.tenancy, 'untenanted table; ivan-only by descriptor');
  assert.equal(OWN_POST_SOURCES.default.tenantColumn, 'client_id');
  assert.equal(OWN_POST_SOURCES.default.untenanted, false);

  const rec = recorder();
  const a = createAdapters({ query: rec.query });
  await a.readOwnPosts({ clientId: 'ivan' });
  assert.match(rec.calls[0].sql, /from public\.own_posts/);

  // No other client can reach the untenanted table, by construction rather than by predicate.
  for (const clientId of ['risedtc', 'arch']) {
    assert.equal(ownPostSourceFor(clientId).table, 'public.client_post_metrics');
    const r2 = recorder();
    const a2 = createAdapters({ query: r2.query });
    await a2.readOwnPosts({ clientId });
    assert.ok(!/own_posts/.test(r2.calls[0].sql), `${clientId} must not reach own_posts`);
    assert.match(r2.calls[0].sql, /where m\.client_id = \$1/);
    assert.deepEqual(r2.calls[0].params, [clientId]);
  }
  // and the untenanted descriptor itself refuses to serve anybody but the client it names
  assert.throws(() => assertRowTenancy('readOwnPosts', OWN_POST_SOURCES.ivan, 'arch', []),
    (err) => err.code === 'ADAPTER_UNTENANTED_SOURCE');
  assert.equal(assertRowTenancy('readOwnPosts', OWN_POST_SOURCES.ivan, 'ivan', [{ social_id: 'x' }]), true);
  // a foreign tag on an untenanted row is still a foreign row
  assert.throws(() => assertRowTenancy('readOwnPosts', OWN_POST_SOURCES.ivan, 'ivan', [{ client_id: 'arch' }]),
    (err) => err.code === 'ADAPTER_TENANCY_VIOLATION');
  assert.throws(() => ownPostSourceFor('zz-selftest'), (err) => err.code === 'ADAPTER_SELFTEST_LANE');
});

test('no reader compares a bound parameter to a literal instead of filtering rows', async () => {
  const rec = recorder();
  const a = createAdapters({ query: rec.query });
  for (const clientId of ['ivan', 'risedtc', 'arch']) {
    await a.readMarketPosts({ clientId });
    await a.readOwnPosts({ clientId });
    await a.readOwnAudience({ clientId });
    await a.readStudyReading({ clientId });
    await a.readRoster({ clientId });
  }
  assert.ok(rec.calls.length > 0);
  for (const { sql } of rec.calls) {
    // `where $1 = 'ivan'` is a whole-statement boolean, not a row filter.
    assert.ok(!/\$\d+\s*=\s*'/.test(sql),
      `a reader compares a bound parameter to a literal: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
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
    const inScope = MARKET_FIXTURE.filter((r) => src.matches(r, clientId));
    const rows = inScope.map((r) => ({ ...r, linkedin_post_url: `https://x/${r.id}` }));
    const rec = recorder(rows);
    const a = createAdapters({ query: rec.query });
    const got = await a.readMarketPosts({ clientId });
    assert.equal(got.length, inScope.length, `${clientId}: descriptor and reader disagree`);
    assert.match(rec.calls[0].sql, new RegExp(escapeRe(src.tenantPredicate)));
  }
});

test('one tenant can never see another tenant or the selftest lane', async () => {
  const rows = MARKET_FIXTURE.map((r) => ({ ...r, linkedin_post_url: `https://x/${r.id}` }));
  for (const clientId of ['risedtc', 'arch', 'ivan']) {
    const rec = recorder(rows);
    const a = createAdapters({ query: rec.query });
    // The mixed population contains rows this lane must not hold. A filtered, quietly-narrowed
    // result would hide a broken predicate, so the reader throws instead.
    await assert.rejects(() => a.readMarketPosts({ clientId }), (err) => {
      assert.equal(err.code, 'ADAPTER_TENANCY_VIOLATION');
      return true;
    }, `${clientId} must refuse a mixed-tenant result`);
    assert.match(rec.calls[0].sql, /not in \('zz-selftest'\)/);
  }
});

test('zz-selftest is excluded by name from every population; lane_allowed is not a scope test', async () => {
  assert.deepEqual(SELFTEST_LANES, ['zz-selftest']);
  assert.ok(!REGISTERED_CLIENTS.includes('zz-selftest'));
  assert.throws(() => marketSourceFor('zz-selftest'), (err) => {
    assert.equal(err.code, 'ADAPTER_SELFTEST_LANE');
    assert.match(err.message, /lane_allowed/);
    return true;
  });
  const rec = recorder(MARKET_FIXTURE);
  const a = createAdapters({ query: rec.query });
  for (const name of READERS) {
    await assert.rejects(() => a[name]({ clientId: 'zz-selftest' }),
      (err) => err.code === 'ADAPTER_SELFTEST_LANE', `${name} must refuse the selftest lane`);
  }
  await assert.rejects(() => a.runReadOnly({ clientId: 'zz-selftest', sql: 'select 1', params: [] }),
    (err) => err.code === 'ADAPTER_FREE_SQL_FORBIDDEN');
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
    { client_id: 'risedtc', linkedin_post_url: 'https://x/1', competitor_name: 'A', linkedin_profile_url: 'https://x/a',
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
    { client_id: 'risedtc', linkedin_post_url: 'https://x/1', competitor_name: 'A', linkedin_profile_url: 'https://x/a',
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
