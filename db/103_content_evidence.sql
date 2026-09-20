-- 103: content evidence. Versioned studies, the posts they retain, and the findings computed
-- from them. Additive only: nothing here alters or replaces an existing object.
--
-- WHY THESE THREE TABLES
--
-- client_research_outliers (102) stores one finished READING per run -- the cards, the lines and
-- the winners as a display object. That is the right shape for a screen and the wrong shape for
-- evidence: a reading cannot be recomputed, its denominators are not addressable, and the newest
-- row wins whatever question you asked. These tables store the population and the arithmetic, so
-- that every displayed number has a recoverable source, denominator, formula and capture date.
-- 102 stays exactly as it is and remains the presentation adapter for the Markets block.
--
-- THE RULES THIS SCHEMA ENFORCES, rather than merely documents
--
--   * A study may not call itself `validated` while it still carries an unresolved numerical
--     discrepancy. The September 19 RISE study stores 147 outliers where two quick replays
--     reproduced 153 and 140; it is importable as `needs_reconciliation` and cannot acquire a
--     verified badge by being re-saved. (studies_validated_reconciled)
--   * A lane's own control posts never join the market population. Ratified 2026-09-19 in 102's
--     header: "a market read that carries own performance was rejected". Here it is a check
--     constraint, not a convention. (posts_own_control_not_market)
--   * An excluded row keeps its reason. A count with no reason is not a receipt.
--     (posts_exclusion_reason_present)
--   * A market finding over a positive baseline must carry its lift. A zero baseline gives no
--     finite multiplier, so lift is null there and the finding stays inspectable and unranked.
--     (findings_market_lift_present)
--
-- TENANCY. client_id leads every primary key and appears first in every index, so no read can be
-- written that is not lane-scoped. Both child tables carry a composite foreign key back to
-- (client_id, study_id), which is what makes a foreign-tenant insert a constraint violation
-- rather than a silent orphan.
--
-- PERMISSIONS. Same shape as 102: RLS on, all privileges revoked from public/anon/authenticated,
-- service_role only. content_evidence_pack is a SERVICE-ONLY computational reader -- its signature
-- is fixed by the plan and carries no p_gate, so it is granted to service_role alone and is NOT
-- an operator reader. The gated browser-facing reader (operator_gate_ok + lane_allowed, granted to
-- authenticated, exactly like operator_market_outliers) is added by the UI package that needs it.
-- anon is revoked from the function BY NAME because a default-privileges rule grants it execute on
-- every new function (see the note in 100).

-- ---------------------------------------------------------------------------
-- client_research_studies
-- ---------------------------------------------------------------------------

create table if not exists public.client_research_studies (
  client_id                 text        not null,
  study_id                  text        not null,
  study_kind                text        not null,
  method_version            text        not null,
  state                     text        not null default 'imported',
  schema_version            integer     not null default 1,
  manifest                  jsonb       not null default '{}'::jsonb,
  source_paths              jsonb       not null default '[]'::jsonb,
  publication_window_from   date,
  publication_window_to     date,
  observation_cutoff        timestamptz not null,
  metric_definitions        jsonb       not null default '{}'::jsonb,
  roster_version            text,
  eligibility               jsonb       not null default '{}'::jsonb,
  excluded_counts           jsonb       not null default '{}'::jsonb,
  classifier_versions       jsonb       not null default '[]'::jsonb,
  unresolved_discrepancies  jsonb       not null default '[]'::jsonb,
  missing_inputs            jsonb       not null default '[]'::jsonb,
  content_sha256            text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint client_research_studies_pkey primary key (client_id, study_id),
  constraint client_research_studies_client_nonempty check (btrim(client_id) <> ''),
  constraint client_research_studies_study_nonempty check (btrim(study_id) <> ''),
  constraint client_research_studies_kind_chk
    check (study_kind in ('market', 'own', 'pattern', 'audience')),
  constraint client_research_studies_state_chk
    check (state in ('imported', 'needs_reconciliation', 'validated', 'stale', 'failed')),
  constraint client_research_studies_manifest_object check (jsonb_typeof(manifest) = 'object'),
  constraint client_research_studies_sources_array check (jsonb_typeof(source_paths) = 'array'),
  constraint client_research_studies_discrepancies_array
    check (jsonb_typeof(unresolved_discrepancies) = 'array'),
  -- The contract's hard rule, in the store as well as in contracts.mjs.
  constraint client_research_studies_validated_reconciled
    check (state <> 'validated' or jsonb_array_length(unresolved_discrepancies) = 0)
);

