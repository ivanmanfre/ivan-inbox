-- 104: operator_content_evidence + the weekly evidence rollout switch.
--
-- Additive only. Nothing in 100-103 is altered, replaced or dropped. Applying this file twice
-- changes nothing the second time.
--
-- ---------------------------------------------------------------------------------------------
-- WHY A SECOND READER EXISTS AT ALL
--
-- 103's content_evidence_pack is a SERVICE read: no gate parameter, granted to service_role only,
-- shaped for the weekly writer's Code node. A browser cannot call it and should not: its signature
-- carries no operator gate and its payload is the raw study population.
--
-- This function is the browser's door, and it is built on the SAME pattern 100-102 established:
-- operator_gate_ok(p_gate) first, lane_allowed(p_client_id) second, security definer,
-- search_path pinned, anon and public revoked BY NAME because a default-privileges rule otherwise
-- grants execute on every new function, then granted to authenticated and service_role exactly as
-- operator_market_outliers is. The tenant parameter is mandatory and every read inside is keyed on
-- it, so there is no call shape that returns another lane's row.
--
-- The selftest lane is refused by name before lane_allowed is even consulted, for the same reason
-- 103 refuses it: lane_allowed returns TRUE for zz-selftest (db/091's second door), so passing the
-- authorization check is not the same as having an evidence population.
--
-- ---------------------------------------------------------------------------------------------
-- THE FOUR ANSWERS, FROM REAL COLUMNS
--
-- this_week  the unapproved weekly shortlist rows for the newest addressed week, each read
--            through its own stored evidence package. No row is invented and no card is padded:
--            a choice with no stored measured source says so in its own sentence.
-- winners    two disjoint arrays. `market` comes only from findings of kind 'market' in a market
--            study; `own` comes only from findings of kind 'own_result' in an own study. They are
--            built by separate queries over separate rows, so a source example's multiple can
--            never appear beside a client's own post as something achieved locally.
-- inputs     collected (stored_posts), connected (connected_consumers), current
--            (last_successful_collection, is_stale) and sufficient (sufficient_for_this_question
--            with its reason) are four separate fields because they are four separate questions.
--            STUDY STATE AND READER STATE ARE SEPARATE: study_state is the stored study's own
--            lifecycle value, and the reader's ready/partial/empty/stale/failed is derived in the
--            browser from these fields. This function never returns a reader state.
-- results    the recommendation to publication chain over the link stored in
--            ops_drafts.context->'audn'->'outcome_link' (the slot automation/content-evidence/
--            outcome-links.mjs names) joined to client_post_metrics for the same tenant. A choice
--            that has been approved but has no publication stays 'awaiting_publication'. Pending
--            is pending; it is never counted as a failed result.
--
-- NULLS STAY NULL. An unknown count is null and a real zero is 0. The browser renders the
-- difference; this function never fills one with the other.
--
-- ---------------------------------------------------------------------------------------------
-- THE ROLLOUT SWITCH
--
-- One row in the EXISTING public.integration_config table (key text primary key, value text),
-- which the weekly writer already reads through its Secrets node. No new table, no new credential,
-- no new grant. Key `weekly_evidence_selector_clients`, value a JSON array of client ids.
-- Absent or [] means the legacy path for every client, so the default is that nobody is enabled.

-- ---------------------------------------------------------------------------
-- Rollout switch storage
-- ---------------------------------------------------------------------------
--
-- integration_config predates this migration series and is not itself a file under db/. It is
-- created here ONLY when it is absent, which is the case in a throwaway test instance and never
-- the case in production. The default row is inserted only when the key is absent, so an operator
-- who has already enabled clients is never reset by a replay.

do $$
begin
  if to_regclass('public.integration_config') is null then
    create table public.integration_config (
      key        text        primary key,
      value      text        not null,
      updated_at timestamptz default now(),
      is_secret  boolean     not null default false
    );
  end if;

  if not exists (select 1 from public.integration_config
                  where key = 'weekly_evidence_selector_clients') then
    insert into public.integration_config (key, value, is_secret)
    values ('weekly_evidence_selector_clients', '[]', false);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- operator_content_evidence
-- ---------------------------------------------------------------------------

create or replace function public.operator_content_evidence(p_gate text, p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_stale_days      integer := 14;
  v_winner_cap      integer := 50;
  v_choice_cap      integer := 20;
  v_candidate_cap   integer := 3;
  v_study           public.client_research_studies%rowtype;
  v_own_study       public.client_research_studies%rowtype;
  v_study_state     text := 'missing';
  v_authors_dir     jsonb := '{}'::jsonb;
  v_week            date;
  v_stored          integer;
  v_eligible        integer;
  v_eligible_auth   integer;
  v_last_capture    timestamptz;
  v_as_of           timestamptz;
  v_is_stale        boolean := false;
  v_findings_n      integer := 0;
  v_finding_auth    integer := 0;
  v_gaps            jsonb := '[]'::jsonb;
  v_rollout         jsonb := '[]'::jsonb;
  v_consumers       jsonb;
  v_sufficient      boolean := false;
  v_reason          text;
  v_coverage        text;
  v_candidates      jsonb := '[]'::jsonb;
  v_market          jsonb := '[]'::jsonb;
  v_own             jsonb := '[]'::jsonb;
  v_choices         jsonb := '[]'::jsonb;
  v_failures        jsonb := '[]'::jsonb;
  v_missing         jsonb := '[]'::jsonb;
begin
  -- Authorization, then scope, in that order.
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id is null or btrim(p_client_id) = '' then
    raise exception 'operator_content_evidence requires one exact client_id';
  end if;
  if p_client_id in ('zz-selftest') then
    raise exception 'selftest lane has no evidence population';
  end if;
  if not public.lane_allowed(p_client_id) then raise exception 'unknown seat'; end if;

  -- The market study this lane is answered from: a validated one when there is one, otherwise the
  -- newest stored study, so an unreconciled study is visible in Inputs rather than hidden.
  select * into v_study
    from public.client_research_studies s
   where s.client_id = p_client_id
     and s.study_kind = 'market'
   order by (s.state = 'validated') desc, s.observation_cutoff desc, s.created_at desc, s.study_id desc
   limit 1;

  select * into v_own_study
    from public.client_research_studies s
   where s.client_id = p_client_id
     and s.study_kind = 'own'
   order by (s.state = 'validated') desc, s.observation_cutoff desc, s.created_at desc, s.study_id desc
   limit 1;

  if v_study.study_id is not null then
    v_study_state := v_study.state;
    v_authors_dir := coalesce(v_study.manifest->'author_directory', '{}'::jsonb);
    v_as_of       := v_study.observation_cutoff;
    v_is_stale    := v_as_of < (now() - make_interval(days => v_stale_days));
    v_gaps        := coalesce(v_study.missing_inputs, '[]'::jsonb);

    select count(*),
           count(*) filter (where p.population = 'market' and p.inclusion = 'included'),
           count(distinct p.author_id) filter (where p.population = 'market' and p.inclusion = 'included'),
           max(p.last_captured_at)
      into v_stored, v_eligible, v_eligible_auth, v_last_capture
      from public.client_research_study_posts p
     where p.client_id = p_client_id
       and p.study_id = v_study.study_id;

    select count(*), count(distinct pp.author_id)
      into v_findings_n, v_finding_auth
      from public.client_research_findings f
      left join public.client_research_study_posts pp
        on pp.client_id = f.client_id
       and pp.study_id  = f.study_id
       and pp.canonical_source_id = f.source_ids->>0
     where f.client_id = p_client_id
       and f.study_id  = v_study.study_id
       and f.kind = 'market'
       and f.validation_state in ('computed', 'validated');
  else
    v_gaps := jsonb_build_array('No market study is stored for this lane yet.');
  end if;

  -- The rollout switch, read defensively: a malformed value is treated as nobody enabled rather
  -- than as an error that hides the whole screen.
  begin
    select coalesce(c.value::jsonb, '[]'::jsonb) into v_rollout
      from public.integration_config c
     where c.key = 'weekly_evidence_selector_clients';
  exception when others then
    v_rollout := '[]'::jsonb;
  end;
  if v_rollout is null or jsonb_typeof(v_rollout) <> 'array' then v_rollout := '[]'::jsonb; end if;

  v_consumers := jsonb_build_array('Strategy evidence view');
  if v_rollout ? p_client_id then
    v_consumers := v_consumers || jsonb_build_array('Weekly recommendation writer');
  end if;

  -- Sufficient for THIS question is not the same as a larger count.
  v_sufficient := v_study_state = 'validated' and v_findings_n >= 3 and v_finding_auth >= 2;
  if not v_sufficient then
    v_reason := case
      when v_study_state = 'missing' then 'No market study is stored for this lane yet.'
      when v_study_state <> 'validated' then 'The stored study has not reconciled its arithmetic.'
      when v_findings_n < 3 then 'Fewer than three source examples clear the screening policy.'
      else 'Every source example comes from one author.'
    end;
  end if;

  v_coverage := case
    when v_study.study_id is null then 'No market study is stored for this lane yet.'
    else coalesce(v_eligible_auth, 0)::text || ' authors and ' || coalesce(v_eligible, 0)::text
         || ' eligible posts are stored for this lane.'
  end;

  -- The newest week this lane has an addressed shortlist for.
  select max((d.context->'audn'->'weekly'->>'week_start')::date) into v_week
    from public.ops_drafts d
   where d.client_id = p_client_id
     and d.kind = 'audn_recommendation'
     and d.context->'audn'->'weekly'->>'week_start' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

  -- -------------------------------------------------------------------------
  -- this_week
  -- -------------------------------------------------------------------------
  if v_week is not null then
    v_candidates := coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id,
               'topic', coalesce(nullif(btrim(q.audn->>'title'), ''),
                                 nullif(btrim(q.ev->>'proposed_angle'), ''),
                                 'Untitled choice'),
               'evidence_sentence', coalesce(
                 nullif(btrim(q.ev->>'evidence_sentence'), ''),
                 case when f.observed_value is not null and f.baseline_value is not null
                             and f.baseline_n is not null
                      then trim(to_char(f.observed_value, 'FM999999999990.##')) || ' against a usual '
                           || trim(to_char(f.baseline_value, 'FM999999999990.##')) || ' across '
                           || f.baseline_n::text || ' posts'
                      else null end,
                 'No measured source is recorded for this choice.'),
               'source_url', p.source_url,
               'source_label', case
                 when p.canonical_source_id is null then null
                 else coalesce(v_authors_dir->>p.author_id, p.author_id)
                      || coalesce(', ' || to_char(p.published_at, 'DD Mon YYYY'), '')
               end,
               'client_material', nullif(btrim(coalesce(q.ev->'client_fact_refs'->0->>'summary',
                                                        q.ev->'client_fact_refs'->>0)), ''),
               'needs_material', coalesce(
                 jsonb_array_length(coalesce(q.ev->'needs_material', '[]'::jsonb)) > 0, false),
               'objective', coalesce(nullif(btrim(q.ev->>'objective'), ''), 'attention'),
               'is_experiment', coalesce((q.ev->>'is_experiment')::boolean,
                                         q.ev->>'selection_kind' = 'experiment', false),
               'experiment_reason', nullif(btrim(q.ev->>'experiment_reason'), ''),
               'test_metric', nullif(btrim(q.ev->>'test_metric'), ''),
               'detail', jsonb_build_object(
                 'calculation', case
                   when f.finding_id is null then 'No stored calculation for this choice.'
                   else f.formula || ', observed '
                        || coalesce(trim(to_char(f.observed_value, 'FM999999999990.##')), 'unknown')
                        || ' against baseline '
                        || coalesce(trim(to_char(f.baseline_value, 'FM999999999990.##')), 'unknown')
                        || ' (n=' || coalesce(f.baseline_n::text, 'unknown') || ')'
                 end,
                 'formula', f.formula,
                 'method_version', f.method_version,
                 'published_at', to_char(p.published_at, 'YYYY-MM-DD'),
                 'captured_at', to_char(p.first_captured_at, 'YYYY-MM-DD'),
                 'limitations', coalesce(f.limitations, '[]'::jsonb),
                 'full_source_text', p.post_text))
             order by q.created_at, q.id)
      from (
        select d.id, d.created_at,
               d.context->'audn' as audn,
               d.context->'audn'->'evidence_package' as ev
          from public.ops_drafts d
         where d.client_id = p_client_id
           and d.kind = 'audn_recommendation'
           and (d.context->'audn'->'weekly'->>'week_start')::date = v_week
           and d.approved_at is null
           and d.sent_at is null
         order by d.created_at, d.id
         limit v_candidate_cap) q
      left join lateral (
        select * from public.client_research_findings ff
         where ff.client_id = p_client_id
           and ff.finding_id = q.ev->'source_finding_ids'->>0
         limit 1) f on true
      left join lateral (
        select * from public.client_research_study_posts pp
         where pp.client_id = p_client_id
           and pp.study_id = f.study_id
           and pp.canonical_source_id = f.source_ids->>0
         limit 1) p on true
    ), '[]'::jsonb);
  end if;

  v_missing := v_gaps;

  -- -------------------------------------------------------------------------
  -- winners: market examples
  -- -------------------------------------------------------------------------
  if v_study.study_id is not null then
    v_market := coalesce((
      select jsonb_agg(jsonb_build_object(
               'finding_id', q.finding_id,
               'author', v_authors_dir->>q.author_id,
               'author_url', q.author_id,
               'first_line', nullif(btrim(left(split_part(coalesce(q.post_text, ''), E'\n', 1), 160)), ''),
               'source_url', q.source_url,
               'published_at', to_char(q.published_at, 'YYYY-MM-DD'),
               'observed_value', q.observed_value,
               'baseline_value', q.baseline_value,
               'baseline_n', q.baseline_n,
               'lift', q.lift,
               'method_version', q.method_version,
               -- A study whose arithmetic has not reconciled is labelled on every row it produces.
               'legacy', q.legacy,
               'limitation', q.limitations->>0)
             order by q.lift desc nulls last, q.finding_id)
      from (
        select f.finding_id, f.observed_value, f.baseline_value, f.baseline_n, f.lift,
               f.method_version, f.limitations,
               (v_study.state is distinct from 'validated') as legacy,
               p.author_id, p.source_url, p.published_at, p.post_text
          from public.client_research_findings f
          left join public.client_research_study_posts p
            on p.client_id = f.client_id
           and p.study_id  = f.study_id
           and p.canonical_source_id = f.source_ids->>0
           and p.population = 'market'
         where f.client_id = p_client_id
           and f.study_id  = v_study.study_id
           and f.kind = 'market'
           and f.validation_state in ('computed', 'validated')
         order by f.lift desc nulls last, f.finding_id
         limit v_winner_cap) q
    ), '[]'::jsonb);
  end if;

  -- -------------------------------------------------------------------------
  -- winners: our own results. A separate query over separate rows. No lift here, ever.
  -- -------------------------------------------------------------------------
  if v_own_study.study_id is not null then
    v_own := coalesce((
      select jsonb_agg(jsonb_build_object(
               'post_id', q.source_ids->>0,
               'published_at', to_char(q.published_at, 'YYYY-MM-DD'),
               'objective', coalesce(q.metric_id, 'attention'),
               'metric_label', coalesce(q.metric_id, 'reach'),
               'observed_value', q.observed_value,
               'comparison_label', case
                 when q.baseline_value is null or q.baseline_n is null
                   then 'No stored account baseline for this window.'
                 else 'Against an account usual of '
                      || trim(to_char(q.baseline_value, 'FM999999999990.##'))
                      || ' across ' || q.baseline_n::text || ' posts.'
               end,
               'sample_note', case when q.baseline_n is null then null
                                   else 'Sample of ' || q.baseline_n::text || ' posts.' end,
               'limitation', q.limitations->>0)
             order by q.published_at desc nulls last, q.finding_id)
      from (
        select f.finding_id, f.source_ids, f.metric_id, f.observed_value, f.baseline_value,
               f.baseline_n, f.limitations, p.published_at
          from public.client_research_findings f
          left join public.client_research_study_posts p
            on p.client_id = f.client_id
           and p.study_id  = f.study_id
           and p.canonical_source_id = f.source_ids->>0
         where f.client_id = p_client_id
           and f.study_id  = v_own_study.study_id
           and f.kind = 'own_result'
           and f.validation_state in ('computed', 'validated')
         order by p.published_at desc nulls last, f.finding_id
         limit v_winner_cap) q
    ), '[]'::jsonb);
  end if;

  -- -------------------------------------------------------------------------
  -- results
  -- -------------------------------------------------------------------------
  v_choices := coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id,
             'topic', coalesce(nullif(btrim(q.audn->>'title'), ''), 'Untitled choice'),
             'status', case
               when q.audn->'weekly'->>'superseded_by' is not null then 'superseded'
               when q.decision = 'rejected' then 'passed'
               when m.published_at is not null and q.age_matched then 'evaluated'
               when m.published_at is not null then 'measuring'
               -- Approved with nothing published is PENDING. It is never a failed result.
               when q.approved_at is not null then 'awaiting_publication'
               when jsonb_array_length(coalesce(q.ev->'needs_material', '[]'::jsonb)) > 0
                 then 'needs_material'
               else 'ready_for_review'
             end,
             'published_at', to_char(m.published_at, 'YYYY-MM-DD'),
             'evaluation_age_days', q.age_days,
             'objective', coalesce(nullif(btrim(q.ev->>'objective'), ''), 'attention'),
             'outcome', case when m.id is null then null else jsonb_build_object(
               'metric_label', 'reactions',
               'observed_value', m.reactions,
               'comparison_label', 'No stored account baseline for this window.') end,
             'incomplete_measurement', (m.published_at is null or not q.age_matched),
             'source_finding_id', q.ev->'source_finding_ids'->>0,
             'denominator_note', case
               when m.impressions is null then 'Impressions are not stored for this post.'
               else 'Impressions ' || m.impressions::text end)
           order by q.created_at desc, q.id)
    from (
      select d.id, d.created_at, d.approved_at, d.sent_at,
             d.context->'audn' as audn,
             d.context->'audn'->'evidence_package' as ev,
             d.context->'audn'->'outcome_link' as link,
             d.context->'weekly_decision'->>'decision' as decision,
             mm.published_at as pub_at, mm.captured_at as cap_at, mm.id as metric_id,
             case when mm.published_at is null or mm.captured_at is null then null
                  else floor(extract(epoch from (mm.captured_at - mm.published_at)) / 86400)::int
             end as age_days,
             coalesce(case when mm.published_at is null or mm.captured_at is null then false
                  else abs(floor(extract(epoch from (mm.captured_at - mm.published_at)) / 86400)::int - 7) <= 1
                    or abs(floor(extract(epoch from (mm.captured_at - mm.published_at)) / 86400)::int - 14) <= 1
             end, false) as age_matched
        from public.ops_drafts d
        left join lateral (
          select * from public.client_post_metrics cm
           where cm.client_id = p_client_id
             and d.context->'audn'->'outcome_link'->>'publication_id' is not null
             and (cm.id::text = d.context->'audn'->'outcome_link'->>'publication_id'
                  or cm.social_id = d.context->'audn'->'outcome_link'->>'publication_id')
           limit 1) mm on true
       where d.client_id = p_client_id
         and d.kind = 'audn_recommendation'
       order by d.created_at desc, d.id
       limit v_choice_cap) q
    left join lateral (
      select * from public.client_post_metrics cm2
       where cm2.client_id = p_client_id and cm2.id = q.metric_id limit 1) m on true
  ), '[]'::jsonb);

  -- A choice that was passed over carries the reason the operator gave. Nothing here infers a
  -- failure from silence.
  v_failures := coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id,
             'topic', coalesce(nullif(btrim(d.context->'audn'->>'title'), ''), 'Untitled choice'),
             'reason', d.context->'weekly_decision'->>'reason')
           order by d.created_at desc, d.id)
    from public.ops_drafts d
   where d.client_id = p_client_id
     and d.kind = 'audn_recommendation'
     and d.context->'weekly_decision'->>'decision' = 'rejected'
     and nullif(btrim(coalesce(d.context->'weekly_decision'->>'reason', '')), '') is not null
  ), '[]'::jsonb);

  return jsonb_build_object(
    'schema_version', 1,
    'client_id', p_client_id,
    'week_start', to_char(v_week, 'YYYY-MM-DD'),
    'freshness', jsonb_build_object(
      'as_of', v_as_of,
      'stale_after_days', v_stale_days,
      'is_stale', coalesce(v_is_stale, false)),
    'this_week', jsonb_build_object(
      'coverage_line', v_coverage,
      'candidates', v_candidates,
      'missing_inputs', v_missing),
    'winners', jsonb_build_object(
      'market', v_market,
      'own', v_own),
    'inputs', jsonb_build_object(
      'study_state', v_study_state,
      'stored_posts', v_stored,
      'eligible_posts', v_eligible,
      'eligible_authors', v_eligible_auth,
      'publication_window', case
        when v_study.study_id is null then null
        else jsonb_build_object('from', to_char(v_study.publication_window_from, 'YYYY-MM-DD'),
                                'to',   to_char(v_study.publication_window_to, 'YYYY-MM-DD'))
      end,
      'last_successful_collection', v_last_capture,
      'connected_consumers', v_consumers,
      'sufficient_for_this_question', v_sufficient,
      'sufficiency_reason', v_reason,
      'gaps', v_gaps),
    'results', jsonb_build_object(
      'choices', v_choices,
      'prior_failures', v_failures));
end;
$function$;

-- anon is revoked by name: a default-privileges rule grants it on every new function (see 100).
revoke all on function public.operator_content_evidence(text, text) from public;
revoke all on function public.operator_content_evidence(text, text) from anon;
grant execute on function public.operator_content_evidence(text, text) to authenticated;
grant execute on function public.operator_content_evidence(text, text) to service_role;
