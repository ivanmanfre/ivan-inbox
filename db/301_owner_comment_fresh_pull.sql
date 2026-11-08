-- db/301: RISE owner comment lane gets fresh posts (2026-11-07)
--
-- Why: the lane pulled posts once a week (Mon), so every card was born on a post 37-94 h old and
-- the inbox hides any comment idea whose post is older than 24 h. 0 of 10 cards were ever visible.
-- A probe on 11-07 showed the 65 owners who posted in the last 28 days wrote 66 posts in 5 days
-- (9-16 per weekday), so a daily 24 h pull over recent posters gives fresh supply.
--
-- 1. owner_comment_reserve_run_h: the same budget reservation, slot measured in hours (a daily pull
--    needs a ~20 h slot). The day version now delegates, so there is one copy of the logic.
-- 2. owner_comment_fresh_targets: pool members who posted in the last N days, minus members whose
--    every judged post failed the fit judge on an owner-level kind (not an owner, employee, vendor,
--    service provider, F&B, unclear owner). Newest poster first, capped.
-- 3. owner_comment_candidates: drafting window in hours (draft_max_post_age_hours, 20).
-- 4. Seat settings: draft window 20 h, fresh pull keys, month cap $5 -> $8 (Ivan 11-02: "$20 is fine
--    but $60 no"; weekly sweep ~$3.5/mo + daily fresh ~$2/mo).
-- Rollback: db/301_owner_comment_fresh_pull_rollback.sql

-- The ledger allows a fixed purpose list; the daily pull is its own purpose so slots stay separate.
alter table public.owner_comment_apify_ledger drop constraint owner_comment_apify_ledger_purpose_check;
alter table public.owner_comment_apify_ledger add constraint owner_comment_apify_ledger_purpose_check
  check (purpose = any (array['posts_pull','reply_check','voice_sample','build_test','fresh_pull']));

create or replace function public.owner_comment_reserve_run_h(p_seat text, p_purpose text, p_actor text,
  p_want numeric, p_min numeric, p_slot_hours numeric)
 returns table(reservation_id text, cap numeric, reason text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_month numeric; v_mtd numeric; v_cap numeric; v_id text;
begin
  perform pg_advisory_xact_lock(hashtext('owner_comment_apify:' || p_seat));
  select (settings->'owner_comment'->>'apify_month_cap_usd')::numeric into v_month
    from outreach_seats where seat = p_seat and active;
  if v_month is null or v_month <= 0 then return query select null::text, null::numeric, 'no_month_cap'; return; end if;
  if p_slot_hours > 0 and exists (select 1 from owner_comment_apify_ledger
       where seat = p_seat and purpose = p_purpose and started_at >= now() - make_interval(secs => p_slot_hours * 3600)) then
    return query select null::text, null::numeric, 'already_ran_in_slot'; return;
  end if;
  v_mtd := owner_comment_apify_mtd(p_seat);
  v_cap := floor(least(p_want, v_month - v_mtd) * 100) / 100;
  if v_cap < p_min or v_mtd + v_cap > v_month then
    return query select null::text, null::numeric, 'month_cap_reached'; return;
  end if;
  v_id := 'pending:' || gen_random_uuid()::text;
  insert into owner_comment_apify_ledger (run_id, seat, purpose, actor, max_charge_usd, status)
    values (v_id, p_seat, p_purpose, p_actor, v_cap, 'RESERVED');
  return query select v_id, v_cap, null::text;
end $function$;

create or replace function public.owner_comment_reserve_run(p_seat text, p_purpose text, p_actor text,
  p_want numeric, p_min numeric, p_slot_days integer)
 returns table(reservation_id text, cap numeric, reason text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select * from owner_comment_reserve_run_h(p_seat, p_purpose, p_actor, p_want, p_min, greatest(p_slot_days, 0) * 24);
$function$;

create or replace function public.owner_comment_fresh_targets(p_seat text)
 returns table(prospect_id uuid, linkedin_url text, last_posted_at timestamptz)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with s as (select settings->'owner_comment' oc from outreach_seats where seat = p_seat and active),
  m as (
    select op.prospect_id, max(op.posted_at) last_posted_at,
           bool_and(op.fit_verdict = 'fail' and op.fit_kind in
             ('not_owner','employee','vendor_or_competitor','service_provider','fnb','unclear_owner')) owner_rejected
    from owner_comment_posts op cross join s
    where op.seat = p_seat and op.prospect_id is not null
      and op.posted_at >= now() - make_interval(days => coalesce((s.oc->>'fresh_pull_window_days')::int, 28))
    group by op.prospect_id
  )
  select pl.prospect_id, pl.linkedin_url, m.last_posted_at
  from m join owner_comment_pool(p_seat) pl on pl.prospect_id = m.prospect_id
  cross join s
  where m.owner_rejected is not true and pl.linkedin_url ~* 'linkedin\.com/in/'
  order by m.last_posted_at desc
  limit greatest(0, least(300, coalesce((select (oc->>'fresh_pull_max_profiles')::int from s), 150)));
$function$;

CREATE OR REPLACE FUNCTION public.owner_comment_candidates(p_seat text, p_limit integer)
 RETURNS TABLE(post_id uuid, prospect_id uuid, owner_name text, owner_headline text, owner_company text, owner_provider_id text, owner_public_id text, owner_linkedin_url text, bucket text, post_social_id text, post_url text, post_text text, posted_at timestamp with time zone, stage text, connected boolean, dm_state text, pick_rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (select settings->'owner_comment' oc from outreach_seats where seat = p_seat and active),
  pool as (select * from owner_comment_pool(p_seat)),
  fresh as (
    select op.*, pl.stage, pl.connected_at, pl.connection_sent_at, pl.last_dm_sent_at, pl.dm_count
    from owner_comment_posts op
    join pool pl on pl.prospect_id = op.prospect_id
    cross join s
    where op.seat = p_seat and not op.used and op.fit_verdict is distinct from 'fail'
      -- 2026-11-07 (db/301): drafting window in hours. The inbox hides an outbound idea once its post is 24 h old,
      -- so a card must be born well inside that. Falls back to the lane window when the key is absent.
      and op.posted_at >= now() - make_interval(secs => 3600 * coalesce((s.oc->>'draft_max_post_age_hours')::numeric,
                                                             24 * coalesce((s.oc->>'max_post_age_days')::numeric, 4)))
      and op.posted_at <= now()
      and not exists (select 1 from owner_comment_feed f where f.seat = p_seat and f.post_social_id = op.post_social_id)
      and not exists (select 1 from owner_comment_feed f where f.seat = p_seat and f.prospect_id = op.prospect_id
                        and (f.created_at >= now() - interval '7 days'
                             or f.status in ('pending','approved','posting')
                             or coalesce(f.posting_started_at, f.posted_at) >= now() - interval '7 days'))
      and (pl.last_dm_sent_at is null
           or pl.last_dm_sent_at <= now() - make_interval(hours => coalesce((s.oc->>'dm_gap_hours')::int, 72)))
  ),
  one_per_owner as (
    select distinct on (prospect_id) * from fresh order by prospect_id, posted_at desc
  )
  select post_id_, prospect_id, owner_name, owner_headline, owner_company, owner_provider_id, owner_public_id,
         owner_linkedin_url, bucket, post_social_id, post_url, post_text, posted_at, stage,
         connected_at is not null,
         case when stage = 'comment_only' then 'comment_only'
              when coalesce(dm_count,0) > 0 then 'dm_unanswered:' || dm_count || ' sent, last ' || to_char(last_dm_sent_at, 'YYYY-MM-DD')
              when connected_at is not null then 'connected_no_dm'
              when connection_sent_at is not null then 'invite_pending'
              else 'not_contacted' end,
         (row_number() over (order by
            case when connected_at is not null and coalesce(dm_count,0) = 0 then 0
                 when connected_at is not null then 1
                 -- 2026-11-03: comment-only money founders rank with pending invites, ahead of other not-contacted owners
                 when connection_sent_at is not null or stage = 'comment_only' then 2 else 3 end,
            posted_at desc))::int
  from (select o.*, o.id as post_id_ from one_per_owner o) z
  order by 17
  limit p_limit;
$function$;

revoke all on function public.owner_comment_reserve_run_h(text,text,text,numeric,numeric,numeric) from public, anon, authenticated;
revoke all on function public.owner_comment_reserve_run(text,text,text,numeric,numeric,integer) from public, anon, authenticated;
revoke all on function public.owner_comment_fresh_targets(text) from public, anon, authenticated;
revoke all on function public.owner_comment_candidates(text,integer) from public, anon, authenticated;
grant execute on function public.owner_comment_reserve_run_h(text,text,text,numeric,numeric,numeric) to service_role;
grant execute on function public.owner_comment_reserve_run(text,text,text,numeric,numeric,integer) to service_role;
grant execute on function public.owner_comment_fresh_targets(text) to service_role;
grant execute on function public.owner_comment_candidates(text,integer) to service_role;

update outreach_seats
   set settings = jsonb_set(settings, '{owner_comment}', (settings->'owner_comment') || jsonb_build_object(
         'draft_max_post_age_hours', 20,
         'fresh_pull_enabled', true,
         'fresh_pull_window_days', 28,
         'fresh_pull_max_profiles', 150,
         'fresh_run_cap_usd', 0.3,
         'apify_month_cap_usd', 8))
 where seat = 'risedtc' and settings ? 'owner_comment';
