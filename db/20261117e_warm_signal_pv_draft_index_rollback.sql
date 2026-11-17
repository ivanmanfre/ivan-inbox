-- Rollback of 20261117e. Single statement, outside a transaction block.
DROP INDEX CONCURRENTLY IF EXISTS public.outreach_prospects_pv_signal_draft_idx;
