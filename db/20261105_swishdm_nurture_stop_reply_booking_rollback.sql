-- Rollback for 20261105_swishdm_nurture_stop_reply_booking.sql (2026-11-05).
-- Order: deactivate n8n "SwishDM - Report Nurture Stop (TidyCal bookings)" and restore the Vg2g73v3T1h6LiMM backup
-- (~/.claude/backups/swishdm-nurture-stop-2026-11-05/) FIRST, so nothing calls the dropped function.
-- Leaves nurture_stopped_at / nurture_stop_reason in place (data) and any request already marked stopped stays stopped.

begin;

update nurture_sequences
   set send_config = jsonb_set(send_config, '{reply_to}', to_jsonb('john@swishdm.com'::text))
 where slug = 'swishdm_ai_search_report';

update nurture_emails e
   set body_markdown = replace(e.body_markdown,
         E'\n\nMore of your buyers are asking ChatGPT and Gemini what to buy',
         E'\n\nTruth be told, more of your buyers are asking ChatGPT and Gemini what to buy')
  from nurture_sequences s
 where s.id = e.sequence_id and s.slug = 'swishdm_ai_search_report' and e.step = 3;

drop function if exists public.swishdm_report_nurture_stop_by_email(jsonb, text);

update integration_config set value = (value::jsonb - 'swishdm-report-reply')::text where key = 'inbox_family_map';

-- Enrollment back to the _sol_r1 body (no stopped check).
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

commit;
