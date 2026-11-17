-- Rollback 304. Roll back 305..309 first. Class columns and open_networks rows stay (303 rollback drops them).
-- The integration_config marker 'open_eligibility_granted_at' stays: re-applying 304 must not grant a second time.
-- Safe on any state: 304 applied or not, backfill finished, half done or never started (every statement is a no-op
-- when its object is missing; the cron job is removed only if it exists).
select cron.unschedule(j.jobname) from cron.job j where j.jobname = 'open-reclassify-nightly';
drop function if exists public.open_release_grant();
drop function if exists public.open_backfill_step(int);
drop function if exists public.reclassify_opens(timestamptz);
drop function if exists public.page_opens_relabel(bigint[]);
drop function if exists public.scan_opens_relabel(bigint[]);
drop function if exists public.scan_open_finalize(bigint, int, text, text, text);
drop function if exists public.scan_open_label(bigint, int, text, text, text);
drop function if exists public.page_open_context(text, text, timestamptz, bigint, text, text, text, text);
drop function if exists public.scan_open_context(bigint);
drop function if exists public.scan_open_addr(text, boolean);
drop function if exists public.scan_open_burst(bigint);
drop function if exists public.page_open_near_send(text, timestamptz);
drop function if exists public.scan_open_near_send(bigint);
drop function if exists public.page_open_sends(text, timestamptz);
drop function if exists public.scan_open_sends(bigint);
drop table if exists public.open_backfill_state;
drop index if exists public.outreach_messages_outbound_sent_idx;
