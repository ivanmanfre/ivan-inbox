-- 082: competitor_post_snapshots. One row per roster post per observation day.
--
-- Why: both weekly harvests upsert with `resolution=merge-duplicates`, so a post's
-- likes/comments/reposts at day 1, day 7 and day 30 overwrite each other and the series
-- is thrown away on every run. This table keeps it. It is written AFTER each harvest's
-- own upsert; neither upsert is touched.
--
-- post_ref is the post's LinkedIn URL. That is the same string
-- `competitor_gated_posts.post_ref` already carries (the judge selects
-- `linkedin_post_url post_ref` from both roster tables), so the two tables join on
-- post_ref with no mapping:
--   competitor_posts.linkedin_post_url       (Ivan lane, client_id null or 'ivan')
--   audn_competitor_posts.linkedin_post_url  (client lanes, by client_id)
--
-- Tenancy: this table is new and has no legacy reader, so it gets ONE convention.
-- Ivan's rows are client_id = 'ivan' (never null). Client rows carry their own client_id.
-- Nothing is added to a shared table, so no existing reader can see another tenant's rows.
--
-- PK is (client_id, post_ref, observed_on). observed_on CANNOT be a GENERATED column:
-- casting a timestamptz to date is STABLE, not IMMUTABLE (it depends on the TimeZone
-- setting), and Postgres rejects such a generation expression. It is therefore a plain
-- date column held in lockstep with observed_at by a BEFORE INSERT OR UPDATE trigger,
-- so a writer never sends it and cannot desynchronise it from observed_at.

create table if not exists public.competitor_post_snapshots (
  client_id       text        not null,
  post_ref        text        not null,
  observed_at     timestamptz not null default now(),
  observed_on     date        not null default ((now() at time zone 'utc')::date),
  likes           integer,
  comments        integer,
  reposts         integer,
  follower_count  integer,
  source          text        not null,
  primary key (client_id, post_ref, observed_on)
);

create or replace function public.competitor_post_snapshots_observed_on()
returns trigger
language plpgsql
as $fn$
begin
  new.observed_on := (new.observed_at at time zone 'utc')::date;
  return new;
end;
$fn$;

drop trigger if exists competitor_post_snapshots_observed_on_trg on public.competitor_post_snapshots;
create trigger competitor_post_snapshots_observed_on_trg
  before insert or update on public.competitor_post_snapshots
  for each row execute function public.competitor_post_snapshots_observed_on();

alter table public.competitor_post_snapshots enable row level security;
revoke all on public.competitor_post_snapshots from anon, authenticated, public;
grant select, insert, update on public.competitor_post_snapshots to service_role;

drop policy if exists service_role_all on public.competitor_post_snapshots;
create policy service_role_all on public.competitor_post_snapshots
  for all to service_role using (true) with check (true);

-- Read paths: a lane's series for a day, and one post's series over time.
create index if not exists competitor_post_snapshots_lane_day_idx
  on public.competitor_post_snapshots (client_id, observed_on desc);
create index if not exists competitor_post_snapshots_ref_idx
  on public.competitor_post_snapshots (post_ref, observed_on);

-- ---------------------------------------------------------------------------
-- Backfill: one row per existing non-killed post from today's values, so every
-- series has a first point. follower_count stays null here; it is not a roster
-- column and is not inferred.
--
-- Runs ONCE, at the table's birth, and only while the table is empty. Re-applying
-- this file on a later day must not stamp a second 'backfill-082' observation day:
-- that would be indistinguishable from a real harvest reading and would destroy
-- `source` as provenance. The guard is emptiness, not mtime and not the row count
-- of one lane, so a partially harvested table is never re-backfilled either. The
-- `on conflict do nothing` below stays as a second line of defence.
-- ---------------------------------------------------------------------------
do $backfill$
begin
  if exists (select 1 from public.competitor_post_snapshots) then
    raise notice 'competitor_post_snapshots already holds rows; backfill skipped';
    return;
  end if;

  insert into public.competitor_post_snapshots
    (client_id, post_ref, observed_at, likes, comments, reposts, follower_count, source)
  select 'ivan', p.linkedin_post_url, now(),
         p.likes_count, p.comments_count, p.reposts_count, null, 'backfill-082'
  from public.competitor_posts p
  where coalesce(p.competitor_role, '') <> 'killed'
    and p.linkedin_post_url is not null
    and (p.client_id is null or p.client_id = 'ivan')
  on conflict (client_id, post_ref, observed_on) do nothing;

  insert into public.competitor_post_snapshots
    (client_id, post_ref, observed_at, likes, comments, reposts, follower_count, source)
  select a.client_id, a.linkedin_post_url, now(),
         a.likes_count, a.comments_count, a.reposts_count, null, 'backfill-082'
  from public.audn_competitor_posts a
  where coalesce(a.competitor_role, '') <> 'killed'
    and a.linkedin_post_url is not null
  on conflict (client_id, post_ref, observed_on) do nothing;
end
$backfill$;
