-- 105: the editorial brief contract. Immutable brief versions, typed source snapshots and
-- links, an append-only decision ledger, idempotent brief-to-artifact links, synthesis batches
-- with immutable input manifests, an atomically promoted current-suggestion pointer, and a
-- source curation state that is deliberately NOT the legacy idea status.
--
-- ADDITIVE ONLY. Nothing in db/001-104 is altered, replaced or dropped by this file. Every
-- object it creates is new and carries the `editorial_` prefix, and every one of them is named
-- explicitly in db/105_editorial_brief_contract_rollback.sql. Applying this file twice changes
-- nothing the second time.
--
-- NUMBERING. 104 is the highest number in the main series, so this is 105. The 2xx file in this
-- directory (203_own_engager_second_touch_for_comments.sql) is a capture of a live-applied
-- outreach function in a separate numbering block, and the three date-named files
-- (20260915_*, 20260919_*) are a separate convention again; neither advances the main series.
--
-- ---------------------------------------------------------------------------------------------
-- TENANCY. `client_id` leads every primary key and appears first in every index, so there is no
-- row shape that is not lane-scoped. Every child table carries a COMPOSITE foreign key back to
-- its parent including client_id, which is what makes a foreign-tenant insert a constraint
-- violation rather than a silent orphan.
--
-- client_id is `text not null` everywhere, and Ivan's lane is the literal 'ivan'. The
-- `client_id IS NULL means Ivan` convention that holds on the OUTREACH tables is deliberately not
-- mirrored here: a nullable tenant key cannot lead a primary key, and `where client_id =
-- p_client_id` would match nothing for exactly the lane that matters most.
--
-- PERMISSIONS. Same shape as 102/103/104: RLS on for every new table, all privileges revoked
-- from public/anon/authenticated, service_role only at the table level, and every browser-facing
-- read or write goes through a `security definer` RPC that checks `operator_gate_ok(p_gate)`
-- first and `lane_allowed(p_client_id)` second. anon is revoked from each function BY NAME
-- because a default-privileges rule otherwise grants execute on every new function (see the note
-- in db/100). The selftest lane is refused by name before lane_allowed is consulted, for the same
-- reason 103 refuses it: lane_allowed returns TRUE for zz-selftest (db/091's second door), so
-- passing authorization is not the same as having an editorial population.
--
-- NO PATH TO THE LEGACY PROMOTERS. Not one function in this file reads or writes
-- lm_idea_candidates, client_ideas, carousel_drafts, ops_drafts, scheduled_posts or any other
-- table a generator selects from. Shortlisting a brief and pinning a source are editorial
-- bookkeeping; they cannot satisfy an existing approval or pickup predicate, and they cannot
-- start a draft, an approval, a schedule or a send. db/tests/editorial_brief_contract.sql proves
-- this by reading pg_get_functiondef for every function created here.
--
-- ---------------------------------------------------------------------------------------------
-- THE RULES THIS SCHEMA ENFORCES, rather than merely documents
--
--   * A brief version is IMMUTABLE. A user edit is a new version, not an update. Generated
--     artifacts stay linked to the exact old version even after a newer one is proposed.
--     (editorial_brief_versions_immutable)
--   * A source snapshot is IMMUTABLE and keyed by (client_id, source_id, seen_version). A repeat
--     ingestion of the same native source is a NEW seen_version of the SAME source, so it updates
--     the seen record and can never create independent corroboration.
--   * A capture never fills a publication. `source_published_at` is null exactly when
--     `published_date_state = 'unknown'`, and an unknown publication date surfaces as the string
--     'unknown', never as the ingest timestamp. (editorial_sources_published_state)
--   * A derived item carries its origin. `independent = false` requires a non-empty
--     `derived_from`. (editorial_sources_derived_origin)
--   * A body is present or its absence is explained. `body_sha256` and `passage` are both
--     required unless an explicit `gap_state` says why they are missing.
--     (editorial_sources_body_or_gap)
--   * A non-public source scope must equal the owning tenant. A public source is scoped 'public'.
--     (editorial_sources_scope_is_own_or_public)
--   * The decision ledger is APPEND-ONLY, and one request_id is one row. A replayed request
--     returns the row it already wrote; a stale expected_version writes a `conflict` row that is
--     excluded from the effective status and overwrites nothing.
--     (editorial_decisions_append_only, editorial_decisions_request_uniq)
--   * One artifact role per brief version, ever. (editorial_brief_artifacts_pkey)
--   * Only a `complete` or `partial` batch may become the current suggestion pointer. An empty or
--     failed refresh leaves the previous pointer exactly where it was.
--     (editorial_current_batch_promotable)
--   * A batch's identity, its input manifest and its prior batch never change after insert; only
--     its lifecycle fields may advance. (editorial_batches_identity_immutable)

-- ---------------------------------------------------------------------------
-- Shared guard functions
-- ---------------------------------------------------------------------------

-- Refuses every UPDATE and every row removal on the tables it guards. Used by the immutable and
-- append-only tables below. A correction is a new row with a new version, never an edit.
create or replace function public.editorial_immutable_guard()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'editorial contract: %.% is append-only (attempted %)',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$function$;

-- A batch may advance its lifecycle fields. Its identity, its manifest and its lineage may not
-- move, because a batch that can be re-pointed is not a receipt.
create or replace function public.editorial_batch_identity_guard()
returns trigger
language plpgsql
as $function$
begin
  if new.client_id is distinct from old.client_id
     or new.batch_id is distinct from old.batch_id
     or new.input_manifest_hash is distinct from old.input_manifest_hash
     or new.prior_batch_id is distinct from old.prior_batch_id
     or new.requested_at is distinct from old.requested_at then
    raise exception 'editorial contract: a batch identity, manifest hash and lineage are fixed at insert'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_sources -- immutable typed source snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_sources (
  client_id             text        not null,
  source_id             text        not null,
  seen_version          integer     not null default 1,
  source_kind           text        not null,
  source_client_scope   text        not null default 'public',
  source_url            text,
  excerpt_pointer       text,
  owner                 text        not null,
  -- Distinct on purpose, forever. source_published_at is when the AUTHOR published;
  -- captured_at is when we observed it. A capture never fills a publication.
  source_published_at   timestamptz,
  published_date_state  text        not null default 'unknown',
  captured_at           timestamptz not null,
  body_sha256           text,
  passage               text,
  retained_context      text        not null default '',
  limitation            text        not null default '',
  independent           boolean     not null default true,
  derived_from          text,
  permission_state      text        not null default 'unknown',
  gap_state             jsonb,
  candidate_fields      jsonb,
  -- Stable for a given (source_id, seen_version): re-reading returns the same hash.
  snapshot_hash         text        not null,
  created_at            timestamptz not null default now(),
  constraint editorial_sources_pkey primary key (client_id, source_id, seen_version),
  constraint editorial_sources_client_nonempty check (btrim(client_id) <> ''),
  constraint editorial_sources_id_nonempty check (btrim(source_id) <> ''),
  constraint editorial_sources_seen_version_positive check (seen_version >= 1),
  constraint editorial_sources_kind_chk check (source_kind in
    ('candidate', 'market_study', 'call', 'own_post', 'asset', 'public_post')),
  constraint editorial_sources_permission_chk check (permission_state in
    ('public_source', 'granted', 'denied', 'unknown', 'withheld')),
  constraint editorial_sources_published_state_chk
    check (published_date_state in ('known', 'unknown')),
  -- An unknown publication date is null in the column and the string 'unknown' at the API. A
  -- known one has a real timestamp. Neither can be the other.
  constraint editorial_sources_published_state
    check ((published_date_state = 'known') = (source_published_at is not null)),
  constraint editorial_sources_ref_present
    check (nullif(btrim(coalesce(source_url, '')), '') is not null
           or nullif(btrim(coalesce(excerpt_pointer, '')), '') is not null),
  -- A non-public scope belongs to the owning tenant and to no one else.
  constraint editorial_sources_scope_is_own_or_public
    check (source_client_scope = 'public' or source_client_scope = client_id),
  constraint editorial_sources_gap_shape
    check (gap_state is null
           or (jsonb_typeof(gap_state) = 'object'
               and gap_state->>'reason' in ('permission_denied', 'unavailable', 'expired', 'partial')
               and nullif(btrim(coalesce(gap_state->>'detail', '')), '') is not null)),
  -- Either the body and its hash are retained, or an explicit gap says why not.
  constraint editorial_sources_body_or_gap
    check (gap_state is not null
           or (nullif(btrim(coalesce(body_sha256, '')), '') is not null
               and nullif(btrim(coalesce(passage, '')), '') is not null)),
  -- A derived item names its origin. A recycled recommendation is never independent.
  constraint editorial_sources_derived_origin
    check (independent or nullif(btrim(coalesce(derived_from, '')), '') is not null),
  constraint editorial_sources_candidate_fields_object
    check (candidate_fields is null or jsonb_typeof(candidate_fields) = 'object'),
  -- A candidate source keeps all five of its fields: the two source-fact ones and the three
  -- derived ones. A missing one is a silently dropped input.
  constraint editorial_sources_candidate_fields_complete
    check (source_kind <> 'candidate'
           or (candidate_fields is not null
               and candidate_fields ? 'evidence' and candidate_fields ? 'raw_context'
               and candidate_fields ? 'editorial_assessment'
               and candidate_fields ? 'editorial_strength'
               and candidate_fields ? 'angle_options')),
  constraint editorial_sources_snapshot_hash_nonempty check (btrim(snapshot_hash) <> '')
);

create index if not exists editorial_sources_client_kind_idx
  on public.editorial_sources (client_id, source_kind, captured_at desc);

create index if not exists editorial_sources_client_published_idx
  on public.editorial_sources (client_id, source_published_at desc nulls last);

-- ---------------------------------------------------------------------------
-- editorial_source_curation -- unseen/seen/pinned/dismissed, and nothing else
-- ---------------------------------------------------------------------------
--
-- SEPARATE FROM THE LEGACY IDEA STATUS ON PURPOSE. lm_idea_candidates.status and
-- client_ideas.status are the vocabularies a generator's pickup predicate reads ('approved',
-- 'staged'). None of the four values here appears in either vocabulary, and nothing in this file
-- writes to either table, so curating a source cannot promote anything.

