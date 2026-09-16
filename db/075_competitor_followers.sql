-- 075: competitor_followers — per-lane roster follower counts (lead-magnet-analytics-2026-09-16 phase 1a)
create table if not exists public.competitor_followers (
  client_id text not null,
  competitor_name text,
  linkedin_profile_url text not null,
  follower_count integer,
  observed_at timestamptz not null default now(),
  source text not null,          -- 'harvest_payload' | 'unipile_seat' | 'roster_field' | 'none'
  primary key (client_id, linkedin_profile_url)
);
alter table public.competitor_followers enable row level security;
revoke all on public.competitor_followers from anon, public;
grant select on public.competitor_followers to authenticated, service_role;
grant insert, update on public.competitor_followers to service_role;
