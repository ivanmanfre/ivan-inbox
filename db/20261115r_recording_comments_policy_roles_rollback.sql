-- Rollback of 20261115r_recording_comments_policy_roles.sql: service_role_all back to every role (PUBLIC),
-- anon_read_comments back to its EXISTS on recordings, and the helper function removed, as before.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER POLICY service_role_all ON public.recording_comments TO PUBLIC;

ALTER POLICY anon_read_comments ON public.recording_comments
  USING (EXISTS (SELECT 1 FROM public.recordings r WHERE r.id = recording_comments.recording_id AND r.is_public = true));

DROP FUNCTION public.recording_is_public(uuid);

COMMIT;
