-- SwishDM AI search report nurture. 2026-11-05.
-- Three emails written as Jonathan, sent by the shared Nurture Sender
-- (n8n 2Vt9Ahcn5GrXh9H1) from a madebyswishdm.com address with the white-label
-- wrapper (send_config.brand). The sender itself is NOT changed.
--
-- Enrollment starts ONLY when a report is marked sent by hand
-- (swishdm_lm_requests.status -> 'sent'), and only when ALL of these hold:
--   integration_config.swishdm_nurture_armed = 'true'   (created 'false' here)
--   the request is a real one (is_test = false) and qualifies ($1M+ band)
--   report_url and report_top_gap are filled in on the row
--   step 1 of the sequence is is_active (all three are created false)
--   the address never unsubscribed from any of our lists
-- Every outcome is written to swishdm_lm_requests.nurture_state, so a request
-- that was not enrolled says why. Nothing is backfilled when the switch flips.
-- Moving a request off 'sent' (or calling swishdm_report_nurture_stop) cancels
-- its pending emails. Replies and bookings are NOT seen here (they land in
-- Jonathan's inbox / TidyCal): stop by hand.
-- Rollback: db/20261105_swishdm_report_nurture_rollback.sql

begin;

-- 1. The switch. Off.
insert into integration_config (key, value, is_secret)
values ('swishdm_nurture_armed', 'false', false)
on conflict (key) do nothing;

-- 2. Columns on the request row (service role only; anon keeps its INSERT column grants and nothing else).
alter table public.swishdm_lm_requests
  add column if not exists report_url text,
  add column if not exists report_top_gap text,
  add column if not exists report_sent_at timestamptz,
  add column if not exists nurture_state text,
  add column if not exists nurture_subscriber_id uuid;

alter table public.swishdm_lm_requests
  drop constraint if exists swishdm_lm_requests_report_url_check,
  add constraint swishdm_lm_requests_report_url_check
    check (report_url is null or (char_length(report_url) <= 500 and report_url ~* '^https://[^[:space:]]+\.[^[:space:]]+$')),
  drop constraint if exists swishdm_lm_requests_report_top_gap_check,
  add constraint swishdm_lm_requests_report_top_gap_check
    check (report_top_gap is null or char_length(btrim(report_top_gap)) between 3 and 220),
  drop constraint if exists swishdm_lm_requests_nurture_state_check,
  add constraint swishdm_lm_requests_nurture_state_check
    check (nurture_state is null or nurture_state ~ '^(enrolled|not_armed|skipped_test|not_qualifying|missing_report_fields|no_sequence|emails_inactive|already_enrolled|unsubscribed_before|stopped|error)');

-- 3. The sequence (inactive, manual) and its three emails (all inactive).
insert into nurture_sequences (slug, name, trigger_type, trigger_filter, is_active, send_config)
values (
  'swishdm_ai_search_report',
  'SwishDM · AI search report follow-up (white-label, Jonathan)',
  'manual', '{}'::jsonb, false,
  jsonb_build_object(
    'from', 'Jonathan at SwishDM <jonathan@madebyswishdm.com>',
    'from_name', 'Jonathan at SwishDM',
    'reply_to', 'john@swishdm.com',
    'brand', jsonb_build_object(
      'name', 'SwishDM',
      'site', 'https://madebyswishdm.com',
      'note', 'You''re receiving this because you asked for a free AI search report at madebyswishdm.com.')
  )
)
on conflict (slug) do nothing;

insert into nurture_emails (sequence_id, step, delay_hours, subject, preview, body_markdown, is_active)
select s.id, e.step, e.delay_hours, e.subject, e.preview, e.body, false
  from nurture_sequences s
 cross join (values
  (1, 48, 'Your AI search report for {{brand}}', 'The one fix I''d start with',
$b1$Hi {{first_name}},

Did you get a chance to look at the AI search report we put together for {{brand}}?

The biggest gap we found was {{top_gap}}. That's the one I'd fix first.

Here's the report again in case it got buried.
{{report_url}}

When you're ready to get {{brand}} recommended by ChatGPT and Gemini more often, you can book a call with me here.
https://tidycal.com/m5llvq1/strategy-session

Jonathan
SwishDM$b1$),
  (2, 72, 'A quick check you can run on {{brand}}', 'Read the whole answer',
$b2$Hi {{first_name}},

One quick thing you can try today.

Open ChatGPT and ask it the question your buyer would ask, something like "what's the best [your product] for [what they need it for]". Then read the whole answer, slowly.

A lot of the time it's pulling outdated pages and saying things about brands that are no longer true, like an old price or a product you stopped selling.

If it gets something wrong about {{brand}}, check your own product page first and make sure the right details are there in plain words, the way a buyer would ask for them.

Getting stores like {{brand}} named and recommended in these answers is the work we do at SwishDM. If that's on your list for this quarter, grab a time with me here.
https://tidycal.com/m5llvq1/strategy-session

Jonathan
SwishDM$b2$),
  (3, 96, 'Last one from me on the report', 'Then I''ll leave you to it',
$b3$Hi {{first_name}},

Last email from me about the {{brand}} report, I don't want to clog up your inbox.

Truth be told, more of your buyers are asking ChatGPT and Gemini what to buy, and those answers only name a handful of brands.

I'd love to help get {{brand}} into that handful. Here's my calendar for a quick call about it.
https://tidycal.com/m5llvq1/strategy-session

And if the timing's not right, no worries at all, just reply and let me know.

Jonathan
SwishDM$b3$)
 ) as e(step, delay_hours, subject, preview, body)
 where s.slug = 'swishdm_ai_search_report'
   and not exists (select 1 from nurture_emails x where x.sequence_id = s.id and x.step = e.step);

-- 4. Enrollment. Pure on its input row (callable with a built record in tests);
--    it only inserts the subscriber + the first queue row and returns the outcome.
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
  v_test boolean := r.is_test;
  v_quals boolean := r.qualifies;
begin
  if coalesce((select value from integration_config where key = 'swishdm_nurture_armed'), 'false') <> 'true' then
    return jsonb_build_object('state', 'not_armed');
  end if;
  -- Generated columns are NULL in a BEFORE trigger's NEW: read the stored ones
  -- (only status moves in the hand-marked update). A row not in the table (a test record) keeps its own.
  if exists (select 1 from swishdm_lm_requests x where x.id = r.id) then
    select x.is_test, x.qualifies into v_test, v_quals from swishdm_lm_requests x where x.id = r.id;
  end if;
  if coalesce(v_test, true) then return jsonb_build_object('state', 'skipped_test'); end if;
  if r.lead_magnet is distinct from 'ai-search-report' or not coalesce(v_quals, false) then
    return jsonb_build_object('state', 'not_qualifying');
  end if;
  if r.report_url is null or nullif(btrim(coalesce(r.report_top_gap, '')), '') is null then
    return jsonb_build_object('state', 'missing_report_fields');
  end if;

  select id into v_seq from nurture_sequences where slug = 'swishdm_ai_search_report';
  if v_seq is null then return jsonb_build_object('state', 'no_sequence'); end if;
  select * into v_step1 from nurture_emails where sequence_id = v_seq and step = 1 and is_active;
  if not found then return jsonb_build_object('state', 'emails_inactive'); end if;

  if exists (select 1 from nurture_subscribers where lower(email) = v_email and unsubscribed_at is not null) then
    return jsonb_build_object('state', 'unsubscribed_before');
  end if;
  select id into v_sub from nurture_subscribers where lower(email) = v_email and sequence_id = v_seq;
  if v_sub is not null then return jsonb_build_object('state', 'already_enrolled', 'subscriber_id', v_sub); end if;

  insert into nurture_subscribers (email, sequence_id, lm_slug, lm_title, first_name, custom_fields, current_step, is_test)
  values (v_email, v_seq, 'ai-search-report', 'AI search report',
          nullif(split_part(btrim(r.name), ' ', 1), ''),
          jsonb_build_object('brand', btrim(r.brand), 'report_url', r.report_url,
                             'top_gap', btrim(r.report_top_gap), 'request_id', r.id),
          0, false)
  returning id into v_sub;

  -- First email lands at the next 14:00 UTC (morning US East, afternoon UK) after the delay.
  v_at := date_trunc('day', now() + make_interval(hours => v_step1.delay_hours)) + interval '14 hours';
  if v_at < now() + make_interval(hours => v_step1.delay_hours) then v_at := v_at + interval '1 day'; end if;

  insert into nurture_queue (subscriber_id, email_id, scheduled_for, status)
  values (v_sub, v_step1.id, v_at, 'pending');

  return jsonb_build_object('state', 'enrolled', 'subscriber_id', v_sub, 'first_send', v_at);
exception when unique_violation then
  return jsonb_build_object('state', 'already_enrolled');
end;
$$;

revoke all on function public.swishdm_report_nurture_enroll(public.swishdm_lm_requests) from public, anon, authenticated;

create or replace function public.swishdm_report_nurture_cancel(p_subscriber uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if p_subscriber is null then return 0; end if;
  update nurture_queue set status = 'cancelled', error_message = left(coalesce(p_reason, 'stopped'), 200)
   where subscriber_id = p_subscriber and status = 'pending';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.swishdm_report_nurture_cancel(uuid, text) from public, anon, authenticated;

-- 5. The hook: BEFORE UPDATE OF status, so the outcome lands on the same row.
create or replace function public.swishdm_report_nurture_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.report_sent_at := coalesce(new.report_sent_at, now());
    begin
      v := public.swishdm_report_nurture_enroll(new);
    exception when others then
      v := jsonb_build_object('state', 'error: ' || left(sqlerrm, 120));
    end;
    new.nurture_state := v->>'state';
    if v ? 'subscriber_id' then new.nurture_subscriber_id := (v->>'subscriber_id')::uuid; end if;
  elsif old.status = 'sent' and new.status is distinct from 'sent' and new.nurture_subscriber_id is not null then
    perform public.swishdm_report_nurture_cancel(new.nurture_subscriber_id, 'request moved off sent');
    new.nurture_state := 'stopped';
  end if;
  return new;
end;
$$;

revoke all on function public.swishdm_report_nurture_on_status() from public, anon, authenticated;

drop trigger if exists swishdm_report_nurture_on_status on public.swishdm_lm_requests;
create trigger swishdm_report_nurture_on_status
  before update of status on public.swishdm_lm_requests
  for each row
  when (new.lead_magnet = 'ai-search-report' and new.status is distinct from old.status)
  execute function public.swishdm_report_nurture_on_status();

-- 6. Manual stop (a reply, a booked call, Jonathan says stop).
create or replace function public.swishdm_report_nurture_stop(p_request_id uuid, p_reason text default 'stopped by hand')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_sub uuid; n integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  select nurture_subscriber_id into v_sub from swishdm_lm_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  n := public.swishdm_report_nurture_cancel(v_sub, p_reason);
  update swishdm_lm_requests set nurture_state = 'stopped' where id = p_request_id and v_sub is not null;
  return jsonb_build_object('ok', true, 'cancelled', n, 'subscriber_id', v_sub);
end;
$$;

revoke all on function public.swishdm_report_nurture_stop(uuid, text) from public, anon, authenticated;
grant execute on function public.swishdm_report_nurture_stop(uuid, text) to service_role;

commit;
