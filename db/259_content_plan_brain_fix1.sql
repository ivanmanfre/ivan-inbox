-- 259 fix1 (controller ruling after review, 2026-10-12). Replaces content_plan_brain_items and content_plan_week only.
-- 1. qa.outcome: a recorded score wins; 'hand' only for a draft with no score at all (a later hand edit shows as edited).
-- 2. Ivan carousels (/120 check): the persisted qa.verdict PASS/APPROVE(D) decides -> 'passed'; an earlier QA_HALTED line never makes it low.
-- 3. Weekend flag and weekend_post warning use the account's own time zone (Rise America/Los_Angeles, Ivan/Arch Europe/Warsaw).
-- 4. done[] metrics move inside the fail-safe block.
-- 5. A failed brain block returns brain_strip null and the error text in a top-level brain_error key.
-- Rollback: 259_content_plan_brain_fix1_rollback.sql (the live db/259 bodies captured before this file).

-- One brain object per draft, set-based over p_drafts (no per-draft loop).
create or replace function public.content_plan_brain_items(p_account text, p_drafts uuid[], p_now timestamptz default now())
returns table(draft_id uuid, brain jsonb)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
set statement_timeout to '15s'
as $fn$
#variable_conflict use_column
declare v_moves jsonb := '{}'::jsonb; v_med numeric; v_tz text := case when p_account = 'risedtc' then 'America/Los_Angeles' else 'Europe/Warsaw' end; v_names jsonb := '{}'::jsonb; v_slugs text[]; v_left text[];
begin
  if not public.cb39_lane_ok(p_account) then raise exception 'unknown seat'; end if;
  if coalesce(cardinality(p_drafts), 0) = 0 then return; end if;

  -- Who set the time: the db/261 move log, once it exists (latest row per draft).
  if to_regclass('public.content_plan_moves') is not null then
    begin
      execute $q$select coalesce(jsonb_object_agg(x.draft_id::text, x.by_who), '{}'::jsonb)
                   from (select distinct on (m.draft_id) m.draft_id, m.by_who from public.content_plan_moves m
                          where m.draft_id = any($1) order by m.draft_id, m.at desc, m.id desc) x$q$
        into v_moves using p_drafts;
    exception when others then v_moves := '{}'::jsonb;
    end;
  end if;

  -- A normal post: the median views of the account's posts in the last 90 days.
  select percentile_cont(0.5) within group (order by m.impressions) into v_med
    from public.client_post_metrics m
   where m.client_id = p_account and m.published_at >= p_now - interval '90 days' and m.impressions is not null;

  -- Real names for the authors of the posts the brain adapted (briefs store URL slugs). Unresolved = null, never the slug.
  select array_agg(distinct s) into v_slugs from (
    select lower(coalesce(case when jsonb_typeof(c.taxonomy->'brain_brief') = 'object' then c.taxonomy->'brain_brief'->>'source_author' end,
                          mb.brief->>'source_author')) as s
      from public.carousel_drafts c left join public.cb34_p2_members mb on mb.draft_id = c.id
     where c.id = any(p_drafts)
       and lower(coalesce(case when jsonb_typeof(c.taxonomy->'brain_brief') = 'object' then c.taxonomy->'brain_brief'->>'source_author' end,
                    mb.brief->>'source_author')) ~ '^[a-z0-9][a-z0-9-]*$') t;
  if v_slugs is not null then
    select coalesce(jsonb_object_agg(k, nm), '{}'::jsonb) into v_names from (
      select distinct on (k) lower(substring(r.linkedin_profile_url from '/in/([^/?#]+)')) as k, regexp_replace(btrim(r.competitor_name), '\s+', ' ', 'g') as nm
        from public.competitor_roster r
       where lower(substring(r.linkedin_profile_url from '/in/([^/?#]+)')) = any(v_slugs) and nullif(btrim(r.competitor_name), '') is not null
       order by k) x;
    v_left := array(select unnest(v_slugs) except select jsonb_object_keys(v_names));
    if cardinality(v_left) > 0 then
      v_names := v_names || coalesce((select jsonb_object_agg(k, nm) from (
        select distinct on (p.slug) p.slug as k, regexp_replace(btrim(p.name), '\s+', ' ', 'g') as nm
          from public.peer_scan_creators p where p.slug = any(v_left) and nullif(btrim(p.name), '') is not null order by p.slug) x), '{}'::jsonb);
      v_left := array(select unnest(v_slugs) except select jsonb_object_keys(v_names));
    end if;
    if cardinality(v_left) > 0 then
      v_names := v_names || coalesce((select jsonb_object_agg(k, nm) from (
        select distinct on (k) lower(substring(a.linkedin_profile_url from '/in/([^/?#]+)')) as k, regexp_replace(btrim(a.competitor_name), '\s+', ' ', 'g') as nm
          from public.audn_competitor_posts a
         where lower(substring(a.linkedin_profile_url from '/in/([^/?#]+)')) = any(v_left) and nullif(btrim(a.competitor_name), '') is not null
         order by k) x), '{}'::jsonb);
      v_left := array(select unnest(v_slugs) except select jsonb_object_keys(v_names));
    end if;
    if cardinality(v_left) > 0 then
      v_names := v_names || coalesce((select jsonb_object_agg(k, nm) from (
        select distinct on (c.author_key) c.author_key as k, regexp_replace(btrim(c.author), '\s+', ' ', 'g') as nm
          from public.cb27_posts c where c.author_key = any(v_left) and nullif(btrim(c.author), '') is not null order by c.author_key) x), '{}'::jsonb);
    end if;
  end if;

  return query
  with d as materialized (
    select c.id, c.client_id, c.status, c.type, c.title, c.post_body, c.image_urls, c.taxonomy, c.qa, c.agent_log,
           c.client_idea_id, c.scheduled_at, c.published_at
      from public.carousel_drafts c
     where c.id = any(p_drafts) and (case when p_account = 'ivan' then c.client_id is null else c.client_id = p_account end)
  ),
  mt as materialized (select * from public.content_plan_draft_metrics(p_account, p_drafts)),
  eng as materialized (
    select s.post_id, s.engagers, s.owners from public.client_post_engager_stats_v s
     where p_account = 'risedtc' and s.client_id = p_account and s.post_id in (select mt.metric_id from mt where mt.metric_id is not null)
  ),
  eu as materialized (
    select case when sum(s.judged) > 0 then round(100.0 * sum(s.owners) / sum(s.judged))::int end as pct
      from public.client_post_engager_stats_v s where p_account = 'risedtc' and s.client_id = p_account
  )
  select d.id, jsonb_build_object(
    'draft_id', d.id,
    'words', case when nullif(btrim(coalesce(d.post_body, '')), '') is not null then array_length(regexp_split_to_array(btrim(d.post_body), '\s+'), 1) end,
    'edited', lg.hand_ord is not null or coalesce(d.taxonomy->>'human_edited', '') = 'true',
    'thumb', case when coalesce(d.image_urls[1], '') ~ '^https?://' then d.image_urls[1] end,
    'body_head', nullif(left(btrim(coalesce(d.post_body, '')), 260), ''),
    'first_line', nullif(btrim(substring(btrim(coalesce(d.post_body, '')) from '^[^\n]*')), ''),
    'has_link', coalesce(d.post_body ~* '(https?://|www\.)[^\s]+', false),
    'flags', jsonb_build_object(
      'lm', coalesce(d.taxonomy ?| array['lead_magnet','lead_magnet_slug','gate_keyword'], false)
            or exists (select 1 from public.scheduled_posts q0 where q0.clickup_task_id = d.id::text and (q0.post_kind = 'capture' or q0.lead_magnet_slug is not null)),
      'boosted', coalesce(d.taxonomy->>'paid_boost' = 'true', false),
      'founder', coalesce(d.taxonomy->>'pillar' = 'personal', false),
      'carousel', coalesce(d.type in ('carousel','pdf','document'), false),
      'weekend', coalesce(extract(isodow from (coalesce(d.published_at, d.scheduled_at) at time zone v_tz)) >= 6, false),
      'failed', coalesce(q.outcome = 'failed', false),
      'low_score', coalesce(q.outcome = 'low' and p_account <> 'arch', false),
      'fact_fail', coalesce(fc.pass = false, false)),
    'qa', case when q.outcome is not null or q.first is not null then jsonb_build_object(
      'outcome', q.outcome, 'first', q.first, 'final', q.final, 'max', q.mx, 'pass_line', q.pass_line, 'rewrites', q.rewrites,
      'approved_anyway', coalesce(q.outcome = 'low' and d.status in ('approved','scheduled','published'), false),
      'dims', q.dims,
      'weakest', (select k.key from jsonb_each(q.dims) k
                   order by (k.value)::numeric, array_position(array['VOICE','SUBSTANCE','SPECIFICITY','OPINION','ECONOMY','HOOK','VERIFIED','AI_TELLS'], k.key) nulls last
                   limit 1)) end,
    'facts', case when fc.pass is not null then jsonb_build_object('pass', fc.pass,
      'failed', case when fc.pass then 0 when fc.nmaj > 0 then fc.nmaj else fc.nall end, 'total', null) end,
    'angle', case when an.structure is not null or an.opener is not null then jsonb_build_object('structure', an.structure, 'opener', an.opener) end,
    'trait', tr.trait,
    'read', public.content_plan_read_shape(rd.rr),
    'brief', case when bb.b ? 'source_author' or bb.b ? 'source_url' then jsonb_build_object(
      'author', case when lower(bb.b->>'source_author') ~ '^[a-z0-9][a-z0-9-]*$' then v_names->>lower(bb.b->>'source_author')
                     else nullif(btrim(bb.b->>'source_author'), '') end,
      'ratio', case when bb.b->>'source_ratio' ~ '^[0-9]+(\.[0-9]+)?$' then round((bb.b->>'source_ratio')::numeric, 2) end,
      'url', case when bb.b->>'source_url' ~ 'activity[-:][0-9]{10,}' then 'https://www.linkedin.com/feed/update/urn:li:activity:' || substring(bb.b->>'source_url' from 'activity[-:]([0-9]{10,})') || '/'
                  when bb.b->>'source_url' ~ 'ugcPost[-:][0-9]{10,}' then 'https://www.linkedin.com/feed/update/urn:li:ugcPost:' || substring(bb.b->>'source_url' from 'ugcPost[-:]([0-9]{10,})') || '/'
                  when bb.b->>'source_url' ~* 'linkedin\.com/(in|posts)/' then null
                  else nullif(btrim(bb.b->>'source_url'), '') end,
      'why', nullif(btrim(bb.b->>'why_this_post'), '')) end,
    'quote', qt.quote,
    'quote_pending', qt.src is not null and qt.quote is null,
    'photo', jsonb_build_object('has', coalesce(cardinality(d.image_urls), 0) > 0,
      'reason', coalesce(nullif(btrim(d.taxonomy->>'photo_reason'), ''), nullif(btrim(d.taxonomy->>'no_photo_reason'), '')),
      'rotation', p_account = 'risedtc' and coalesce(d.image_urls[1], '') ~ '/client-photos/'),
    'replaced', case when rp.title is not null then jsonb_build_object('title', rp.title, 'on', rp.on_day) end,
    'result', case when d.status = 'published' then jsonb_build_object(
      'views', mt.views, 'reactions', mt.reactions, 'comments', mt.comments,
      'viral', coalesce(mt.views >= 3 * v_med, false),
      'young', coalesce(d.published_at > p_now - interval '7 days', false),
      'url', mt.url,
      'engaged', case when eng.post_id is not null then jsonb_build_object('brand', eng.owners, 'total', eng.engagers, 'usual_pct', eu.pct) end) end,
    'time_set_by', case when v_moves ? d.id::text then case when v_moves->>(d.id::text) = 'ivan' then 'hand' else 'planner' end end)
  from d
  cross join eu
  left join mt on mt.draft_id = d.id
  left join eng on eng.post_id = mt.metric_id
  left join public.cb34_p2_members mb on mb.draft_id = d.id
  left join public.client_ideas ci on ci.id = d.client_idea_id
  left join lateral (
    select l.id, l.source, case when jsonb_typeof(l.evidence) = 'array' then l.evidence->0 else '{}'::jsonb end as e
      from public.lm_idea_candidates l where p_account = 'ivan' and l.promoted_draft_id = d.id
     order by l.ingested_at desc nulls last limit 1) li on true
  -- The check story from agent_log: the latest QA cycle = regen lines between the previous and the latest QA Agent JSON.
  left join lateral (
    with e as (
      -- Only the check and hand-edit entries, in log order (a jsonpath filter skips copying the large writer bodies).
      select t.ord::int as ord, t.x->>'agent' as ag, t.x
        from jsonb_path_query(case when jsonb_typeof(d.agent_log) = 'array' then d.agent_log else '[]'::jsonb end,
               '$[*] ? (@.agent == "QA Agent" || @.agent == "QA Regen Loop" || @.agent == "QA Give-Up" || @.agent == "Persist Carousel QA" || @.agent == "Check Agent" || @.agent == "Ivan edit" || @.agent like_regex "hand edit" flag "i")')
             with ordinality t(x, ord)
    ), eq as (
      select e.ord, e.ag, e.x->>'body' as b from e where e.ag in ('QA Agent','QA Regen Loop','QA Give-Up','Persist Carousel QA')
    ), qr as (
      select eq.ord from eq where eq.ag = 'QA Agent' and left(eq.b, 1) = '{' and pg_input_is_valid(eq.b, 'jsonb') order by eq.ord desc limit 2
    ), bd as (
      select coalesce(max(qr.ord), 0) as l, case when count(*) = 2 then min(qr.ord) else 0 end as p from qr
    ), cy as (
      select eq.ord, eq.ag, eq.b from eq, bd where eq.ag in ('QA Regen Loop','QA Give-Up') and eq.ord > bd.p and (bd.l = 0 or eq.ord < bd.l)
    ), cq as (
      select eq.ord, substring(eq.b from 'VERDICT: ([A-Z_]+)') as v, substring(eq.b from 'qa_total ([0-9]+)/')::int as t, substring(eq.b from 'qa_total [0-9]+/([0-9]+)')::int as mx
        from eq where eq.ag = 'Persist Carousel QA' and eq.b ~ 'qa_total [0-9]+/[0-9]+'
    )
    select
      (select jsonb_build_object('raw_total', z.j->'qa_raw'->'total', 'total', z.j->'qa_total', 'total_raw', z.j->'qa_total_raw', 'max', z.j->'qa_total_max',
              'passed', z.j->'qa_passed', 'rec_raw', z.j->'qa_recommendation_raw', 'version', z.j->'qa_published_version', 'parse', z.j->'parse_success',
              'dims', case when jsonb_typeof(z.j->'qa_dim_scores_canonical') = 'object' then z.j->'qa_dim_scores_canonical'
                           when jsonb_typeof(z.j->'qa_scores') = 'object' then (z.j->'qa_scores') - 'DISTINCT' end)
         from (select eq.b::jsonb as j from eq where eq.ord = bd.l) z) as qj,
      (select count(*) from cy where cy.b ~ '^Attempt [0-9]+/')::int as attempts,
      (select substring(cy.b from 'floor ([0-9]+)')::int from cy where cy.b ~ 'floor [0-9]+' order by cy.ord desc limit 1) as floor,
      (select substring(cy.b from '\(([0-9]+)/80\)')::int from cy where cy.b ~ '^REGEN LOOP ENTERED' and cy.b ~ '\([0-9]+/80\)' order by cy.ord limit 1) as entered,
      (select substring(cy.b from '\(([0-9]+)/80')::int from cy
        where cy.b ~ '^(Attempt [0-9]+/[0-9]+: (RECOVERED|still failing)|REGEN LOOP EXHAUSTED)' and cy.b ~ '\([0-9]+/80' order by cy.ord desc limit 1) as final_rg,
      exists (select 1 from cy where cy.b ~ 'RECOVERED') as recovered,
      (select max(e.ord) from e where e.ag in ('Ivan edit','Ivan + Claude (hand edit)') or e.ag ilike '%hand edit%') as hand_ord,
      (select max(e.ord) from e where e.ag in ('QA Agent','QA Regen Loop','QA Give-Up','Persist Carousel QA','Check Agent')) as check_ord,
      (select count(*) from cq)::int as cq_n,
      (select cq.t from cq order by cq.ord limit 1) as cq_first,
      (select cq.t from cq order by cq.ord desc limit 1) as cq_last,
      (select cq.mx from cq order by cq.ord desc limit 1) as cq_max,
      (select cq.v from cq order by cq.ord desc limit 1) as cq_verdict
    from bd
  ) lg on true
  left join lateral (
    select z.outcome, z.first, z.final, z.mx, z.pass_line, z.rewrites,
           case when jsonb_typeof(z.dims) = 'object' and (select bool_and(jsonb_typeof(v.value) = 'number') from jsonb_each(z.dims) v) then z.dims end as dims
    from (
      select
        case
          when d.status = 'error' then 'failed'
          -- fix1: a recorded score wins; 'hand' only for a draft with no score at all (the later hand edit shows as edited).
          when lg.qj is not null and lg.qj->>'parse' = 'false' and lg.attempts = 0 and lg.final_rg is null then
            case when lg.hand_ord is not null then 'hand' end
          when lg.qj is not null then
            case when lg.recovered or (lg.attempts = 0 and lg.qj->>'passed' = 'true')
                 then case when lg.attempts = 0 and (lg.qj->>'rec_raw' = 'approve' or lg.qj->>'version' = 'original') then 'passed' else 'recovered' end
                 else 'low' end
          when jsonb_typeof(d.qa->'check') = 'object' then
            case when d.qa->'check'->>'verdict' = 'PASS'
                 then case when jsonb_typeof(d.qa->'check'->'fix_pass') = 'object' then 'recovered' else 'passed' end
                 else 'low' end
          -- fix1: the persisted carousel verdict decides; an earlier QA_HALTED line never makes it low.
          when lg.cq_n > 0 then case when upper(coalesce(d.qa->>'verdict', '')) in ('PASS','APPROVE','APPROVED') then 'passed'
                                     when lg.cq_verdict = 'PASS' then case when lg.cq_n > 1 then 'recovered' else 'passed' end else 'low' end
          when coalesce(d.qa->>'total_80', '') ~ '^[0-9]+(\.[0-9]+)?$' and coalesce(d.qa->>'verdict', 'PASS') = 'PASS' then 'passed'
          when lg.hand_ord is not null or coalesce(d.taxonomy->>'human_edited', '') = 'true' or d.qa->>'verdict' = 'EDITORIAL_REVIEWED' then 'hand'
        end as outcome,
        f.first,
        case when lg.qj is not null then
               case when lg.attempts > 0 then coalesce(lg.final_rg, f.first)
                    else coalesce(case when jsonb_typeof(lg.qj->'total') = 'number' and (lg.qj->>'total')::numeric > 0 then round((lg.qj->>'total')::numeric)::int end, f.first) end
             when lg.cq_n > 0 then
               case when upper(coalesce(d.qa->>'verdict', '')) in ('PASS','APPROVE','APPROVED')
                    then coalesce(case when coalesce(d.qa->>'score', '') ~ '^[0-9]+(\.[0-9]+)?$' then round((d.qa->>'score')::numeric)::int end,
                                  case when lg.cq_verdict = 'PASS' then lg.cq_last end)
                    else lg.cq_last end
             when coalesce(d.qa->>'total_80', '') ~ '^[0-9]+(\.[0-9]+)?$' then round((d.qa->>'total_80')::numeric)::int end as final,
        case when lg.qj is not null then coalesce(case when jsonb_typeof(lg.qj->'max') = 'number' then (lg.qj->>'max')::numeric::int end, 80)
             when lg.cq_n > 0 then coalesce(lg.cq_max, 120) else 80 end as mx,
        case when lg.qj is not null then lg.floor end as pass_line,
        case when lg.qj is not null then case when lg.attempts > 0 then lg.attempts else (lg.qj->>'version' = 'rewrite')::int end
             when jsonb_typeof(d.qa->'check') = 'object' then (jsonb_typeof(d.qa->'check'->'fix_pass') = 'object')::int
             when lg.cq_n > 0 then lg.cq_n - 1 else 0 end as rewrites,
        case when lg.qj is not null then lg.qj->'dims' end as dims
      from (select case
                     when lg.qj is not null then coalesce(lg.entered,
                       case when jsonb_typeof(lg.qj->'raw_total') = 'number' and (lg.qj->>'raw_total')::numeric > 0 then round((lg.qj->>'raw_total')::numeric)::int end,
                       case when jsonb_typeof(lg.qj->'total_raw') = 'number' and (lg.qj->>'total_raw')::numeric > 0 then round((lg.qj->>'total_raw')::numeric)::int end,
                       case when jsonb_typeof(lg.qj->'total') = 'number' and (lg.qj->>'total')::numeric > 0 then round((lg.qj->>'total')::numeric)::int end)
                     when lg.cq_n > 0 then lg.cq_first
                     when coalesce(d.qa->>'total_80', '') ~ '^[0-9]+(\.[0-9]+)?$' then round((d.qa->>'total_80')::numeric)::int end as first) f
    ) z
  ) q on true
  -- Rise fact check against the call (enforced gate). cb45_claim_checks is never read.
  left join lateral (
    select f.pass,
           (select count(*) from jsonb_array_elements(case when jsonb_typeof(f.failures) = 'array' then f.failures else '[]'::jsonb end) x
             where coalesce(x->>'votes', '') ~ '^[0-9]+$' and (x->>'votes')::int >= 2)::int as nmaj,
           jsonb_array_length(case when jsonb_typeof(f.failures) = 'array' then f.failures else '[]'::jsonb end) as nall
      from public.rise_call_fact_checks f where p_account = 'risedtc' and f.draft_id = d.id order by f.checked_at desc, f.id desc limit 1
  ) fc on true
  left join lateral (
    select nullif(btrim(regexp_replace(coalesce(d.taxonomy->>'structure_used', d.taxonomy->>'structure'), '\s*\(.*$', '')), '') as structure,
           nullif(btrim(coalesce(d.taxonomy->>'hook_type', d.taxonomy->>'hook_class')), '') as opener
  ) an on true
  left join lateral (
    select r.rendered_read as rr from public.cb33_early_reads r
     where r.client_id = p_account and r.draft_id = d.id and r.rendered_read is not null
     order by r.computed_at desc nulls last limit 1
  ) rd on true
  left join lateral (
    select coalesce(case when jsonb_typeof(d.taxonomy->'brain_brief') = 'object' then d.taxonomy->'brain_brief' end,
                    case when jsonb_typeof(mb.brief) = 'object' then mb.brief end) as b
  ) bb on true
  left join lateral (
    select case when ci.id is not null then public.content_plan_source_quote(ci.id) end as src_ci
  ) sq on true
  left join lateral (
    select sq.src_ci as src,
           case when ci.id is not null then case when sq.src_ci is not null and ci.quote_en_src = sq.src_ci then nullif(btrim(ci.quote_en), '') end
                when li.id is not null and li.source in ('ivan_call','calls','kyle_call') then nullif(btrim(coalesce(li.e->>'quote', li.e->>'anchor_quote')), '') end as quote
  ) qt on true
  -- The plan slot this draft fills (newest), for the matched niche trait and the replaced-slot story.
  left join lateral (
    select s.id, s.week_start, s.created_at, s.evidence from public.content_plan_slots s
     where s.account = p_account
       and ((s.idea_source = 'carousel_drafts' and s.idea_ref = d.id::text)
         or (s.idea_source = 'client_ideas' and d.client_idea_id is not null and s.idea_ref = d.client_idea_id::text)
         or (s.idea_source = 'lm_idea_candidates' and li.id is not null and s.idea_ref = li.id::text))
     order by s.created_at desc limit 1
  ) sl on true
  left join lateral (
    select coalesce(
      (select nullif(btrim(substring(x->>'label' from ':\s*(.*)$')), '')
         from jsonb_array_elements(case when jsonb_typeof(sl.evidence) = 'array' then sl.evidence else '[]'::jsonb end) x
        where x->>'type' = 'brain_rule' limit 1),
      case when ci.recipe_fit is not null and cardinality(ci.recipe_fit) > 0 then
        (select nullif(btrim(substring(x->>'label' from ':\s*(.*)$')), '')
           from jsonb_array_elements(public.content_plan_strip_format_traits(jsonb_build_array(jsonb_build_object('type', 'brain_rule',
                  'label', 'Shares traits with top niche posts: ' || public.content_plan_trait_words(ci.recipe_fit[1:4]))))) x limit 1) end) as trait
  ) tr on true
  left join lateral (
    select coalesce(nullif(od.title, ''), left(od.post_body, 80), os.topic) as title, (r.requested_at at time zone 'Europe/Warsaw')::date as on_day
      from public.content_plan_replans r
      join public.content_plan_slots os on os.id = r.slot_id
      left join public.carousel_drafts od on od.id = r.draft_id
     where sl.id is not null and r.account = p_account and os.week_start = sl.week_start and os.id <> sl.id
       and r.requested_at <= sl.created_at and sl.created_at < r.requested_at + interval '12 hours'
     order by r.requested_at desc limit 1
  ) rp on true;
