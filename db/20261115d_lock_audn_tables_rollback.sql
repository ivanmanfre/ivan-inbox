-- Rollback of 20261115d_lock_audn_tables.sql: row level security off and the anon / authenticated grants back, exactly as before
-- (relacl was anon=arwdDxtm, authenticated=arwdDxtm on every table).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.audn_post_collection_coverage DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.audn_post_collection_coverage TO anon, authenticated;
ALTER TABLE public.audn_post_metric_snapshots DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.audn_post_metric_snapshots TO anon, authenticated;

COMMIT;
