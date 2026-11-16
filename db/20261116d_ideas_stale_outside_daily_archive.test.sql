-- Test for 20261116d. Run AFTER the migration, as postgres. Everything is rolled back.
--  archived:  T1 old outside idea
--  kept:      T2 old own idea (manual); T3 old outside waiting on Ivan; T4 fresh outside;
--             T5 old outside in a plan slot; T6 old outside pinned (bridge id form);
--             T7 old outside that already carries an archived_reason
--  T8 not exposed; cron command, schedule and owner wired
-- Two-session races (a plan or pin committing during the archive) are covered by the locks, not by this test.

begin;

do $t$
declare ids uuid[] := '{}'; i uuid; r jsonb; s text; mon date := date_trunc('week', now())::date;
  want text[] := array['archived','reviewing','reviewing','reviewing','reviewing','reviewing','reviewing'];
begin
  insert into public.lm_idea_candidates (source, raw_topic, status, content_type, created_at, ingested_at, evidence)
  values ('x_viral', 'T1 old outside 20261116d', 'reviewing', 'post', now() - interval '40 days', now() - interval '40 days', '[]'::jsonb) returning id into i; ids := ids || i;
  insert into public.lm_idea_candidates (source, raw_topic, status, content_type, created_at, ingested_at, evidence)
  values ('manual', 'T2 old own 20261116d', 'reviewing', 'post', now() - interval '40 days', now() - interval '40 days', '[]'::jsonb) returning id into i; ids := ids || i;
  insert into public.lm_idea_candidates (source, raw_topic, status, content_type, created_at, ingested_at, evidence, needs_ivan_data, needs_ivan_question)
  values ('claude_sessions', 'T3 old held 20261116d', 'reviewing', 'post', now() - interval '40 days', now() - interval '40 days', '[]'::jsonb, true, 'Test question 20261116d: what number did you see?') returning id into i; ids := ids || i;
  insert into public.lm_idea_candidates (source, raw_topic, status, content_type, created_at, ingested_at, evidence)
  values ('competitor', 'T4 fresh outside 20261116d', 'reviewing', 'post', now() - interval '5 days', now() - interval '5 days', '[]'::jsonb) returning id into i; ids := ids || i;
  insert into public.lm_idea_candidates (source, raw_topic, status, content_type, created_at, ingested_at, evidence)
  values ('kyle_call', 'T5 old planned 20261116d', 'reviewing', 'post', now() - interval '40 days', now() - interval '40 days', '[]'::jsonb) returning id into i; ids := ids || i;
  insert into public.content_plan_slots (account, week_start, kind, idea_source, idea_ref, topic, why_now, status)
  values ('ivan', mon, 'idea', 'lm_idea_candidates', i::text, 'T5 topic', 'T5 why', 'planned');
  insert into public.lm_idea_candidates (source, raw_topic, status, content_type, created_at, ingested_at, evidence)
  values ('competitor', 'T6 old pinned 20261116d', 'reviewing', 'post', now() - interval '40 days', now() - interval '40 days', '[]'::jsonb) returning id into i; ids := ids || i;
  insert into public.editorial_source_curation (client_id, source_id, state)
  values ('ivan', 'candidate-summary:lm_idea_candidates:' || i::text, 'pinned');
  insert into public.lm_idea_candidates (source, raw_topic, status, content_type, created_at, ingested_at, evidence, archived_reason)
  values ('x_viral', 'T7 old with reason 20261116d', 'reviewing', 'post', now() - interval '40 days', now() - interval '40 days', '[]'::jsonb, 'earlier reason 20261116d') returning id into i; ids := ids || i;

  r := public.lm_ideas_archive_stale_outside();

  for n in 1..7 loop
    select status into s from public.lm_idea_candidates where id = ids[n];
    if s is distinct from want[n] then raise exception 'T% FAIL: status % (want %)', n, s, want[n]; end if;
  end loop;
  if (select archived_reason from public.lm_idea_candidates where id = ids[7]) is distinct from 'earlier reason 20261116d' then
    raise exception 'T7 FAIL: earlier reason overwritten';
  end if;

  if has_function_privilege('anon', 'public.lm_ideas_archive_stale_outside()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.lm_ideas_archive_stale_outside()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.lm_ideas_archive_stale_outside()', 'EXECUTE') then
    raise exception 'T8 FAIL: exposed';
  end if;
  if not exists (select 1 from cron.job where jobname = 'ideas-stale-outside-archive' and username = 'postgres' and active
                   and schedule = '20 4 * * *' and command = 'select public.lm_ideas_archive_stale_outside()') then
    raise exception 'T8 FAIL: cron';
  end if;
  raise notice 'T1-T8 ok: %', r;
end $t$;

rollback;
