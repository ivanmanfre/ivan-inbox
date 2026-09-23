import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { PlatformSourceError, PLATFORM_QUERY_CONFIGS, normalizePlatformSource } from './platform-sources.mjs';

test('normalizes one captured raw provider response for every configured client/platform cell', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../../content-brain-07-repair-2026-09-22-out/private/platform-normalization-requests.json', import.meta.url), 'utf8'));
  const expected = new Map([
    ['ivan/reddit/ivan-reddit-agency-owner-v1', 'public_post'],
    ['ivan/x/ivan-x-agency-owner-v1', 'candidate'],
    ['risedtc/reddit/risedtc-reddit-founder-pain-v1', 'public_post'],
    ['risedtc/x/risedtc-x-topic-and-reaction-v1', 'public_post'],
    ['arch/reddit/arch-reddit-ua-pain-v1', 'public_post'],
    ['arch/x/arch-x-mobile-games-ua-v1', 'public_post'],
  ]);
  for (const [cell, kind] of expected) {
    const row = fixture.find(item => [item.clientId, item.platform, item.queryConfigId].join('/') === cell);
    assert.ok(row, `captured fixture missing ${cell}`);
    const normalized = await normalizePlatformSource(row);
    assert.equal(normalized.source_kind, kind, cell);
    assert.equal(normalized.source_client_scope, 'public', cell);
    assert.equal(normalized.permission_state, 'public_source', cell);
    assert.ok(normalized.passage, `${cell} original body`);
    assert.ok(normalized.candidate_fields.acquisition.provider_run_id, `${cell} provider run`);
    assert.ok(Object.keys(normalized.candidate_fields.acquisition.query_input).length, `${cell} query`);
    const expectedMetrics = row.platform === 'x'
      ? { likes: Number(row.row.likeCount ?? row.row.likes), replies: Number(row.row.replyCount ?? row.row.replies),
        reposts: Number(row.row.retweetCount ?? row.row.reposts), quotes: Number(row.row.quoteCount ?? row.row.quotes),
        views: row.row.viewCount ?? row.row.views ?? null }
      : { score: Number(row.row.score), comments: Number(row.row.num_comments ?? row.row.comments) };
    assert.deepEqual(normalized.candidate_fields.observed_metrics, expectedMetrics, `${cell} native metrics`);
  }
});

test('preserves a captured true-zero native metric instead of treating it as missing', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../../content-brain-07-repair-2026-09-22-out/private/platform-normalization-requests.json', import.meta.url), 'utf8'));
  const row = fixture.find(item => item.clientId === 'arch' && item.platform === 'reddit' && item.row.id === '1wn8o0q');
  const normalized = await normalizePlatformSource(row);
  assert.equal(normalized.candidate_fields.observed_metrics.score, 0);
  assert.equal(normalized.candidate_fields.observed_metrics.comments, 0);
  assert.equal(normalized.source_kind, 'public_post');
});

test('normalizes a complete X source without promoting it to an outlier without a baseline', async () => {
  const source = await normalizePlatformSource({
    clientId: 'ivan', platform: 'x', queryConfigId: 'ivan-x-agency-owner-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { client_id: 'ivan', id: 'x-1', url: 'https://x.com/example/status/1', text: 'Original post.',
      created_at: '2026-09-21T10:00:00Z', permission_state: 'public_source',
      provider: 'apify', provider_run_id: 'run-x-1', query_input: { query: 'agency owner', sort: 'Latest' },
      likeCount: 12, replyCount: 3, retweetCount: 1, quoteCount: 2, viewCount: 100 },
  });
  assert.equal(source.source_kind, 'public_post');
  assert.equal(source.passage, 'Original post.');
  assert.equal(source.candidate_fields.observed_metrics.likes, 12);
  assert.equal(source.candidate_fields.observed_metrics.quotes, 2);
  assert.equal(source.candidate_fields.outlier.status, 'not_measured');
  assert.equal(source.candidate_fields.body_state, 'full');
  assert.equal(source.candidate_fields.acquisition.provider_run_id, 'run-x-1');
  assert.deepEqual(source.candidate_fields.acquisition.query_input, { query: 'agency owner', sort: 'Latest' });
});

