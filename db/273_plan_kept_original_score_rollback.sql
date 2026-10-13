-- Rollback db/273: content_plan_brain_items as it was live before.
CREATE OR REPLACE FUNCTION public.content_plan_brain_items(p_account text, p_drafts uuid[], p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(draft_id uuid, brain jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
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
    -- db/261 fix1: only a move by Ivan is 'hand' and only a planner move is 'planner'; a system or client move says nothing.
    'time_set_by', case v_moves->>(d.id::text) when 'ivan' then 'hand' when 'planner' then 'planner' end)
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
      exists (select 1 from cy where cy.b ~ '^REGEN LOOP EXHAUSTED' or cy.ag = 'QA Give-Up') as exhausted,
      -- fix2: the scale the score was given on, from the check's own text ("56/120", "(57/80)").
      -- Only read when the QA JSON carries no qa_total_max of its own (older lanes).
      (select max(m[1]::int) from eq, regexp_matches(eq.b, '[0-9]+ ?/ ?(80|90|100|120)\M', 'g') m
        where (eq.ord = bd.l or eq.ord in (select cy.ord from cy))
          and not exists (select 1 from eq e2 where e2.ord = bd.l and strpos(e2.b, '"qa_total_max":') > 0)) as scale_hint,
      (select cq.v from cq order by cq.ord limit 1) as cq_vfirst,
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
        -- fix2: the persisted qa.verdict PASS/APPROVE(D) decides in every arm; low needs a non-pass persisted
        -- verdict, a non-pass check, or an exhausted / give-up line with no later pass.
        case
          when d.status = 'error' then 'failed'
          when x.vpass then case when x.earlier_fail then 'recovered' else 'passed' end
          when x.arm_pass then case when x.earlier_fail then 'recovered' else 'passed' end
          when x.arm_pass = false and (x.vfail or x.gave_up) then 'low'
          when f.first is null and x.final0 is null
               and (lg.hand_ord is not null or coalesce(d.taxonomy->>'human_edited', '') = 'true' or x.v in ('EDITORIAL_REVIEWED','HAND_COPY')) then 'hand'
        end as outcome,
        f.first,
        x.final0 as final,
        case when greatest(f.first, x.final0) is null or greatest(f.first, x.final0) <= x.mx0 then x.mx0
             else (select min(sc) from unnest(array[80, 90, 100, 120]) sc where sc >= greatest(f.first, x.final0) and sc >= x.mx0) end as mx,
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
      cross join lateral (
        select y.*,
          y.v <> '' and not y.vpass and y.v not in ('EDITORIAL_REVIEWED','HAND_COPY','REVIEW','HOLD') as vfail
        from (select
          upper(coalesce(d.qa->>'verdict', '')) as v,
          upper(coalesce(d.qa->>'verdict', '')) ~ '(^|_)(PASS|APPROVE|APPROVED)$' as vpass,
          case when lg.qj is not null and not (lg.qj->>'parse' = 'false' and lg.attempts = 0 and lg.final_rg is null)
                 then lg.recovered or (lg.attempts = 0 and lg.qj->>'passed' = 'true')
               when jsonb_typeof(d.qa->'check') = 'object' then d.qa->'check'->>'verdict' = 'PASS'
               when lg.cq_n > 0 then lg.cq_verdict = 'PASS'
               when coalesce(d.qa->>'total_80', '') ~ '^[0-9]+(\.[0-9]+)?$' then coalesce(upper(d.qa->>'verdict'), 'PASS') ~ '(^|_)(PASS|APPROVE|APPROVED)$'
          end as arm_pass,
          case when lg.qj is not null then lg.attempts > 0 or (lg.qj->>'version' = 'rewrite' and coalesce(lg.qj->>'rec_raw', '') <> 'approve')
               when jsonb_typeof(d.qa->'check') = 'object' then jsonb_typeof(d.qa->'check'->'fix_pass') = 'object'
               when lg.cq_n > 0 then lg.cq_n > 1 and coalesce(lg.cq_vfirst, '') <> 'PASS'
               else false end as earlier_fail,
          (lg.exhausted and not lg.recovered)
            or (jsonb_typeof(d.qa->'check') = 'object' and coalesce(d.qa->'check'->>'verdict', '') <> 'PASS')
            or (lg.qj is null and lg.cq_n > 0 and coalesce(lg.cq_verdict, '') <> 'PASS') as gave_up,
          case when lg.qj is not null then
                 case when lg.attempts > 0 then coalesce(lg.final_rg, f.first)
                      else coalesce(case when jsonb_typeof(lg.qj->'total') = 'number' and (lg.qj->>'total')::numeric > 0 then round((lg.qj->>'total')::numeric)::int end, f.first) end
               when lg.cq_n > 0 then
                 case when upper(coalesce(d.qa->>'verdict', '')) in ('PASS','APPROVE','APPROVED')
                      then coalesce(case when coalesce(d.qa->>'score', '') ~ '^[0-9]+(\.[0-9]+)?$' then round((d.qa->>'score')::numeric)::int end,
                                    case when lg.cq_verdict = 'PASS' then lg.cq_last end)
                      else lg.cq_last end
               when coalesce(d.qa->>'total_80', '') ~ '^[0-9]+(\.[0-9]+)?$' then round((d.qa->>'total_80')::numeric)::int end as final0,
          case when lg.qj is not null then coalesce(case when jsonb_typeof(lg.qj->'max') = 'number' then (lg.qj->>'max')::numeric::int end, lg.scale_hint, 80)
               when lg.cq_n > 0 then coalesce(lg.cq_max, 120) else 80 end as mx0
        ) y
      ) x
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
end $function$;
