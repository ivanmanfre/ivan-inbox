-- Rollback for db/301: restores the 11-07 pre-change functions and seat settings exactly.
-- Run the n8n rollback first (Weekly Pull snapshot), or the fresh path will call a missing function.

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
      and op.posted_at >= now() - make_interval(days => coalesce((s.oc->>'max_post_age_days')::int, 4))
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

CREATE OR REPLACE FUNCTION public.owner_comment_reserve_run(p_seat text, p_purpose text, p_actor text, p_want numeric, p_min numeric, p_slot_days integer)
 RETURNS TABLE(reservation_id text, cap numeric, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_month numeric; v_mtd numeric; v_cap numeric; v_id text;
begin
  perform pg_advisory_xact_lock(hashtext('owner_comment_apify:' || p_seat));
  select (settings->'owner_comment'->>'apify_month_cap_usd')::numeric into v_month
    from outreach_seats where seat = p_seat and active;
  if v_month is null or v_month <= 0 then return query select null::text, null::numeric, 'no_month_cap'; return; end if;
  if p_slot_days > 0 and exists (select 1 from owner_comment_apify_ledger
       where seat = p_seat and purpose = p_purpose and started_at >= now() - make_interval(days => p_slot_days)) then
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

revoke all on function public.owner_comment_reserve_run(text,text,text,numeric,numeric,integer) from public, anon, authenticated;
grant execute on function public.owner_comment_reserve_run(text,text,text,numeric,numeric,integer) to service_role;
drop function if exists public.owner_comment_fresh_targets(text);
drop function if exists public.owner_comment_reserve_run_h(text,text,text,numeric,numeric,numeric);

update outreach_seats
   set settings = jsonb_set(settings, '{owner_comment}',
         ((settings->'owner_comment') - 'draft_max_post_age_hours' - 'fresh_pull_enabled' - 'fresh_pull_window_days'
           - 'fresh_pull_max_profiles' - 'fresh_run_cap_usd') || jsonb_build_object('apify_month_cap_usd', 5))
 where seat = 'risedtc' and settings ? 'owner_comment';

-- fresh_pull rows keep their cost in the month-to-date sum as build_test (never posts_pull: that would hold the weekly slot).
update public.owner_comment_apify_ledger set purpose = 'build_test', note = coalesce(note || '; ', '') || 'was fresh_pull (db/301 rollback)' where purpose = 'fresh_pull';
alter table public.owner_comment_apify_ledger drop constraint owner_comment_apify_ledger_purpose_check;
alter table public.owner_comment_apify_ledger add constraint owner_comment_apify_ledger_purpose_check
  check (purpose = any (array['posts_pull','reply_check','voice_sample','build_test']));
