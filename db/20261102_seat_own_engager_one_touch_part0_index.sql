-- 20261102 one-touch own-post engagers, part 0 (run alone, outside a transaction: CONCURRENTLY).
-- The identity leg "member key inside a prospect's linkedin_url" had no index, so seat_own_engager_candidates took
-- ~0.9s a person and timed out PostgREST (8s) on a 70-day replay. Measured 11-02: 12.7s -> 117ms.
-- Rollback: drop index concurrently if exists public.outreach_prospects_li_mid_url_idx;
create index concurrently if not exists outreach_prospects_li_mid_url_idx on public.outreach_prospects (li_member_key(linkedin_url));
