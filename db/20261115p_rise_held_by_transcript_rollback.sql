-- Rollback of 20261115p_rise_held_by_transcript.sql: stop the daily job, drop the three functions and the five
-- held_* columns (with their two checks). Nothing else in booking_attributions is touched; meeting_outcome was never
-- written by the job. The held_* values are derived and re-created by re-applying the migration.
BEGIN;
SET LOCAL lock_timeout = '5s';

select cron.unschedule('rise-booking-held-daily') where exists (select 1 from cron.job where jobname = 'rise-booking-held-daily');

DROP FUNCTION IF EXISTS public.rise_booking_held_apply(timestamptz);
DROP FUNCTION IF EXISTS public.rise_booking_held_compute(timestamptz);
DROP FUNCTION IF EXISTS public._rise_held_norm(text);

ALTER TABLE public.booking_attributions
  DROP CONSTRAINT IF EXISTS booking_attributions_held_consistent_chk,
  DROP CONSTRAINT IF EXISTS booking_attributions_held_basis_chk,
  DROP COLUMN IF EXISTS held_by_transcript,
  DROP COLUMN IF EXISTS held_transcript_id,
  DROP COLUMN IF EXISTS held_basis,
  DROP COLUMN IF EXISTS held_call_start,
  DROP COLUMN IF EXISTS held_checked_at;

COMMIT;
