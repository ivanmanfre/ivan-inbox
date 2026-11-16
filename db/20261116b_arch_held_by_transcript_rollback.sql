-- Rollback of 20261116b_arch_held_by_transcript.sql: stop the ARCH job, drop the three ARCH functions, clear the
-- held_* stamps on ARCH rows only, and put back the 20261115p column comments. The held_* columns and their CHECKs
-- belong to 20261115p (RISE) and stay; no RISE row, function or job is touched. meeting_outcome was never written.
-- The ARCH values are derived and re-created by re-applying the migration.
BEGIN;
SET LOCAL lock_timeout = '5s';

select cron.unschedule('arch-booking-held-daily') where exists (select 1 from cron.job where jobname = 'arch-booking-held-daily');

DROP FUNCTION IF EXISTS public.arch_booking_held_apply(timestamptz);
DROP FUNCTION IF EXISTS public.arch_booking_held_compute(timestamptz);
DROP FUNCTION IF EXISTS public._arch_held_norm(text);

UPDATE public.booking_attributions
   SET held_by_transcript = null, held_transcript_id = null, held_basis = null, held_call_start = null, held_checked_at = null
 WHERE client_id = 'arch'
   AND (held_by_transcript IS NOT NULL OR held_transcript_id IS NOT NULL OR held_basis IS NOT NULL
        OR held_call_start IS NOT NULL OR held_checked_at IS NOT NULL);

COMMENT ON COLUMN public.booking_attributions.held_by_transcript IS
  'RISE only. true = the booker spoke on a Fathom recording of this booking; false = no-show under strict coverage rules; NULL = unknown. Written by rise_booking_held_apply(); independent of meeting_outcome. See db/20261115p.';
COMMENT ON COLUMN public.booking_attributions.held_transcript_id IS 'RISE only. transcripts.id of the recording that proves held_by_transcript = true.';
COMMENT ON COLUMN public.booking_attributions.held_basis IS
  'RISE only. Why held_by_transcript has its value: email | name | no_transcript | met_other_time | unverified_speaker | host_not_recorded | pending_ingest | recorder_off | internal_booker | rescheduled.';
COMMENT ON COLUMN public.booking_attributions.held_call_start IS 'RISE only. Scheduled start of the matched recording.';
COMMENT ON COLUMN public.booking_attributions.held_checked_at IS 'RISE only. When the held verdict on this row was last written or changed.';

COMMIT;
