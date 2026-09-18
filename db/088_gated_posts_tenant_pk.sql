-- 088: competitor_gated_posts primary key becomes (client_id, post_ref).
--
-- SUPERSEDES db/076_competitor_gated_posts.sql:7, which declares `post_ref text primary key`.
-- That line is left as it was, because 076 is the history of what was built on that day and
-- editing it would make the migration tree a worse record than the database. Anyone rebuilding
-- from migrations gets 076's single-column key and then this file widens it. Anyone reading 076
-- on its own should read this line first: the live key is two columns, and 8 post_refs are
-- legitimately held by two tenants each, so a rebuild that stops after 076 and then loads live
-- data will fail on the primary key.
--
-- The table was created in 076 with `post_ref text primary key` while every read of it is
-- lane-scoped (077/080: `join competitor_gated_posts j on j.post_ref = s.post_ref and
-- j.client_id = p_client_id`). Those two facts contradict each other. One post read by the gate
-- judge for one lane took the only row that post_ref will ever have, so the same post could
-- never be judged for a second lane -- and the judge writes `on conflict do nothing`, so the
-- second lane's row was refused in silence and the run reported a judged count it had not
-- earned. That never fired only because the three live rosters happen not to overlap.
--
-- It stops being hypothetical the moment a fourth tenant is researched: any tenant whose roster
-- shares one account with an existing lane hits it on the first run.
--
-- This is a widening, not a rewrite. Every existing row is already unique on post_ref alone, so
-- it is trivially unique on (client_id, post_ref): no row moves, no row is lost, and the counts
-- per lane (ivan 298, risedtc 298, arch 214 at the time of writing) are unchanged.
--
-- What the RPCs keep: the `judged` join in operator_gated_posts pins client_id, and
-- (client_id, post_ref) is unique, so the join still cannot multiply a source row. The
-- `unjudged = count(src) - count(judged)` subtraction in 083 stays exact. The comment in 083
-- that explains this by naming the old single-column key is now one migration out of date; the
-- guarantee it describes survives, for the reason above.
--
-- Callers that had to move in the same step, because a bare `post_ref` conflict target is an
-- error once the key is two columns:
--   goal-runs/lead-magnet-analytics-2026-09-16-out/judge/judge-run.mjs:66
--   goal-runs/lm-readings-true-and-history-2026-09-17-out/judge/judge-run.mjs:66
--   tools/client-research/judge-run.mjs (the launcher's own copy)
--   n8n LM Gate Judge - Weekly (born-dead) WZ4ukN9Wa5evUFCM -- which also read the
--     already-judged set with NO client filter, a bug this key exposes rather than causes.

begin;

alter table public.competitor_gated_posts
  drop constraint competitor_gated_posts_pkey;

alter table public.competitor_gated_posts
  add constraint competitor_gated_posts_pkey primary key (client_id, post_ref);

-- The judge's backlog query is `select post_ref ... where client_id = $1`, which the new key
-- serves directly. This index keeps a lookup by post_ref alone (across lanes) cheap -- the
-- shape a cross-tenant question like "who else has judged this post" needs.
create index if not exists competitor_gated_posts_post_ref_idx
  on public.competitor_gated_posts (post_ref);

commit;
