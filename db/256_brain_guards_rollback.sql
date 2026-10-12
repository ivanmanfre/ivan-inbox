-- Rollback of 256_brain_guards.sql: restores the 251 versions of apply / rollback / transition / Monday line and removes
-- the guard trigger, the lock columns, the proposals and the run ledger. Copies of the dropped tables are kept as
-- *_bak_256 so nothing is lost.
begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

drop trigger if exists brain_rules_guard on public.brain_rules;
drop function if exists public.brain_rules_guard();

create or replace function public.brain_rule_apply(p_rule_id text, p_after jsonb, p_run_id text default null,
  p_actor text default 'brain-retest', p_reason text default null, p_expected_before jsonb default null,
  p_to_status text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '15s' set lock_timeout = '3s' as $$
declare r public.brain_rules%rowtype; cp record; v jsonb; k text; before jsonb; had boolean; old_text text; new_text text;
        ev bigint; tok uuid := gen_random_uuid(); lc record; from_st text;
begin
  select * into r from public.brain_rules where rule_id = p_rule_id for update;
  if not found then raise exception 'brain_rule_apply: unknown rule %', p_rule_id; end if;
  if r.veto then raise exception 'brain_rule_apply: rule % is vetoed; it never re-applies by itself', p_rule_id; end if;
  from_st := r.status;

  if r.consumer_type = 'scheduler_var' then
    k := r.consumer_ref ->> 'key';
    select id, variables into cp from public.content_prompts where slug = r.consumer_ref ->> 'slug' and is_active for update;
    if not found then raise exception 'brain_rule_apply: prompt row % not found', r.consumer_ref ->> 'slug'; end if;
    old_text := cp.variables[1];
    v := old_text::jsonb;
    had := v ? k;
    before := v -> k;
    if p_expected_before is not null and before is distinct from p_expected_before then
      raise exception 'brain_rule_apply: % drifted (expected %, found %)', k, p_expected_before, before;
    end if;
    new_text := (v || jsonb_build_object(k, p_after))::text;
    update public.content_prompts set variables[1] = new_text where id = cp.id;
    insert into public.brain_rule_events (rule_id, kind, from_status, to_status, consumer_type, consumer_ref, before_value, after_value, undo_token, run_id, actor, reason)
    values (p_rule_id, 'apply', from_st, coalesce(p_to_status, from_st), r.consumer_type, r.consumer_ref,
            jsonb_build_object('present', had, 'value', before, 'text', old_text),
            jsonb_build_object('value', p_after, 'text', new_text), tok, p_run_id, p_actor, p_reason)
    returning id into ev;
  elsif r.consumer_type = 'lint_check' then
    select * into lc from public.brain_lint_codes where code = r.consumer_ref ->> 'code' and scope = r.scope for update;
    before := case when found then jsonb_build_object('mode', lc.mode, 'params', lc.params) else null end;
    if p_expected_before is not null and before is distinct from p_expected_before then
      raise exception 'brain_rule_apply: lint % drifted', r.consumer_ref ->> 'code';
    end if;
    insert into public.brain_lint_codes (code, scope, mode, params, rule_id)
    values (r.consumer_ref ->> 'code', r.scope, p_after ->> 'mode', coalesce(p_after -> 'params', '{}'::jsonb), p_rule_id)
    on conflict (code, scope) do update set mode = excluded.mode, params = excluded.params, rule_id = excluded.rule_id, updated_at = now();
    insert into public.brain_rule_events (rule_id, kind, from_status, to_status, consumer_type, consumer_ref, before_value, after_value, undo_token, run_id, actor, reason)
    values (p_rule_id, 'apply', from_st, coalesce(p_to_status, from_st), r.consumer_type, r.consumer_ref,
            jsonb_build_object('present', before is not null, 'value', before), jsonb_build_object('value', p_after), tok, p_run_id, p_actor, p_reason)
    returning id into ev;
  else
    raise exception 'brain_rule_apply: consumer_type % is not applied by code; stage a kit', r.consumer_type;
  end if;

  if p_to_status is not null and p_to_status <> r.status then
    update public.brain_rules set status = p_to_status where rule_id = p_rule_id;
  end if;
  return jsonb_build_object('event_id', ev, 'undo_token', tok, 'before', before, 'after', p_after);
end $$;

create or replace function public.brain_rule_rollback(p_event_id bigint, p_actor text default 'operator', p_veto boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '15s' set lock_timeout = '3s' as $$
declare e public.brain_rule_events%rowtype; r public.brain_rules%rowtype; cp record; v jsonb; k text; cur_text text;
        restored text; mode text; ev bigint; done bigint;
begin
  select * into e from public.brain_rule_events where id = p_event_id;
  if not found or e.kind <> 'apply' then raise exception 'brain_rule_rollback: % is not an apply event', p_event_id; end if;
  select id into done from public.brain_rule_events where reverts_event_id = p_event_id and kind = 'rollback';
  if found then return jsonb_build_object('already_rolled_back', true, 'rollback_event_id', done); end if;
  select * into r from public.brain_rules where rule_id = e.rule_id for update;

  if e.consumer_type = 'scheduler_var' then
    k := e.consumer_ref ->> 'key';
    select id, variables into cp from public.content_prompts where slug = e.consumer_ref ->> 'slug' and is_active for update;
    cur_text := cp.variables[1];
    if cur_text = e.after_value ->> 'text' then
      restored := e.before_value ->> 'text'; mode := 'exact_text';
    else
      v := cur_text::jsonb;
      if (e.before_value ->> 'present')::boolean then v := v || jsonb_build_object(k, e.before_value -> 'value');
      else v := v - k; end if;
      restored := v::text; mode := 'key_only';
    end if;
    update public.content_prompts set variables[1] = restored where id = cp.id;
    insert into public.brain_rule_events (rule_id, kind, from_status, to_status, consumer_type, consumer_ref, before_value, after_value, reverts_event_id, actor, reason)
    values (e.rule_id, 'rollback', r.status, case when r.status = e.to_status then e.from_status else r.status end, e.consumer_type, e.consumer_ref,
            jsonb_build_object('text', cur_text), jsonb_build_object('text', restored, 'mode', mode), p_event_id, p_actor,
            case when p_veto then 'undo with veto' else 'rollback' end)
    returning id into ev;
  elsif e.consumer_type = 'lint_check' then
    if (e.before_value ->> 'present')::boolean then
      update public.brain_lint_codes set mode = e.before_value -> 'value' ->> 'mode', params = e.before_value -> 'value' -> 'params', updated_at = now()
       where code = e.consumer_ref ->> 'code' and scope = r.scope;
    else
      delete from public.brain_lint_codes where code = e.consumer_ref ->> 'code' and scope = r.scope;
    end if;
    insert into public.brain_rule_events (rule_id, kind, from_status, to_status, consumer_type, consumer_ref, before_value, after_value, reverts_event_id, actor, reason)
    values (e.rule_id, 'rollback', r.status, case when r.status = e.to_status then e.from_status else r.status end, e.consumer_type, e.consumer_ref,
            e.after_value, e.before_value, p_event_id, p_actor, case when p_veto then 'undo with veto' else 'rollback' end)
    returning id into ev;
  else
    raise exception 'brain_rule_rollback: consumer_type % has no code rollback', e.consumer_type;
  end if;

  if r.status = e.to_status and e.from_status is distinct from e.to_status then
    update public.brain_rules set status = e.from_status where rule_id = e.rule_id;
  end if;
  if p_veto then
    update public.brain_rules set veto = true where rule_id = e.rule_id;
    insert into public.brain_rule_events (rule_id, kind, actor, reason, reverts_event_id) values (e.rule_id, 'veto', p_actor, 'Undo on the feed line', p_event_id);
  end if;
  return jsonb_build_object('rollback_event_id', ev, 'mode', mode, 'veto', p_veto);
end $$;

create or replace function public.brain_rule_transition(p_rule_id text, p_to text, p_run_id text default null,
  p_reason text default null, p_actor text default 'brain-retest')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.brain_rules%rowtype; ev bigint;
begin
  select * into r from public.brain_rules where rule_id = p_rule_id for update;
  if not found then raise exception 'unknown rule %', p_rule_id; end if;
  if r.override is not null and p_actor <> 'owner' then
    return jsonb_build_object('skipped', 'owner_override', 'override', r.override);
  end if;
  if r.status = p_to then return jsonb_build_object('skipped', 'same_status'); end if;
  update public.brain_rules set status = p_to, last_tested = now() where rule_id = p_rule_id;
  insert into public.brain_rule_events (rule_id, kind, from_status, to_status, run_id, actor, reason)
  values (p_rule_id, 'transition', r.status, p_to, p_run_id, p_actor, p_reason) returning id into ev;
  return jsonb_build_object('event_id', ev, 'from', r.status, 'to', p_to);
end $$;

create or replace function public.brain_monday_line(p_now timestamptz default now()) returns text
language plpgsql stable security definer set search_path = public, pg_temp set statement_timeout = '5s' as $$
declare since timestamptz := date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'; base text; parts text[] := '{}';
        x record; n int := 0;
begin
  select value into base from public.integration_config where key = 'brain_undo_url';
  for x in
    select e.id, e.rule_id, e.kind, e.from_status, e.to_status, e.consumer_ref, e.after_value, e.undo_token,
           exists (select 1 from public.brain_rule_events b where b.reverts_event_id = e.id and b.kind = 'rollback') undone
      from public.brain_rule_events e
     where e.created_at >= since and e.created_at <= p_now and e.kind in ('apply','transition')
     order by e.created_at
  loop
    if x.rule_id like 'zz-%' and x.undone then continue; end if;  -- an undone self-test leaves no line
    n := n + 1;
    if n > 3 then continue; end if;
    parts := parts || (x.rule_id || ': ' ||
      case when x.kind = 'apply' then coalesce(x.consumer_ref ->> 'key', x.consumer_ref ->> 'code', 'consumer') || ' set to ' || (x.after_value -> 'value')::text
           else x.from_status || ' to ' || x.to_status end ||
      case when x.undone then ' (undone)'
           when x.undo_token is not null and base is not null then ' Undo: ' || base || '?t=' || x.undo_token
           else '' end);
  end loop;
  if n = 0 then return 'Brain: nothing changed this month.'; end if;
  return 'Brain this month: ' || array_to_string(parts, '; ') || case when n > 3 then '; and ' || (n - 3) || ' more' else '' end || '.';
end $$;

drop function if exists public.brain_proposal_accept(bigint, text);
drop function if exists public.brain_proposal_dismiss(bigint, text);
drop function if exists public.brain_proposal_add(text, text, text, text, text, text, jsonb);
drop function if exists public.brain_guard_cap(text, text);
drop function if exists public.brain_guard_max_auto_changes();
drop function if exists public.brain_guard_owner();

create table if not exists public.brain_rule_proposals_bak_256 as select * from public.brain_rule_proposals;
create table if not exists public.brain_retest_runs_bak_256 as select * from public.brain_retest_runs;
drop table if exists public.brain_rule_proposals;
drop table if exists public.brain_retest_runs;

alter table public.brain_rules drop column if exists lock_reason;
alter table public.brain_rules drop column if exists locked;

revoke execute on function public.brain_rule_apply(text, jsonb, text, text, text, jsonb, text), public.brain_rule_rollback(bigint, text, boolean),
  public.brain_rule_transition(text, text, text, text, text), public.brain_monday_line(timestamptz) from public, anon, authenticated;
commit;
