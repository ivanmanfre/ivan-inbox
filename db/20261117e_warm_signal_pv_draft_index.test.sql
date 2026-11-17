-- Check of 20261117e after it is applied (read-only). Passes when the plan for the last arm uses the new index
-- and warm_signal_cards() returns the same rows as before (compare the md5 with one taken before applying).
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM public.outreach_prospects p
WHERE p.blacklisted = false AND ((p.enrichment_data -> 'pv_signal') ->> 'draft_id') IS NOT NULL;
-- expected: Index Only Scan / Bitmap Index Scan on outreach_prospects_pv_signal_draft_idx, a few ms.

SELECT md5(string_agg(w::text, '|' ORDER BY w.prospect_id)) AS warm_signal_cards_md5, count(*) FROM public.warm_signal_cards() w;
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.warm_signal_cards();
-- expected: the md5 equals the pre-apply one; execution well under the 2.4-2.8 s measured before.
