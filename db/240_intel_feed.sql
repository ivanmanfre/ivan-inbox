-- Intel feed (2026-10-30). Ivan: "a focused view like YouTube subscriptions, but only
-- hyper-relevant assessed stuff from specific channels and newly explored ones".
-- Writer: ~/.claude/intel-feed/run.py (local launchd; yt-dlp is bot-blocked from cloud IPs).
-- Reader: the inbox Intel place (src/d/intel). Ivan's Useful / Noise taps and Mute go back
-- into the judge prompt and the source list.

create table if not exists public.intel_sources (
  id text primary key,                         -- 'yt:<channel_id>' | 'rss:<feed url>'
  kind text not null check (kind in ('youtube', 'podcast')),
  name text not null,
  url text not null,                           -- channel or feed url, for the Sources list
  feed_url text not null,                      -- what the job polls
  topic text,                                  -- outreach | agency | ai | linkedin (display only)
  status text not null default 'core' check (status in ('core', 'trial', 'muted', 'dropped')),
  added_by text not null default 'ivan' check (added_by in ('ivan', 'discovery')),
  note text,                                   -- why it is on the list, or why it was dropped
  items_judged int not null default 0,
  items_kept int not null default 0,
  last_item_at timestamptz,
  last_kept_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intel_items (
  id uuid primary key default gen_random_uuid(),
  source_id text references public.intel_sources(id) on delete set null,
  source_name text not null,
  external_id text not null unique,            -- 'yt:<video_id>' | 'rss:<guid>'
  url text not null,
  title text not null,
  published_at timestamptz,
  duration_sec int,
  found_via text not null default 'source' check (found_via in ('source', 'discovery')),
  verdict text not null check (verdict in ('keep', 'drop')),
  score int not null default 0,                -- 0-100, judge's confidence it is new + usable for us
  headline text,                               -- one plain line: the idea
  what_new text,                               -- 2-3 sentences: what it adds over what we run
  applies_to text,                             -- lane or system part, e.g. 'RISE DM6', 'ARCH invites', 'pricing'
  try_this text,                               -- the smallest test we could run
  watch_from_sec int,                          -- where the useful part starts
  quote text,                                  -- one verbatim transcript line
  drop_reason text,                            -- for verdict = drop
  ivan_verdict text check (ivan_verdict in ('useful', 'noise')),
  ivan_verdict_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists intel_items_feed_idx on public.intel_items (verdict, published_at desc);

alter table public.intel_sources enable row level security;
alter table public.intel_items enable row level security;

drop policy if exists intel_sources_service on public.intel_sources;
create policy intel_sources_service on public.intel_sources for all to service_role using (true) with check (true);
drop policy if exists intel_sources_auth_select on public.intel_sources;
create policy intel_sources_auth_select on public.intel_sources for select to authenticated using (true);
drop policy if exists intel_sources_auth_update on public.intel_sources;
create policy intel_sources_auth_update on public.intel_sources for update to authenticated using (true) with check (true);

drop policy if exists intel_items_service on public.intel_items;
create policy intel_items_service on public.intel_items for all to service_role using (true) with check (true);
drop policy if exists intel_items_auth_select on public.intel_items;
create policy intel_items_auth_select on public.intel_items for select to authenticated using (true);
drop policy if exists intel_items_auth_update on public.intel_items;
create policy intel_items_auth_update on public.intel_items for update to authenticated using (true) with check (true);

grant select, update on public.intel_sources, public.intel_items to authenticated;
grant all on public.intel_sources, public.intel_items to service_role;