create index if not exists client_research_studies_client_kind_idx
  on public.client_research_studies (client_id, study_kind, created_at desc);

-- ---------------------------------------------------------------------------
-- client_research_study_posts
-- ---------------------------------------------------------------------------

create table if not exists public.client_research_study_posts (
  client_id           text        not null,
  study_id            text        not null,
  canonical_source_id text        not null,
  source_url          text,
  author_id           text,
  author_role         text,
  -- Distinct on purpose, forever. published_at is when the author published; captured_at is when
  -- we observed it. A capture never fills a publication and never overwrites one.
  published_at        timestamptz,
  first_captured_at   timestamptz,
  last_captured_at    timestamptz,
  post_text           text,
  artifact_location   text,
  artifact_sha256     text,
  format_evidence     jsonb       not null default '{}'::jsonb,
  observed_metrics    jsonb       not null default '{}'::jsonb,
  -- Repeat captures of one post are observations of that post, never additional posts.
  observations        jsonb       not null default '[]'::jsonb,
  population          text        not null default 'market',
  is_own_control      boolean     not null default false,
  inclusion           text        not null default 'included',
  exclusion_reason    text,
  age_comparability   text        not null default 'unknown',
  content_sha256      text,
  created_at          timestamptz not null default now(),
  constraint client_research_study_posts_pkey
    primary key (client_id, study_id, canonical_source_id),
  constraint client_research_study_posts_study_fk
    foreign key (client_id, study_id)
    references public.client_research_studies (client_id, study_id) on delete cascade,
  constraint client_research_study_posts_id_nonempty check (btrim(canonical_source_id) <> ''),
  constraint client_research_study_posts_population_chk
    check (population in ('market', 'own_control', 'excluded')),
  constraint client_research_study_posts_inclusion_chk
    check (inclusion in ('included', 'excluded')),
  constraint client_research_study_posts_age_chk
    check (age_comparability in ('comparable', 'age_unmatched', 'unknown')),
  constraint client_research_study_posts_observations_array
    check (jsonb_typeof(observations) = 'array'),
  -- Ratified 2026-09-19: own performance never enters a market population.
  constraint client_research_study_posts_own_control_not_market
    check (not (is_own_control and population = 'market')),
  -- Every exclusion keeps its reason.
  constraint client_research_study_posts_exclusion_reason_present
    check (inclusion = 'included' or nullif(btrim(coalesce(exclusion_reason, '')), '') is not null)
);

create index if not exists client_research_study_posts_population_idx
  on public.client_research_study_posts (client_id, study_id, population, published_at desc);

create index if not exists client_research_study_posts_author_idx
  on public.client_research_study_posts (client_id, study_id, author_id);

create index if not exists client_research_study_posts_url_idx
  on public.client_research_study_posts (client_id, source_url);

-- ---------------------------------------------------------------------------
-- client_research_findings
-- ---------------------------------------------------------------------------