create table if not exists public.editorial_source_curation (
  client_id      text        not null,
  source_id      text        not null,
  state          text        not null default 'unseen',
  reason         text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  seen_version   integer     not null default 1,
  updated_at     timestamptz not null default now(),
  constraint editorial_source_curation_pkey primary key (client_id, source_id),
  constraint editorial_source_curation_state_chk
    check (state in ('unseen', 'seen', 'pinned', 'dismissed')),
  constraint editorial_source_curation_seen_version_positive check (seen_version >= 1),
  -- A dismissal keeps its reason. A state change with no reason is not a receipt.
  constraint editorial_source_curation_dismiss_reason
    check (state <> 'dismissed' or nullif(btrim(coalesce(reason, '')), '') is not null)
);

create index if not exists editorial_source_curation_state_idx
  on public.editorial_source_curation (client_id, state, updated_at desc);

-- ---------------------------------------------------------------------------
-- editorial_batches -- one synthesis run, and its exact inputs
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_input_manifests (
  client_id             text        not null,
  input_manifest_hash   text        not null,
  source_refs           jsonb       not null default '[]'::jsonb,
  source_cutoff         timestamptz not null,
  collector_cursors     jsonb       not null default '{}'::jsonb,
  direction_version     text        not null,
  decision_cutoff       timestamptz not null,
  decision_ids          jsonb       not null default '[]'::jsonb,
  outcome_snapshot_ids  jsonb       not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  constraint editorial_input_manifests_pkey primary key (client_id, input_manifest_hash),
  constraint editorial_input_manifests_hash_nonempty check (btrim(input_manifest_hash) <> ''),
  constraint editorial_input_manifests_sources_array check (jsonb_typeof(source_refs) = 'array'),
  constraint editorial_input_manifests_decisions_array check (jsonb_typeof(decision_ids) = 'array'),
  constraint editorial_input_manifests_outcomes_array
    check (jsonb_typeof(outcome_snapshot_ids) = 'array'),
  constraint editorial_input_manifests_cursors_object
    check (jsonb_typeof(collector_cursors) = 'object'),
  constraint editorial_input_manifests_direction_nonempty check (btrim(direction_version) <> '')
);

create table if not exists public.editorial_batches (
  client_id             text        not null,
  batch_id              text        not null,
  status                text        not null default 'queued',
  input_manifest_hash   text        not null,
  synthesis_method      text        not null default 'unspecified',
  synthesis_model       text        not null default 'unspecified',
  prompt_version        text        not null default 'unspecified',
  requested_at          timestamptz not null default now(),
  started_at            timestamptz,
  completed_at          timestamptz,
  coverage_gaps         jsonb       not null default '[]'::jsonb,
  prior_batch_id        text,
  -- Decisions that landed after the input snapshot was taken are PRESERVED; the batch is marked
  -- rather than the decisions being overwritten.
  awaiting_reconciliation boolean   not null default false,
  failure_reason        text,
  constraint editorial_batches_pkey primary key (client_id, batch_id),
  constraint editorial_batches_id_nonempty check (btrim(batch_id) <> ''),
  constraint editorial_batches_status_chk
    check (status in ('queued', 'running', 'complete', 'partial', 'empty', 'failed')),
  constraint editorial_batches_manifest_fk
    foreign key (client_id, input_manifest_hash)
    references public.editorial_input_manifests (client_id, input_manifest_hash),
  constraint editorial_batches_prior_fk
    foreign key (client_id, prior_batch_id)
    references public.editorial_batches (client_id, batch_id),
  constraint editorial_batches_gaps_array check (jsonb_typeof(coverage_gaps) = 'array'),
  -- A partial batch names the coverage it could not reach. "Partial" with no stated gap is a
  -- complete batch wearing a hedge.
  constraint editorial_batches_partial_states_gaps
    check (status <> 'partial' or jsonb_array_length(coverage_gaps) > 0),
  -- A failed batch keeps its reason.
  constraint editorial_batches_failure_reason
    check (status <> 'failed' or nullif(btrim(coalesce(failure_reason, '')), '') is not null)
);

create index if not exists editorial_batches_status_idx
  on public.editorial_batches (client_id, status, requested_at desc);

