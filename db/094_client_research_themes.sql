-- 094: client_research_themes. What repeats in a market, reasoned and stored.
--
-- (Written as 092 in the brief; 092 and 093 were taken on main before this landed, so it ships
-- as 094.)
--
-- The readout used to build its "repeated themes" by counting token pairs, and it counted them
-- over OUR OWN judge text -- the `suggested_angle` strings the angle judge wrote -- so the page
-- reported our vocabulary back to the client as their market's themes. A theme has to be a
-- reasoned reading of what the posts say, made once, stored, and traceable to the posts it came
-- from. That is this table.
--
-- The key is (client_id, run_id, theme): a theme belongs to the run that reasoned it, so an
-- earlier run's reading is never silently overwritten and the readout can take the newest run and
-- leave the history intact.
--
-- post_refs holds linkedin_post_url values from the lane's own post table. It is the whole point
-- of the row: the readout RECOMPUTES posts, authors and median comments from these refs against
-- the post table rather than storing counts here, so every number on the page traces to SQL and
-- no count can drift from the posts behind it. A theme renders only with 2 or more authors and
-- 3 or more posts.
--
-- `theme` is OUR wording for what the posts have in common, not a phrase lifted from them, and
-- the page says so in those words.
--
-- Tenancy: client_id is the first half of the key, so every read is lane-scoped by construction.
-- Nothing reads this table but the launcher that writes it and the readout.

create table if not exists public.client_research_themes (
  client_id   text        not null,
  run_id      text        not null,
  theme       text        not null,
  post_refs   text[]      not null,
  created_at  timestamptz not null default now(),
  constraint client_research_themes_pkey primary key (client_id, run_id, theme),
  -- A theme with no posts under it is not a theme. The 2-author / 3-post floor is applied by
  -- the writer and again by the reader; this only refuses the degenerate case outright.
  constraint client_research_themes_refs_nonempty check (cardinality(post_refs) > 0),
  constraint client_research_themes_theme_nonempty check (btrim(theme) <> '')
);

create index if not exists client_research_themes_client_created_idx
  on public.client_research_themes (client_id, created_at desc);

alter table public.client_research_themes enable row level security;
revoke all on public.client_research_themes from public, anon, authenticated;
grant select, insert, update, delete on public.client_research_themes to service_role;

-- Same closure on the run ledger. 090 granted `select` to authenticated, which on a table with
-- RLS and no policy returns nothing -- but the grant also carried TRUNCATE and the rest of the
-- default set through PUBLIC, and a grant nobody needs is a grant nobody audits. The launcher
-- and the readout both run as service_role.
revoke all on public.client_research_runs from public, anon, authenticated;
grant select, insert, update, delete on public.client_research_runs to service_role;
