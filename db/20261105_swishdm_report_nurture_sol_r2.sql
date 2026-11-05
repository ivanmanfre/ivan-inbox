-- SwishDM report nurture, Sol r2 fixes (2026-11-05). On top of _sol_r1.
--  G1 the queue guard takes FOR SHARE locks on the switch row, the email row and the request row before
--     it judges a pending row, so a disarm / email deactivation / stop (all UPDATEs of those rows) waits for
--     an in-flight enqueue to commit and then cancels it, instead of missing an uncommitted row.
--  G2 renaming the switch key counts as a disarm.
--  G3 (Sol r3/r4) the gate locks are NOWAIT: if any of those rows is locked right now, the guard cancels
--     the row (fails closed) instead of waiting, so a sender retry PATCH can never deadlock with a
--     disarm/stop. Cost: a step that collides in the same instant with an unrelated update of its request
--     row (brand-check sweep) is cancelled too; the request then shows the cancelled step in nurture_queue.
-- Rollback: disarm first, then re-apply db/20261105_swishdm_report_nurture_sol_r1.sql. That brings back
--   the r1 guard WITHOUT these locks (uncommitted-enqueue race and key-rename bypass return).

begin;

create or replace function public.swishdm_nurture_queue_guard()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_seq uuid := public.swishdm_nurture_seq_id();
  v_why text;
  v_armed text;
  v_active boolean;
  v_unsub timestamptz;
  v_req uuid;
  v_req_state text;
  v_req_status text;
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
    begin
      select value into v_armed from integration_config where key = 'swishdm_nurture_armed' for share nowait;
      select is_active into v_active from nurture_emails where id = new.email_id for share nowait;
      select unsubscribed_at, nullif(custom_fields->>'request_id', '')::uuid into v_unsub, v_req
        from nurture_subscribers where id = new.subscriber_id for share nowait;
      if v_req is not null then
        select nurture_state, status into v_req_state, v_req_status from swishdm_lm_requests where id = v_req for share nowait;
      end if;
    exception when lock_not_available then
      v_why := 'lock contention';
    end;
    if v_why is not null then null;
    elsif v_armed is distinct from 'true' then v_why := 'switch off';
    elsif not coalesce(v_active, false) then v_why := 'email inactive';
    elsif v_unsub is not null then v_why := 'unsubscribed';
    elsif v_req is not null and (v_req_state = 'stopped' or v_req_status is distinct from 'sent') then v_why := 'request stopped';
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

create or replace function public.swishdm_nurture_on_disarm()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' or new.key is distinct from old.key or new.value is distinct from 'true' then
    perform public.swishdm_nurture_cancel_pending(null, 'swishdm guard: switch off');
  end if;
  return null;
end;
$$;
revoke all on function public.swishdm_nurture_on_disarm() from public, anon, authenticated;

commit;
