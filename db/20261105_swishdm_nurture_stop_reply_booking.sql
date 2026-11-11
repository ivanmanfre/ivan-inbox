-- SwishDM report nurture: replies go to the madebyswishdm.com inbox, a reply or a booking stops it. 2026-11-05.
-- On top of 20261105_swishdm_report_nurture.sql + _sol_r1 + _sol_r2. Switch and emails stay OFF.
--
--  1. reply_to = jonathan@madebyswishdm.com (was john@swishdm.com, Jonathan's own Google mailbox).
--     madebyswishdm.com MX = Resend inbound -> n8n Vg2g73v3T1h6LiMM -> Ivan's inbox app.
--     Without reply_to the shared sender falls back to ivan@ivanmanfredi.com, so it stays explicit.
--  2. Email 3: the "Truth be told," opener removed. Nothing else in the copy changes.
--  3. swishdm_report_nurture_stop_by_email(events, reason): for each {email, at}, every ai-search-report
--     request with that address created at or before `at` is marked stopped (durable: the queue guard cancels
--     any later step) and its pending emails are cancelled. Called by:
--       - SwishDM Email Inbound Vg2g73v3T1h6LiMM (any email from that person to madebyswishdm.com)
--       - SwishDM Report Nurture Stop (TidyCal bookings), every 15 min
--     It also returns every matching request (name, brand, is_test) so the inbound workflow can ring Ivan for a
--     report requester's reply (src swishdm-report-reply, push) while everyone else keeps the silent card.
--  4. Enrollment refuses a request that is already stopped (they replied or booked before the report went out).
-- Rollback: db/20261105_swishdm_nurture_stop_reply_booking_rollback.sql

begin;

-- 1. Reply-to.
update nurture_sequences
   set send_config = jsonb_set(send_config, '{reply_to}', to_jsonb('jonathan@madebyswishdm.com'::text))
 where slug = 'swishdm_ai_search_report';

-- 2. Email 3 opener.
update nurture_emails e
   set body_markdown = replace(e.body_markdown,
         'Truth be told, more of your buyers are asking ChatGPT and Gemini what to buy',
         'More of your buyers are asking ChatGPT and Gemini what to buy')
  from nurture_sequences s
 where s.id = e.sequence_id and s.slug = 'swishdm_ai_search_report' and e.step = 3;

-- 3. Why a request stopped.
alter table public.swishdm_lm_requests
  add column if not exists nurture_stopped_at timestamptz,
  add column if not exists nurture_stop_reason text;

create or replace function public.swishdm_report_nurture_stop_by_email(p_events jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ev jsonb;
  v_email text;
  v_at timestamptz;
  r record;
  n integer;
  v_out jsonb := '[]'::jsonb;
  v_found jsonb := '[]'::jsonb;
  v_seen integer := 0;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'stopped'), 120);
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return jsonb_build_object('ok', false, 'error', 'events must be an array'); end if;
  for ev in select * from jsonb_array_elements(p_events) loop
    v_email := lower(btrim(coalesce(ev->>'email', '')));
    continue when v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    begin v_at := coalesce((ev->>'at')::timestamptz, now()); exception when others then v_at := now(); end;
    v_seen := v_seen + 1;
    -- every request from this address (for the inbound workflow's card), stopped before or not
    select v_found || coalesce(jsonb_agg(jsonb_build_object('request_id', x.id, 'email', v_email, 'name', x.name, 'brand', x.brand,
                                                            'is_test', x.is_test, 'status', x.status)), '[]'::jsonb)
      into v_found
      from swishdm_lm_requests x
     where x.lead_magnet = 'ai-search-report' and lower(btrim(x.email)) = v_email and x.created_at <= v_at;
    for r in
      select id, nurture_subscriber_id from swishdm_lm_requests
       where lead_magnet = 'ai-search-report'
         and lower(btrim(email)) = v_email
         and created_at <= v_at
         and nurture_state is distinct from 'stopped'
       for update
    loop
      update swishdm_lm_requests
         set nurture_state = 'stopped', nurture_stopped_at = now(), nurture_stop_reason = v_reason
       where id = r.id;
      n := 0;
      if r.nurture_subscriber_id is not null then
        n := public.swishdm_report_nurture_cancel(r.nurture_subscriber_id, 'swishdm stop: ' || v_reason);
      end if;
      v_out := v_out || jsonb_build_object('request_id', r.id, 'email', v_email, 'cancelled', n);
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'checked', v_seen, 'stopped', v_out, 'requests', v_found);
end;
$$;
revoke all on function public.swishdm_report_nurture_stop_by_email(jsonb, text) from public, anon, authenticated;
grant execute on function public.swishdm_report_nurture_stop_by_email(jsonb, text) to service_role;

-- 4. Enrollment: a stopped request stays stopped (same body as _sol_r1 plus the first check after the switch).
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
  if r.nurture_state = 'stopped' then return jsonb_build_object('state', 'stopped'); end if;
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

  v_at := date_trunc('day', now() + make_interval(hours => v_step1.delay_hours)) + interval '14 hours';
  if v_at < now() + make_interval(hours => v_step1.delay_hours) then v_at := v_at + interval '1 day'; end if;

  insert into nurture_queue (subscriber_id, email_id, scheduled_for, status)
  values (v_sub, v_step1.id, v_at, 'pending');

  return jsonb_build_object('state', 'enrolled', 'subscriber_id', v_sub, 'first_send', v_at);
end;
$$;
revoke all on function public.swishdm_report_nurture_enroll(public.swishdm_lm_requests) from public, anon, authenticated;

-- 5. A report requester's email reply rings (registered wa-relay src). Test requests post under the old src (feed only).
update integration_config
   set value = (value::jsonb || jsonb_build_object('swishdm-report-reply', jsonb_build_object(
                  'key', 'full', 'url', './#exp/brain-b/today', 'push', true, 'family', 'lead_request_notice', 'severity', 'attention')))::text
 where key = 'inbox_family_map';

commit;