end $fn$;


CREATE OR REPLACE FUNCTION public.content_plan_week(p_account text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
declare
  cfg public.content_plan_config%rowtype;
  v_today date := (p_now at time zone 'Europe/Warsaw')::date;
  w0 date; target int; lm_target int; pol jsonb;
  weeks jsonb := '[]'::jsonb; wk date; i int; posts jsonb; planned jsonb; n_posts int; n_planned int; target_week date := null;
  done jsonb; supply jsonb; warnings jsonb := '[]'::jsonb; last_run jsonb; n int; open_target int := 0;
  founder_n int; photos int; fresh_proof int; r record;
  -- db/259: brain data
  v_done_ids uuid[]; v_ids uuid[]; v_brain jsonb; v_blank jsonb; v_med numeric; v_items jsonb; v_xdays jsonb := '[]'::jsonb; v_strip jsonb;
  b_weeks jsonb; b_supply jsonb; b_warn jsonb; b_done jsonb; v_rule record; v_max int; v_min int; v_err text;
  v_tz text := case when p_account = 'risedtc' then 'America/Los_Angeles' else 'Europe/Warsaw' end;
begin
  if not public.cb39_lane_ok(p_account) then raise exception 'unknown seat'; end if;
  select * into cfg from public.content_plan_config where account = p_account;
  if not found then raise exception 'no plan config for %', p_account; end if;
  w0 := v_today - (extract(isodow from v_today)::int - 1);
  if p_account = 'ivan' then
    select (variables[1])::jsonb into pol from public.content_prompts where slug = 'format-mix-policy-2026' and is_active order by updated_at desc limit 1;
  end if;
  target := coalesce(cfg.posts_per_week, (pol->>'max_posts_per_week')::int);
  lm_target := coalesce(cfg.lm_per_week, (pol->>'lm_carousel_per_week')::int, 0);
  if target is null then raise exception 'no cadence for %', p_account; end if;

  for i in 0..2 loop
    wk := w0 + 7*i;
    -- Posts already holding a slot: dated drafts on the Warsaw week, plus Ivan's publish-queue rows with no draft.
    select coalesce(jsonb_agg(x.j order by x.at), '[]'::jsonb), count(*) into posts, n_posts from (
      select coalesce(d.published_at, d.scheduled_at) at, jsonb_build_object(
        'kind','post','draft_id', d.id, 'title', coalesce(nullif(d.title,''), left(d.post_body, 80)),
        'day', (coalesce(d.published_at, d.scheduled_at) at time zone 'Europe/Warsaw')::date,
        'at', coalesce(d.published_at, d.scheduled_at), 'status', d.status,
        'format', d.type, 'lead_magnet', d.taxonomy ?| array['lead_magnet','lead_magnet_slug','gate_keyword'] or exists (select 1 from public.scheduled_posts q0
            where q0.clickup_task_id = d.id::text and (q0.post_kind = 'capture' or q0.lead_magnet_slug is not null)),
        'founder', d.taxonomy->>'pillar' = 'personal',
        'picture', case when d.type in ('carousel','pdf') then 'carousel deck' when d.type = 'video' then 'video'
                        when coalesce(array_length(d.image_urls,1),0) > 0 then 'picture' else 'no picture' end,
        'board_visible', d.board_visible,
        'evidence', public.content_plan_post_evidence(d.id)) j
      from public.carousel_drafts d
      where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
        and d.status in ('review','approved','scheduled','published')
        and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
        and coalesce(d.published_at, d.scheduled_at) >= (wk::timestamp at time zone 'Europe/Warsaw')
        and coalesce(d.published_at, d.scheduled_at) < ((wk + 7)::timestamp at time zone 'Europe/Warsaw')
      union all
      select q.scheduled_at, jsonb_build_object('kind','post','queue_id', q.id, 'title', left(q.post_text, 80),
        'day', (q.scheduled_at at time zone 'Europe/Warsaw')::date, 'at', q.scheduled_at, 'status', q.status,
        'format', q.post_format, 'lead_magnet', q.post_kind = 'capture' or q.lead_magnet_slug is not null, 'founder', false,
        'picture', case when q.post_format in ('carousel','pdf') then 'carousel deck' when q.post_format = 'video' then 'video'
                        when coalesce(array_length(q.media_urls,1),0) > 0 then 'picture' else 'no picture' end,
        'evidence', jsonb_build_array(jsonb_build_object('type','queue','label','In the publish queue')))
      from public.scheduled_posts q
      where p_account = 'ivan' and q.platform = 'linkedin' and q.status in ('pending','posted') and coalesce(q.is_repost,false) = false
        and q.scheduled_at >= (wk::timestamp at time zone 'Europe/Warsaw') and q.scheduled_at < ((wk + 7)::timestamp at time zone 'Europe/Warsaw')
        and not exists (select 1 from public.carousel_drafts d2 where d2.client_id is null and d2.status in ('review','approved','scheduled','published')
                          and (d2.scheduled_at = q.scheduled_at or d2.published_at = q.posted_at))
    ) x;

    -- Planned slots of this week that have not become a dated post yet.
    select coalesce(jsonb_agg(y.j order by y.created_at), '[]'::jsonb), count(*) into planned, n_planned from (
      select s.created_at, jsonb_build_object('kind','planned','slot_id', s.id, 'topic', s.topic, 'why_now', s.why_now,
        'evidence', s.evidence, 'format', s.format, 'picture', s.picture, 'idea_source', s.idea_source, 'idea_ref', s.idea_ref,
        'proposal', cfg.proposals_only and st.status = 'proposal', 'status', st.status, 'status_label', st.label, 'draft_id', st.draft_id) j
      from public.content_plan_slots s
      cross join lateral (
        select case
          when s.idea_source = 'carousel_drafts' then (select case when d.status = 'review' then 'waiting_review' else 'dropped' end from public.carousel_drafts d where d.id::text = s.idea_ref and d.scheduled_at is null)
          when s.idea_source = 'lm_idea_candidates' then (select case when l.status in ('reviewing','pending') then case when s.status = 'requested' then 'requested' else 'planned' end
                                                                       when l.status in ('promoted','approved') then 'drafting' else 'dropped' end from public.lm_idea_candidates l where l.id::text = s.idea_ref)
          else (select case when ci.status = 'staged' then 'proposal'
                            when ci.status in ('approved','live') then
                              case when exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id)
                                        and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived')) then 'failed'
                                   when exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status = 'review') then 'waiting_review'
                                   else 'drafting' end
                            else 'dropped' end from public.client_ideas ci where ci.id::text = s.idea_ref)
        end as status0,
        (select coalesce(case when s.idea_source = 'carousel_drafts' then s.idea_ref::uuid end,
                         (select l.promoted_draft_id from public.lm_idea_candidates l where s.idea_source = 'lm_idea_candidates' and l.id::text = s.idea_ref),
                         (select d.id from public.carousel_drafts d where s.idea_source = 'client_ideas' and d.client_idea_id::text = s.idea_ref order by d.created_at desc limit 1))) as draft_id
      ) st0
      cross join lateral (
        select coalesce(st0.status0, 'dropped') as status, st0.draft_id,
          case coalesce(st0.status0,'dropped') when 'waiting_review' then 'Draft waiting in Review' when 'planned' then 'Planned, draft not written yet'
            when 'requested' then 'Draft requested' when 'drafting' then 'Draft being written or waiting in Review'
            when 'proposal' then case when cfg.auto_generate then 'Draft is requested at the next planner run' else 'Waiting for you to generate the draft' end
            else 'Dropped' end as label
      ) st
      where s.account = p_account and s.week_start = wk and s.status in ('planned','proposal','requested')
        and coalesce(st.status,'dropped') not in ('dropped','failed')
        and not exists (select 1 from public.carousel_drafts d where d.id = st.draft_id and d.scheduled_at is not null)
    ) y;

    -- Each planned slot shows the day it is meant for: the first free weekday of its week, in slot order.
    -- A day with a dated post is taken; days before today are gone. No free weekday left = no day (warned below).
    if n_planned > 0 then
      select coalesce(jsonb_agg(e.j || jsonb_build_object('day', free.gd) order by e.ord), '[]'::jsonb) into planned
        from jsonb_array_elements(planned) with ordinality as e(j, ord)
        left join lateral (
          select f.gd from (
            select g::date as gd, row_number() over (order by g) as rn from generate_series(wk::timestamp, (wk + 4)::timestamp, interval '1 day') g
             where g::date >= v_today
               and not exists (select 1 from jsonb_array_elements(posts) pp where (pp->>'day')::date = g::date)
          ) f where f.rn = e.ord
        ) free on true;
    end if;

    if i >= 1 and target_week is null and n_posts + n_planned < target then target_week := wk; open_target := target - n_posts - n_planned; end if;
    weeks := weeks || jsonb_build_array(jsonb_build_object('start', wk, 'which', case i when 0 then 'this' when 1 then 'next' else 'after' end,
      'target', target, 'posts', posts, 'planned', planned, 'filled', n_posts + n_planned, 'dated', n_posts,
      'no_day', (select count(*) from jsonb_array_elements(planned) pl where pl->>'day' is null),
      'open', greatest(target - n_posts - n_planned, 0),
      'lead_magnets', (select count(*) from jsonb_array_elements(posts) p where (p->>'lead_magnet')::boolean),
      'founder', (select count(*) from jsonb_array_elements(posts) p where (p->>'founder')::boolean)));
  end loop;

  -- Topics already done: published in the last 8 weeks, with their results (db/259).
  select array_agg(d.id) into v_done_ids from (select d.id from public.carousel_drafts d where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
            and d.status = 'published' and d.published_at >= p_now - interval '56 days' order by d.published_at desc limit 40) d;
  select coalesce(jsonb_agg(jsonb_build_object('title', coalesce(nullif(d.title,''), left(d.post_body,80)), 'day', (d.published_at at time zone 'Europe/Warsaw')::date,
           'format', d.type, 'pillar', d.taxonomy->>'pillar',
           'draft_id', d.id, 'impressions', null, 'reactions', null, 'comments', null) order by d.published_at desc), '[]'::jsonb) into done
    from public.carousel_drafts d
   where d.id = any(coalesce(v_done_ids, '{}'::uuid[]));

  -- Written drafts waiting in Review with no date: the first supply for an open slot.
  select coalesce(jsonb_agg(jsonb_build_object('draft_id', d.id, 'title', coalesce(nullif(d.title,''), left(d.post_body,80)), 'format', d.type,
           'created_at', d.created_at, 'brain', exists(select 1 from public.cb34_p2_members m where m.draft_id = d.id and m.state = 'released'),
           'evidence', public.content_plan_post_evidence(d.id)) order by d.created_at desc), '[]'::jsonb) into supply
    from (select * from public.carousel_drafts d where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
            and d.status = 'review' and d.scheduled_at is null and d.created_at >= p_now - interval '30 days'
            and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
            and not exists (select 1 from public.cb39_draft_verdicts v where v.draft_id = d.id and v.verdict = 'drop')
          order by d.created_at desc limit 25) d;

  select to_jsonb(r0) into last_run from (select cr.ran_at, cr.target_week, cr.open_before, cr.picked, cr.outcome from public.content_plan_runs cr where cr.account = p_account order by cr.ran_at desc limit 1) r0;

  -- Warnings only. Each names a real gap and stays silent otherwise. Plain words (spec R4).
  if target_week is not null and last_run is not null and coalesce((last_run->>'picked')::int,0) < coalesce((last_run->>'open_before')::int,0)
     and (last_run->>'target_week')::date = target_week and coalesce(last_run->'outcome'->>'reason','') = 'no_candidates' then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','empty_topic_area','text','Not enough ideas to fill the week of ' || to_char(target_week,'FMDD Mon')));
  end if;
  for r in select (x->>'start')::date as ws, (x->>'no_day')::int as nd from jsonb_array_elements(weeks) x where (x->>'no_day')::int > 0 loop
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_day','text',
      r.nd || ' planned post' || case when r.nd = 1 then '' else 's' end || ' in the week of ' || to_char(r.ws,'FMDD Mon') || ' ha' || case when r.nd = 1 then 's' else 've' end || ' no free weekday'));
  end loop;
  if target_week is not null then
    select count(*) into n from public.content_plan_slots s
      join public.client_ideas ci on s.idea_source = 'client_ideas' and ci.id::text = s.idea_ref
     where s.account = p_account and s.status in ('planned','proposal','requested') and s.week_start >= w0
       and ci.status in ('approved','live')
       and exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id)
       and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived'));
    if n > 0 then
      warnings := warnings || jsonb_build_array(jsonb_build_object('code','draft_failed','text',
        n || ' planned draft' || case when n = 1 then '' else 's' end || ' failed the check twice. The planner is picking a new topic.'));
    end if;
  end if;
  if p_account <> 'ivan' then
    for r in
      select d.taxonomy->>'pillar' pillar, count(*) n from public.carousel_drafts d
       where d.client_id = p_account and d.status = 'published' and d.published_at >= p_now - interval '56 days' and d.taxonomy->>'pillar' is not null
       group by 1 having count(*) >= 2
    loop
      select count(*) into n from public.client_ideas ci where ci.client_id = p_account and ci.status = 'staged' and ci.pillar = r.pillar
        and (ci.eligible_at is null or ci.eligible_at <= p_now);
      if n = 0 then
        warnings := warnings || jsonb_build_array(jsonb_build_object('code','empty_topic_area','topic', r.pillar, 'text','Out of ideas for '
          || case r.pillar when 'demand' then 'sales posts' when 'reach' then 'posts that bring new followers' when 'case_study' then 'case studies'
               when 'teardown' then 'teardowns' when 'personal' then 'founder stories' when 'how_to' then 'how-to posts' when 'opinion' then 'opinion posts'
               when 'trust' then 'trust posts' when 'authority' then 'expert posts' else replace(r.pillar,'_',' ') || ' posts' end
          || ' (' || r.n || ' used in 8 weeks)'));
      end if;
    end loop;
    select count(*) into fresh_proof from public.client_ideas ci where ci.client_id = p_account
      and (ci.lane in ('sales_call','fireflies_call') or ci.source_ref ~ '^(fc|ffc|ffr)-') and ci.created_at >= p_now - interval '21 days';
  else
    select count(*) into fresh_proof from public.lm_idea_candidates l where l.source in ('ivan_call','calls','kyle_call','claude_sessions')
      and l.status in ('reviewing','pending') and l.created_at >= p_now - interval '21 days';
  end if;
  if fresh_proof = 0 then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_fresh_proof',
      'text', case when p_account = 'ivan' then 'No new ideas from calls or your own work in 3 weeks' else 'No new ideas from a client call in 3 weeks' end));
  end if;
  if p_account = 'ivan' then
    select count(*) into photos from public.ivan_photo_candidates_v1();
    if photos < target then
      warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_photos','text', 'Only ' || photos || ' fitting photo' || case when photos = 1 then '' else 's' end || ' left in your library'));
    end if;
  end if;
  if lm_target > 0 then
    for i in 1..2 loop
      if coalesce((weeks->i->>'lead_magnets')::int,0) < lm_target then
        warnings := warnings || jsonb_build_array(jsonb_build_object('code','lm_due','text','No lead magnet in the week of ' || to_char((weeks->i->>'start')::date,'FMDD Mon')));
      end if;
    end loop;
  end if;
  founder_n := coalesce((weeks->1->>'founder')::int,0);
  if founder_n > cfg.founder_story_max then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','founder_cap','text', founder_n || ' founder stories next week. Your limit is ' || cfg.founder_story_max));
  end if;

  -- db/259: the content brain data. Fail-safe: a brain error never breaks the plan read (content_plan_apply reads it too).
  begin
    select array_agg(distinct (x->>'draft_id')::uuid) into v_ids from (
      select p as x from jsonb_array_elements(weeks) w, jsonb_array_elements(w->'posts') p
      union all select p from jsonb_array_elements(weeks) w, jsonb_array_elements(w->'planned') p
      union all select s from jsonb_array_elements(supply) s) t
     where x->>'draft_id' ~ '^[0-9a-fA-F-]{36}$';
    select coalesce(jsonb_object_agg(b.draft_id::text, b.brain), '{}'::jsonb) into v_brain
      from public.content_plan_brain_items(p_account, coalesce(v_ids, '{}'::uuid[]), p_now) b;

    v_blank := jsonb_build_object('draft_id', null, 'words', null, 'edited', false, 'thumb', null, 'body_head', null, 'first_line', null, 'has_link', false,
      'flags', jsonb_build_object('lm', false, 'boosted', false, 'founder', false, 'carousel', false, 'weekend', false, 'failed', false, 'low_score', false, 'fact_fail', false),
      'qa', null, 'facts', null, 'angle', null, 'trait', null, 'read', null, 'brief', null, 'quote', null, 'quote_pending', false,
      'photo', null, 'replaced', null, 'result', null, 'time_set_by', null);

    select coalesce(jsonb_agg(w.j || jsonb_build_object(
        'posts', (select coalesce(jsonb_agg(p.j || jsonb_build_object('brain',
                    case when v_brain ? (p.j->>'draft_id') then
                           (v_brain->(p.j->>'draft_id')) || jsonb_build_object('flags', (v_brain->(p.j->>'draft_id'))->'flags'
                             || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false)))
                         else v_blank || jsonb_build_object('flags', (v_blank->'flags') || jsonb_build_object(
                             'lm', coalesce((p.j->>'lead_magnet')::boolean, false), 'founder', coalesce((p.j->>'founder')::boolean, false),
                             'carousel', coalesce(p.j->>'format' in ('carousel','pdf','document'), false),
                             'weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false))) end) order by p.o), '[]'::jsonb)
                  from jsonb_array_elements(w.j->'posts') with ordinality p(j, o)),
        'planned', (select coalesce(jsonb_agg(p.j || jsonb_build_object('brain',
                    case when v_brain ? (p.j->>'draft_id') then
                           (v_brain->(p.j->>'draft_id')) || jsonb_build_object('flags', (v_brain->(p.j->>'draft_id'))->'flags'
                             || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false)))
                         else v_blank || jsonb_build_object('read', nd.rd, 'quote', nd.quote, 'quote_pending', coalesce(nd.src is not null and nd.quote is null, false),
                             'replaced', nd.rp,
                             'flags', (v_blank->'flags') || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false))) end) order by p.o), '[]'::jsonb)
                  from jsonb_array_elements(w.j->'planned') with ordinality p(j, o)
                  left join lateral (
                    select case when p.j->>'idea_source' = 'client_ideas' then public.content_plan_read_shape(public.cb33_idea_read(p_account, p.j->>'idea_ref')) end as rd,
                           qs.src,
                           case when qs.src is not null and ci.quote_en_src = qs.src then nullif(btrim(ci.quote_en), '') end as quote,
                           (select jsonb_build_object('title', coalesce(nullif(od.title, ''), left(od.post_body, 80), os.topic), 'on', (rr.requested_at at time zone 'Europe/Warsaw')::date)
                              from public.content_plan_slots ns
                              join public.content_plan_replans rr on rr.account = p_account and rr.requested_at <= ns.created_at and ns.created_at < rr.requested_at + interval '12 hours'
                              join public.content_plan_slots os on os.id = rr.slot_id and os.week_start = ns.week_start and os.id <> ns.id
                              left join public.carousel_drafts od on od.id = rr.draft_id
                             where ns.id::text = p.j->>'slot_id' order by rr.requested_at desc limit 1) as rp
                      from (select 1) one
                      left join public.client_ideas ci on p.j->>'idea_source' = 'client_ideas' and ci.id = case when p.j->>'idea_ref' ~ '^[0-9a-fA-F-]{36}$' then (p.j->>'idea_ref')::uuid end
                      left join lateral (select public.content_plan_source_quote(ci.id) as src where ci.id is not null) qs on true
                     where not (v_brain ? coalesce(p.j->>'draft_id', ''))
                  ) nd on true)
      ) order by w.o), '[]'::jsonb) into b_weeks
      from jsonb_array_elements(weeks) with ordinality w(j, o);

    select coalesce(jsonb_agg(s.j || jsonb_build_object('brain_draft', s.j->'brain', 'brain', coalesce(v_brain->(s.j->>'draft_id'), v_blank)) order by s.o), '[]'::jsonb)
      into b_supply from jsonb_array_elements(supply) with ordinality s(j, o);

    -- Rule breaks become warnings (spec R3.2), only for rules in force.
    b_warn := warnings;
    select b.rule_id, b.effect_pct into v_rule from public.brain_rules b where b.rule_id = 'R08-frequency-' || p_account and b.status = 'live';
    if found then
      v_max := coalesce((pol->>'max_posts_per_week')::int, target); v_min := (pol->>'min_posts_per_week')::int;
      for r in select (x->>'start')::date as ws, (x->>'filled')::int as f from jsonb_array_elements(b_weeks) x where (x->>'filled')::int > v_max order by 1 loop
        b_warn := b_warn || jsonb_build_array(jsonb_build_object('code','over_rule','text',
          'Week of ' || to_char(r.ws,'FMDD Mon') || ' has ' || r.f || ' posts. Your rule is '
          || case when v_min is not null then v_min || ' to ' || v_max else 'at most ' || v_max end || '.'
          || case when v_rule.effect_pct is not null then ' Each extra post costs ' || round(abs(v_rule.effect_pct)) || '% of views.' else '' end));
      end loop;
    end if;
    if exists (select 1 from public.brain_rules b where b.rule_id = 'R11-weekend-' || p_account and b.status = 'live') then
      for r in select distinct z.dd
                 from jsonb_array_elements(b_weeks) w,
                 lateral (select coalesce(((x->>'at')::timestamptz at time zone v_tz)::date, (x->>'day')::date) as dd
                            from (select x from jsonb_array_elements(w->'posts') x union all select x from jsonb_array_elements(w->'planned') x) xx(x)) z
                where z.dd is not null and z.dd >= v_today and extract(isodow from z.dd) >= 6 order by 1 loop
        b_warn := b_warn || jsonb_build_array(jsonb_build_object('code','weekend_post','text', to_char(r.dd,'Dy FMDD Mon') || ': a post on a weekend. Your rule is weekdays only.'));
      end loop;
    end if;

    select percentile_cont(0.5) within group (order by m.impressions) into v_med
      from public.client_post_metrics m where m.client_id = p_account and m.published_at >= p_now - interval '90 days' and m.impressions is not null;
    if p_account = 'ivan' then
      select coalesce(jsonb_agg(distinct ((a->>'at')::timestamptz at time zone 'Europe/Warsaw')::date), '[]'::jsonb) into v_xdays
        from jsonb_array_elements(public.x_calendar(w0::timestamp at time zone 'Europe/Warsaw', (w0 + 21)::timestamp at time zone 'Europe/Warsaw')) a
       where a->>'at' is not null;
    end if;
    select coalesce(jsonb_agg(z.p order by w.wo, z.k, z.o), '[]'::jsonb) into v_items
      from jsonb_array_elements(b_weeks) with ordinality w(j, wo),
      lateral (select x.p, 0 as k, x.o from jsonb_array_elements(w.j->'posts') with ordinality x(p, o)
               union all select x.p, 1, x.o from jsonb_array_elements(w.j->'planned') with ordinality x(p, o)) z;
    v_strip := public.content_plan_brain_strip(p_account, v_items, p_now);

    -- Results of the topics already done (fix1: inside the fail-safe).
    select coalesce(jsonb_agg(x.j || jsonb_build_object('impressions', mt.views, 'reactions', mt.reactions, 'comments', mt.comments) order by x.o), '[]'::jsonb)
      into b_done
      from jsonb_array_elements(done) with ordinality x(j, o)
      left join public.content_plan_draft_metrics(p_account, coalesce(v_done_ids, '{}'::uuid[])) mt on mt.draft_id::text = x.j->>'draft_id';

    weeks := b_weeks; supply := b_supply; warnings := b_warn; done := b_done;
  exception when others then
    v_strip := null; v_err := left(sqlerrm, 200);
  end;

  return jsonb_build_object('ok', true, 'account', p_account, 'today', v_today, 'target', target,
    'target_week', target_week, 'open', open_target,
    'state', case when target_week is null then 'two_weeks_planned' else 'planning' end,
    'proposals_only', cfg.proposals_only, 'auto_generate', cfg.auto_generate, 'founder_story_max', cfg.founder_story_max,
    'cadence_source', cfg.cadence_source, 'lm_per_week', lm_target,
    'weeks', weeks, 'done', done, 'supply', supply, 'warnings', warnings, 'last_run', last_run,
    'done_median', round(v_med),
    'tz', case when p_account = 'risedtc' then jsonb_build_object('name','America/Los_Angeles','label','PT') else jsonb_build_object('name','Europe/Warsaw','label','Warsaw') end,
    'x_days', v_xdays,
    'brain_strip', v_strip)
    || case when v_err is not null then jsonb_build_object('brain_error', v_err) else '{}'::jsonb end;
end $function$;

-- Helpers carry no seat check of their own: service only (content_plan_week calls them as the owner).
