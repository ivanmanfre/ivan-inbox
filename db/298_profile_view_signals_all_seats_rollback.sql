-- rollback 298: remove the new objects, then restore the pre-298 warm_signal_cards / warm_signal_decide.
-- Pre-298 bodies: db/066_warm_signals.sql and ~/.claude/backups/pv-warm-signals-all-seats-2026-10-30/live_wsc.sql + live_wsd.sql.
DROP FUNCTION IF EXISTS public.warm_signal_cards();
DROP FUNCTION IF EXISTS public.profile_view_signal_route(timestamptz, boolean);
DROP FUNCTION IF EXISTS public.outreach_seat_clients();
DELETE FROM engine_features WHERE feature = 'profile_view_signals';
update outreach_seats set settings = settings - 'profile_view';
update content_prompts set is_active = false where slug = 'profile-view-judge-swishdm';
-- then apply live_wsc.sql (as CREATE FUNCTION) and live_wsd.sql with the db/066 grants.
