-- Sales > Email: Revenue Line Score sign-ups in Ivan's block. 2026-11-05.
-- Same function as 20261105_email_lists.sql plus one list read from score_runs (counts only; test and own hidden).
-- Rollback: re-apply db/20261105_email_lists.sql (its function body is the version before this one).
CREATE OR REPLACE FUNCTION public.inbox_email_lists()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_since timestamptz := now() - interval '30 days';
  v_seq jsonb;
  v_ivan jsonb := '[]'::jsonb;
  v_rise jsonb := '[]'::jsonb;
  v_swish jsonb := '[]'::jsonb;
  v_arch jsonb := '[]'::jsonb;
  v_armed boolean;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.outreach_agent_accounts a
     where a.client_id = 'ivan' and auth.uid() = any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode = '42501'; end if;

  -- One row per nurture sequence, counted on real subscribers only.
  with subs as (
    select s.id, s.sequence_id, s.created_at, s.unsubscribed_at,
           (s.is_test or public._email_is_own(s.email)) as hidden
      from nurture_subscribers s
  ), q as (
    select b.sequence_id,
           count(*) filter (where q.status = 'sent') as sent,
           count(*) filter (where q.status = 'pending') as pending,
           max(q.sent_at) as last_sent
      from nurture_queue q join subs b on b.id = q.subscriber_id
     where not b.hidden
     group by b.sequence_id
  ), ev as (
    select b.sequence_id, count(*) filter (where e.event_type = 'bounced') as bounced
      from nurture_events e join subs b on b.id = e.subscriber_id
     where not b.hidden
     group by b.sequence_id
  ), agg as (
    select n.id, n.slug, n.name, n.send_config,
           count(b.id) filter (where not b.hidden) as real,
           count(b.id) filter (where b.hidden) as hidden,
           count(b.id) filter (where not b.hidden and b.created_at >= v_since) as last30,
           max(b.created_at) filter (where not b.hidden) as last_at,
           count(b.id) filter (where not b.hidden and b.unsubscribed_at is not null) as unsub,
           (select count(*) from nurture_emails e where e.sequence_id = n.id) as steps,
           (select count(*) from nurture_emails e where e.sequence_id = n.id and e.is_active) as live_steps,
           exists (select 1 from nurture_emails e where e.sequence_id = n.id and e.step = 1 and e.is_active) as step1_active
      from nurture_sequences n left join subs b on b.sequence_id = n.id
     group by n.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', 'seq:' || a.slug,
           'kind', 'nurture',
           'name', a.name,
           'tenant', case
             when a.slug like 'client\_risedtc%' or coalesce(a.send_config->>'from', '') ilike '%@risedtc.com%' then 'rise'
             when a.slug like 'swishdm%' or coalesce(a.send_config->>'from', '') ilike '%swishdm%' then 'swishdm'
             when a.slug like '%arch%' and a.send_config is not null then 'arch'
             else 'ivan' end,
           'real', a.real, 'hidden', a.hidden, 'last30', a.last30, 'last_at', a.last_at,
           'sent', coalesce(q.sent, 0), 'pending', coalesce(q.pending, 0), 'last_sent', q.last_sent,
           'unsub', a.unsub, 'bounced', coalesce(ev.bounced, 0),
           'replies', null, 'calls', null,
           'steps', a.steps, 'live_steps', a.live_steps, 'step1_active', a.step1_active
         ) order by a.real desc, a.last_at desc nulls last, a.slug), '[]'::jsonb)
    into v_seq
    from agg a left join q on q.sequence_id = a.id left join ev on ev.sequence_id = a.id;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_ivan from jsonb_array_elements(v_seq) x where x->>'tenant' = 'ivan';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rise from jsonb_array_elements(v_seq) x where x->>'tenant' = 'rise';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_swish from jsonb_array_elements(v_seq) x where x->>'tenant' = 'swishdm';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_arch from jsonb_array_elements(v_seq) x where x->>'tenant' = 'arch';

  -- Ivan: the profile audit sign-ups (own table, own delivery email).
  v_ivan := jsonb_build_array((
    select jsonb_build_object(
      'key', 'profile_audit', 'kind', 'signup', 'name', 'Profile audit report',
      'real', count(*) filter (where not h), 'hidden', count(*) filter (where h),
      'last30', count(*) filter (where not h and created_at >= v_since),
      'last_at', max(created_at) filter (where not h),
      'sent', count(*) filter (where not h and emailed_at is not null),
      'unsub', count(*) filter (where not h and unsubscribed_at is not null),
      'replies', null, 'calls', null)
      from (select p.*, (coalesce(p.is_test, false) or public._email_is_own(p.email)) h from profile_audit_signups p) s
  )) || v_ivan;

  -- Ivan: Revenue Line Score (inboundonsteroids.com/score, his LinkedIn Featured resource since 2026-10-30).
  -- One row per run in score_runs; real = distinct people, sent = report emails. It has NO follow-up sequence.
  v_ivan := jsonb_build_array((
    select jsonb_build_object(
      'key', 'revenue_line_score', 'kind', 'signup', 'name', 'Revenue Line Score (profile Featured, no follow-up emails)',
      'real', count(distinct lower(btrim(email))) filter (where not h), 'hidden', count(*) filter (where h),
      'last30', count(distinct lower(btrim(email))) filter (where not h and created_at >= v_since),
      'last_at', max(created_at) filter (where not h),
      'sent', count(*) filter (where not h and emailed_at is not null),
      'replies', null, 'calls', null)
      from (select r.email, r.created_at, r.emailed_at, public._email_is_own(r.email) h from score_runs r) s
  )) || v_ivan;

  -- Ivan: the weekly letter broadcasts (one row per issue, recipients = the letter list).
  v_ivan := v_ivan || jsonb_build_array((
    select jsonb_build_object(
      'key', 'letter', 'kind', 'broadcast', 'name', 'Weekly letter (broadcasts)',
      'issues', count(*) filter (where status = 'sent'),
      'last_sent', max(sent_at) filter (where status = 'sent'),
      'last_recipients', (select recipient_count from newsletter_issues where status = 'sent' order by sent_at desc nulls last limit 1),
      'failed', count(*) filter (where status = 'failed'))
      from newsletter_issues
  ));

  -- SwishDM: requests per lead magnet on madebyswishdm.com.
  v_swish := coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', 'swishdm_req:' || lm, 'kind', 'request',
      'name', case lm when 'ai-search-report' then 'AI search report requests'
                      when 'ai-view-guide' then 'AI view guide sign-ups'
                      when 'ai-product-check' then 'AI product check requests' else lm end,
      'real', real, 'hidden', hidden, 'last30', last30, 'last_at', last_at,
      'qualifying', qualifying, 'reports_sent', reports_sent, 'enrolled', enrolled,
      'replies', null, 'calls', null) order by lm)
      from (
        select m.lm,
               count(r.id) filter (where not r.h) real, count(r.id) filter (where r.h) hidden,
               count(r.id) filter (where not r.h and r.created_at >= v_since) last30,
               max(r.created_at) filter (where not r.h) last_at,
               count(r.id) filter (where not r.h and r.qualifies) qualifying,
               count(r.id) filter (where not r.h and r.status = 'sent') reports_sent,
               count(r.id) filter (where not r.h and r.nurture_state = 'enrolled') enrolled
          from (values ('ai-search-report'), ('ai-view-guide'), ('ai-product-check')) m(lm)
          left join (select x.*, (coalesce(x.is_test, false) or public._email_is_own(x.email)) h from swishdm_lm_requests x) r
            on r.lead_magnet = m.lm
         group by m.lm
      ) t
  ), '[]'::jsonb) || v_swish;

  select coalesce((select value from integration_config where key = 'swishdm_nurture_armed'), 'false') = 'true' into v_armed;

  -- ARCH: the newsletter sign-up table (empty so far).
  v_arch := jsonb_build_array((
    select jsonb_build_object(
      'key', 'arch_newsletter', 'kind', 'signup', 'name', 'ARCH newsletter sign-ups',
      'real', count(*) filter (where not public._email_is_own(email)),
      'hidden', count(*) filter (where public._email_is_own(email)),
      'last30', count(*) filter (where not public._email_is_own(email) and created_at >= v_since),
      'last_at', max(created_at) filter (where not public._email_is_own(email)),
      'replies', null, 'calls', null)
      from arch_newsletter_subscriptions
  )) || v_arch;

  return jsonb_build_object(
    'ok', true,
    'at', now(),
    'swishdm_nurture_armed', v_armed,
    'clients', jsonb_build_array(
      jsonb_build_object('client', 'ivan', 'label', 'Ivan', 'lists', v_ivan),
      jsonb_build_object('client', 'swishdm', 'label', 'SwishDM', 'lists', v_swish),
      jsonb_build_object('client', 'rise', 'label', 'RISE (Mattan)', 'lists', v_rise),
      jsonb_build_object('client', 'arch', 'label', 'ARCH (Davorin)', 'lists', v_arch)
    ));
end;
$function$;

revoke all on function public.inbox_email_lists() from public, anon;
grant execute on function public.inbox_email_lists() to authenticated, service_role;
