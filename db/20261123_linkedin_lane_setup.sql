begin;

-- Anna uses this predicate during intake, claim and final invitation preparation.
-- Patch the existing guard in place, retaining its identity, grants and exclusion rules.
do $$
declare
  previous text := pg_get_functiondef('public.anna_candidate_ok(uuid)'::regprocedure);
  old_rule text := $old$or coalesce(p.icp_score,0)<6 or (case when p.scorer_version ~ '^[0-9]+$' then p.scorer_version::integer else 0 end)<18$old$;
  current_rule text := $new$or coalesce(p.icp_score,0)<7 or p.scorer_version is null
 or p.scorer_version is distinct from (select version::text from content_prompts where slug='icp-outreach-scoring')$new$;
begin
  if strpos(previous,old_rule)=0 then raise exception 'Review the current Anna qualification guard before applying'; end if;
  execute replace(previous,old_rule,current_rule);
end;
$$;

create table public.outreach_linkedin_lane_setup (
  lane_key text primary key,
  provider_account_id text not null unique,
  display_name text not null,
  provider_verified_at timestamptz not null,
  week_caps integer[] not null check (cardinality(week_caps) = 4 and array_position(week_caps,null) is null and 0 < all(week_caps))
);
alter table public.outreach_linkedin_lane_setup enable row level security;
revoke all on table public.outreach_linkedin_lane_setup from public, anon, authenticated;
grant select,insert,update,delete on table public.outreach_linkedin_lane_setup to service_role;

create function public.inbox_linkedin_lane_overview() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  anna jsonb;
  activity jsonb;
  queued integer;
  setups jsonb;
begin
  perform public.anna_assert_operator();
  anna := public.anna_lane_status();
  select count(*) into queued
  from public.anna_invites i join public.outreach_prospects p on i.prospect_id = p.id
  join public.anna_lane_state s on s.campaign_id = p.campaign_id
  where i.status = 'queued'
    and (i.warm_expires_at is null or i.warm_expires_at > now())
    and public.anna_candidate_ok(p.id);
  -- Intake and exclusions are queue decisions. This list shows actual invitation activity.
  select coalesce(jsonb_agg(event order by event.sort_at desc, event.id),'[]'::jsonb)
  into activity from (
    select p.id, p.name, p.company, p.linkedin_url, i.status, i.invited_at, i.accepted_at,
      i.last_reply_at, i.error, greatest(i.invited_at,i.accepted_at,i.last_reply_at,i.attempted_at) as sort_at
    from public.anna_invites i join public.outreach_prospects p on p.id=i.prospect_id
    where i.invited_at is not null or i.attempted_at is not null
    order by sort_at desc, p.id limit 100
  ) event;
  select coalesce(jsonb_agg(jsonb_build_object('key', lane_key, 'name', display_name,
    'verified_at', provider_verified_at, 'week_caps', week_caps) order by display_name), '[]'::jsonb)
  into setups from public.outreach_linkedin_lane_setup;
  return anna || jsonb_build_object('qualified_queued', queued, 'queued', queued, 'events', activity, 'setups', setups);
end;
$$;
revoke all on function public.inbox_linkedin_lane_overview() from public,anon;
grant execute on function public.inbox_linkedin_lane_overview() to authenticated;
notify pgrst, 'reload schema';
commit;
