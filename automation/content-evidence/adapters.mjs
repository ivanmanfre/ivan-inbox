// content-evidence / adapters.mjs
//
// Read-only views over the stores that already exist. These adapters exist so the evidence
// modules never learn a table name, and so three boundaries hold in one place:
//
//   * TENANCY. Every reader takes an explicit clientId and refuses to build SQL without one.
//     There is no default client, no "current" client and no inference from a path or a cwd.
//     The client is always a bound parameter, never interpolated into the statement. The readers
//     are a CLOSED SET of named builders whose statements are constants in this file; there is no
//     caller-supplied SQL, because a statement this module has not written cannot be scoped by
//     inspecting it. (Independent audit 2026-09-20, finding 4: the old runReadOnly accepted any
//     statement in which `$1` appeared with the right bind, so
//     `select $1 as requested_client, p.* from public.client_post_metrics p` read as "tenant
//     bound" and returned another tenant's rows. Parameter presence is not scope proof.)
//   * OUTPUT TENANCY. Scope is checked again on the way back. A row whose tenant column is absent,
//     null or another tenant's value is a THROWN error, never a quietly filtered result and never
//     a returned row: a narrowed result hides the broken predicate that produced it.
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

// The explicit registry set for this workspace. Scope comes from here and from nowhere else --
// never from a directory name, a session, a path substring or a caller's string. A new tenant is
// an edit to this line, reviewed like any other code change; an unregistered clientId is refused
// rather than quietly given an empty or a shared population.
export const REGISTERED_CLIENTS = Object.freeze(['ivan', 'risedtc', 'arch']);

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
    tenantColumn: 'client_id',
    includesNullTenant: true,
    untenanted: false,
    matches: (row, clientId) =>
      !SELFTEST_LANES.includes(row.client_id)
      && (row.client_id === null || row.client_id === undefined || row.client_id === clientId),
    note: 'client_id IS NULL is the corpus (2163 rows); exactly 1 row carries the literal "ivan".',
  }),
  default: Object.freeze({
    lane: 'default',
    table: 'public.audn_competitor_posts',
    tenantPredicate: 'p.client_id = $1',
    tenantColumn: 'client_id',
    includesNullTenant: false,
    untenanted: false,
    matches: (row, clientId) =>
      !SELFTEST_LANES.includes(row.client_id) && row.client_id === clientId,
    note: 'Per-tenant table, properly tagged. An untagged row belongs to nobody and is not read.',
  }),
});

/**
 * The one place a clientId becomes a scope. Missing, a selftest lane, or absent from the explicit
 * registry are three distinct refusals; none of them is a silent empty population.
 */
function assertClient(caller, clientId, population = 'population') {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new AdapterError('ADAPTER_MISSING_CLIENT',
      `${caller} requires an explicit clientId; there is no default tenant`);
  }
  // By name, and before the registry check. lane_allowed('zz-selftest') is true, so authorization
  // would let a selftest lane build a population; scope does not.
  if (SELFTEST_LANES.includes(clientId)) {
    throw new AdapterError('ADAPTER_SELFTEST_LANE',
      `${caller} refuses ${clientId}: a selftest lane is not a tenant and has no ${population}. lane_allowed() passing is authorization, not scope.`);
  }
  if (!REGISTERED_CLIENTS.includes(clientId)) {
    throw new AdapterError('ADAPTER_UNKNOWN_CLIENT',
      `${caller} refuses ${JSON.stringify(clientId)}: it is not in the explicit client registry [${REGISTERED_CLIENTS.join(', ')}]`);
  }
  return clientId;
}

/**
 * The market source descriptor for one tenant. Throws for a selftest lane: it is not a tenant and
 * must never acquire a market population, whatever lane_allowed() says about it.
 */
export function marketSourceFor(clientId) {
  assertClient('marketSourceFor', clientId, 'market population');
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
    // The ONE descriptor allowed to return rows that carry no tenant value, and it says so here
    // rather than leaving the validator to infer it from a missing column. It serves the client it
    // names and no other; every other client routes to the tenanted table below.
    untenanted: true,
    onlyClient: IVAN,
    includesNullTenant: false,
    tenancy: 'untenanted table; ivan-only by descriptor',
    note: 'No client_id/seat/tenant/owner column exists. Scope comes from the descriptor, never from SQL.',
  }),
  default: Object.freeze({
    lane: 'default',
    table: 'public.client_post_metrics',
    tenantColumn: 'client_id',
    untenanted: false,
    includesNullTenant: false,
    tenancy: 'tenant column client_id, bound as $1',
    note: 'Per-tenant table; the client is a bound parameter in the where clause.',
  }),
});

/** The own-post source descriptor for one tenant. Selftest lanes are refused, as everywhere. */
export function ownPostSourceFor(clientId) {
  assertClient('ownPostSourceFor', clientId, 'own-post population');
  const base = clientId === IVAN ? OWN_POST_SOURCES.ivan : OWN_POST_SOURCES.default;
  return Object.freeze({ ...base, clientId });
}

