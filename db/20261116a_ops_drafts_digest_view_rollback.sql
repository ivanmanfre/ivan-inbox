-- Rollback for db/20261116a. The app falls back to the plain ops_drafts read when this view errors.
BEGIN;
DROP VIEW IF EXISTS public.ops_drafts_digest_v;
COMMIT;
