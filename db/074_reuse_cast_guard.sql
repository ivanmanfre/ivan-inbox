-- db/074: guarded cast in reuse_eligible_task_cards().
-- db/073 shipped the card builder with a bare (meta->>'original_published_at')::timestamptz.
-- meta is jsonb written by the Rise Winner Detector, so one row with a non-date value there
-- (an empty string, a note, a half-written key) raises invalid_input_syntax and aborts the
-- WHOLE daily cron run, not just that row: no card lands for any client that day, and the
-- failure is silent because pg_cron only records it in cron.job_run_details. First card is
-- due 2026-10-25, so the guard goes in before then.
--
-- Exactly one change against the live definition: the cast is wrapped in a CASE that only
-- casts when the value starts with a YYYY-MM-DD. A value that fails the test yields NULL,
-- to_char(NULL) yields NULL, and the existing coalesce(..., 'earlier') already covers that
-- path, so a bad row degrades to "The original ran earlier" and every other card still lands.
-- Same signature, same body otherwise. Nothing else in db/073 is touched.

create or replace function public.reuse_eligible_task_cards()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  -- 074: guarded cast, FMDD Mon
  with due as (
    select i.id, i.client_id, i.title, i.meta
    from client_ideas i
    where i.status = 'staged' and i.reuse_of is not null
      and i.eligible_at is not null and i.eligible_at <= now()
      and not exists (
        select 1 from ops_drafts d
        where d.kind = 'task' and d.context->>'card_key' = 'reuse:' || i.id::text
      )
  ), ins as (
    insert into ops_drafts (client_id, kind, body, context)
    select 'ivan', 'task',
      'Reuse eligible (' || case client_id when 'risedtc' then 'Rise' when 'arch' then 'ARCH' else client_id end || '): '
        || coalesce(replace(title, 'Repurpose winner: ', ''), '(untitled)')
        || E'\n\nThe original ran '
        || coalesce(to_char(case when meta->>'original_published_at' ~ '^\d{4}-\d{2}-\d{2}' then (meta->>'original_published_at')::timestamptz end, 'DD Mon'), 'earlier')
        || ' with ' || coalesce(meta->>'original_comments', '?') || ' comments. Approve it under Strategy, Ideas, on the '
        || case client_id when 'risedtc' then 'Mattan' when 'arch' then 'Davorin' else client_id end || ' lane.',
      jsonb_build_object('source', 'reuse_eligibility', 'card_key', 'reuse:' || id::text, 'idea_id', id, 'client_id', client_id)
    from due
    returning 1
  )
  select count(*) into n from ins;
  return n;
end; $$;

revoke all on function public.reuse_eligible_task_cards() from public, anon, authenticated;
