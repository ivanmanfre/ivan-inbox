-- db/052 — sales_packs: the per-call reading material the Sales section shows.
-- Goal run inbox-sales-section-2026-09-06, phase 1. NEW OBJECTS ONLY: one
-- table, one index, one trigger + its function, RLS, grants, one publication
-- membership. Touches no existing table, view, policy or function.
--
-- Apply via the Management API (POST /v1/projects/<ref>/database/query with a
-- User-Agent header; Cloudflare 403s code 1010 without one). Never re-paste
-- older migrations.
--
-- Why a table and not files in this repo: this repo is PUBLIC. Every body here
-- is a dossier written for one call — the card, the sheet, the audit, the
-- ideas, the source JSON. They can live behind auth or they can live in git,
-- and only one of those is a place a customer's name belongs. Storage plus
-- signed URLs was the other candidate and was dropped: it is a second auth path
-- for text that fits in a column (largest body today ~52 KB).
--
-- Read model for the browser  = select on the user's own rows (realtime rides
--                               the same policy).
-- Write model for the browser = NONE. Every row is written by the Mac-side
--                               publisher (scripts/sales-pack-publish.py) with
--                               the service key, from files on the Mac. A
--                               browser that could write here could rewrite the
--                               words in front of him on a live call.

-- ---------------------------------------------------------------------------
-- one row per (prospect, document)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_packs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  -- the file-and-folder slug the Mac already uses for this call's material
  prospect_slug  text not null,
  kind           text not null check (kind in
                   ('card','call_sheet','audience_audit','asset_ideas','prospect','extra')),
  title          text not null,
  body           text not null,
  mime           text not null check (mime in
                   ('text/html','text/markdown','application/json')),
  -- where the body came from on the Mac, and that file's mtime: together they
  -- are the idempotence key the publisher checks before it rewrites a row.
  source_path    text,
  source_mtime   timestamptz,
  -- parsed from the prospect JSON's `when` prose; null when it carries no time.
  call_at        timestamptz,
  -- {"name","company","domain","when","bytes"} — the list row's subtitle, so
  -- the surface never has to parse a dossier to draw a heading.
  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (prospect_slug, kind)
);

-- The list's read: this week's packs in call order.
create index if not exists sales_packs_user_call
  on public.sales_packs (user_id, call_at);

-- ---------------------------------------------------------------------------
-- updated_at, so a republish from the Mac is visible as motion in the pane even
-- when the body is the only column that moved. Named after the table rather
-- than a generic set_updated_at(): this project has no shared one (see 050).
-- ---------------------------------------------------------------------------
create or replace function public.sales_packs_touch() returns trigger
language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists sales_packs_touch on public.sales_packs;
create trigger sales_packs_touch
  before update on public.sales_packs
  for each row execute function public.sales_packs_touch();

-- ---------------------------------------------------------------------------
-- RLS: read your own rows, and nothing else. There is deliberately no insert,
-- update or delete policy for `authenticated` — the publisher is service role.
-- ---------------------------------------------------------------------------
alter table public.sales_packs enable row level security;

drop policy if exists sales_packs_owner_read on public.sales_packs;
create policy sales_packs_owner_read on public.sales_packs
  for select to authenticated using (user_id = auth.uid());

-- Supabase's default privileges hand anon AND authenticated the full grant list
-- on every new table in public. Take both back first, then hand back exactly
-- one verb to one role; the policy above is then the whole surface.
revoke all on public.sales_packs from anon, authenticated;
grant select on public.sales_packs to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime, so a `--publish` on the Mac lands on the phone without a reload.
-- Guarded so a re-run of this file is a no-op instead of "relation is already
-- member of publication". Default replica identity is enough: the pane refetches
-- the row by id on any event, it never diffs an old image.
-- ---------------------------------------------------------------------------
do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'sales_packs'
  ) then
    execute 'alter publication supabase_realtime add table public.sales_packs';
  end if;
end;
$pub$;
