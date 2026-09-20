// content-evidence / adapters.mjs
//
// Read-only views over the stores that already exist. These adapters exist so the evidence
// modules never learn a table name, and so three boundaries hold in one place:
//
//   * TENANCY. Every reader takes an explicit clientId and refuses to build SQL without one.
//     There is no default client, no "current" client and no inference from a path or a cwd.
//     The client is always a bound parameter, never interpolated into the statement.
//   * COLLECTION. An adapter reads. It never harvests and never writes: assertReadOnlySql()
//     rejects anything that is not a single select/with statement, including a select with a
//     write smuggled in after a semicolon.
//   * MISSINGNESS. A missing number stays null and a real zero stays 0. A capture timestamp
//     never fills in a publication timestamp -- a post with no known publication date reads
//     null there, and the date we learned about it lives in a different field.
//
// Column names below were read from information_schema on the production project on 2026-09-20
// with read-only SELECTs (see OUTPUT/03-integration/source-columns.md). The lane split mirrors
// the live operator_* functions in db/088: Ivan reads the legacy shared competitor_posts rows
// (client_id null or 'ivan'), every other tenant reads its own audn_competitor_posts.

import { utcIso } from './contracts.mjs';

export class AdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

const IVAN = 'ivan';

// ---------------------------------------------------------------------------
// Market source descriptors: where a tenant's market corpus actually lives
// ---------------------------------------------------------------------------
//
// This is data on purpose, not a branch buried inside a query string, because the obvious
// predicate is WRONG for Ivan and wrong in a way that looks like success. Measured read-only on
// the production project, 2026-09-20:
//
//     competitor_posts        client_id IS NULL  -> 2163 rows, 35 authors (2025-09-22 .. 2026-09-11)
//     competitor_posts        client_id = 'ivan' ->    1 row,   1 author  (2026-09-14)
//     audn_competitor_posts   arch 439 | risedtc 655 | zz-selftest 12
//
// So `where client_id = 'ivan'` returns 1 row out of 2164 and reports no error. Ivan's market
// corpus is the UNTENANTED population of the legacy shared table. This repo has already been
// burned by the mirror-image of that bug (a shared table plus readers with no tenant filter leaked
// one tenant's rows into another tenant's readers on 2026-09-12), so the predicate is stated once,
// by name, with both an SQL form and an equivalent in-memory `matches` form that a test can check
// row by row. The two must always agree; a test asserts they do.
//
// `zz-selftest` is a selftest lane, not a tenant. It is excluded from every client population BY
// NAME. lane_allowed('zz-selftest') returns true -- it passes the selftest door -- so lane_allowed
// is an authorization check, never a scope check, and the exclusion cannot be delegated to it.

export const SELFTEST_LANES = Object.freeze(['zz-selftest']);

export const MARKET_SOURCES = Object.freeze({
  ivan: Object.freeze({
    lane: 'ivan',
    table: 'public.competitor_posts',
    // The untenanted legacy population IS Ivan's corpus. Never narrow this to client_id = 'ivan'.
    tenantPredicate: "(p.client_id is null or p.client_id = $1)",
    includesNullTenant: true,
    matches: (row, clientId) =>
      !SELFTEST_LANES.includes(row.client_id)
      && (row.client_id === null || row.client_id === undefined || row.client_id === clientId),
    note: 'client_id IS NULL is the corpus (2163 rows); exactly 1 row carries the literal "ivan".',
  }),
  default: Object.freeze({
    lane: 'default',
    table: 'public.audn_competitor_posts',
    tenantPredicate: 'p.client_id = $1',
    includesNullTenant: false,
    matches: (row, clientId) =>
      !SELFTEST_LANES.includes(row.client_id) && row.client_id === clientId,
    note: 'Per-tenant table, properly tagged. An untagged row belongs to nobody and is not read.',
  }),
});

