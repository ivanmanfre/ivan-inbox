// Platform-source normalizer. Import this from the collector bridge/import path once the
// concurrent Refresh repair chooses its integration point; it deliberately has no DB or network dependency.
// It turns one retained X/Reddit item into the immutable editorial-source shape without treating
// a query-screened winner as a comparable outlier.

import { createHash } from 'node:crypto';

export class PlatformSourceError extends Error {
  constructor(code, message) { super(message); this.name = 'PlatformSourceError'; this.code = code; }
}

const CLIENTS = Object.freeze(['ivan', 'risedtc', 'arch']);
const fail = (code, message) => { throw new PlatformSourceError(code, message); };

export const PLATFORM_QUERY_CONFIGS = Object.freeze({
  ivan: Object.freeze({
    reddit: Object.freeze({ id: 'ivan-reddit-agency-owner-v1', kind: 'discovery',
      subreddits: ['agency', 'smallbusiness', 'marketing', 'Entrepreneur', 'digital_marketing', 'marketingagency', 'EntrepreneurRideAlong'],
      provenance: 'Retained LM Curator Reddit/X Ingestor (99LHX3WdkXcjoeoA); existing agency-owner discovery configuration.' }),
    x: Object.freeze({ id: 'ivan-x-agency-owner-v1', kind: 'discovery',
      query: '("agency owner" OR "my agency" OR "marketing agency" OR "creative agency") (struggling OR churn OR "feast or famine" OR underpriced OR "fired a client" OR "losing clients" OR overwhelmed OR "scope creep" OR retention OR pricing OR "no pipeline") lang:en',
      direction: 'outbound, inbound, Poland/Warsaw operator context',
      provenance: 'Retained LM Curator X node plus repair direction: retain the recorded outbound/inbound and Poland/Warsaw context; do not reduce Ivan to agency pain.' }),
  }),
  risedtc: Object.freeze({
    reddit: Object.freeze({ id: 'risedtc-reddit-founder-pain-v1', kind: 'discovery',
      cells: [['ecommerce', 'ad spend of'], ['shopify', 'ad spend of'], ['shopify', 'chargebacks'], ['FacebookAds', '100k a month'], ['FacebookAds', 'ad spend of'], ['FacebookAds', 'ROAS dropped'], ['shopify', 'my store'], ['ecommerce', 'chargebacks'], ['ecommerce', 'my store'], ['ecommerce', '100k a month'], ['ecommerce', 'our 3PL'], ['ecommercemarketing', 'ad spend of']],
      provenance: 'Retained RISE Reddit founder-pain workflow (W2GgcFKM4guZl1WA).' }),
    x: Object.freeze({ id: 'risedtc-x-topic-and-reaction-v1', kind: 'discovery',
      cells: ['p&l/margin/cash-flow/payroll', 'ads/ROAS/CAC/spend', 'creative fatigue/testing', 'retention/LTV/repeat/churn', 'AOV/CVR/product-page/checkout/returns', 'agency', 'inventory/COGS/tariff/freight', 'scaling/plateau'],
      provenance: 'Retained RISE X viral-trend and reaction workflow (xBV2Cq3UWBY5v5nQ); min-faves and reaction gates are discovery screening only.' }),
  }),
  arch: Object.freeze({
    reddit: Object.freeze({ id: 'arch-reddit-ua-pain-v1', kind: 'discovery',
      cells: [['AppBusiness', 'user acquisition'], ['AppBusiness', 'ad spend'], ['AppBusiness', 'influencer marketing'], ['AppBusiness', 'cost per install'], ['gamedev', 'marketing budget'], ['gamedev', 'ad spend'], ['gamedev', 'influencer marketing'], ['gamemarketing', 'marketing budget'], ['gamemarketing', 'paid ads'], ['gameDevMarketing', 'streamers'], ['AppStoreOptimization', 'paid ads'], ['IndieDev', 'paid ads']],
      provenance: 'Retained ARCH Reddit UA-pain workflow (99C7rtA2mDuMBNUf); current code parse failure must be repaired before collection.' }),
    x: Object.freeze({ id: 'arch-x-mobile-games-ua-v1', kind: 'discovery',
      query: '("mobile game" OR "mobile gaming" OR "game app") ("user acquisition" OR UA OR CPI OR "paid ads" OR "creator marketing" OR influencers OR streamers) lang:en',
      provenance: 'Repair scope explicitly authorizes ARCH X. Query is derived from registered client direction: mobile gaming/app UA and creator marketing; it is a discovery configuration, not an ICP approval.' }),
  }),
});

const iso = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' && value < 2_000_000_000 ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

function platformMetrics(platform, row) {
  return platform === 'x'
    ? { likes: number(row.likeCount ?? row.likes), replies: number(row.replyCount ?? row.replies), reposts: number(row.retweetCount ?? row.reposts), quotes: number(row.quoteCount ?? row.quotes), views: number(row.viewCount ?? row.views) }
    : { score: number(row.score), comments: number(row.num_comments ?? row.comments) };
}

const expectedMetricKeys = (platform) => platform === 'x'
  ? ['likes', 'replies', 'reposts', 'quotes', 'views'] : ['score', 'comments'];