-- ---------------------------------------------------------------------------
-- editorial_brief_versions -- the immutable proposal
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_brief_versions (
  client_id           text        not null,
  brief_id            text        not null,
  version             integer     not null,
  batch_id            text,
  kind                text        not null,
  status              text        not null default 'proposed',
  content_hash        text        not null,
  source_cutoff       timestamptz not null,
  direction_version   text        not null,
  payload             jsonb       not null,
  claim_ledger        jsonb       not null default '[]'::jsonb,
  revises_brief_id    text,
  revises_version     integer,
  changed_evidence    text,
  readiness           text        not null default 'needs_material',
  missing_material    jsonb       not null default '[]'::jsonb,
  authored_by_seat    text,
  created_at          timestamptz not null default now(),
  constraint editorial_brief_versions_pkey primary key (client_id, brief_id, version),
  constraint editorial_brief_versions_client_nonempty check (btrim(client_id) <> ''),
  constraint editorial_brief_versions_id_nonempty check (btrim(brief_id) <> ''),
  constraint editorial_brief_versions_version_positive check (version >= 1),
  constraint editorial_brief_versions_kind_chk
    check (kind in ('post', 'resource', 'promotion', 'video_script')),
  constraint editorial_brief_versions_status_chk
    check (status in ('proposed', 'shortlisted', 'deferred', 'rejected')),
  constraint editorial_brief_versions_readiness_chk
    check (readiness in ('ready_to_draft', 'needs_material')),
  -- A 64-character lowercase hex digest, or it is not a content hash.
  constraint editorial_brief_versions_hash_shape
    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint editorial_brief_versions_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint editorial_brief_versions_claims_array check (jsonb_typeof(claim_ledger) = 'array'),
  constraint editorial_brief_versions_missing_array check (jsonb_typeof(missing_material) = 'array'),
  -- Ready means ready. A brief cannot be ready to draft while it still lists missing material.
  constraint editorial_brief_versions_ready_has_no_gap
    check (readiness <> 'ready_to_draft' or jsonb_array_length(missing_material) = 0),
  constraint editorial_brief_versions_batch_fk
    foreign key (client_id, batch_id)
    references public.editorial_batches (client_id, batch_id),
  -- A revision points at a real earlier version of this tenant and explains what changed.
  constraint editorial_brief_versions_revises_pair
    check ((revises_brief_id is null) = (revises_version is null)),
  constraint editorial_brief_versions_revises_explained
    check (revises_brief_id is null
           or nullif(btrim(coalesce(changed_evidence, '')), '') is not null),
  constraint editorial_brief_versions_revises_fk
    foreign key (client_id, revises_brief_id, revises_version)
    references public.editorial_brief_versions (client_id, brief_id, version)
);

create index if not exists editorial_brief_versions_batch_idx
  on public.editorial_brief_versions (client_id, batch_id, brief_id, version desc);

create index if not exists editorial_brief_versions_head_idx
  on public.editorial_brief_versions (client_id, brief_id, version desc);

-- ---------------------------------------------------------------------------
-- editorial_brief_sources -- the typed link from a brief version to a snapshot
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_brief_sources (
  client_id       text    not null,
  brief_id        text    not null,
  version         integer not null,
  evidence_id     text    not null,
  relation        text    not null,
  source_id       text    not null,
  seen_version    integer not null,
  created_at      timestamptz not null default now(),
  constraint editorial_brief_sources_pkey
    primary key (client_id, brief_id, version, evidence_id),
  constraint editorial_brief_sources_relation_chk check (relation in
    ('supports_buyer_concern', 'supports_claim', 'observed_own_performance',
     'observed_market_performance', 'supplies_format_inspiration',
     'supplies_asset_proof', 'contradicts_claim')),
  constraint editorial_brief_sources_brief_fk
    foreign key (client_id, brief_id, version)
    references public.editorial_brief_versions (client_id, brief_id, version) on delete cascade,
  constraint editorial_brief_sources_source_fk
    foreign key (client_id, source_id, seen_version)
    references public.editorial_sources (client_id, source_id, seen_version)
);

create index if not exists editorial_brief_sources_source_idx
  on public.editorial_brief_sources (client_id, source_id, seen_version);

-- ---------------------------------------------------------------------------
-- editorial_decisions -- append-only, one request_id is one row
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_decisions (
  client_id         text        not null,
  decision_id       text        not null,
  request_id        text        not null,
  target_kind       text        not null,
  target_id         text        not null,
  target_version    integer,
  expected_version  integer,
  observed_version  integer,
  action            text        not null,
  scope             text        not null,
  reason            text        not null,
  outcome           text        not null default 'recorded',
  conflict_detail   text,
  created_at        timestamptz not null default now(),
  constraint editorial_decisions_pkey primary key (client_id, decision_id),
  -- Idempotency. A replayed request returns the row it already wrote.
  constraint editorial_decisions_request_uniq unique (client_id, request_id),
  constraint editorial_decisions_target_kind_chk
    check (target_kind in ('brief', 'source', 'client_direction')),
  constraint editorial_decisions_action_chk check (action in
    ('shortlist', 'defer', 'reject', 'edit', 'pin', 'dismiss', 'restore', 'accept_direction')),
  constraint editorial_decisions_scope_chk
    check (scope in ('candidate', 'angle', 'format', 'source', 'client_direction')),
  constraint editorial_decisions_outcome_chk
    check (outcome in ('recorded', 'conflict', 'pending_reconciliation')),
  -- Every decision has a reason. A skipped card writes no row at all, which is why this can be
  -- required rather than defaulted.
  constraint editorial_decisions_reason_nonempty check (btrim(reason) <> ''),
  constraint editorial_decisions_conflict_detail
    check (outcome = 'recorded' or nullif(btrim(coalesce(conflict_detail, '')), '') is not null)
);

create index if not exists editorial_decisions_target_idx
  on public.editorial_decisions (client_id, target_kind, target_id, created_at desc);

