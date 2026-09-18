-- 099: client_research_insights. What the corpus says, read once and stored.
--
-- The themes table (094) holds one kind of reading: which idea a market keeps returning to.
-- This table holds every other kind. A mining pass reads the lane's own corpus -- the posts, the
-- gate judgments, the follower counts, the outreach outcomes -- and writes one row per section
-- with the number, its base, the posts that carry it, and, only where the base is large enough,
-- the one change it argues for.
--
-- Why a table and not a recomputation: a reading is reasoned, not counted. "Posts that open with
-- a number draw 2.1x the comments" is a judgment about a labelling, made once against a frozen
-- corpus, and re-deriving it on every page load would be both slow and a different answer each
-- time. Storing it keeps the Markets view to one call and keeps the reading auditable: the run
-- that produced it is in the key.
--
-- The key is (client_id, run_id, section). A section is the reading's subject -- 'format',
-- 'hook', 'length', 'ask', 'timing', 'outreach', 'own' and so on -- one row each per run, so a
-- later run's pass never silently overwrites an earlier one and the reader can take the newest
-- run whole. The reader takes exactly one run: a page built from two runs' rows would mix two
-- corpora and two windows.
--
-- `reading` is jsonb rather than columns because the shape differs by section: a format reading
-- carries a table of formats, a timing reading carries hours. Every reading is expected to carry
-- its own `base` (how many posts it stands on) and its own examples; the RPC hands the object
-- through untouched and the view renders what is there. Nothing here is a count the database can
-- verify, so the honesty lives in the writer and in the reviewer's recompute, not in a check
-- constraint that would only give false comfort.
--
-- Tenancy: client_id is the first half of the key, so every read is lane-scoped by construction.
-- RLS on, service role only: the mining pass writes as service_role, and the only reader is
-- operator_market_readout, which is security definer and runs as its owner.

create table if not exists public.client_research_insights (
  client_id   text        not null,
  run_id      text        not null,
  section     text        not null,
  reading     jsonb       not null,
  created_at  timestamptz not null default now(),
  constraint client_research_insights_pkey primary key (client_id, run_id, section),
  constraint client_research_insights_section_nonempty check (btrim(section) <> ''),
  -- A reading is an object. An array or a bare string would render as nothing the view can read.
  constraint client_research_insights_reading_object check (jsonb_typeof(reading) = 'object')
);

-- The reader always asks the same question: the newest run for one client.
create index if not exists client_research_insights_client_created_idx
  on public.client_research_insights (client_id, created_at desc);

alter table public.client_research_insights enable row level security;
revoke all on public.client_research_insights from public, anon, authenticated;
grant select, insert, update, delete on public.client_research_insights to service_role;
