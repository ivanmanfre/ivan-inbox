BEGIN;

-- 20261115n_prospect_edit_name_index_grant Batch 7 of 7: a signed-in prospect edit that changes the name fails.
--
-- Fault (older than the 2026-11-15 locks, same before and after them): the inbox app edits outreach_prospects as the
-- signed-in user. The index outreach_prospects_detector_name_key_idx is built on detector_name_key(name). When an
-- update has to write a new index entry (the name changes, or the row moves to a new page), Postgres runs that
-- expression as the user doing the update, and authenticated has no EXECUTE on detector_name_key or on
-- detector_name_norm, which it calls. The edit ends with "permission denied for function detector_name_key".
-- Reproduced 2026-11-15 in a rolled-back transaction as authenticated: UPDATE outreach_prospects SET name = name || ' zz'
-- -> 42501. With EXECUTE on detector_name_key only -> 42501 on detector_name_norm. With both -> the update succeeds.
-- 9 signed-in prospect edits in the last 7 days succeeded only because they did not need a new index entry.
--
-- Fix: the smallest grant that makes the edit work, EXECUTE on the two functions for authenticated. Both are IMMUTABLE,
-- invoker-rights, pure text functions (lower-case, strip punctuation, keep the first two words). They read no table,
-- so the grant exposes nothing. anon gets nothing: the public key has no write path to outreach_prospects.
-- Rollback: 20261115n_prospect_edit_name_index_grant_rollback.sql

GRANT EXECUTE ON FUNCTION public.detector_name_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detector_name_norm(text) TO authenticated;

COMMIT;