test('keeps a missing body or date as a candidate gap and preserves zero metrics', async () => {
  const source = await normalizePlatformSource({
    clientId: 'risedtc', platform: 'reddit', queryConfigId: 'risedtc-reddit-founder-pain-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { client_id: 'risedtc', id: 'rd-1', url: 'https://reddit.com/r/shopify/comments/a', title: 'A title',
      score: 0, num_comments: 0 },
  });
  assert.equal(source.source_kind, 'candidate');
  assert.equal(source.passage, null);
  assert.equal(source.published_date_state, 'unknown');
  assert.equal(source.candidate_fields.observed_metrics.score, 0);
  assert.equal(source.candidate_fields.body_state, 'unavailable');
  assert.equal(source.candidate_fields.outlier.status, 'not_measured');
});

test('rejects a foreign client row before it can be normalized', async () => {
  await assert.rejects(() => normalizePlatformSource({
    clientId: 'arch', platform: 'x', queryConfigId: 'arch-x-mobile-games-ua-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { client_id: 'risedtc', id: 'bad', url: 'https://x.com/x/status/1', text: 'wrong lane', created_at: '2026-09-21T10:00:00Z' },
  }), (err) => err instanceof PlatformSourceError && err.code === 'PLATFORM_TENANT_MISMATCH');
});

test('retains a comparison payload as unverified discovery and never promotes it to a measured outlier', async () => {
  const source = await normalizePlatformSource({
    clientId: 'arch', platform: 'reddit', queryConfigId: 'arch-reddit-ua-pain-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { client_id: 'arch', id: 'rd-2', url: 'https://reddit.com/r/gamedev/comments/b', title: 'UA pain',
      body: 'Bounded retained excerpt.', body_state: 'excerpt', created_utc: 1758535200,
      permission_state: 'public_source', provider: 'apify', provider_run_id: 'run-r-1',
      query_input: { subreddit: 'gamedev', query: 'user acquisition', sort: 'top' }, score: 42, num_comments: 8,
      comparison: { baseline_value: 14, baseline_n: 3, metric: 'score_plus_comments', formula: 'score + comments',
        population: [{ id: 'rd-a', observed_value: 7 }, { id: 'rd-b', observed_value: 14 }, { id: 'rd-c', observed_value: 21 }],
        platform: 'reddit', query_config_id: 'arch-reddit-ua-pain-v1',
        window_start: '2026-09-01T00:00:00Z', window_end: '2026-09-22T00:00:00Z',
        filter_signature: 'subreddit=gamedev;query=user acquisition', selection_method: 'full_query_population',
        winner_only: false } },
  });
  assert.equal(source.candidate_fields.body_state, 'excerpt');
  assert.equal(source.candidate_fields.outlier.status, 'not_measured');
  assert.deepEqual(source.candidate_fields.unverified_comparison.population[0], { id: 'rd-a', observed_value: 7 });
});

