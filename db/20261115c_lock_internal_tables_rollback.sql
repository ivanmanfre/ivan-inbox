-- Rollback of 20261115c_lock_internal_tables.sql: row level security off and the anon / authenticated grants back, exactly as before
-- (relacl was anon=arwdDxtm, authenticated=arwdDxtm on every table).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.board_truth_dirty DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.board_truth_dirty TO anon, authenticated;
ALTER TABLE public.booking_sync_log DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.booking_sync_log TO anon, authenticated;
ALTER TABLE public.client_guard_booked_keys DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_guard_booked_keys TO anon, authenticated;
ALTER TABLE public.draft_deletions DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.draft_deletions TO anon, authenticated;
ALTER TABLE public.client_generator_config DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_generator_config TO anon, authenticated;
ALTER TABLE public.outreach_enrich_rejects DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.outreach_enrich_rejects TO anon, authenticated;

COMMIT;