create index if not exists editorial_decisions_cutoff_idx
  on public.editorial_decisions (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- editorial_brief_artifacts -- one artifact role per brief version, ever
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_brief_artifacts (
  client_id       text        not null,
  brief_id        text        not null,
  version         integer     not null,
  artifact_role   text        not null,
  artifact_kind   text        not null default 'draft',
  artifact_id     text,
  request_id      text        not null,
  created_at      timestamptz not null default now(),
  -- The UNIQUE key the plan names, expressed as the primary key: a retry of the same request
  -- collides here instead of creating a second draft.
  constraint editorial_brief_artifacts_pkey
    primary key (client_id, brief_id, version, artifact_role),
  constraint editorial_brief_artifacts_request_uniq unique (client_id, request_id),
  constraint editorial_brief_artifacts_role_nonempty check (btrim(artifact_role) <> ''),
  constraint editorial_brief_artifacts_brief_fk
    foreign key (client_id, brief_id, version)
    references public.editorial_brief_versions (client_id, brief_id, version)
);

-- ---------------------------------------------------------------------------
-- editorial_current_batch -- the promoted suggestion pointer, one row per lane
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_current_batch (
  client_id     text        not null,
  batch_id      text        not null,
  promoted_at   timestamptz not null default now(),
  constraint editorial_current_batch_pkey primary key (client_id),
  constraint editorial_current_batch_fk
    foreign key (client_id, batch_id)
    references public.editorial_batches (client_id, batch_id)
);

-- Only a validated complete or explicitly partial batch may become the current pointer. An
-- empty/failed refresh therefore leaves the previous pointer exactly where it was; the guard is
-- a trigger and not only an RPC branch, so a future writer cannot route around it.
create or replace function public.editorial_current_batch_promotable()
returns trigger
language plpgsql
as $function$
declare
  v_status text;
begin
  select b.status into v_status
    from public.editorial_batches b
   where b.client_id = new.client_id and b.batch_id = new.batch_id;
  if v_status is null then
    raise exception 'editorial contract: cannot promote an unknown batch'
      using errcode = 'foreign_key_violation';
  end if;
  if v_status not in ('complete', 'partial') then
    raise exception 'editorial contract: a % batch is not promotable; the last usable batch stays', v_status
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_refresh_requests -- idempotent request identity + per-lane serialization
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_refresh_requests (
  client_id                   text        not null,
  request_id                  text        not null,
  refresh_id                  text        not null,
  expected_direction_version  text        not null,
  observed_direction_version  text,
  status                      text        not null default 'queued',
  batch_id                    text,
  last_usable_batch_id        text,
  failure_reason              text,
  awaiting_reconciliation     boolean     not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint editorial_refresh_requests_pkey primary key (client_id, request_id),
  constraint editorial_refresh_requests_refresh_uniq unique (client_id, refresh_id),
  constraint editorial_refresh_requests_status_chk
    check (status in ('queued', 'running', 'complete', 'partial', 'empty', 'failed')),
  constraint editorial_refresh_requests_batch_fk
    foreign key (client_id, batch_id)
    references public.editorial_batches (client_id, batch_id)
);

-- At most one active synthesis per lane: the concurrency boundary the plan names, expressed as a
-- partial unique index rather than an advisory lock, so it survives a connection drop.
create unique index if not exists editorial_refresh_active_one_per_client
  on public.editorial_refresh_requests (client_id)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- editorial_outcome_snapshots -- observations attached to a hypothesis
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_outcome_snapshots (
  client_id             text        not null,
  snapshot_id           text        not null,
  brief_id              text        not null,
  brief_version         integer,
  artifact_id           text,
  artifact_role         text,
  metric                text        not null,
  -- NULL means unknown, and the reader renders 'unknown'. A real zero is 0. Neither fills the
  -- other, which is why the value is nullable and the reason is required when it is null.
  observed_value        numeric,
  unknown_reason        text,
  denominator           text,
  scope                 text        not null default 'unspecified',
  window_start          timestamptz,
  window_end            timestamptz,
  captured_at           timestamptz not null default now(),
  event_definition      text        not null default 'unspecified',
  attribution           text        not null default 'unknown',
  limitation            text        not null default '',
  publication_id        text,
  constraint editorial_outcome_snapshots_pkey primary key (client_id, snapshot_id),
  constraint editorial_outcome_snapshots_attribution_chk
    check (attribution in ('direct', 'assisted', 'unknown')),
  constraint editorial_outcome_snapshots_unknown_reason
    check (observed_value is not null
           or nullif(btrim(coalesce(unknown_reason, '')), '') is not null),
  -- A counted value states its denominator. A count with no denominator is not a measurement.
  constraint editorial_outcome_snapshots_denominator
    check (observed_value is null
           or nullif(btrim(coalesce(denominator, '')), '') is not null)
);

create index if not exists editorial_outcome_snapshots_brief_idx
  on public.editorial_outcome_snapshots (client_id, brief_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Triggers: immutability and append-only, attached idempotently
-- ---------------------------------------------------------------------------

-- Each pair is written out in full rather than generated in a loop, for two reasons: PostgreSQL
-- has no `create trigger if not exists`, and the rollback file has to be able to name every
-- trigger it removes. `drop trigger if exists` on a trigger THIS FILE creates two lines later is
-- the idempotency idiom -- it removes nothing that predates 105 and makes a replay a no-op.

drop trigger if exists editorial_sources_immutable on public.editorial_sources;
create trigger editorial_sources_immutable
  before update or delete on public.editorial_sources
  for each row execute function public.editorial_immutable_guard();

drop trigger if exists editorial_brief_versions_immutable on public.editorial_brief_versions;
create trigger editorial_brief_versions_immutable
  before update or delete on public.editorial_brief_versions
  for each row execute function public.editorial_immutable_guard();

drop trigger if exists editorial_brief_sources_immutable on public.editorial_brief_sources;
create trigger editorial_brief_sources_immutable
  before update or delete on public.editorial_brief_sources
  for each row execute function public.editorial_immutable_guard();

drop trigger if exists editorial_decisions_immutable on public.editorial_decisions;
create trigger editorial_decisions_immutable
  before update or delete on public.editorial_decisions
  for each row execute function public.editorial_immutable_guard();

drop trigger if exists editorial_brief_artifacts_immutable on public.editorial_brief_artifacts;
create trigger editorial_brief_artifacts_immutable
  before update or delete on public.editorial_brief_artifacts
  for each row execute function public.editorial_immutable_guard();

drop trigger if exists editorial_input_manifests_immutable on public.editorial_input_manifests;
create trigger editorial_input_manifests_immutable
  before update or delete on public.editorial_input_manifests
  for each row execute function public.editorial_immutable_guard();

drop trigger if exists editorial_outcome_snapshots_immutable on public.editorial_outcome_snapshots;
create trigger editorial_outcome_snapshots_immutable
  before update or delete on public.editorial_outcome_snapshots
  for each row execute function public.editorial_immutable_guard();

drop trigger if exists editorial_batches_identity_immutable on public.editorial_batches;
create trigger editorial_batches_identity_immutable
  before update on public.editorial_batches
  for each row execute function public.editorial_batch_identity_guard();

drop trigger if exists editorial_current_batch_guard on public.editorial_current_batch;
create trigger editorial_current_batch_guard
  before insert or update on public.editorial_current_batch
  for each row execute function public.editorial_current_batch_promotable();

-- ---------------------------------------------------------------------------
-- RLS and grants. service_role at the table; the browser goes through the RPCs.
-- ---------------------------------------------------------------------------

alter table public.editorial_sources            enable row level security;
alter table public.editorial_source_curation    enable row level security;
alter table public.editorial_input_manifests    enable row level security;
alter table public.editorial_batches            enable row level security;
alter table public.editorial_brief_versions     enable row level security;
alter table public.editorial_brief_sources      enable row level security;
alter table public.editorial_decisions          enable row level security;
alter table public.editorial_brief_artifacts    enable row level security;
alter table public.editorial_current_batch      enable row level security;
alter table public.editorial_refresh_requests   enable row level security;
alter table public.editorial_outcome_snapshots  enable row level security;

revoke all on public.editorial_sources            from public, anon, authenticated;
revoke all on public.editorial_source_curation    from public, anon, authenticated;
revoke all on public.editorial_input_manifests    from public, anon, authenticated;
revoke all on public.editorial_batches            from public, anon, authenticated;
revoke all on public.editorial_brief_versions     from public, anon, authenticated;
revoke all on public.editorial_brief_sources      from public, anon, authenticated;
revoke all on public.editorial_decisions          from public, anon, authenticated;
revoke all on public.editorial_brief_artifacts    from public, anon, authenticated;
revoke all on public.editorial_current_batch      from public, anon, authenticated;
revoke all on public.editorial_refresh_requests   from public, anon, authenticated;
revoke all on public.editorial_outcome_snapshots  from public, anon, authenticated;

grant select, insert on public.editorial_sources            to service_role;
grant select, insert, update on public.editorial_source_curation to service_role;
grant select, insert on public.editorial_input_manifests    to service_role;
grant select, insert, update on public.editorial_batches    to service_role;
grant select, insert on public.editorial_brief_versions     to service_role;
grant select, insert on public.editorial_brief_sources      to service_role;
grant select, insert on public.editorial_decisions          to service_role;
grant select, insert on public.editorial_brief_artifacts    to service_role;
grant select, insert, update on public.editorial_current_batch to service_role;
grant select, insert, update on public.editorial_refresh_requests to service_role;
grant select, insert on public.editorial_outcome_snapshots  to service_role;

-- ---------------------------------------------------------------------------
-- The tenant guard every RPC below opens with
-- ---------------------------------------------------------------------------
--
-- Authorization first, scope second, exactly as 104 does. The caller-supplied client_id is never
-- trusted on its own: it has to be a lane this installation registers AND the caller has to hold
-- the operator gate. A lane that does not exist is refused, never answered with a calm empty
-- page that would read as "this tenant has nothing".

create or replace function public.editorial_guard(p_gate text, p_client_id text)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.operator_gate_ok(p_gate) then
    raise exception 'unauthorized';
  end if;
  if p_client_id is null or btrim(p_client_id) = '' then
    raise exception 'the editorial contract requires one exact client_id';
  end if;
  if p_client_id in ('zz-selftest') then
    raise exception 'selftest lane has no editorial population';
  end if;
  if not public.lane_allowed(p_client_id) then
    raise exception 'unknown seat';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_read_research -- SourcePage
-- ---------------------------------------------------------------------------
--
-- The newest snapshot of each distinct source for one lane, with its curation state. Repeat
-- ingestions are seen_versions of ONE source, so `total` counts sources and never captures.
-- `independent_source_count` is recomputed here, server-side: a caller-supplied count is ignored.

create or replace function public.editorial_read_research(
  p_gate text, p_client_id text, p_filters jsonb default '{}'::jsonb,
  p_cursor text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_limit    integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_kinds    text[];
  v_cur      text[];
  v_items    jsonb;
  v_total    integer;
  v_indep    integer;
  v_last     timestamptz;
  v_next     text;
  v_awaiting integer;
  v_stale    integer;
begin
  perform public.editorial_guard(p_gate, p_client_id);

  if p_filters is not null and jsonb_typeof(p_filters->'kinds') = 'array' then
    select array_agg(value::text) into v_kinds
      from jsonb_array_elements_text(p_filters->'kinds') as value;
  end if;
  if p_filters is not null and jsonb_typeof(p_filters->'curation') = 'array' then
    select array_agg(value::text) into v_cur
      from jsonb_array_elements_text(p_filters->'curation') as value;
  end if;

  with heads as (
    select distinct on (s.source_id) s.*
      from public.editorial_sources s
     where s.client_id = p_client_id
       and (v_kinds is null or s.source_kind = any (v_kinds))
     order by s.source_id, s.seen_version desc
  ), joined as (
    select h.*, coalesce(c.state, 'unseen') as curation_state
      from heads h
      left join public.editorial_source_curation c
        on c.client_id = p_client_id and c.source_id = h.source_id
  ), filtered as (
    select * from joined j
     where (v_cur is null or j.curation_state = any (v_cur))
  )
  select count(*)::int,
         count(distinct f.source_id) filter (
           where f.independent and f.gap_state is null
             and f.permission_state not in ('denied','withheld'))::int,
         max(f.captured_at),
         count(*) filter (where f.captured_at > coalesce(
           (select max(b.requested_at) from public.editorial_batches b
             where b.client_id = p_client_id and b.status in ('complete', 'partial')),
           '-infinity'::timestamptz))::int,
         count(*) filter (where f.source_published_at is not null
                            and f.source_published_at < now() - interval '120 days')::int
    into v_total, v_indep, v_last, v_awaiting, v_stale
    from filtered f;

  with heads as (
    select distinct on (s.source_id) s.*
      from public.editorial_sources s
     where s.client_id = p_client_id
       and (v_kinds is null or s.source_kind = any (v_kinds))
     order by s.source_id, s.seen_version desc
  ), joined as (
    select h.*, coalesce(c.state, 'unseen') as curation_state
      from heads h
      left join public.editorial_source_curation c
        on c.client_id = p_client_id and c.source_id = h.source_id
  ), page as (
    select * from joined j
     where (v_cur is null or j.curation_state = any (v_cur))
       and (p_cursor is null or j.source_id > p_cursor)
     order by j.source_id
     limit v_limit
  )
  select jsonb_agg(jsonb_build_object(
           'source_id', p.source_id,
           'source_kind', p.source_kind,
           'source_client_scope', p.source_client_scope,
           'source_ref', case
             when nullif(btrim(coalesce(p.source_url, '')), '') is not null
               then jsonb_build_object('url', p.source_url)
             else jsonb_build_object('excerpt_pointer', p.excerpt_pointer) end,
           -- An unknown publication date surfaces as the literal 'unknown'. The capture date is
           -- never promoted into this field.
           'source_published_date', case
             when p.published_date_state = 'known'
               then to_jsonb(to_char(p.source_published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
             else to_jsonb('unknown'::text) end,
           'captured_date', to_char(p.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'owner', case when p.permission_state in ('denied','withheld') then 'unknown' else p.owner end,
           'source_content_hash', case when p.permission_state in ('denied','withheld') then null else p.body_sha256 end,
           'passage', case when p.permission_state in ('denied','withheld') then null else p.passage end,
           'retained_context', case when p.permission_state in ('denied','withheld') then '' else p.retained_context end,
           'limitation', case when p.permission_state in ('denied','withheld') then 'Current source permission is unavailable.' else p.limitation end,
           'independent', case when p.permission_state in ('denied','withheld') then false else p.independent end,
           'derived_from', case when p.permission_state in ('denied','withheld') then p.source_id else p.derived_from end,
           'permission_state', p.permission_state,
           'gap_state', case when p.permission_state in ('denied','withheld')
             then jsonb_build_object('reason','permission_denied','detail','Current source permission is unavailable.')
             else p.gap_state end,
           'currency_state', case
             when p.published_date_state <> 'known' then 'unknown'
             when p.source_published_at < now() - interval '120 days' then 'historical'
             else 'current' end,
           'age_days', case
             when p.published_date_state <> 'known' then null
             else (now()::date - p.source_published_at::date) end,
           'snapshot_hash', p.snapshot_hash,
           'snapshot_hash_scope', 'immutable_original',
           'curation_state', p.curation_state,
           'seen_version', p.seen_version,
           'candidate_fields', case when p.permission_state in ('denied','withheld') then null else p.candidate_fields end,
           'derived_field_names', jsonb_build_array(
             'editorial_assessment', 'editorial_strength', 'angle_options'))
         order by p.source_id),
         max(p.source_id)
    into v_items, v_next
    from page p;

  return jsonb_build_object(
    'schema_version', 1,
    'client_id', p_client_id,
    'state', case when coalesce(v_total, 0) = 0 then 'empty' else 'ready' end,
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0),
    'independent_source_count', coalesce(v_indep, 0),
    'next_cursor', case
      when v_items is null or jsonb_array_length(v_items) < v_limit then null else v_next end,
    'health', jsonb_build_object(
      'last_successful_collection', case
        when v_last is null then 'unknown'
        else to_char(v_last at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
      'source_cutoff', coalesce((
        select to_char(m.source_cutoff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          from public.editorial_input_manifests m
         where m.client_id = p_client_id
         order by m.created_at desc limit 1), 'unknown'),
      'new_evidence_awaiting_refresh', coalesce(v_awaiting, 0),
      'stale_inputs', coalesce(v_stale, 0)),
    'gaps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'source_id', g.source_id,
               'reason', case when g.permission_state in ('denied','withheld')
                 then 'permission_denied' else g.gap_state->>'reason' end,
               'detail', case when g.permission_state in ('denied','withheld')
                 then 'Current source permission is unavailable.' else g.gap_state->>'detail' end))
        from (select distinct on (s.source_id) s.* from public.editorial_sources s
          where s.client_id=p_client_id order by s.source_id,s.seen_version desc) g
       where g.gap_state is not null or g.permission_state in ('denied','withheld')), '[]'::jsonb));
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_read_briefs -- BriefPage
-- ---------------------------------------------------------------------------
--
-- A batch id that does not exist returns an EXPLICIT empty page. It never falls back to the
-- current batch and never borrows another lane's rows.

create or replace function public.editorial_read_briefs(
  p_gate text, p_client_id text, p_batch_id text default null,
  p_cursor text default null, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_limit   integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_batch   text;
  v_known   boolean := false;
  v_status  text;
  v_gaps    jsonb := '[]'::jsonb;
  v_items   jsonb;
  v_total   integer := 0;
  v_next    text;
begin
  perform public.editorial_guard(p_gate, p_client_id);

  if p_batch_id is null then
    select cb.batch_id into v_batch
      from public.editorial_current_batch cb
     where cb.client_id = p_client_id;
  else
    v_batch := p_batch_id;
  end if;

  if v_batch is not null then
    select true, b.status, b.coverage_gaps into v_known, v_status, v_gaps
      from public.editorial_batches b
     where b.client_id = p_client_id and b.batch_id = v_batch;
  end if;

  if v_batch is null or not coalesce(v_known, false) then
    return jsonb_build_object(
      'schema_version', 1, 'client_id', p_client_id, 'batch_id', v_batch,
      'state', 'empty', 'items', '[]'::jsonb, 'total', 0, 'next_cursor', null,
      'coverage_gaps', '[]'::jsonb,
      'message', case when v_batch is null
        then 'No batch has been promoted for this lane yet.'
        else 'No batch with that id exists for this lane.' end);
  end if;

  select count(distinct brief_id)::int into v_total
    from public.editorial_brief_versions v
   where v.client_id = p_client_id and v.batch_id = v_batch;

  with heads as (
    select distinct on (v.brief_id) v.* from public.editorial_brief_versions v
     where v.client_id = p_client_id and v.batch_id = v_batch
     order by v.brief_id, v.version desc
  ), page as (
    select v.* from heads v
     where true
       and (p_cursor is null or v.brief_id > p_cursor)
     order by v.brief_id
     limit v_limit
  )
  select jsonb_agg(public.editorial_brief_json(p.client_id, p.brief_id, p.version)
                   order by p.brief_id),
         max(p.brief_id)
    into v_items, v_next
    from page p;

  return jsonb_build_object(
    'schema_version', 1,
    'client_id', p_client_id,
    'batch_id', v_batch,
    'state', case
      when coalesce(v_total, 0) = 0 then 'empty'
      when v_status in ('partial', 'failed', 'empty') then 'partial'
      else 'ready' end,
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0),
    'next_cursor', case
      when v_items is null or jsonb_array_length(v_items) < v_limit then null else v_next end,
    'coverage_gaps', coalesce(v_gaps, '[]'::jsonb));
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_brief_json -- one brief version, assembled once and reused
-- ---------------------------------------------------------------------------
--
-- Service-only: it carries no gate and is never granted to the browser. The two gated readers
-- above and below call it AFTER their own guard has run.

create or replace function public.editorial_brief_json(
  p_client_id text, p_brief_id text, p_version integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_row       public.editorial_brief_versions%rowtype;
  v_effective text;
  v_denied_ids jsonb;
begin
  select * into v_row from public.editorial_brief_versions v
   where v.client_id = p_client_id and v.brief_id = p_brief_id and v.version = p_version;
  if v_row.brief_id is null then
    return null;
  end if;

  -- Current permission governs historical reads too. Do not return the stored
  -- payload, claim ledger or editorial copy after any linked source is revoked.
  -- The original hash remains an identity only, never a digest of this gap view.
  select jsonb_agg(distinct l.source_id) into v_denied_ids
    from public.editorial_brief_sources l
   where l.client_id=p_client_id and l.brief_id=p_brief_id and l.version=p_version
     and (select s.permission_state from public.editorial_sources s
           where s.client_id=l.client_id and s.source_id=l.source_id
           order by s.seen_version desc limit 1) in ('denied','withheld');
  if v_denied_ids is not null then
    return jsonb_build_object('access','permission_unavailable',
      'identity',jsonb_build_object('brief_id',v_row.brief_id,'client_id',v_row.client_id,
        'version',v_row.version,'kind',v_row.kind,'status',v_row.status,
        'content_hash',v_row.content_hash),
      'source_ids',v_denied_ids,'content_hash_scope','immutable_original');
  end if;

  -- The status AT PROPOSAL is immutable on the row; the EFFECTIVE status comes from the
  -- append-only ledger, and only from decisions that were actually recorded. A conflict row is
  -- provenance, never a state change.
  select case d.action
           when 'shortlist' then 'shortlisted'
           when 'defer' then 'deferred'
           when 'reject' then 'rejected'
           when 'restore' then 'proposed'
           else null end
    into v_effective
    from public.editorial_decisions d
   where d.client_id = p_client_id
     and d.target_kind = 'brief'
     and d.target_id = p_brief_id
     and d.outcome = 'recorded'
     and d.action in ('shortlist', 'defer', 'reject', 'restore')
   order by d.created_at desc, d.decision_id desc
   limit 1;

  return v_row.payload
    || jsonb_build_object(
         'identity', coalesce(v_row.payload->'identity', '{}'::jsonb) || jsonb_build_object(
           'brief_id', v_row.brief_id,
           'version', v_row.version,
           'client_id', v_row.client_id,
           'kind', v_row.kind,
           'status', v_row.status,
           'content_hash', v_row.content_hash,
           'source_cutoff', to_char(v_row.source_cutoff at time zone 'UTC',
                                    'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         'claim_ledger', v_row.claim_ledger,
         'readiness', v_row.readiness,
         'missing_material', v_row.missing_material,
         'batch_id', v_row.batch_id,
         'effective_status', coalesce(v_effective, v_row.status),
         'revises', case when v_row.revises_brief_id is null then null else jsonb_build_object(
           'brief_id', v_row.revises_brief_id,
           'version', v_row.revises_version,
           'changed_evidence', v_row.changed_evidence) end,
         'decisions_links', coalesce(v_row.payload->'decisions_links', '{}'::jsonb)
           || jsonb_build_object(
             'selection_events', coalesce((
               select jsonb_agg(d.decision_id order by d.created_at)
                 from public.editorial_decisions d
                where d.client_id = p_client_id and d.target_kind = 'brief'
                  and d.target_id = p_brief_id), '[]'::jsonb),
             'draft_ids', coalesce((
               select jsonb_agg(a.artifact_id order by a.created_at)
                 from public.editorial_brief_artifacts a
                where a.client_id = p_client_id and a.brief_id = p_brief_id
                  and a.version = p_version and a.artifact_id is not null), '[]'::jsonb),
             'observed_outcomes', coalesce((
               select jsonb_agg(o.snapshot_id order by o.captured_at)
                 from public.editorial_outcome_snapshots o
                where o.client_id = p_client_id and o.brief_id = p_brief_id), '[]'::jsonb)));
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_read_brief -- BriefRead (found | explicit not-found)
-- ---------------------------------------------------------------------------
--
-- A request for a version that does not exist returns not-found. It NEVER silently answers with
-- the newest version, and it never distinguishes "belongs to another tenant" from "does not
-- exist" -- the second would confirm the other tenant's content by omission.

create or replace function public.editorial_read_brief(
  p_gate text, p_client_id text, p_brief_id text, p_version integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_any   boolean;
  v_brief jsonb;
begin
  perform public.editorial_guard(p_gate, p_client_id);
  if p_brief_id is null or btrim(p_brief_id) = '' or p_version is null then
    raise exception 'editorial_read_brief requires an exact brief id and version';
  end if;

  select exists (select 1 from public.editorial_brief_versions v
                  where v.client_id = p_client_id and v.brief_id = p_brief_id)
    into v_any;

  v_brief := public.editorial_brief_json(p_client_id, p_brief_id, p_version);

  if v_brief is null then
    return jsonb_build_object(
      'schema_version', 1, 'found', false, 'client_id', p_client_id,
      'brief_id', p_brief_id, 'version', p_version,
      'reason', case when v_any then 'no_such_version' else 'no_such_brief' end);
  end if;

  if v_brief->>'access'='permission_unavailable' then
    return jsonb_build_object('schema_version',1,'found',true,
      'access','permission_unavailable','gap',v_brief);
  end if;
  return jsonb_build_object('schema_version', 1, 'found', true, 'brief', v_brief);
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_record_decision -- DecisionReceipt
-- ---------------------------------------------------------------------------
--
-- Idempotent on (client_id, request_id): a replay returns the row it already wrote, with the same
-- decision_id. A stale expected_version writes a `conflict` row -- kept as provenance, excluded
-- from the effective status -- and overwrites nothing. NOTHING in this function touches
-- lm_idea_candidates, client_ideas, carousel_drafts, ops_drafts or scheduled_posts: a shortlist
-- is bookkeeping and cannot satisfy a generator's pickup predicate.

create or replace function public.editorial_record_decision(
  p_gate text, p_client_id text, p_target_kind text, p_target_id text,
  p_target_version integer, p_expected_version integer, p_action text,
  p_reason text, p_scope text, p_request_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_existing public.editorial_decisions%rowtype;
  v_head     integer;
  v_outcome  text := 'recorded';
  v_detail   text;
  v_id       text;
  v_row      public.editorial_decisions%rowtype;
begin
  perform public.editorial_guard(p_gate, p_client_id);
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'a decision requires an explicit request id';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a decision requires a reason';
  end if;

  -- Idempotency first: the same request is the same decision, not a second one.
  select * into v_existing from public.editorial_decisions d
   where d.client_id = p_client_id and d.request_id = p_request_id;
  if v_existing.decision_id is not null then
    return jsonb_build_object(
      'schema_version', 1, 'decision_id', v_existing.decision_id, 'client_id', p_client_id,
      'request_id', v_existing.request_id,
      'target', jsonb_build_object('kind', v_existing.target_kind, 'id', v_existing.target_id,
                                   'version', v_existing.target_version),
      'action', v_existing.action, 'scope', v_existing.scope, 'reason', v_existing.reason,
      'expected_version', v_existing.expected_version,
      'observed_version', v_existing.observed_version,
      'outcome', case when v_existing.outcome = 'recorded' then 'duplicate' else v_existing.outcome end,
      'recorded_at', to_char(v_existing.created_at at time zone 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'conflict', case when v_existing.conflict_detail is null then null
        else jsonb_build_object('reason', v_existing.conflict_detail, 'newer_decision_id', null) end,
      'promoted', false);
  end if;

  if p_target_kind = 'brief' then
    select max(v.version) into v_head from public.editorial_brief_versions v
     where v.client_id = p_client_id and v.brief_id = p_target_id;
    if v_head is null then
      raise exception 'no such brief for this lane';
    end if;
    if p_expected_version is not null and p_expected_version <> v_head then
      v_outcome := 'conflict';
      v_detail  := format(
        'the decision was taken against version %s; version %s is now current for this brief',
        p_expected_version, v_head);
    end if;
  end if;

  v_id := 'dec-' || encode(sha256(convert_to(
            p_client_id || '|' || p_request_id, 'UTF8')), 'hex');

  insert into public.editorial_decisions
    (client_id, decision_id, request_id, target_kind, target_id, target_version,
     expected_version, observed_version, action, scope, reason, outcome, conflict_detail)
  values
    (p_client_id, v_id, p_request_id, p_target_kind, p_target_id, p_target_version,
     p_expected_version, v_head, p_action, p_scope, p_reason, v_outcome, v_detail)
  returning * into v_row;

  return jsonb_build_object(
    'schema_version', 1, 'decision_id', v_row.decision_id, 'client_id', p_client_id,
    'request_id', v_row.request_id,
    'target', jsonb_build_object('kind', v_row.target_kind, 'id', v_row.target_id,
                                 'version', v_row.target_version),
    'action', v_row.action, 'scope', v_row.scope, 'reason', v_row.reason,
    'expected_version', v_row.expected_version, 'observed_version', v_row.observed_version,
    'outcome', v_row.outcome,
    'recorded_at', to_char(v_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'conflict', case when v_row.conflict_detail is null then null
      else jsonb_build_object('reason', v_row.conflict_detail, 'newer_decision_id', null) end,
    'promoted', false);
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_read_brief_outcomes -- OutcomeRead
-- ---------------------------------------------------------------------------
--
-- An observation attached to a hypothesis. A null observed_value is reported as 'unknown' with
-- its reason; it is never rendered as 0, and no causal claim is made here.

create or replace function public.editorial_read_brief_outcomes(
  p_gate text, p_client_id text, p_brief_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_items jsonb;
  v_pub   text;
begin
  perform public.editorial_guard(p_gate, p_client_id);
  if p_brief_id is null or btrim(p_brief_id) = '' then
    raise exception 'editorial_read_brief_outcomes requires an exact brief id';
  end if;

  select jsonb_agg(jsonb_build_object(
           'snapshot_id', o.snapshot_id,
           'artifact_id', o.artifact_id,
           'artifact_role', o.artifact_role,
           'metric', o.metric,
           'observed_value', case when o.observed_value is null
             then to_jsonb('unknown'::text) else to_jsonb(o.observed_value) end,
           'denominator', case when o.denominator is null
             then to_jsonb('unknown'::text) else to_jsonb(o.denominator) end,
           'scope', o.scope,
           'window_start', case when o.window_start is null then 'unknown'
             else to_char(o.window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
           'window_end', case when o.window_end is null then 'unknown'
             else to_char(o.window_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
           'captured_at', to_char(o.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'event_definition', o.event_definition,
           'attribution', o.attribution,
           'limitation', o.limitation)
         order by o.captured_at),
         max(o.publication_id)
    into v_items, v_pub
    from public.editorial_outcome_snapshots o
   where o.client_id = p_client_id and o.brief_id = p_brief_id;

  return jsonb_build_object(
    'schema_version', 1, 'client_id', p_client_id, 'brief_id', p_brief_id,
    'state', case when v_items is null then 'empty' else 'ready' end,
    'observations', coalesce(v_items, '[]'::jsonb),
    'unknowns', coalesce((
      select jsonb_agg(o.unknown_reason order by o.snapshot_id)
        from public.editorial_outcome_snapshots o
       where o.client_id = p_client_id and o.brief_id = p_brief_id
         and o.unknown_reason is not null), '[]'::jsonb),
    'attribution_limitations',
      'Direct and assisted attribution are distinct; an unmeasured event is unknown, not zero.',
    'publication_id', v_pub);
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_set_source_curation -- unseen/seen/pinned/dismissed
-- ---------------------------------------------------------------------------
--
-- The one write on the curation table. It has no promoter permission: the four states it can
-- write are not in any generator's pickup vocabulary, and it touches no other table.

create or replace function public.editorial_set_source_curation(
  p_gate text, p_client_id text, p_source_id text, p_state text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_seen integer;
begin
  perform public.editorial_guard(p_gate, p_client_id);
  if p_state not in ('unseen', 'seen', 'pinned', 'dismissed') then
    raise exception 'curation state must be one of unseen, seen, pinned, dismissed';
  end if;

  select max(s.seen_version) into v_seen from public.editorial_sources s
   where s.client_id = p_client_id and s.source_id = p_source_id;
  if v_seen is null then
    raise exception 'no such source for this lane';
  end if;

  insert into public.editorial_source_curation
    (client_id, source_id, state, reason, seen_version)
  values (p_client_id, p_source_id, p_state, p_reason, v_seen)
  on conflict (client_id, source_id) do update
    set state = excluded.state,
        reason = excluded.reason,
        seen_version = excluded.seen_version,
        last_seen_at = now(),
        updated_at = now();

  return jsonb_build_object('schema_version', 1, 'client_id', p_client_id,
    'source_id', p_source_id, 'state', p_state, 'seen_version', v_seen, 'promoted', false);
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_link_artifact -- the idempotent brief-to-artifact link
-- ---------------------------------------------------------------------------
--
-- Run 2's requestDraft calls this BEFORE invoking any existing generator. A retry of the same
-- (client, brief, version, role) returns the identity that already exists -- which is what makes
-- a retry produce one draft and not two. It records a link; it starts nothing.

create or replace function public.editorial_link_artifact(
  p_gate text, p_client_id text, p_brief_id text, p_version integer,
  p_artifact_role text, p_artifact_id text, p_request_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_row public.editorial_brief_artifacts%rowtype;
  v_hash text;
begin
  perform public.editorial_guard(p_gate, p_client_id);

  select v.content_hash into v_hash from public.editorial_brief_versions v
   where v.client_id = p_client_id and v.brief_id = p_brief_id and v.version = p_version;
  if v_hash is null then
    raise exception 'no such brief version for this lane';
  end if;

  select * into v_row from public.editorial_brief_artifacts a
   where a.client_id = p_client_id and a.brief_id = p_brief_id
     and a.version = p_version and a.artifact_role = p_artifact_role;

  if v_row.artifact_role is not null then
    return jsonb_build_object('schema_version', 1, 'client_id', p_client_id,
      'brief_id', p_brief_id, 'brief_version', p_version, 'artifact_role', p_artifact_role,
      'artifact_id', v_row.artifact_id, 'request_id', v_row.request_id,
      'expected_hash', v_hash, 'idempotent_replay', true, 'state', 'accepted',
      'blocked_reason', null);
  end if;

  insert into public.editorial_brief_artifacts
    (client_id, brief_id, version, artifact_role, artifact_id, request_id)
  values (p_client_id, p_brief_id, p_version, p_artifact_role, p_artifact_id, p_request_id)
  returning * into v_row;

  return jsonb_build_object('schema_version', 1, 'client_id', p_client_id,
    'brief_id', p_brief_id, 'brief_version', p_version, 'artifact_role', p_artifact_role,
    'artifact_id', v_row.artifact_id, 'request_id', v_row.request_id,
    'expected_hash', v_hash, 'idempotent_replay', false, 'state', 'accepted',
    'blocked_reason', null);
end;
$function$;

-- ---------------------------------------------------------------------------
-- editorial_promote_batch -- the atomic current-suggestion swap
-- ---------------------------------------------------------------------------
--
-- One statement, one row per lane. A batch that is empty or failed is refused by the trigger, so
-- the previous pointer -- and therefore the shortlist the operator is looking at -- survives.

create or replace function public.editorial_promote_batch(
  p_gate text, p_client_id text, p_batch_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_prev   text;
begin
  perform public.editorial_guard(p_gate, p_client_id);

  select b.status into v_status from public.editorial_batches b
   where b.client_id = p_client_id and b.batch_id = p_batch_id;
  if v_status is null then
    raise exception 'no such batch for this lane';
  end if;

  select cb.batch_id into v_prev from public.editorial_current_batch cb
   where cb.client_id = p_client_id;

  if v_status not in ('complete', 'partial') then
    return jsonb_build_object('schema_version', 1, 'client_id', p_client_id,
      'promoted', false, 'batch_id', p_batch_id, 'status', v_status,
      'current_batch_id', v_prev,
      'message', format('a %s batch is not promotable; the last usable batch is kept', v_status));
  end if;

  insert into public.editorial_current_batch (client_id, batch_id, promoted_at)
  values (p_client_id, p_batch_id, now())
  on conflict (client_id) do update
    set batch_id = excluded.batch_id, promoted_at = excluded.promoted_at;

  return jsonb_build_object('schema_version', 1, 'client_id', p_client_id,
    'promoted', true, 'batch_id', p_batch_id, 'status', v_status,
    'current_batch_id', p_batch_id, 'previous_batch_id', v_prev);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Function grants. anon and public revoked BY NAME on every one of them.
-- ---------------------------------------------------------------------------

revoke all on function public.editorial_guard(text, text) from public;
revoke all on function public.editorial_guard(text, text) from anon;
revoke all on function public.editorial_guard(text, text) from authenticated;
grant execute on function public.editorial_guard(text, text) to service_role;

revoke all on function public.editorial_brief_json(text, text, integer) from public;
revoke all on function public.editorial_brief_json(text, text, integer) from anon;
revoke all on function public.editorial_brief_json(text, text, integer) from authenticated;
grant execute on function public.editorial_brief_json(text, text, integer) to service_role;

revoke all on function public.editorial_immutable_guard() from public;
revoke all on function public.editorial_immutable_guard() from anon;
revoke all on function public.editorial_immutable_guard() from authenticated;

revoke all on function public.editorial_batch_identity_guard() from public;
revoke all on function public.editorial_batch_identity_guard() from anon;
revoke all on function public.editorial_batch_identity_guard() from authenticated;

revoke all on function public.editorial_current_batch_promotable() from public;
revoke all on function public.editorial_current_batch_promotable() from anon;
revoke all on function public.editorial_current_batch_promotable() from authenticated;

revoke all on function public.editorial_read_research(text, text, jsonb, text, integer) from public;
revoke all on function public.editorial_read_research(text, text, jsonb, text, integer) from anon;
grant execute on function public.editorial_read_research(text, text, jsonb, text, integer) to authenticated;
grant execute on function public.editorial_read_research(text, text, jsonb, text, integer) to service_role;

revoke all on function public.editorial_read_briefs(text, text, text, text, integer) from public;
revoke all on function public.editorial_read_briefs(text, text, text, text, integer) from anon;
grant execute on function public.editorial_read_briefs(text, text, text, text, integer) to authenticated;
grant execute on function public.editorial_read_briefs(text, text, text, text, integer) to service_role;

revoke all on function public.editorial_read_brief(text, text, text, integer) from public;
revoke all on function public.editorial_read_brief(text, text, text, integer) from anon;
grant execute on function public.editorial_read_brief(text, text, text, integer) to authenticated;
grant execute on function public.editorial_read_brief(text, text, text, integer) to service_role;

revoke all on function public.editorial_record_decision(text, text, text, text, integer, integer, text, text, text, text) from public;
revoke all on function public.editorial_record_decision(text, text, text, text, integer, integer, text, text, text, text) from anon;
grant execute on function public.editorial_record_decision(text, text, text, text, integer, integer, text, text, text, text) to authenticated;
grant execute on function public.editorial_record_decision(text, text, text, text, integer, integer, text, text, text, text) to service_role;

revoke all on function public.editorial_read_brief_outcomes(text, text, text) from public;
revoke all on function public.editorial_read_brief_outcomes(text, text, text) from anon;
grant execute on function public.editorial_read_brief_outcomes(text, text, text) to authenticated;
grant execute on function public.editorial_read_brief_outcomes(text, text, text) to service_role;

revoke all on function public.editorial_set_source_curation(text, text, text, text, text) from public;
revoke all on function public.editorial_set_source_curation(text, text, text, text, text) from anon;
grant execute on function public.editorial_set_source_curation(text, text, text, text, text) to authenticated;
grant execute on function public.editorial_set_source_curation(text, text, text, text, text) to service_role;

revoke all on function public.editorial_link_artifact(text, text, text, integer, text, text, text) from public;
revoke all on function public.editorial_link_artifact(text, text, text, integer, text, text, text) from anon;
grant execute on function public.editorial_link_artifact(text, text, text, integer, text, text, text) to service_role;

revoke all on function public.editorial_promote_batch(text, text, text) from public;
revoke all on function public.editorial_promote_batch(text, text, text) from anon;
grant execute on function public.editorial_promote_batch(text, text, text) to service_role;
