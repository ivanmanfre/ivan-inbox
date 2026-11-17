-- Content plan, calendar panel read (Run C). NOT applied by the run: apply after
-- the PR merges (the arm step), then reload the app.
--
-- One read for Ivan's Plan tab: belief and vehicle per slot for this Warsaw
-- week and the next 3, the weekly quotas, how full each week is by belief and
-- vehicle, the profile-first score, profile views by contacted people in 48 h per
-- post, cohort rates of every period (grouped by filter_key in the app; rates compare
-- only within one filter_key), and the newest "what made you book" quotes.
--
-- Read only. Same operator check as inbox_lane_adjustment_cohorts. A slot with
-- no belief and no belief on its placed draft returns null, never a guess.
-- Outlier copies are listed as extras (is_copy) and never counted in the fill.
--
-- Needs: content_plan_quotas, content_plan_slots.belief/vehicle,
-- cp17_profile_first_ivan(), cp17_post_profile_views_ivan,
-- cp17_top_of_feed_cohorts_ivan, cp17_booking_reasons, and the flag
-- integration_config.cp17c_belief_quota_enforce (all created by Run C).
-- Rollback: 20261117r_cp17_calendar_panel_rollback.sql
begin;

create or replace function public.cp17_calendar_panel_ivan()
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  as_of timestamptz := statement_timestamp();
  this_monday date;
  v_slots jsonb;
  v_quotas jsonb;
  v_fill jsonb;
  v_pv jsonb;
  v_key text;
  v_coh jsonb;
  v_book jsonb;
  v_enf text;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id = 'ivan' and auth.uid() = any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode = '42501'; end if;

  this_monday := date_trunc('week', (as_of at time zone 'Europe/Warsaw'))::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_id', x.id, 'week_start', x.week_start, 'draft_id', x.placed_draft_id,
    'belief', x.belief, 'vehicle', x.vehicle, 'is_copy', coalesce(x.is_copy, false)
  ) order by x.week_start, x.id), '[]'::jsonb) into v_slots
  from (
    select s.id, s.week_start, s.placed_draft_id,
      coalesce(s.belief,
        case when d.taxonomy->>'belief' ~ '^[1-5]$' then (d.taxonomy->>'belief')::smallint end) belief,
      coalesce(nullif(btrim(s.vehicle), ''), nullif(btrim(d.taxonomy->>'vehicle'), '')) vehicle,
      (coalesce(d.taxonomy->>'outlier_copy', '') = 'true'
        or coalesce(d.taxonomy->>'source', '') in ('linkedin_outlier_copy', 'x_tracked_outlier')
        or coalesce(d.taxonomy->>'source_ref', '') like 'outlier:%') is_copy
    from public.content_plan_slots s
    left join public.carousel_drafts d on d.id = s.placed_draft_id
    where s.account = 'ivan' and s.status <> 'dropped'
      and s.week_start >= this_monday and s.week_start < this_monday + 28
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_kind', q.slot_kind, 'belief', q.belief, 'vehicle', q.vehicle,
    'per_week', q.per_week, 'every_n_weeks', q.every_n_weeks, 'note', q.note
  ) order by q.id), '[]'::jsonb) into v_quotas
  from public.content_plan_quotas q where q.account = 'ivan';

  with t as (
    select r.week_start, r.belief, r.vehicle, r.is_copy
    from jsonb_to_recordset(v_slots) as r(week_start date, belief smallint, vehicle text, is_copy boolean)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'week_start', w.d,
    'slots', (select count(*) from t where t.week_start = w.d and not t.is_copy),
    'copies', (select count(*) from t where t.week_start = w.d and t.is_copy),
    'no_belief', (select count(*) from t where t.week_start = w.d and not t.is_copy and t.belief is null),
    'by_belief', coalesce((select jsonb_object_agg(x.belief::text, x.n) from (
        select t.belief, count(*) n from t
        where t.week_start = w.d and not t.is_copy and t.belief is not null group by t.belief) x), '{}'::jsonb),
    'by_vehicle', coalesce((select jsonb_object_agg(x.vehicle, x.n) from (
        select t.vehicle, count(*) n from t
        where t.week_start = w.d and not t.is_copy and t.vehicle is not null group by t.vehicle) x), '{}'::jsonb)
  ) order by w.d), '[]'::jsonb) into v_fill
  from (select (this_monday + 7 * g.n) d from generate_series(0, 3) g(n)) w;

  select coalesce(jsonb_agg(jsonb_build_object(
    'posted_at', p.posted_at, 'first_line', p.first_line, 'kind', p.kind,
    'contacted_viewers_48h', p.contacted_viewers_48h,
    'contacted_fit_viewers_48h', p.contacted_fit_viewers_48h,
    'contacted_fit_known_48h', p.contacted_fit_known_48h,
    'baseline_per_48h', p.baseline_per_48h, 'window_open', p.window_open
  ) order by p.posted_at desc), '[]'::jsonb) into v_pv
  from (select * from public.cp17_post_profile_views_ivan x
        where not coalesce(x.deleted, false) order by x.posted_at desc limit 10) p;

  select string_agg(distinct c.filter_key, '; ') into v_key
  from public.cp17_top_of_feed_cohorts_ivan c;

  select coalesce(jsonb_agg(jsonb_build_object(
    'filter_key', c.filter_key, 'campaign_name', c.campaign_name,
    'period_from', c.period_from, 'period_to', c.period_to,
    'top_post_kind', c.top_post_kind, 'top_belief', c.top_belief, 'top_vehicle', c.top_vehicle,
    'invites', c.invites, 'accept_base', c.accept_base, 'accepts', c.accepts,
    'reply_base', c.reply_base, 'replies', c.replies,
    'booking_base', c.booking_base, 'bookings', c.bookings,
    'accept_rate', c.accept_rate, 'reply_rate', c.reply_rate, 'booking_rate', c.booking_rate,
    'scorer_version', to_jsonb(c)->'scorer_version', 'note_arm', to_jsonb(c)->'note_arm',
    'small_n', c.small_n,
    'reply_small_n', to_jsonb(c)->'reply_small_n',
    'booking_small_n', to_jsonb(c)->'booking_small_n'
  ) order by c.filter_key, c.top_post_kind, c.top_belief, c.top_vehicle), '[]'::jsonb) into v_coh
  from public.cp17_top_of_feed_cohorts_ivan c;

  select coalesce(jsonb_agg(jsonb_build_object(
    'call_date', b.call_date, 'reason_class', b.reason_class, 'quote', b.quote
  ) order by b.call_date desc), '[]'::jsonb) into v_book
  from (select * from public.cp17_booking_reasons r
        where coalesce(btrim(r.quote), '') <> '' order by r.call_date desc limit 12) b;

  select c.value into v_enf from public.integration_config c where c.key = 'cp17c_belief_quota_enforce';

  return jsonb_build_object(
    'ok', true, 'as_of', as_of, 'this_week', this_monday,
    'slots', v_slots, 'quotas', v_quotas, 'week_fill', v_fill,
    'profile_first', public.cp17_profile_first_ivan(),
    'pv48', v_pv,
    'cohorts', jsonb_build_object('filter_key', v_key, 'rows', v_coh,
      'note', 'Compare rates only inside one group.'),
    'booking_reasons', v_book,
    'enforce', v_enf
  );
end;
$$;

comment on function public.cp17_calendar_panel_ivan() is
  'Run C: one read for the Plan tab calendar panel (slot belief/vehicle, quotas, week fill, profile-first, 48 h views, newest-period cohorts, booking reasons). Operator or service role only. Read only.';

revoke all on function public.cp17_calendar_panel_ivan() from public, anon;
grant execute on function public.cp17_calendar_panel_ivan() to authenticated, service_role;

commit;