create table if not exists public.client_research_findings (
  client_id           text        not null,
  study_id            text        not null,
  finding_id          text        not null,
  kind                text        not null,
  metric_id           text        not null,
  observed_value      numeric,
  baseline_value      numeric,
  baseline_n          integer,
  lift                numeric,
  formula             text        not null,
  method_version      text        not null,
  source_ids          jsonb       not null default '[]'::jsonb,
  -- pattern findings
  comparator_ids      jsonb,
  comparator_n        integer,
  per_author_results  jsonb,
  -- audience findings
  sample_method       text,
  sample_size         integer,
  unknown_count       integer,
  class_definition    jsonb,
  classifier_version  text,
  -- shared
  source_dates        jsonb       not null default '{}'::jsonb,
  capture_dates       jsonb       not null default '{}'::jsonb,
  age_comparability   text        not null default 'unknown',
  uncertainty         jsonb       not null default '{}'::jsonb,
  selection_method    text,
  limitations         jsonb       not null default '[]'::jsonb,
  validation_state    text        not null default 'computed',
  created_at          timestamptz not null default now(),
  constraint client_research_findings_pkey primary key (client_id, study_id, finding_id),
  constraint client_research_findings_study_fk
    foreign key (client_id, study_id)
    references public.client_research_studies (client_id, study_id) on delete cascade,
  constraint client_research_findings_id_nonempty check (btrim(finding_id) <> ''),
  constraint client_research_findings_kind_chk
    check (kind in ('market', 'pattern', 'audience', 'own_result')),
  constraint client_research_findings_state_chk
    check (validation_state in ('computed', 'needs_reconciliation', 'validated', 'withheld', 'failed')),
  constraint client_research_findings_age_chk
    check (age_comparability in ('comparable', 'age_unmatched', 'unknown')),
  constraint client_research_findings_sources_nonempty
    check (jsonb_typeof(source_ids) = 'array' and jsonb_array_length(source_ids) > 0),
  constraint client_research_findings_limitations_array
    check (jsonb_typeof(limitations) = 'array'),
  constraint client_research_findings_baseline_n_nonneg
    check (baseline_n is null or baseline_n >= 0),
  -- A market claim over a real baseline states its multiple. A zero baseline gives no finite
  -- multiplier, so lift stays null there by design.
  constraint client_research_findings_market_lift_present
    check (kind <> 'market' or baseline_value is null or baseline_value <= 0 or lift is not null),
  -- A pattern claim carries what it was compared against.
  constraint client_research_findings_pattern_comparators
    check (kind <> 'pattern' or (comparator_ids is not null and comparator_n is not null)),
  -- An audience claim carries how the sample was drawn and who judged it.
  constraint client_research_findings_audience_sample
    check (kind <> 'audience'
           or (sample_method is not null and sample_size is not null
               and unknown_count is not null and classifier_version is not null))
);

create index if not exists client_research_findings_kind_idx
  on public.client_research_findings (client_id, study_id, kind, created_at desc);

