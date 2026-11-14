BEGIN;

-- 20261114f Cold reader check for Ivan's brain-written business drafts ("stranger read"). Ships with the edge function
-- content-stranger-read and the prompt row ivan-stranger-read (client:ivan).
--
-- Bug (Ivan 2026-11-13, draft 848607fe "GEO?", "makes like 0 sense"): a post no stranger could follow was the day's
-- pick. QA and the fact check look for invented facts and banned wording; nothing asked whether a reader with no
-- context can follow it.
--
-- Scope: Ivan's own text and image drafts written by the content brain (a cb34_p2_members row for ivan), own business
-- posts only (Poland posts, X copies and takes on a screenshot are out). That is where the session-remark posts come
-- from. Hand-made and lead-magnet posts are not read: on 11-14 the strict read flagged 3 of 14 published lead-magnet
-- and hand posts ("how do I get it"), and loosening the prompt for them let GEO through again.
--
-- Rules
--   Two reads of the current text; it passes only when both pass (11-14 replay, single reads: GEO 6 of 7 fail, the draft
--   Ivan dropped 70d4a151 2 of 2, 1e3dfbc3 "I don't know what came before it" 4 of 4; published brain posts 8 of 8
--   pass; 1 of 19 clear Review drafts failed 1 read of 4). A held brain draft only misses the automatic pick and
--   placement; it stays in Review for Ivan.
--   A refused, empty or malformed answer is never a verdict: the try is counted and retried (backoff, 8 tries).
--   "Not read yet" holds a draft back only while the judge is alive (beat within 3 hours). A dead judge, or 8 failed
--   tries, lets the draft through as before, so an outage cannot empty the supply.
--   Used by content_card_candidates (the daily pick) and content_autopilot_candidates (a fail joins the draft's
--   fails). Neither may be emptied by it: if it holds every draft that could otherwise be picked or placed, it holds
--   none. The publish gate is not touched.
--   One draft per edge call (two reads), pg_cron every 5 minutes.
--   Kill switch: integration_config content_stranger_gate = 'off' (both readers and the cron tick).
--
-- Readers checked with who-reads: content_card_candidates is read by content_card_pick only;
-- content_autopilot_candidates by content_autonomy_pending_ivan and 3 other DB functions (it only gains a fail).
-- Every other name here is new.
-- Rollback: 20261114f_content_stranger_read_rollback.sql

create table if not exists public.content_stranger_reads (
  draft_id uuid not null,
  body_sha256 text not null,
  verdict text check (verdict in ('pass', 'fail')),
  reason text,
  detail jsonb,
  model text,
  prompt_version int,
  attempts int not null default 0,
  last_error text,
  first_seen_at timestamptz not null default now(),
  attempted_at timestamptz,
  judged_at timestamptz,
  primary key (draft_id, body_sha256),
  constraint content_stranger_reads_verdict_ck
    check (verdict is null or (nullif(btrim(coalesce(reason, '')), '') is not null and judged_at is not null))
);
alter table public.content_stranger_reads enable row level security;
revoke all on table public.content_stranger_reads from public, anon, authenticated;
grant all on table public.content_stranger_reads to service_role;

create table if not exists public.content_stranger_state (
  id boolean primary key default true check (id),
  beat_at timestamptz
);
alter table public.content_stranger_state enable row level security;
revoke all on table public.content_stranger_state from public, anon, authenticated;
grant all on table public.content_stranger_state to service_role;

-- Which drafts get the cold read.
create or replace function public.content_stranger_scope(p_draft uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.carousel_drafts d
     where d.id = p_draft
       and d.client_id is null
       and d.type in ('text', 'single_image', 'image')
       and nullif(btrim(coalesce(d.post_body, '')), '') is not null
       and public.content_card_source(d.taxonomy, d.source_detail) = 'own'
       and not coalesce(public.content_card_poland(d.id), false)
       and exists (select 1 from public.cb34_p2_members m where m.draft_id = d.id and m.client_id = 'ivan'))
$function$;

