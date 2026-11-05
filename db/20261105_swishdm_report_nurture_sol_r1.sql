-- SwishDM report nurture, Sol r1 fixes (2026-11-05). Applies on top of 20261105_swishdm_report_nurture.sql.
--  F1 the gates now hold AFTER enrollment too: a guard on nurture_queue cancels any SwishDM row that is
--     inserted (the sender's next-step enqueue) while the switch is off, the email is inactive, the
--     person unsubscribed or the request was stopped; disarming or deactivating an email cancels what is pending.
--  F2 a cancelled SwishDM row never goes back to pending (the sender's retry PATCH); the stop is durable
--     (request nurture_state='stopped' blocks every later step). Residual: a row the sender already
--     fetched in the same few seconds can still go out (needs a sender change; documented).
--  F3 enrollment runs AFTER UPDATE, so is_test / qualifies are the NEW computed values.
--  F4 leaving 'sent' cancels even when lead_magnet changes in the same update.
--  F5 only the subscriber (email, sequence) conflict counts as already_enrolled, and it returns the id.
-- Rollback: db/20261105_swishdm_report_nurture_sol_r1_rollback.sql (back to the base migration).

begin;

create or replace function public.swishdm_nurture_seq_id()
returns uuid language sql stable set search_path = public
as $$ select id from nurture_sequences where slug = 'swishdm_ai_search_report' $$;
revoke all on function public.swishdm_nurture_seq_id() from public, anon, authenticated;

create or replace function public.swishdm_nurture_armed()
returns boolean language sql stable set search_path = public
as $$ select coalesce((select value from integration_config where key = 'swishdm_nurture_armed'), 'false') = 'true' $$;
revoke all on function public.swishdm_nurture_armed() from public, anon, authenticated;

-- F3 + F5: enrollment on the computed row.
create or replace function public.swishdm_report_nurture_enroll(r public.swishdm_lm_requests)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq uuid;
  v_step1 public.nurture_emails%rowtype;
  v_email text := lower(btrim(r.email));
  v_sub uuid;
  v_at timestamptz;
  v_con text;
begin
  if not public.swishdm_nurture_armed() then return jsonb_build_object('state', 'not_armed'); end if;
  if coalesce(r.is_test, true) then return jsonb_build_object('state', 'skipped_test'); end if;
  if r.lead_magnet is distinct from 'ai-search-report' or not coalesce(r.qualifies, false) then
    return jsonb_build_object('state', 'not_qualifying');
  end if;
  if r.report_url is null or nullif(btrim(coalesce(r.report_top_gap, '')), '') is null then
    return jsonb_build_object('state', 'missing_report_fields');
  end if;

  v_seq := public.swishdm_nurture_seq_id();
  if v_seq is null then return jsonb_build_object('state', 'no_sequence'); end if;
  select * into v_step1 from nurture_emails where sequence_id = v_seq and step = 1 and is_active;
  if not found then return jsonb_build_object('state', 'emails_inactive'); end if;

  if exists (select 1 from nurture_subscribers where lower(email) = v_email and unsubscribed_at is not null) then
    return jsonb_build_object('state', 'unsubscribed_before');
  end if;
  select id into v_sub from nurture_subscribers where lower(email) = v_email and sequence_id = v_seq;
  if v_sub is not null then return jsonb_build_object('state', 'already_enrolled', 'subscriber_id', v_sub); end if;

  begin
    insert into nurture_subscribers (email, sequence_id, lm_slug, lm_title, first_name, custom_fields, current_step, is_test)
    values (v_email, v_seq, 'ai-search-report', 'AI search report',
            nullif(split_part(btrim(r.name), ' ', 1), ''),
            jsonb_build_object('brand', btrim(r.brand), 'report_url', r.report_url,
                               'top_gap', btrim(r.report_top_gap), 'request_id', r.id),
            0, false)
    returning id into v_sub;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con is distinct from 'nurture_subscribers_email_sequence_id_key' then raise; end if;
    select id into v_sub from nurture_subscribers where email = v_email and sequence_id = v_seq;
    return jsonb_build_object('state', 'already_enrolled', 'subscriber_id', v_sub);
  end;

  -- First email lands at the next 14:00 UTC (morning US East, afternoon UK) after the delay.
  v_at := date_trunc('day', now() + make_interval(hours => v_step1.delay_hours)) + interval '14 hours';
  if v_at < now() + make_interval(hours => v_step1.delay_hours) then v_at := v_at + interval '1 day'; end if;

  insert into nurture_queue (subscriber_id, email_id, scheduled_for, status)
  values (v_sub, v_step1.id, v_at, 'pending');

  return jsonb_build_object('state', 'enrolled', 'subscriber_id', v_sub, 'first_send', v_at);
end;
$$;
revoke all on function public.swishdm_report_nurture_enroll(public.swishdm_lm_requests) from public, anon, authenticated;

-- F3 + F4: AFTER UPDATE hook. Its own write never names status, so it cannot re-fire.
drop trigger if exists swishdm_report_nurture_on_status on public.swishdm_lm_requests;
drop function if exists public.swishdm_report_nurture_on_status();

create or replace function public.swishdm_report_nurture_after_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb; v_state text; v_sub uuid;
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    begin
      v := public.swishdm_report_nurture_enroll(new);
    exception when others then
      v := jsonb_build_object('state', 'error: ' || left(sqlerrm, 120));
    end;
    v_state := v->>'state';
    v_sub := nullif(v->>'subscriber_id', '')::uuid;
    update swishdm_lm_requests
       set nurture_state = v_state,
           nurture_subscriber_id = coalesce(v_sub, nurture_subscriber_id),
           report_sent_at = coalesce(report_sent_at, now())
     where id = new.id;
  elsif old.status = 'sent' and new.status is distinct from 'sent' then
    v_sub := coalesce(new.nurture_subscriber_id, old.nurture_subscriber_id);
    if v_sub is not null then
      perform public.swishdm_report_nurture_cancel(v_sub, 'request moved off sent');
      update swishdm_lm_requests set nurture_state = 'stopped' where id = new.id;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.swishdm_report_nurture_after_status() from public, anon, authenticated;

create trigger swishdm_report_nurture_after_status
  after update of status on public.swishdm_lm_requests
  for each row
  when ((old.lead_magnet = 'ai-search-report' or new.lead_magnet = 'ai-search-report')
        and new.status is distinct from old.status)
  execute function public.swishdm_report_nurture_after_status();

-- F1 + F2: the queue guard. Rows of every other sequence pass untouched (first check returns NEW).
create or replace function public.swishdm_nurture_queue_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_seq uuid := public.swishdm_nurture_seq_id(); v_why text;
begin
  if v_seq is null or not exists (select 1 from nurture_emails e where e.id = new.email_id and e.sequence_id = v_seq) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'cancelled' and new.status = 'pending' then
    new.status := 'cancelled';
    new.error_message := old.error_message;
    return new;
  end if;
  if new.status = 'pending' then
    if not public.swishdm_nurture_armed() then v_why := 'switch off';
    elsif not exists (select 1 from nurture_emails e where e.id = new.email_id and e.is_active) then v_why := 'email inactive';
    elsif exists (select 1 from nurture_subscribers s where s.id = new.subscriber_id and s.unsubscribed_at is not null) then v_why := 'unsubscribed';
    elsif exists (select 1 from nurture_subscribers s join swishdm_lm_requests r on r.id::text = s.custom_fields->>'request_id'
                   where s.id = new.subscriber_id and (r.nurture_state = 'stopped' or r.status is distinct from 'sent')) then v_why := 'request stopped';
    end if;
    if v_why is not null then
      new.status := 'cancelled';
      new.error_message := 'swishdm guard: ' || v_why;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.swishdm_nurture_queue_guard() from public, anon, authenticated;

drop trigger if exists swishdm_nurture_queue_guard on public.nurture_queue;
create trigger swishdm_nurture_queue_guard
  before insert or update of status on public.nurture_queue
  for each row execute function public.swishdm_nurture_queue_guard();

create or replace function public.swishdm_nurture_cancel_pending(p_email_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  update nurture_queue q set status = 'cancelled', error_message = left(p_reason, 200)
    from nurture_emails e
   where q.email_id = e.id and e.sequence_id = public.swishdm_nurture_seq_id()
     and q.status = 'pending' and (p_email_id is null or e.id = p_email_id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.swishdm_nurture_cancel_pending(uuid, text) from public, anon, authenticated;

create or replace function public.swishdm_nurture_on_disarm()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' or new.value is distinct from 'true' then
    perform public.swishdm_nurture_cancel_pending(null, 'swishdm guard: switch off');
  end if;
  return null;
end;
$$;
revoke all on function public.swishdm_nurture_on_disarm() from public, anon, authenticated;

drop trigger if exists swishdm_nurture_on_disarm on public.integration_config;
create trigger swishdm_nurture_on_disarm
  after update or delete on public.integration_config
  for each row when (old.key = 'swishdm_nurture_armed')
  execute function public.swishdm_nurture_on_disarm();

create or replace function public.swishdm_nurture_on_email_off()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.sequence_id = public.swishdm_nurture_seq_id() then
    perform public.swishdm_nurture_cancel_pending(new.id, 'swishdm guard: email inactive');
  end if;
  return null;
end;
$$;
revoke all on function public.swishdm_nurture_on_email_off() from public, anon, authenticated;

drop trigger if exists swishdm_nurture_on_email_off on public.nurture_emails;
create trigger swishdm_nurture_on_email_off
  after update of is_active on public.nurture_emails
  for each row when (old.is_active and not new.is_active)
  execute function public.swishdm_nurture_on_email_off();

commit;