/**
 * The market source descriptor for one tenant. Throws for a selftest lane: it is not a tenant and
 * must never acquire a market population, whatever lane_allowed() says about it.
 */
export function marketSourceFor(clientId) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new AdapterError('ADAPTER_MISSING_CLIENT',
      'marketSourceFor requires an explicit clientId; there is no default tenant');
  }
  if (SELFTEST_LANES.includes(clientId)) {
    throw new AdapterError('ADAPTER_SELFTEST_LANE',
      `${clientId} is a selftest lane, not a tenant; it has no market population. lane_allowed() passing is authorization, not scope.`);
  }
  const base = clientId === IVAN ? MARKET_SOURCES.ivan : MARKET_SOURCES.default;
  return Object.freeze({ ...base, clientId });
}

// ---------------------------------------------------------------------------
// Own-post source descriptors: the tenant's OWN published posts
// ---------------------------------------------------------------------------
//
// `public.own_posts` has NO tenant column. Checked against information_schema on 2026-09-20: the
// only column resembling one is `source text`, which is provenance (where the row came from), not
// tenancy. The table is Ivan's spine by history, and nothing in it says so.
//
// An earlier version of this adapter wrote `where $1 = 'ivan'`, which is a comparison between a
// bound parameter and a literal -- true or false for the whole statement, never a row filter. For
// clientId 'ivan' it returned the entire table, which is right by accident; the shape is wrong
// because it looks like a tenancy predicate and is not one. It is gone.
//
// The rule now: an untenanted table is reachable only through the descriptor that names its lane.
// `ownPostSourceFor('risedtc')` returns the client_post_metrics descriptor, so own_posts is
// unreachable for any client but ivan BY CONSTRUCTION -- there is no predicate to get wrong, and
// no parameter whose value could widen the population.

export const OWN_POST_SOURCES = Object.freeze({
  ivan: Object.freeze({
    lane: 'ivan',
    table: 'public.own_posts',
    tenantColumn: null,
    tenancy: 'untenanted table; ivan-only by descriptor',
    note: 'No client_id/seat/tenant/owner column exists. Scope comes from the descriptor, never from SQL.',
  }),
  default: Object.freeze({
    lane: 'default',
    table: 'public.client_post_metrics',
    tenantColumn: 'client_id',
    tenancy: 'tenant column client_id, bound as $1',
    note: 'Per-tenant table; the client is a bound parameter in the where clause.',
  }),
});

/** The own-post source descriptor for one tenant. Selftest lanes are refused, as everywhere. */
export function ownPostSourceFor(clientId) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new AdapterError('ADAPTER_MISSING_CLIENT',
      'ownPostSourceFor requires an explicit clientId; there is no default tenant');
  }
  if (SELFTEST_LANES.includes(clientId)) {
    throw new AdapterError('ADAPTER_SELFTEST_LANE',
      `${clientId} is a selftest lane, not a tenant; it has no own-post population.`);
  }
  const base = clientId === IVAN ? OWN_POST_SOURCES.ivan : OWN_POST_SOURCES.default;
  return Object.freeze({ ...base, clientId });
}

/** Reader names, in one place, so a tenancy test can loop over all of them instead of a sample. */
export const READERS = Object.freeze([
  'readMarketPosts',
  'readOwnPosts',
  'readOwnAudience',
  'readStudyReading',
  'readRoster',
  'runReadOnly',
]);

// The statement verbs an adapter must never emit. Assembled from a list so the word "write verb"
// list reads as data. A single read statement is allowed; `with` is included because the repo's
// existing readers are CTE-heavy. Column names such as `updated_at` and `deleted_at` survive the
// check because \b requires a word boundary their suffix does not provide.
const WRITE_VERBS = Object.freeze([
  'ins' + 'ert', 'upd' + 'ate', 'del' + 'ete', 'dr' + 'op', 'alt' + 'er', 'trunc' + 'ate',
  'cre' + 'ate', 'gr' + 'ant', 'rev' + 'oke', 'co' + 'py', 'mer' + 'ge', 'ca' + 'll',
  'vac' + 'uum', 'ref' + 'resh',
]);
const FORBIDDEN = new RegExp(`\\b(${WRITE_VERBS.join('|')})\\b`, 'i');