-- Drafts whose current text has no verdict yet. A text that was tried without a verdict comes back after a wait
-- that doubles each time (10 min, 20, 40 ... capped at 4 h), 8 tries in all.
create or replace function public.content_stranger_due(p_limit int default 4)
returns table(draft_id uuid, body text, body_sha256 text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select d.id, d.post_body, public.content_card_sha(d.post_body)
    from public.carousel_drafts d
    left join public.content_stranger_reads r on r.draft_id = d.id and r.body_sha256 = public.content_card_sha(d.post_body)
   where d.client_id is null
     and d.status in ('review', 'approved', 'scheduled')
     and d.published_at is null
     and d.created_at > now() - interval '45 days'
     and not coalesce(public.content_card_tax(d.taxonomy) -> 'internal_test' = 'true'::jsonb, false)
     and coalesce(public.content_card_tax(d.taxonomy) ->> 'deleted_by_operator', '') <> 'true'
     and left(ltrim(coalesce(d.title, '')), 16) <> '[new voice test]'
     and public.content_stranger_scope(d.id)
     and (r.draft_id is null
          or (r.verdict is null and r.attempts < 8
              and coalesce(r.attempted_at, '-infinity'::timestamptz) < now() - make_interval(mins => least(240, 5 * (2 ^ r.attempts)::int))))
   order by (d.status = 'review') desc, d.created_at desc, d.id
   limit greatest(coalesce(p_limit, 4), 0)
$function$;

-- One result per call. p_verdict 'pass' or 'fail' with a reason stores the verdict. Anything else is a try that gave
-- no verdict: the attempt is counted and nothing else is stored. Returns saved, kept (a verdict was already stored),
-- retry, body_changed or bad_input.
-- A stored verdict is never replaced by a try without one.
create or replace function public.content_stranger_save(
  p_draft uuid, p_sha text, p_verdict text, p_reason text, p_detail jsonb, p_model text, p_prompt_version int, p_error text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 400); v_ok boolean; v_n int;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  if p_draft is null or coalesce(p_sha, '') = '' then return 'bad_input'; end if;
  -- the draft row is locked so the text cannot change between this check and the write
  perform 1 from public.carousel_drafts d where d.id = p_draft and d.client_id is null for share;
  if not found then return 'bad_input'; end if;
  if not exists (select 1 from public.carousel_drafts d where d.id = p_draft and public.content_card_sha(d.post_body) = p_sha) then
    return 'body_changed';
  end if;
  v_ok := p_verdict in ('pass', 'fail') and v_reason is not null;
  if v_ok then
    insert into public.content_stranger_reads as r (draft_id, body_sha256, verdict, reason, detail, model, prompt_version, attempts, last_error, attempted_at, judged_at)
    values (p_draft, p_sha, p_verdict, v_reason, p_detail, left(p_model, 80), p_prompt_version, 1, null, now(), now())
    on conflict (draft_id, body_sha256) do update
       set verdict = excluded.verdict, reason = excluded.reason, detail = excluded.detail, model = excluded.model,
           prompt_version = excluded.prompt_version, attempts = r.attempts + 1, last_error = null,
           attempted_at = excluded.attempted_at, judged_at = excluded.judged_at
     where r.verdict is null;
    get diagnostics v_n = row_count;
    insert into public.content_stranger_state as s (id, beat_at) values (true, now())
    on conflict (id) do update set beat_at = excluded.beat_at;
    return case when v_n = 0 then 'kept' else 'saved' end;
  end if;
  insert into public.content_stranger_reads as r (draft_id, body_sha256, attempts, last_error, attempted_at)
  values (p_draft, p_sha, 1, left(coalesce(p_error, 'no_verdict'), 200), now())
  on conflict (draft_id, body_sha256) do update
     set attempts = r.attempts + 1, last_error = excluded.last_error, attempted_at = excluded.attempted_at
   where r.verdict is null;
  return 'retry';
end $function$;

-- The cron tick. Nothing due = the judge is idle and healthy (beat). Something due = one call to the edge function;
-- the beat then comes from the first stored verdict.
create or replace function public.content_stranger_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_url text; v_secret text; v_req bigint;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  if coalesce((select value from public.integration_config where key = 'content_stranger_gate'), 'on') = 'off' then
    return jsonb_build_object('called', false, 'why', 'gate off');
  end if;
  if not exists (select 1 from public.content_stranger_due(1)) then
    -- Idle and healthy only when no text is waiting out a failed try: a try in backoff is not proof the judge works.
    if not exists (select 1 from public.content_stranger_reads r
                    where r.verdict is null and r.attempts between 1 and 7 and r.attempted_at > now() - interval '1 day') then
      insert into public.content_stranger_state as s (id, beat_at) values (true, now())
      on conflict (id) do update set beat_at = excluded.beat_at;
    end if;
    return jsonb_build_object('called', false, 'why', 'nothing due');
  end if;
  select value into v_url from public.integration_config where key = 'content_stranger_read_url';
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return jsonb_build_object('called', false, 'why', 'not configured'); end if;
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
           body := '{}'::jsonb, timeout_milliseconds := 150000) into v_req;
  return jsonb_build_object('called', true, 'request_id', v_req);
