-- Brain guardrails (12 Oct 2026). Ivan: "be careful with the self updating brain tho to not do retarded decisions".
-- The monthly re-test (runner lane brain-retest, guards.py) already filters its plan; this migration makes the database
-- refuse the same things, so a bug in the Python can never get past them:
--   1. locked rules (Ivan's rulings, hand-made rules) never change without an owner session (brain.owner = on)
--   2. no automatic retire and no automatic direction flip (claimed_sign) for any rule
--   3. at most brain_guard_max_auto_changes() (3) automatic applies + transitions per run_id; a run_id is required
--   4. automatic applies never write a client's schedule (risedtc/arch scheduler_var), never switch a lint check to
--      "block", and never write a scheduler key or lint code that a locked rule owns
--   5. brain_rule_proposals: what the guards held back, shown in the Monday line; brain_proposal_accept runs one as owner
--   6. brain_retest_runs: one row per dry/monthly run with the input-health verdict (the dead-man baseline)
-- Undo (brain_rule_rollback / brain-undo link) is always a human act and always allowed.
-- Rollback file: 256_brain_guards_rollback.sql. Applied live 12 Oct 2026 (Management API); numbered 256 because 255 was taken concurrently.

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

-- 1. Locks --------------------------------------------------------------------------------------------------------
alter table public.brain_rules add column if not exists locked boolean not null default false;
alter table public.brain_rules add column if not exists lock_reason text;

create or replace function public.brain_guard_owner() returns boolean language sql stable as $$
  select coalesce(current_setting('brain.owner', true), '') = 'on'
$$;

create or replace function public.brain_guard_max_auto_changes() returns integer language sql immutable as $$ select 3 $$;

create or replace function public.brain_rules_guard() returns trigger language plpgsql as $$
begin
  -- An owner ruling always locks the rule.
  if new.override is not null and (tg_op = 'INSERT' or old.override is distinct from new.override) then
    new.locked := true;
    new.lock_reason := coalesce(new.lock_reason, 'owner ruling (' || new.override || ')');
  end if;
  if tg_op = 'INSERT' or public.brain_guard_owner() then
    return new;
  end if;
  if old.locked and (new.status, new.claimed_sign, new.consumer_type, new.consumer_ref, new.statement, new.scope, new.test_id,
                     new.override, new.locked, new.veto)
                is distinct from (old.status, old.claimed_sign, old.consumer_type, old.consumer_ref, old.statement, old.scope, old.test_id,
                     old.override, old.locked, old.veto) then
    raise exception 'brain rule % is locked (%): only an owner session changes it (set local brain.owner = ''on'')', old.rule_id, old.lock_reason;
  end if;
  if new.claimed_sign is distinct from old.claimed_sign then
    raise exception 'brain rule %: flipping a rule''s direction is never automatic', old.rule_id;
  end if;
  if new.status = 'retired' and old.status <> 'retired' then
    raise exception 'brain rule %: retiring a rule is never automatic', old.rule_id;
  end if;
  if old.veto and not new.veto then
    raise exception 'brain rule %: lifting a veto is an owner act', old.rule_id;
  end if;
  return new;
end $$;
drop trigger if exists brain_rules_guard on public.brain_rules;
create trigger brain_rules_guard before insert or update on public.brain_rules
  for each row execute function public.brain_rules_guard();

update public.brain_rules
   set locked = true,
       lock_reason = case when override is not null then 'owner ruling (' || override || ')'
                          else 'hand-made rule: no frozen code test' end
 where (override is not null or test_id is null) and not locked;

-- 2. Run ledger (dead-man baseline) -------------------------------------------------------------------------------
create table if not exists public.brain_retest_runs (
  run_id      text primary key,
  mode        text not null check (mode in ('dry_run','monthly')),
  verdict     text not null check (verdict in ('ok','aborted')),
  health      jsonb not null default '{}'::jsonb,
  applied     integer,
  proposed    integer,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
drop trigger if exists brain_retest_runs_append_only on public.brain_retest_runs;
create trigger brain_retest_runs_append_only before update or delete on public.brain_retest_runs
  for each row execute function public.brain_append_only();

-- 3. Proposals ----------------------------------------------------------------------------------------------------
create table if not exists public.brain_rule_proposals (
  id           bigserial primary key,
  run_id       text not null,
  rule_id      text not null references public.brain_rules(rule_id),
  from_status  text,
  to_status    text,
  kind         text not null check (kind in ('retire','flip','locked_disagrees','over_cap','client_scope','block_mode')),
  reason       text,
  evidence     jsonb,
  state        text not null default 'open' check (state in ('open','accepted','dismissed','superseded')),
  decided_at   timestamptz,
  decided_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists brain_rule_proposals_open on public.brain_rule_proposals(rule_id, created_at desc) where state = 'open';

create or replace function public.brain_proposal_add(p_run_id text, p_rule_id text, p_from text, p_to text, p_kind text,
  p_reason text default null, p_evidence jsonb default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '10s' as $$
declare nid bigint;
begin
  update public.brain_rule_proposals set state = 'superseded', decided_at = now(), decided_by = 'newer run ' || p_run_id
   where rule_id = p_rule_id and state = 'open' and kind = p_kind;
  insert into public.brain_rule_proposals (run_id, rule_id, from_status, to_status, kind, reason, evidence)
  values (p_run_id, p_rule_id, p_from, p_to, p_kind, p_reason, p_evidence) returning id into nid;
  return nid;
end $$;

-- 4. Apply / transition / rollback with the guards ----------------------------------------------------------------
create or replace function public.brain_guard_cap(p_run_id text, p_actor text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if p_run_id is null then
    raise exception 'brain guard: an automatic change needs a run_id (the per-run cap counts them)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('brain-run:' || p_run_id, 0));
  select count(*) into n from public.brain_rule_events
   where run_id = p_run_id and actor = p_actor and kind in ('apply','transition');
  if n >= public.brain_guard_max_auto_changes() then
    raise exception 'brain guard: % automatic changes already made in run %; the rest are proposals', n, p_run_id;
  end if;
  return n;
end $$;

create or replace function public.brain_rule_apply(p_rule_id text, p_after jsonb, p_run_id text default null,
  p_actor text default 'brain-retest', p_reason text default null, p_expected_before jsonb default null,
  p_to_status text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '15s' set lock_timeout = '3s' as $$
declare r public.brain_rules%rowtype; cp record; v jsonb; k text; before jsonb; had boolean; old_text text; new_text text;
        ev bigint; tok uuid := gen_random_uuid(); lc record; from_st text; prev_owner text := current_setting('brain.owner', true);
begin
  select * into r from public.brain_rules where rule_id = p_rule_id for update;
  if not found then raise exception 'brain_rule_apply: unknown rule %', p_rule_id; end if;
  if r.veto then raise exception 'brain_rule_apply: rule % is vetoed; it never re-applies by itself', p_rule_id; end if;
  if p_actor <> 'owner' then
    if r.locked or r.override is not null then
      raise exception 'brain_rule_apply: rule % is locked (%); statistics never change it', p_rule_id, coalesce(r.lock_reason, 'owner override');
    end if;
    if r.consumer_type = 'scheduler_var' and r.scope in ('risedtc','arch') then
      raise exception 'brain_rule_apply: % would change a client schedule; that is a proposal, never automatic', p_rule_id;
    end if;
    if r.consumer_type = 'lint_check' and coalesce(p_after ->> 'mode', '') = 'block' then
      raise exception 'brain_rule_apply: % would switch a blocking lint check on; that is a proposal, never automatic', p_rule_id;
    end if;
    if exists (select 1 from public.brain_rules o
                where o.locked and o.rule_id <> r.rule_id and o.consumer_type = r.consumer_type
                  and ((r.consumer_type = 'scheduler_var' and o.consumer_ref ->> 'slug' = r.consumer_ref ->> 'slug'
                        and o.consumer_ref ->> 'key' = r.consumer_ref ->> 'key')
                    or (r.consumer_type = 'lint_check' and o.consumer_ref ->> 'code' = r.consumer_ref ->> 'code' and o.scope = r.scope))) then
      raise exception 'brain_rule_apply: % targets a setting a locked rule owns; never written automatically', p_rule_id;
    end if;
    perform public.brain_guard_cap(p_run_id, p_actor);
  end if;
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
    if p_actor = 'owner' then perform set_config('brain.owner', 'on', true); end if;   -- owner flag only for this one update
    update public.brain_rules set status = p_to_status where rule_id = p_rule_id;
    perform set_config('brain.owner', coalesce(prev_owner, ''), true);
  end if;
  return jsonb_build_object('event_id', ev, 'undo_token', tok, 'before', before, 'after', p_after);
end $$;

create or replace function public.brain_rule_transition(p_rule_id text, p_to text, p_run_id text default null,
  p_reason text default null, p_actor text default 'brain-retest')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.brain_rules%rowtype; ev bigint; prev_owner text := current_setting('brain.owner', true);
begin
  select * into r from public.brain_rules where rule_id = p_rule_id for update;
  if not found then raise exception 'unknown rule %', p_rule_id; end if;
  if p_actor <> 'owner' then
    if r.override is not null then
      return jsonb_build_object('skipped', 'owner_override', 'override', r.override);
    end if;
    if r.locked then
      return jsonb_build_object('skipped', 'locked', 'lock_reason', r.lock_reason);
    end if;
    if p_to = 'retired' then
      return jsonb_build_object('skipped', 'retire_is_a_proposal');
    end if;
  end if;
  if r.status = p_to then return jsonb_build_object('skipped', 'same_status'); end if;
  if p_actor <> 'owner' then
    perform public.brain_guard_cap(p_run_id, p_actor);
  end if;
  if p_actor = 'owner' then perform set_config('brain.owner', 'on', true); end if;   -- owner flag only for this one update
  update public.brain_rules set status = p_to, last_tested = now() where rule_id = p_rule_id;
  perform set_config('brain.owner', coalesce(prev_owner, ''), true);
  insert into public.brain_rule_events (rule_id, kind, from_status, to_status, run_id, actor, reason)
  values (p_rule_id, 'transition', r.status, p_to, p_run_id, p_actor, p_reason) returning id into ev;
  return jsonb_build_object('event_id', ev, 'from', r.status, 'to', p_to);
end $$;

-- Undo is a human act (the link or an operator): it may restore any rule, locked or not.
create or replace function public.brain_rule_rollback(p_event_id bigint, p_actor text default 'operator', p_veto boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
set statement_timeout = '15s' set lock_timeout = '3s' as $$
declare e public.brain_rule_events%rowtype; r public.brain_rules%rowtype; cp record; v jsonb; k text; cur_text text;
        restored text; mode text; ev bigint; done bigint; prev_owner text := current_setting('brain.owner', true);
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

  perform set_config('brain.owner', 'on', true);   -- owner flag only for the status / veto restore below
  if r.status = e.to_status and e.from_status is distinct from e.to_status then
    update public.brain_rules set status = e.from_status where rule_id = e.rule_id;
  end if;
  if p_veto then
    update public.brain_rules set veto = true where rule_id = e.rule_id;
    insert into public.brain_rule_events (rule_id, kind, actor, reason, reverts_event_id) values (e.rule_id, 'veto', p_actor, 'Undo on the feed line', p_event_id);
  end if;
  perform set_config('brain.owner', coalesce(prev_owner, ''), true);
  return jsonb_build_object('rollback_event_id', ev, 'mode', mode, 'veto', p_veto);
end $$;

-- Run one held proposal as the owner (a Claude session on Ivan's word, or Ivan). Direction flips are edited by hand.
create or replace function public.brain_proposal_accept(p_id bigint, p_actor text default 'owner')
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '15s' as $$
declare pr public.brain_rule_proposals%rowtype; r public.brain_rules%rowtype; res jsonb;
begin
  select * into pr from public.brain_rule_proposals where id = p_id for update;
  if not found or pr.state <> 'open' then raise exception 'brain_proposal_accept: % is not an open proposal', p_id; end if;
  if pr.kind in ('flip', 'locked_disagrees') then
    raise exception 'brain_proposal_accept: a direction change is edited by hand in an owner session (claimed_sign, statement), never executed from a proposal';
  end if;
  select * into r from public.brain_rules where rule_id = pr.rule_id;
  if pr.to_status = 'live' and pr.from_status is distinct from 'live' and r.consumer_type in ('scheduler_var', 'lint_check')
     and pr.evidence ? 'after' and pr.evidence -> 'after' <> 'null'::jsonb then
    res := public.brain_rule_apply(pr.rule_id, pr.evidence -> 'after', pr.run_id, 'owner', 'accepted proposal ' || p_id || ' by ' || p_actor, null, 'live');
  else
    res := public.brain_rule_transition(pr.rule_id, pr.to_status, pr.run_id, 'accepted proposal ' || p_id || ' by ' || p_actor, 'owner');
  end if;
  update public.brain_rule_proposals set state = 'accepted', decided_at = now(), decided_by = p_actor where id = p_id;
  return res || jsonb_build_object('proposal', p_id);
end $$;

create or replace function public.brain_proposal_dismiss(p_id bigint, p_actor text default 'owner')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.brain_rule_proposals set state = 'dismissed', decided_at = now(), decided_by = p_actor where id = p_id and state = 'open';
  return jsonb_build_object('dismissed', found, 'proposal', p_id);
end $$;

-- 5. Monday line: also say what was held back ---------------------------------------------------------------------
create or replace function public.brain_monday_line(p_now timestamptz default now()) returns text
language plpgsql stable security definer set search_path = public, pg_temp set statement_timeout = '5s' as $$
declare since timestamptz := date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'; base text; parts text[] := '{}';
        x record; n int := 0; held text; n_held int;
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
  select count(*), string_agg(rule_id || ' (' || replace(kind, '_', ' ') || ')', ', ' order by created_at)
    into n_held, held
    from (select rule_id, kind, created_at from public.brain_rule_proposals
           where state = 'open' and created_at >= since and created_at <= p_now and rule_id not like 'zz-%'
           order by created_at limit 5) h;
  if n = 0 and coalesce(n_held, 0) = 0 then return 'Brain: nothing changed this month.'; end if;
  return case when n = 0 then 'Brain: nothing changed this month'
              else 'Brain this month: ' || array_to_string(parts, '; ') || case when n > 3 then '; and ' || (n - 3) || ' more' else '' end end
         || case when coalesce(n_held, 0) > 0 then '. Held back, not applied: ' || held else '' end || '.';
end $$;

-- 6. Locks --------------------------------------------------------------------------------------------------------
alter table public.brain_retest_runs enable row level security;
alter table public.brain_rule_proposals enable row level security;
revoke all on public.brain_retest_runs, public.brain_rule_proposals from anon, authenticated;
revoke all on sequence public.brain_rule_proposals_id_seq from anon, authenticated;
revoke execute on function public.brain_guard_cap(text, text), public.brain_proposal_add(text, text, text, text, text, text, jsonb),
  public.brain_proposal_accept(bigint, text), public.brain_proposal_dismiss(bigint, text),
  public.brain_rule_apply(text, jsonb, text, text, text, jsonb, text), public.brain_rule_rollback(bigint, text, boolean),
  public.brain_rule_transition(text, text, text, text, text), public.brain_monday_line(timestamptz)
  from public, anon, authenticated;

commit;