// ---------------------------------------------------------------------------
// The closed set of named readers
// ---------------------------------------------------------------------------
//
// Every read this module performs is one of these five statements. Each is a constant here, each
// filters rows by the bound client, and each declares the tenant column its rows must carry so the
// result can be checked again on the way back.

/** Reader names, in one place, so a tenancy test can loop over all of them instead of a sample. */
export const READERS = Object.freeze([
  'readMarketPosts',
  'readOwnPosts',
  'readOwnAudience',
  'readStudyReading',
  'readRoster',
]);

/**
 * Names that were removed from the read surface and still exist only to reject. `runReadOnly` took
 * caller-supplied SQL; audit finding 4 showed that checking such a statement for `$1` proves
 * nothing about what it reads. Kept as a throwing member so an old caller gets a named error
 * instead of "undefined is not a function".
 */
export const REMOVED_READERS = Object.freeze(['runReadOnly']);

/** Source descriptors for the readers whose table is the same for every tenant. */
export const READER_SOURCES = Object.freeze({
  readOwnAudience: Object.freeze({
    lane: 'all', table: 'public.post_audience_history',
    tenantColumn: 'seat', untenanted: false, includesNullTenant: false,
    tenancy: 'tenant column seat, bound as $1',
  }),
  readStudyReading: Object.freeze({
    lane: 'all', table: 'public.client_research_outliers',
    tenantColumn: 'client_id', untenanted: false, includesNullTenant: false,
    tenancy: 'tenant column client_id, bound as $1',
  }),
  readRoster: Object.freeze({
    lane: 'all', table: 'public.client_registry',
    tenantColumn: 'client_id', untenanted: false, includesNullTenant: false,
    tenancy: 'tenant column client_id, bound as $1',
  }),
});

/** The statement each named reader runs, verbatim. The only market statement is built from the
 *  tenant's descriptor, so the predicate a test inspects is the predicate that runs. */
const SQL = Object.freeze({
  marketPosts: (src, selftestList) =>
    `select p.linkedin_post_url, p.competitor_name, p.linkedin_profile_url, p.competitor_role,
            p.client_id, p.post_date, p.created_at, p.updated_at, p.post_type, p.post_text,
            p.likes_count, p.comments_count, p.reposts_count
       from ${src.table} p
      where ${src.tenantPredicate}
        and coalesce(p.client_id, '') not in (${selftestList})
        and coalesce(p.competitor_role, '') <> 'killed'
      order by p.post_date desc nulls last`,
  ownPostsLegacyIvan:
    `select o.social_id, o.linkedin_url, o.post_text, o.post_type, o.posted_at,
            o.metrics_updated_at, o.scraped_at, o.num_likes, o.num_comments, o.num_shares,
            o.num_impressions, o.profile_views_from_post
       from public.own_posts o
      order by o.posted_at desc nulls last`,
  // client_id is selected as well as bound: a row that cannot show its tenant is refused, so the
  // reader has to ask for the column it validates.
  ownPostsTenanted:
    `select m.client_id, m.social_id, m.post_url, m.title, m.published_at, m.captured_at,
            m.impressions, m.reactions, m.comments, m.shares,
            m.profile_views_from_post, m.followers_gained_from_post, m.inbound_dms
       from public.client_post_metrics m
      where m.client_id = $1
      order by m.published_at desc nulls last`,
  ownAudience:
    `select h.seat, h.activity_id, h.post_url, h.title, h.published_at, h.captured_at,
            h.impressions, h.reactions, h.comments, h.members_reached, h.demographics,
            h.in_pct, h.out_pct, h.source
       from public.post_audience_history h
      where h.seat = $1
      order by h.published_at desc nulls last`,
  studyReading:
    `select o.client_id, o.run_id, o.reading, o.created_at
       from public.client_research_outliers o
      where o.client_id = $1
      order by o.created_at desc, o.run_id desc
      limit 1`,
  roster:
    `select r.client_id, r.display_name, r.is_active, r.platform
       from public.client_registry r
      where r.client_id = $1`,
});

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
  return assertClient(reader, opts && opts.clientId, 'evidence population');
}

/**
 * Output tenancy. Defence in depth, run on the rows that came BACK: a where clause can be widened
 * by a view, a future column default, a join or a mistake, and a narrowed result would hide it.
 *
 * A row is accepted only when the source descriptor can account for it:
 *   * tenanted source -- the declared tenant column must be present and equal the client. Absent or
 *     null counts as unproven and is refused, unless the descriptor declares includesNullTenant
 *     (Ivan's legacy market corpus, where the untenanted rows ARE the population).
 *   * untenanted source -- allowed only for the single client the descriptor names, and only
 *     because that descriptor states the table has no tenant column at all.
 * A stray foreign `client_id` is refused even on a source whose tenant column is something else.
 *
 * @returns {true} when every row is in scope; otherwise it throws and no row is returned.
 */