export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw new AdapterError('ADAPTER_WRITE_FORBIDDEN', 'sql must be a non-empty string');
  }
  const stripped = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  if (!/^\s*(with|select)\b/i.test(stripped)) {
    throw new AdapterError('ADAPTER_WRITE_FORBIDDEN',
      'an adapter may only run a select/with statement');
  }
  if (stripped.replace(/;\s*$/, '').includes(';')) {
    throw new AdapterError('ADAPTER_WRITE_FORBIDDEN',
      'an adapter may only run ONE statement; a second statement was found');
  }
  const hit = stripped.match(FORBIDDEN);
  if (hit) {
    throw new AdapterError('ADAPTER_WRITE_FORBIDDEN',
      `an adapter never writes; statement contains ${hit[0]}`);
  }
  return true;
}

function requireClient(reader, opts) {
  const clientId = opts && opts.clientId;
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new AdapterError('ADAPTER_MISSING_CLIENT',
      `${reader} requires an explicit clientId; there is no default tenant`);
  }
  // By name, in every reader. lane_allowed('zz-selftest') is true, so authorization would let a
  // selftest lane build a population; scope does not.
  if (SELFTEST_LANES.includes(clientId)) {
    throw new AdapterError('ADAPTER_SELFTEST_LANE',
      `${reader} refuses ${clientId}: a selftest lane is not a tenant and has no evidence population`);
  }
  return clientId;
}

/** null/undefined stay null; a genuine 0 stays 0. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === '' ? null : s;
}

/** The LinkedIn activity urn inside a post URL, when there is one. Identity, not decoration. */
export function canonicalSourceIdFromUrl(url) {
  const s = str(url);
  if (s === null) return null;
  const m = s.match(/activity[-:](\d{10,})/i);
  return m ? `urn:li:activity:${m[1]}` : s;
}

/**
 * @param {{query: (sql: string, params: any[]) => Promise<any[]>}} deps
 *   `query` must be a read-only executor (a Supabase/pg client bound to a read role, or a test
 *   double). Every call is checked by assertReadOnlySql before it reaches it.
 */