create index if not exists client_research_findings_state_idx
  on public.client_research_findings (client_id, validation_state, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS and grants. Same shape as 102: service_role only, anon revoked by name.
-- ---------------------------------------------------------------------------

alter table public.client_research_studies    enable row level security;
alter table public.client_research_study_posts enable row level security;
alter table public.client_research_findings   enable row level security;

revoke all on public.client_research_studies     from public, anon, authenticated;
revoke all on public.client_research_study_posts from public, anon, authenticated;
revoke all on public.client_research_findings    from public, anon, authenticated;

grant select, insert, update on public.client_research_studies     to service_role;
grant select, insert, update on public.client_research_study_posts to service_role;
grant select, insert, update on public.client_research_findings    to service_role;

-- ---------------------------------------------------------------------------
-- content_evidence_pack: the bounded service read
-- ---------------------------------------------------------------------------
--
-- One client, one week. It returns the LATEST VALIDATED study of each kind -- never whichever
-- research row happens to be newest -- plus the market population, the own-control count kept
-- separately, the findings and an explicit coverage/missing-inputs block. An empty answer is a
-- stated gap, not a silent zero.
--
-- The post list is capped. When the cap bites, `posts_truncated` is true and `posts_total` says
-- how many there were: a budget limit is a visible fact, never a quiet fallback to a summary.

create or replace function public.content_evidence_pack(p_client_id text, p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cap    integer := 200;
  v_study  public.client_research_studies%rowtype;
  v_total  integer;
begin
  if p_client_id is null or btrim(p_client_id) = '' then
    raise exception 'content_evidence_pack requires one exact client_id';
  end if;
  -- A selftest lane passes lane_allowed (it goes through the selftest door), so authorization is
  -- not scope: it is refused here by name and has no evidence population.
  if p_client_id in ('zz-selftest') then
    raise exception 'selftest lane has no evidence population';
  end if;
  if not public.lane_allowed(p_client_id) then
    raise exception 'unknown seat';
  end if;
  if p_week_start is null then
    raise exception 'content_evidence_pack requires an explicit week_start';
  end if;

  select * into v_study
    from public.client_research_studies s
   where s.client_id = p_client_id
     and s.study_kind = 'market'
     and s.state = 'validated'
   order by s.observation_cutoff desc, s.created_at desc, s.study_id desc
   limit 1;

  if v_study.study_id is null then
    return jsonb_build_object(
      'schema_version', 1,
      'client_id', p_client_id,
      'week_start', p_week_start,
      'study', null,
      'posts', '[]'::jsonb,
      'findings', '[]'::jsonb,
      'own_controls', 0,
      'coverage', jsonb_build_object('validated_market_study', false),
      'missing_inputs', jsonb_build_array('no validated market study for this client'));
  end if;

  select count(*) into v_total
    from public.client_research_study_posts p
   where p.client_id = p_client_id
     and p.study_id = v_study.study_id
     and p.population = 'market'
     and p.inclusion = 'included';

  return jsonb_build_object(
    'schema_version', 1,
    'client_id', p_client_id,
    'week_start', p_week_start,
    'study', jsonb_build_object(
      'study_id', v_study.study_id,
      'study_kind', v_study.study_kind,
      'state', v_study.state,
      'method_version', v_study.method_version,
      'observation_cutoff', v_study.observation_cutoff,
      'metric_definitions', v_study.metric_definitions,
      'roster_version', v_study.roster_version,
      'eligibility', v_study.eligibility,
      'excluded_counts', v_study.excluded_counts,
      'unresolved_discrepancies', v_study.unresolved_discrepancies,
      'content_sha256', v_study.content_sha256),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'canonical_source_id', q.canonical_source_id,
               'source_url', q.source_url,
               'author_id', q.author_id,
               'author_role', q.author_role,
               'published_at', q.published_at,
               'first_captured_at', q.first_captured_at,
               'last_captured_at', q.last_captured_at,
               'age_comparability', q.age_comparability,
               'format_evidence', q.format_evidence,
               'observed_metrics', q.observed_metrics,
               'observations', q.observations,
               'text', q.post_text)
             order by q.published_at desc nulls last, q.canonical_source_id)
      from (
        select * from public.client_research_study_posts p
         where p.client_id = p_client_id
           and p.study_id = v_study.study_id
           and p.population = 'market'
           and p.inclusion = 'included'
         order by p.published_at desc nulls last, p.canonical_source_id
         limit v_cap) q), '[]'::jsonb),
    'posts_total', v_total,
    'posts_cap', v_cap,
    'posts_truncated', v_total > v_cap,
    -- Counted, never mixed in. Own controls are not part of the market denominator.
    'own_controls', (
      select count(*) from public.client_research_study_posts p
       where p.client_id = p_client_id and p.study_id = v_study.study_id
         and p.population = 'own_control'),
    'excluded', coalesce((
      select jsonb_object_agg(reason, n) from (
        select coalesce(p.exclusion_reason, 'unstated') as reason, count(*) as n
          from public.client_research_study_posts p
         where p.client_id = p_client_id and p.study_id = v_study.study_id
           and p.inclusion = 'excluded'
         group by 1) e), '{}'::jsonb),
    'findings', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.created_at desc, f.finding_id)
        from public.client_research_findings f
       where f.client_id = p_client_id
         and f.study_id = v_study.study_id
         and f.validation_state in ('computed', 'validated')), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'validated_market_study', true,
      'distinct_authors', (
        select count(distinct p.author_id) from public.client_research_study_posts p
         where p.client_id = p_client_id and p.study_id = v_study.study_id
           and p.population = 'market' and p.inclusion = 'included')),
    'missing_inputs', coalesce(v_study.missing_inputs, '[]'::jsonb));
end;
$function$;

-- anon is revoked by name: a default-privileges rule grants it on every new function (see 100).
revoke all on function public.content_evidence_pack(text, date) from public;
revoke all on function public.content_evidence_pack(text, date) from anon;
revoke all on function public.content_evidence_pack(text, date) from authenticated;
grant execute on function public.content_evidence_pack(text, date) to service_role;