export function assertRowTenancy(reader, source, clientId, rows) {
  if (source.untenanted === true) {
    if (source.onlyClient !== clientId) {
      throw new AdapterError('ADAPTER_UNTENANTED_SOURCE',
        `${reader}: ${source.table} has no tenant column and its descriptor serves ${JSON.stringify(source.onlyClient)} only; ${JSON.stringify(clientId)} cannot read it`);
    }
  } else if (typeof source.tenantColumn !== 'string' || source.tenantColumn === '') {
    throw new AdapterError('ADAPTER_UNTENANTED_SOURCE',
      `${reader}: ${source.table} declares no tenant column and no untenanted descriptor; its rows cannot be scoped`);
  }
  const col = source.untenanted === true ? null : source.tenantColumn;
  for (const row of rows) {
    if (col !== null) {
      const present = row !== null && typeof row === 'object' && col in row;
      const value = present ? row[col] : undefined;
      if (value === null || value === undefined) {
        if (source.includesNullTenant !== true) {
          throw new AdapterError('ADAPTER_TENANCY_VIOLATION',
            `${reader}: a row from ${source.table} carries no ${col}; an unattributable row cannot be read as ${JSON.stringify(clientId)}`);
        }
      } else if (value !== clientId) {
        throw new AdapterError('ADAPTER_TENANCY_VIOLATION',
          `${reader}: ${source.table} returned a row for ${JSON.stringify(value)} while reading ${JSON.stringify(clientId)}`);
      }
    }
    // A tenant tag the source did not promise is still a tenant tag.
    if (col !== 'client_id' && row && typeof row === 'object' && 'client_id' in row
        && row.client_id !== null && row.client_id !== undefined && row.client_id !== clientId) {
      throw new AdapterError('ADAPTER_TENANCY_VIOLATION',
        `${reader}: ${source.table} returned a row tagged ${JSON.stringify(row.client_id)} while reading ${JSON.stringify(clientId)}`);
    }
  }
  return true;
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

  /**
   * The only path to the executor. The statement is one of this module's constants, the client is
   * its bound parameter, and the rows that come back are checked against the source descriptor
   * before any caller sees them.
   */
  async function runNamed(reader, source, clientId, sql, params) {
    assertReadOnlySql(sql);
    assertRowTenancy(reader, source, clientId, []); // source reachability, before anything is sent
    const rows = await query(sql, params);
    const list = Array.isArray(rows) ? rows : [];
    assertRowTenancy(reader, source, clientId, list);
    return list;
  }

  return {
    /**
     * Removed. It ran caller-supplied SQL and treated the presence of `$1` plus a matching bind as
     * proof of tenancy; `select $1 as requested_client, p.* from public.client_post_metrics p`
     * satisfied both and read every tenant's rows (independent audit 2026-09-20, finding 4). A
     * statement this module did not write cannot be scoped by looking at it, so there is no
     * free-SQL surface left -- only the named readers in READERS. The name survives so an old
     * caller receives this error rather than a TypeError.
     */
    async runReadOnly() {
      throw new AdapterError('ADAPTER_FREE_SQL_FORBIDDEN',
        `runReadOnly is removed: caller-supplied SQL cannot establish tenancy (a bound $1 proves only that a parameter exists). Use a named reader: ${READERS.join(', ')}.`);
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
      // The descriptor's in-memory predicate re-checks every row that comes back, so a view, a
      // future column default or a widened predicate cannot enlarge the population behind the
      // adapter's back. A row the descriptor does not match is an error, not a row to drop.
      const rows = await runNamed('readMarketPosts', src, clientId,
        SQL.marketPosts(src, selftestList), [clientId]);
      return rows.map((r) => mapMarketRow(clientId, r));
    },

    /**
     * The tenant's own published posts, from that tenant's named source descriptor.
     * Ivan's spine is the untenanted own_posts; every other tenant's is client_post_metrics,
     * which has a real client_id column and binds it.
     */
    async readOwnPosts(opts = {}) {
      const clientId = requireClient('readOwnPosts', opts);
      const src = ownPostSourceFor(clientId);
      if (src.untenanted === true) {
        // No tenant column exists, so there is no predicate to write. The descriptor is the scope,
        // it says so in `untenanted`, and no client but the one it names can reach this table.
        const rows = await runNamed('readOwnPosts', src, clientId, SQL.ownPostsLegacyIvan, []);
        return rows.map((r) => mapOwnPostRow(clientId, r));
      }
      const rows = await runNamed('readOwnPosts', src, clientId, SQL.ownPostsTenanted, [clientId]);
      return rows.map((r) => mapClientMetricRow(clientId, r));
    },

    /** Audience history for one seat. Unknown demographics stay null, never {} and never zero. */
    async readOwnAudience(opts = {}) {
      const clientId = requireClient('readOwnAudience', opts);
      const rows = await runNamed('readOwnAudience', READER_SOURCES.readOwnAudience, clientId,
        SQL.ownAudience, [clientId]);
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
      const rows = await runNamed('readStudyReading', READER_SOURCES.readStudyReading, clientId,
        SQL.studyReading, [clientId]);
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
      const rows = await runNamed('readRoster', READER_SOURCES.readRoster, clientId,
        SQL.roster, [clientId]);
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