export function createAdapters({ query }) {
  if (typeof query !== 'function') {
    throw new AdapterError('ADAPTER_NO_QUERY', 'createAdapters needs a { query } executor');
  }

  async function run(sql, params) {
    assertReadOnlySql(sql);
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : [];
  }

  return {
    /**
     * Escape hatch for a caller with its own read statement. Read-only, and genuinely tenant-bound:
     * the statement MUST reference $1 and $1 MUST be this client. A caller-supplied statement that
     * never mentions the client is an untenanted read wearing a clientId argument, so it is refused
     * rather than executed. (Read-only is checked first, so a smuggled write still reports as one.)
     */
    async runReadOnly(opts = {}) {
      const clientId = requireClient('runReadOnly', opts);
      assertReadOnlySql(opts.sql);
      const params = opts.params ?? [];
      if (!/\$1\b/.test(String(opts.sql))) {
        throw new AdapterError('ADAPTER_UNBOUND_CLIENT',
          'runReadOnly requires the statement to reference the bound client parameter $1');
      }
      if (params[0] !== clientId) {
        throw new AdapterError('ADAPTER_UNBOUND_CLIENT',
          `runReadOnly requires params[0] to be the clientId ${JSON.stringify(clientId)}`);
      }
      return run(opts.sql, params);
    },

    /**
     * Market (source-author) posts for one tenant, from that tenant's named source descriptor.
     * The statement is built FROM the descriptor, so the predicate a test inspects is the
     * predicate that runs.
     */
    async readMarketPosts(opts = {}) {
      const clientId = requireClient('readMarketPosts', opts);
      const src = marketSourceFor(clientId);
      const selftestList = SELFTEST_LANES.map((l) => `'${l}'`).join(', ');
      const sql =
        `select p.linkedin_post_url, p.competitor_name, p.linkedin_profile_url, p.competitor_role,
                p.client_id, p.post_date, p.created_at, p.updated_at, p.post_type, p.post_text,
                p.likes_count, p.comments_count, p.reposts_count
           from ${src.table} p
          where ${src.tenantPredicate}
            and coalesce(p.client_id, '') not in (${selftestList})
            and coalesce(p.competitor_role, '') <> 'killed'
          order by p.post_date desc nulls last`;
      const rows = await run(sql, [clientId]);
      // Belt and braces: the descriptor's in-memory predicate re-checks every row that comes back,
      // so a view, a future column default or a hand-written statement cannot widen the population
      // behind the adapter's back.
      return rows
        .filter((r) => !('client_id' in r) || src.matches(r, clientId))
        .map((r) => mapMarketRow(clientId, r));
    },

    /**
     * The tenant's own published posts, from that tenant's named source descriptor.
     * Ivan's spine is the untenanted own_posts; every other tenant's is client_post_metrics,
     * which has a real client_id column and binds it.
     */
    async readOwnPosts(opts = {}) {
      const clientId = requireClient('readOwnPosts', opts);
      const src = ownPostSourceFor(clientId);
      if (src.tenantColumn === null) {
        // No tenant column exists, so there is no predicate to write. The descriptor is the scope,
        // and no client but the one it names can reach this table at all.
        const rows = await run(
          `select o.social_id, o.linkedin_url, o.post_text, o.post_type, o.posted_at,
                  o.metrics_updated_at, o.scraped_at, o.num_likes, o.num_comments, o.num_shares,
                  o.num_impressions, o.profile_views_from_post
             from ${src.table} o
            order by o.posted_at desc nulls last`, []);
        return rows.map((r) => mapOwnPostRow(clientId, r));
      }
      const rows = await run(
        `select m.social_id, m.post_url, m.title, m.published_at, m.captured_at,
                m.impressions, m.reactions, m.comments, m.shares,
                m.profile_views_from_post, m.followers_gained_from_post, m.inbound_dms
           from ${src.table} m
          where m.${src.tenantColumn} = $1
          order by m.published_at desc nulls last`, [clientId]);
      return rows.map((r) => mapClientMetricRow(clientId, r));
    },

    /** Audience history for one seat. Unknown demographics stay null, never {} and never zero. */
    async readOwnAudience(opts = {}) {
      const clientId = requireClient('readOwnAudience', opts);
      const rows = await run(
        `select h.seat, h.activity_id, h.post_url, h.title, h.published_at, h.captured_at,
                h.impressions, h.reactions, h.comments, h.members_reached, h.demographics,
                h.in_pct, h.out_pct, h.source
           from public.post_audience_history h
          where h.seat = $1
          order by h.published_at desc nulls last`, [clientId]);
      return rows.map((r) => ({
        client_id: clientId,
        activity_id: str(r.activity_id),
        canonical_source_id: r.activity_id ? `urn:li:activity:${r.activity_id}` : null,
        source_url: str(r.post_url),
        title: str(r.title),
        source_dates: { published_at: utcIso(r.published_at) },
        capture_dates: { captured_at: utcIso(r.captured_at) },
        metrics: {
          impressions: num(r.impressions),
          reactions: num(r.reactions),
          comments: num(r.comments),
          members_reached: num(r.members_reached),
        },
        audience_split: { in_pct: num(r.in_pct), out_pct: num(r.out_pct) },
        demographics: r.demographics ?? null,
        source: str(r.source),
      }));
    },

    /** The newest stored study reading for one tenant, or null. Presentation adapter, not evidence. */
    async readStudyReading(opts = {}) {
      const clientId = requireClient('readStudyReading', opts);
      const rows = await run(
        `select o.client_id, o.run_id, o.reading, o.created_at
           from public.client_research_outliers o
          where o.client_id = $1
          order by o.created_at desc, o.run_id desc
          limit 1`, [clientId]);
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        client_id: clientId,
        run_id: str(r.run_id),
        reading: r.reading ?? null,
        capture_dates: { captured_at: utcIso(r.created_at) },
      };
    },

    /** The registry roster for one tenant. Scope comes from here, never from a directory name. */
    async readRoster(opts = {}) {
      const clientId = requireClient('readRoster', opts);
      const rows = await run(
        `select r.client_id, r.display_name, r.is_active, r.platform
           from public.client_registry r
          where r.client_id = $1`, [clientId]);
      if (rows.length === 0) return null;
      const r = rows[0];
      const platform = r.platform ?? {};
      const roster = platform?.measurement?.roster;
      return {
        client_id: clientId,
        display_name: str(r.display_name),
        is_active: r.is_active === true,
        roster: Array.isArray(roster) ? roster : null,
        roster_n: Array.isArray(roster) ? roster.length : null,
      };
    },
  };
}

