-- 2026-11-17 speed pass: an index for warm_signal_cards' last arm. NOT APPLIED: for review.
--
-- Why. warm_signal_cards() (DMs and Lanes, 5-8 s in the browser; 2.4-2.8 s of database time) picks prospects with
-- an OR of four arms. Three arms already have indexes (inbox_r3_warm_lane_idx, inbox_r3_warm_view_idx): alone they
-- run as a BitmapOr in ~1 ms. The fourth, `enrichment_data->'pv_signal'->>'draft_id' IS NOT NULL`, has none, so
-- the planner walks every prospect and detoasts enrichment_data for each:
--   EXPLAIN ANALYZE (2026-11-17) of that arm alone: Seq Scan, Rows Removed by Filter 62206, 102266 buffers, 1101 ms;
--   of the function body: Index Scan on inbox_r3_warm_view_idx with Rows Removed by Filter 58379, 342344 buffers,
--   2849 ms, returning 1 row.
-- With this partial index every arm is indexable, so the OR can become a BitmapOr over ~30 + ~50 rows.
-- The function itself is not changed. Expected: ~2.5 s -> tens of ms (to be confirmed by EXPLAIN after applying).
--
-- CONCURRENTLY: no write lock on outreach_prospects while it builds. It cannot run inside a transaction block:
-- run this file as a single statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS outreach_prospects_pv_signal_draft_idx
  ON public.outreach_prospects (((enrichment_data -> 'pv_signal') ->> 'draft_id'))
  WHERE blacklisted = false AND ((enrichment_data -> 'pv_signal') ->> 'draft_id') IS NOT NULL;