test('recursive canonical hash changes for nested evidence and is stable across key order', async () => {
  const base = { clientId: 'ivan', platform: 'x', queryConfigId: 'ivan-x-agency-owner-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { client_id: 'ivan', id: 'hash-1', url: 'https://x.com/example/status/hash-1', text: 'Original post.',
      created_at: '2026-09-21T10:00:00Z', permission_state: 'public_source', likes: 20,
      comparison: { observed_value: 20, baseline_value: 10, baseline_n: 2,
        population: [{ id: 'a', observed_value: 5 }, { id: 'b', observed_value: 15 }], platform: 'x',
        query_config_id: 'ivan-x-agency-owner-v1', window_start: '2026-09-01T00:00:00Z',
        window_end: '2026-09-22T00:00:00Z', filter_signature: 'lang=en',
        selection_method: 'full_query_population', winner_only: false } } };
  const first = await normalizePlatformSource(base);
  const reordered = await normalizePlatformSource({ ...base, row: { comparison: {
    winner_only: false, selection_method: 'full_query_population', filter_signature: 'lang=en',
    window_end: '2026-09-22T00:00:00Z', window_start: '2026-09-01T00:00:00Z',
    query_config_id: 'ivan-x-agency-owner-v1', platform: 'x',
    population: [{ id: 'a', observed_value: 5 }, { id: 'b', observed_value: 15 }], baseline_n: 2, observed_value: 20,
    baseline_value: 10 }, permission_state: 'public_source', created_at: '2026-09-21T10:00:00Z',
    likes: 20, text: 'Original post.', url: 'https://x.com/example/status/hash-1', id: 'hash-1', client_id: 'ivan' } });
  const changed = await normalizePlatformSource({ ...base, row: { ...base.row,
    comparison: { ...base.row.comparison, filter_signature: 'lang=en;min_faves=10' } } });
  assert.equal(first.snapshot_hash, reordered.snapshot_hash);
  assert.notEqual(first.snapshot_hash, changed.snapshot_hash);
});

test('retains denied permission and makes even a complete public URL ineligible', async () => {
  const source = await normalizePlatformSource({
    clientId: 'risedtc', platform: 'x', queryConfigId: 'risedtc-x-topic-and-reaction-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { client_id: 'risedtc', id: 'denied-1', url: 'https://x.com/example/status/denied-1', text: 'Retained body.',
      created_at: '2026-09-21T10:00:00Z', permission_state: 'denied' },
  });
  assert.equal(source.permission_state, 'denied');
  assert.equal(source.source_kind, 'candidate');
  assert.equal(source.independent, false);
  assert.match(source.gap_state.detail, /permission/i);
});

test('does not measure winner-only, mismatched or unproven comparison populations', async () => {
  const base = { clientId: 'arch', platform: 'reddit', queryConfigId: 'arch-reddit-ua-pain-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { client_id: 'arch', id: 'cmp-1', url: 'https://reddit.com/r/gamedev/comments/cmp-1', body: 'Body.',
      created_utc: 1758535200, permission_state: 'public_source', score: 42, num_comments: 8,
      comparison: { baseline_value: 14, baseline_n: 2,
        population: [{ id: 'a', observed_value: 7 }, { id: 'b', observed_value: 21 }], platform: 'reddit',
        query_config_id: 'arch-reddit-ua-pain-v1', window_start: '2026-09-01T00:00:00Z',
        window_end: '2026-09-22T00:00:00Z', filter_signature: 'subreddit=gamedev',
        selection_method: 'full_query_population', winner_only: false } } };
  for (const comparison of [
    { ...base.row.comparison, winner_only: true },
    { ...base.row.comparison, platform: 'x' },
    { ...base.row.comparison, query_config_id: 'other-query' },
    { ...base.row.comparison, population: [{ id: 'a', observed_value: 14 }] },
    { ...base.row.comparison, filter_signature: '' },
  ]) {
    const source = await normalizePlatformSource({ ...base, row: { ...base.row, comparison } });
    assert.equal(source.candidate_fields.outlier.status, 'not_measured');
  }
});