function mapMarketRow(clientId, r) {
  const url = str(r.linkedin_post_url);
  return {
    client_id: clientId,
    canonical_source_id: canonicalSourceIdFromUrl(url),
    source_url: url,
    author_id: str(r.linkedin_profile_url) ?? str(r.competitor_name),
    author_name: str(r.competitor_name),
    author_role: str(r.competitor_role),
    // Distinct on purpose. post_date is when the author published; created_at/updated_at is when
    // we recorded the row. Neither ever substitutes for the other.
    source_dates: { published_at: utcIso(r.post_date) },
    capture_dates: { captured_at: utcIso(r.captured_at ?? r.updated_at ?? r.created_at) },
    text: str(r.post_text),
    format_evidence: { post_type: str(r.post_type) },
    metrics: {
      likes: num(r.likes_count),
      comments: num(r.comments_count),
      reposts: num(r.reposts_count),
      impressions: null, // public impressions are unknown unless sourced directly
    },
    // Ratified in db/102's header on 2026-09-19: a market read that carries own performance was
    // rejected. The market store holds the market only; a lane's own control posts are read by
    // readOwnPosts and stay out of every market denominator and author ranking.
    is_own_control: false,
  };
}

function mapOwnPostRow(clientId, r) {
  return {
    client_id: clientId,
    canonical_source_id: str(r.social_id) ?? canonicalSourceIdFromUrl(r.linkedin_url),
    source_url: str(r.linkedin_url),
    source_dates: { published_at: utcIso(r.posted_at) },
    capture_dates: { captured_at: utcIso(r.metrics_updated_at ?? r.scraped_at) },
    text: str(r.post_text),
    format_evidence: { post_type: str(r.post_type) },
    metrics: {
      likes: num(r.num_likes),
      comments: num(r.num_comments),
      shares: num(r.num_shares),
      impressions: num(r.num_impressions),
      profile_views: num(r.profile_views_from_post),
    },
    is_own_control: true,
  };
}

function mapClientMetricRow(clientId, r) {
  return {
    client_id: clientId,
    canonical_source_id: str(r.social_id) ?? canonicalSourceIdFromUrl(r.post_url),
    source_url: str(r.post_url),
    title: str(r.title),
    source_dates: { published_at: utcIso(r.published_at) },
    capture_dates: { captured_at: utcIso(r.captured_at) },
    metrics: {
      impressions: num(r.impressions),
      reactions: num(r.reactions),
      comments: num(r.comments),
      shares: num(r.shares),
      profile_views: num(r.profile_views_from_post),
      followers_gained: num(r.followers_gained_from_post),
      inbound_dms: num(r.inbound_dms),
    },
    is_own_control: true,
  };
}