const metricsComplete = (platform, metrics) => expectedMetricKeys(platform).every(key => metrics[key] !== null);

function validPlatformUrl(platform, value) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return platform === 'x' ? host === 'x.com' || host === 'twitter.com' : host === 'reddit.com' || host.endsWith('.reddit.com');
  } catch { return false; }
}

function acquisition(row) {
  const provider = text(row.provider);
  const providerRunId = text(row.provider_run_id);
  const queryInput = row.query_input && typeof row.query_input === 'object' && !Array.isArray(row.query_input)
    ? row.query_input : null;
  return { complete: provider === 'apify' && Boolean(providerRunId && queryInput && Object.keys(queryInput).length),
    value: { provider, provider_run_id: providerRunId, query_input: queryInput } };
}

function outlier() {
  return { status: 'not_measured',
    reason: 'Platform acquisition is discovery-only; measured outliers require the separate reviewed study pipeline.' };
}

export async function normalizePlatformSource({ clientId, platform, queryConfigId, row, observedAt } = {}) {
  if (!CLIENTS.includes(clientId)) fail('PLATFORM_UNKNOWN_CLIENT', 'A registered explicit clientId is required.');
  if (!['x', 'reddit'].includes(platform)) fail('PLATFORM_UNKNOWN_FAMILY', 'platform must be x or reddit.');
  const config = PLATFORM_QUERY_CONFIGS[clientId][platform];
  if (queryConfigId !== config.id) fail('PLATFORM_QUERY_CONFIG', `queryConfigId must be ${config.id} for ${clientId}/${platform}.`);
  if (!row || typeof row !== 'object') fail('PLATFORM_BAD_ROW', 'row must be an object.');
  if (row.client_id !== undefined && row.client_id !== clientId) fail('PLATFORM_TENANT_MISMATCH', 'The row client_id does not match the explicit clientId.');
  const id = text(row.id ?? row.platform_id ?? row.reddit_id);
  if (!id) fail('PLATFORM_MISSING_ID', 'A platform-native id is required.');
  const url = text(row.url ?? row.source_url);
  if (url && !validPlatformUrl(platform, url)) fail('PLATFORM_URL_MISMATCH', `Source URL does not match claimed ${platform} platform.`);
  const body = text(row.text ?? row.body ?? row.selftext);
  const title = text(row.title);
  const published = iso(row.created_at ?? row.createdAt ?? row.created_utc ?? row.published_at);
  const captured = iso(observedAt);
  if (!captured) fail('PLATFORM_BAD_CAPTURE_TIME', 'observedAt must be a valid timestamp.');
  const bodyState = body ? (row.body_state === 'excerpt' ? 'excerpt' : 'full') : 'unavailable';
  const metrics = platformMetrics(platform, row);
  const acquired = acquisition(row);
  const permissionState = text(row.permission_state) ?? 'unknown';
  const permissionEligible = ['public_source', 'granted'].includes(permissionState);
  const complete = Boolean(body && published && url && permissionEligible && metricsComplete(platform, metrics) && acquired.complete);
  const missing = [!body && 'original body', !published && 'publication date', !url && 'source URL',
    !permissionEligible && `eligible permission (retained state: ${permissionState})`,
    !metricsComplete(platform, metrics) && 'complete native metrics', !acquired.complete && 'exact acquisition provider/run/query provenance'].filter(Boolean);
  const source = {
    client_id: clientId, source_id: `${platform}:${id}`, seen_version: 1,
    source_kind: complete ? 'public_post' : 'candidate', source_client_scope: 'public', source_url: url,
    excerpt_pointer: url ? null : `${platform}.id=${id}`, owner: text(row.author ?? row.author_name) ?? 'unknown author',
    source_published_at: published, published_date_state: published ? 'known' : 'unknown', captured_at: captured,
    body_sha256: body ? hash(body) : null, passage: body, retained_context: title ? `Title: ${title}` : '',
    limitation: 'Platform-native discovery evidence. Query screening, min-faves floors and winner selection do not establish a comparable outlier or causal result.',
    independent: complete, derived_from: complete ? null : `${platform}:${id}`, permission_state: permissionState,
    gap_state: complete ? null : { reason: ['denied', 'withheld'].includes(permissionState) ? 'permission_denied' : 'partial',
      detail: `${missing.join(', ')} required; this discovery candidate cannot support a factual claim.` },
    candidate_fields: { evidence: body, raw_context: title, editorial_assessment: 'unreviewed platform discovery',
      editorial_strength: complete ? 'retained_original' : 'unknown', angle_options: [],
      platform, query_config_id: queryConfigId, query_config_provenance: config.provenance,
      source_identity: { platform, native_id: id }, acquisition: acquired.value, observed_metrics: metrics,
      observation_window: { published_at: published, captured_at: captured }, body_state: bodyState,
      discovery_classification: config.kind,
      unverified_comparison: row.comparison && typeof row.comparison === 'object' ? row.comparison : null,
      outlier: outlier() },
  };
  return { ...source, snapshot_hash: hash(canonical({ ...source, seen_version: undefined })) };
}
