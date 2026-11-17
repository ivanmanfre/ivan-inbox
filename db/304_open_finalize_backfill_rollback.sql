-- Rollback 304. Roll back 305..309 first. Class columns and open_networks rows stay (303 rollback drops them).
-- The integration_config marker 'open_eligibility_granted_at' stays: re-applying 304 must not grant a second time.
select cron.unschedule('open-reclassify-nightly');
drop function if exists public.open_release_grant();
drop function if exists public.reclassify_opens(timestamptz);
drop function if exists public.scan_open_finalize(bigint, int, text, text, text);
drop function if exists public.scan_open_label(bigint, int, text, text, text);
drop function if exists public.page_open_context(text, text, timestamptz, bigint, text, text, text, text);
drop function if exists public.scan_open_context(bigint);
drop function if exists public.page_open_near_send(text, timestamptz);
drop function if exists public.scan_open_near_send(bigint);