test('does not trust a crafted comparison even when every declared proof field is internally consistent', async () => {
  const source = await normalizePlatformSource({
    clientId: 'ivan', platform: 'x', queryConfigId: 'ivan-x-agency-owner-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { id: 'crafted', url: 'https://x.com/example/status/crafted', text: 'Body',
      created_at: '2026-09-21T10:00:00Z', permission_state: 'public_source', provider: 'apify',
      provider_run_id: 'crafted-run', query_input: { query: 'crafted', sort: 'Top' },
      likes: 999, replies: 0, reposts: 0, quotes: 0, views: 999,
      comparison: { observed_value: 999, baseline_value: 10, baseline_n: 3,
        population: [{ id: 'a', observed_value: 5 }, { id: 'b', observed_value: 10 }, { id: 'c', observed_value: 15 }],
        platform: 'x', query_config_id: 'ivan-x-agency-owner-v1', window_start: '2026-09-01T00:00:00Z',
        window_end: '2026-09-22T00:00:00Z', filter_signature: 'crafted',
        selection_method: 'full_query_population', winner_only: false } },
  });
  assert.equal(source.candidate_fields.outlier.status, 'not_measured');
  assert.match(source.candidate_fields.outlier.reason, /discovery/i);
});

test('rejects a URL whose domain does not match the claimed platform', async () => {
  await assert.rejects(() => normalizePlatformSource({
    clientId: 'ivan', platform: 'x', queryConfigId: 'ivan-x-agency-owner-v1', observedAt: '2026-09-22T10:00:00Z',
    row: { id: 'wrong-domain', url: 'https://reddit.com/r/agency/comments/wrong', text: 'Body',
      created_at: '2026-09-21T10:00:00Z', permission_state: 'public_source',
      likes: 1, replies: 0, reposts: 0, quotes: 0, views: 10 },
  }), (err) => err instanceof PlatformSourceError && err.code === 'PLATFORM_URL_MISMATCH');
});

test('keeps a complete body as candidate when native metrics or exact acquisition provenance are missing', async () => {
  for (const row of [
    { id: 'missing-metric', url: 'https://x.com/a/status/1', text: 'Body', created_at: '2026-09-21T10:00:00Z',
      permission_state: 'public_source', likes: 1, replies: 0, reposts: 0, quotes: 0,
      provider: 'apify', provider_run_id: 'run-1', query_input: { query: 'agency owner', sort: 'Top' } },
    { id: 'missing-query', url: 'https://x.com/a/status/2', text: 'Body', created_at: '2026-09-21T10:00:00Z',
      permission_state: 'public_source', likes: 1, replies: 0, reposts: 0, quotes: 0, views: 10 },
  ]) {
    const source = await normalizePlatformSource({ clientId: 'ivan', platform: 'x',
      queryConfigId: 'ivan-x-agency-owner-v1', observedAt: '2026-09-22T10:00:00Z', row });
    assert.equal(source.source_kind, 'candidate');
    assert.ok(source.gap_state);
  }
});

test('every registered client has both platform configurations and ARCH X is explicitly configured', () => {
  for (const clientId of ['ivan', 'risedtc', 'arch']) {
    assert.ok(PLATFORM_QUERY_CONFIGS[clientId].x);
    assert.ok(PLATFORM_QUERY_CONFIGS[clientId].reddit);
  }
  assert.match(PLATFORM_QUERY_CONFIGS.arch.x.provenance, /registry|direction/i);
});

test('local CLI normalizes acquired rows to a local file without any network or database path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'platform-source-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.json');
  writeFileSync(input, JSON.stringify({
    clientId: 'ivan', platform: 'reddit', queryConfigId: 'ivan-reddit-agency-owner-v1', observedAt: '2026-09-22T10:00:00Z',
    rows: [{ id: 'local-1', url: 'https://reddit.com/r/agency/comments/local-1', body: 'A retained local post.',
      created_utc: 1758535200, permission_state: 'public_source', score: 3, num_comments: 1,
      provider: 'apify', provider_run_id: 'run-local-1',
      query_input: { subreddit: 'agency', query: 'agency owner', sort: 'new' } }],
  }));
  const run = spawnSync(process.execPath, ['automation/content-evidence/platform-sources-cli.mjs', '--input', input, '--output', output],
    { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(result.length, 1);
  assert.equal(result[0].source_id, 'reddit:local-1');
  assert.equal(result[0].source_kind, 'public_post');
});
