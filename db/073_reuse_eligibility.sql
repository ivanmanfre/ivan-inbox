-- db/073: reuse eligibility. The Rise Winner Detector (n8n YAKAUb0cEuWdWJEg)
-- stages a "Repurpose winner" idea with eligible_at = published + 90 d, and
-- until now nothing read that date: the idea was approvable the day it was
-- staged. Three changes, all CREATE OR REPLACE on the same signatures:
--   1. operator_client_ideas hides rows whose eligible_at is in the future and
--      returns reuse_of / eligible_at so the card can say what it is.
--   2. operator_approve_idea refuses 'approved' on such a row (not_eligible_yet),
--      so the gate holds even for a client that bypasses the list.
--   3. reuse_eligible_task_cards() drops one ops_drafts task card the day a
--      reuse idea becomes eligible; pg_cron runs it daily at 07:15 UTC, after
--      the detector's 07:00 run. Ops IS Ivan's task list (ops_drafts kind
--      'task', client 'ivan', title on the first line), same row the inbox's
--      createBotTask writes.

create or replace function public.operator_client_ideas(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare out jsonb;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select jsonb_agg(jsonb_build_object(
    'id', i.id, 'hook', i.hook, 'title', i.title, 'source_label', i.source_label,
    'source_ref', i.source_ref, 'pillar', i.pillar, 'format', i.format,
    'status', i.status, 'created_at', i.created_at,
    'icp_score', i.icp_score, 'score_breakdown', i.score_breakdown,
    'funnel_stage', i.funnel_stage, 'funnel_source', i.funnel_source,
    'agent_log', coalesce(i.agent_log, '[]'::jsonb),
    'reuse_of', i.reuse_of, 'eligible_at', i.eligible_at
  ) order by i.icp_score desc nulls last, i.created_at desc) into out
  from client_ideas i
  where i.client_id = p_client_id and i.status = 'staged'
    and (i.eligible_at is null or i.eligible_at <= now());
  return jsonb_build_object('ok', true, 'ideas', coalesce(out, '[]'::jsonb));
end; $$;

create or replace function public.operator_approve_idea(p_gate text, p_idea_id uuid, p_decision text default 'approved')
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare r client_ideas;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  if p_decision not in ('approved','rejected') then
    return jsonb_build_object('ok', false, 'error', 'bad_decision');
  end if;
  if p_decision = 'approved' and exists (
    select 1 from client_ideas where id = p_idea_id and eligible_at is not null and eligible_at > now()
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_eligible_yet');
  end if;
  update client_ideas
    set status = p_decision,
        approved_at = case when p_decision = 'approved' then now() else approved_at end
    where id = p_idea_id and status = 'staged'
    returning * into r;
  if r.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_not_staged');
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'status', r.status);
end; $$;

create or replace function public.reuse_eligible_task_cards()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
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
        || coalesce(to_char((meta->>'original_published_at')::timestamptz, 'DD Mon'), 'earlier')
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

select cron.unschedule('reuse-eligible-cards') where exists (select 1 from cron.job where jobname = 'reuse-eligible-cards');
select cron.schedule('reuse-eligible-cards', '15 7 * * *', $$select public.reuse_eligible_task_cards()$$);