end $function$;

-- One plain sentence when the draft must not be picked, else null.
create or replace function public.content_stranger_block(p_draft uuid, p_now timestamptz default now())
returns text
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare r public.content_stranger_reads%rowtype; v_body text; v_beat timestamptz;
begin
  if coalesce((select value from public.integration_config where key = 'content_stranger_gate'), 'on') = 'off' then return null; end if;
  if not public.content_stranger_scope(p_draft) then return null; end if;
  select d.post_body into v_body from public.carousel_drafts d where d.id = p_draft;
  select * into r from public.content_stranger_reads x where x.draft_id = p_draft and x.body_sha256 = public.content_card_sha(v_body);
  if r.verdict = 'pass' then return null; end if;
  if r.verdict = 'fail' then return 'a cold reader could not follow it: ' || r.reason; end if;
  -- no verdict for this text yet
  if coalesce(r.attempts, 0) >= 8 then return null; end if;
  select s.beat_at into v_beat from public.content_stranger_state s where s.id;
  if v_beat is null or v_beat < p_now - interval '3 hours' then return null; end if;
  return 'the cold read has not run on this text yet';
end $function$;

revoke all on function public.content_stranger_scope(uuid) from public, anon, authenticated;
revoke all on function public.content_stranger_due(int) from public, anon, authenticated;
revoke all on function public.content_stranger_save(uuid, text, text, text, jsonb, text, int, text) from public, anon, authenticated;
revoke all on function public.content_stranger_tick() from public, anon, authenticated;
revoke all on function public.content_stranger_block(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.content_stranger_scope(uuid) to service_role;
grant execute on function public.content_stranger_due(int) to service_role;
grant execute on function public.content_stranger_save(uuid, text, text, text, jsonb, text, int, text) to service_role;
grant execute on function public.content_stranger_tick() to service_role;
grant execute on function public.content_stranger_block(uuid, timestamptz) to service_role;

insert into public.integration_config (key, value)
select 'content_stranger_read_url', 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/content-stranger-read'
 where not exists (select 1 from public.integration_config where key = 'content_stranger_read_url');

select cron.schedule('content-stranger-read', '*/5 * * * *', $cron$select public.content_stranger_tick()$cron$);

insert into public.content_prompts (slug, scope, version, is_active, kind, category, title, body, variables, updated_by)
select 'ivan-stranger-read', 'client:ivan', 1, true, 'prompt', 'Post pipeline', 'Ivan brain drafts: can a stranger follow the post',
  $p$You are checking one LinkedIn post before it is published. Read it as a stranger would: someone who scrolls LinkedIn, runs or works at a small agency or B2B business, and has never met the author. You do not know his clients, his campaigns, his tools, his calls, his past posts or anything he said elsewhere. You only have the text below.

Your job: find the gaps that stop the post's own point from landing for that stranger.

Step 1. In one sentence, write what the post is trying to tell the reader (its point).

Step 2. List the questions the stranger is left with that the post itself needs answered for that point to make sense. Only count a question when, without its answer, the stranger cannot tell what happened, what the author means, or why the advice is right. Typical blocking gaps:
- the story hinges on a message, offer, question or event the post never shows,
- the point hinges on a term, acronym, tool or number the post never explains, and a reader in agencies or B2B would not know it for sure,
- it contradicts itself about who did or said what,
- it builds to advice from one moment and never says what happened next, so the advice rests on nothing.

Do NOT count: curiosity ("I wonder what his rates are"), wanting more detail on something already clear, disagreement, style, length, tone, grammar, or how good the advice is. Short posts, opinions and personal stories are fine when their point is clear. Everyday marketing and sales words (CRM, DM, outreach, lead magnet, SEO, CPC, ICP) need no explanation.

Step 3. Verdict: "fail" if Step 2 has at least one blocking question, else "pass".

Answer with JSON only, no other text:
{"topic": "the point from Step 1", "blocking": ["each blocking question, plain words"], "verdict": "pass" or "fail", "missing": "if fail: one plain sentence naming what the stranger needs and does not get; if pass: empty string"}

The post:
<post>
{{BODY}}
</post>$p$, '{}'::text[], 'content-stranger-read 2026-11-14 replay tune'
 where not exists (select 1 from public.content_prompts where slug = 'ivan-stranger-read');
-- re-applied after a rollback: the kept row is switched back on (its text is left as it is)
update public.content_prompts set is_active = true where slug = 'ivan-stranger-read' and scope = 'client:ivan' and is_active is not true;

-- The two readers, each from its live definition plus the marked lines.
CREATE OR REPLACE FUNCTION public.content_card_candidates(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(draft_id uuid, created_at timestamp with time zone, poland boolean, lift numeric, poland_lane boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 2026-11-14: a brain draft a cold reader cannot follow (or not read yet while the reader runs) is not picked,
  -- unless every candidate is held that way: the cold read never empties the pick.
  with base as (
  select d.id as b_id, d.created_at as b_created, public.content_card_poland(d.id) as b_poland,
         coalesce((select case when x.m[2]::numeric > 0 then replace(x.m[1], ',', '')::numeric / x.m[2]::numeric
                               else replace(x.m[1], ',', '')::numeric end
                     from regexp_match(coalesce(d.source_label, ''), '([0-9][0-9,]*) likes vs own median ([0-9]+(?:\.[0-9]+)?)', 'i') as x(m)), 0) as b_lift,
         coalesce(public.content_card_poland(d.id), false)
           or (jsonb_typeof(d.source_detail) = 'object' and public.content_card_jstrim(coalesce(d.source_detail ->> 'kind', '')) = 'x_tracked_outlier')
           or public.content_card_jstrim(coalesce(public.content_card_tax(d.taxonomy) ->> 'source', '')) = 'x_tracked_outlier' as b_lane,
         public.content_stranger_block(d.id, p_now) as b_cold
    from public.carousel_drafts d
   where d.client_id is null
     and d.status = 'review'
     and d.scheduled_at is null
     and d.published_at is null
     and d.type in ('text', 'single_image', 'image')
     and d.qa ->> 'verdict' = 'PASS'
     and public.cb34_p2_review_block(d.qa, d.taxonomy) is null
     and d.created_at > p_now - interval '30 days'
     and nullif(btrim(coalesce(d.post_body, '')), '') is not null
     and not coalesce(public.content_card_tax(d.taxonomy) -> 'internal_test' = 'true'::jsonb, false)
     and left(ltrim(coalesce(d.title, '')), 16) <> '[new voice test]'
     and coalesce(public.content_card_tax(d.taxonomy) ->> 'deleted_by_operator', '') <> 'true'
     and not exists (select 1 from public.content_daily_cards c where c.draft_id = d.id)
     -- a brain draft: only once released and validated for Ivan's seat (cb34_p2_read_guard's member rule)
     and (not exists (select 1 from public.cb34_p2_members m where m.draft_id = d.id)
          or exists (select 1 from public.cb34_p2_members m where m.draft_id = d.id and m.state = 'released'
                       and m.validation ->> 'verdict' = 'PASS' and m.client_id = 'ivan'))
  )
  select b_id, b_created, b_poland, b_lift, b_lane from base
   where b_cold is null or not exists (select 1 from base x where x.b_cold is null)
$function$;

CREATE OR REPLACE FUNCTION public.content_autopilot_candidates(p_account text, p_week date, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  e jsonb; out jsonb := '[]'::jsonb; f jsonb; why text[]; sc numeric; rd jsonb; v_pw date; v_slot uuid; age int; v_cold text; v_held int := 0; v_free int := 0; v_freed int := 0;
BEGIN
  FOR e IN SELECT x FROM jsonb_array_elements(public.content_brain_eligibility(p_account, p_now)) x LOOP
    f := e -> 'fails'; why := '{}'; sc := 0; age := (e ->> 'age_days')::int;
    SELECT s.week_start, s.id INTO v_pw, v_slot FROM public.content_plan_slots s
     WHERE s.account = p_account AND ((s.idea_source = 'carousel_drafts' AND s.idea_ref = e ->> 'draft_id')
       OR (p_account='ivan' AND s.idea_source='lm_idea_candidates' AND EXISTS (
         SELECT 1 FROM public.lm_idea_candidates l WHERE l.id::text=s.idea_ref AND l.promoted_draft_id::text=e->>'draft_id')))
       AND s.status IN ('planned','proposal','requested') ORDER BY s.created_at DESC LIMIT 1;
    IF NOT FOUND THEN v_pw := NULL; v_slot := NULL; END IF;
    -- plan-relative: a draft the plan holds for another week stays there
    IF v_pw IS NOT NULL AND v_pw <> p_week THEN
      f := f || to_jsonb('planned for the week of ' || to_char(v_pw, 'FMDD Mon'));
    END IF;

    -- score (only explains the order; every pick already passed every check)
    IF e ->> 'status' = 'approved' OR (e ->> 'verdict' = 'keep' AND e ->> 'verdict_source' <> 'implicit') THEN sc := sc + 100; why := why || 'you approved it'::text; END IF;
    IF v_pw = p_week THEN sc := sc + 50; why := why || 'the planner put it in this week'::text; END IF;
    IF e ->> 'qa_outcome' = 'passed' THEN sc := sc + 10; why := why || 'QA passed first time'::text;
    ELSIF e ->> 'qa_outcome' = 'recovered' THEN sc := sc + 5; why := why || 'QA passed after one rewrite'::text; END IF;
    rd := e -> 'read';
    IF jsonb_typeof(rd) = 'object' AND rd ->> 'proven' = 'true' AND coalesce(rd ->> 'small', 'false') <> 'true'
       AND (rd ->> 'rate') ~ '^[0-9.]+$' AND (rd ->> 'base') ~ '^[0-9.]+$' AND (rd ->> 'rate')::numeric > (rd ->> 'base')::numeric THEN
      sc := sc + 15; why := why || ('its kind of post (' || coalesce(rd ->> 'dim', '?') || ' ' || coalesce(rd ->> 'val', '?') || ') is proven above your usual');
    END IF;
    sc := sc + greatest(0, 10 - age / 3.0);
    IF e ->> 'source_ref' LIKE 'outlier:%' THEN why := why || ('adapts a niche outlier by ' || coalesce(e ->> 'brief_author', e ->> 'author', 'an unnamed author')); END IF;
    IF e ->> 'must_carry' IN ('verifier','replay') THEN why := why || 'carries what made the winner work'::text; END IF;

    out := out || jsonb_build_array(jsonb_build_object(
      'draft_id', e -> 'draft_id', 'title', e -> 'title', 'status', e -> 'status', 'type', e -> 'type',
      'pillar', e -> 'pillar', 'founder', e -> 'founder', 'opener', e -> 'opener', 'source_ref', e -> 'source_ref', 'author', e -> 'author',
      'author_name', e -> 'author_name', 'created_at', e -> 'created_at', 'age_days', age,
      'must_carry', e -> 'must_carry', 'planned_week', v_pw, 'plan_slot_id', v_slot, 'body_sha256', e -> 'body_sha256',
      'eligible', jsonb_array_length(f) = 0, 'fails', f, 'warnings', e -> 'warnings',
      'score', round(sc, 1), 'why', to_jsonb(why)));
    -- 2026-11-14: a brain draft a cold reader cannot follow (or not read yet while the reader runs) is not placed,
    -- unless that would leave nothing to place (below).
    v_cold := public.content_stranger_block((e ->> 'draft_id')::uuid, p_now);
    IF v_cold IS NOT NULL THEN
      IF jsonb_array_length(f) = 0 THEN v_held := v_held + 1; END IF;
      out := jsonb_set(out, ARRAY[(jsonb_array_length(out) - 1)::text], (out -> -1) || jsonb_build_object('cold', v_cold));
    ELSIF jsonb_array_length(f) = 0 THEN v_free := v_free + 1;
    END IF;
  END LOOP;
  -- The cold read never empties the supply: if it holds every draft that could otherwise go out, it holds none.
  IF v_free > 0 OR v_held = 0 THEN
    SELECT coalesce(jsonb_agg(CASE WHEN x ? 'cold' THEN (x - 'cold') || jsonb_build_object('eligible', false,
             'fails', (x -> 'fails') || to_jsonb(x ->> 'cold')) ELSE x END ORDER BY n), '[]'::jsonb)
      INTO out FROM jsonb_array_elements(out) WITH ORDINALITY t(x, n);
  ELSE
    SELECT coalesce(jsonb_agg(CASE WHEN x ? 'cold' THEN (x - 'cold') || jsonb_build_object('warnings',
             coalesce(x -> 'warnings', '[]'::jsonb) || to_jsonb('cold read hold lifted: nothing else could go out'::text)) ELSE x END ORDER BY n), '[]'::jsonb)
      INTO out FROM jsonb_array_elements(out) WITH ORDINALITY t(x, n);
  END IF;
  RETURN out;
END $function$;

COMMIT;
