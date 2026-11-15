BEGIN;

-- 20261115r_recording_comments_policy_roles Batch 3 of 3: recording_comments. The policy named service_role_all was
-- created with no role list, so it applied to every role (PUBLIC): FOR ALL USING (true) WITH CHECK (true). With the
-- public (anon) key anyone could read every comment (ip_hash included) on every recording, public or not, and change
-- or delete any comment.
--
-- The public video page (personal-site components/VideoViewer.tsx) uses the public key for two things only: read the
-- comments of the recording it got from recording_view_by_token (public recordings only) and insert one. Each has its
-- own policy:
--   anon_insert_comments FOR INSERT TO anon WITH CHECK (true)                       (unchanged)
--   anon_read_comments   FOR SELECT TO anon, only where the recording is public
-- anon_read_comments never matched a row by itself: its EXISTS looks into recordings, and recordings has no policy
-- for anon, so the public key sees no recording there. The page's comment list only worked through the PUBLIC policy.
-- So this batch does two things together:
--   1. recording_is_public(uuid): a small owner-rights function that answers "is this recording public" (the same
--      condition the policy already states), and anon_read_comments now asks it. Public on purpose: it is the 90th
--      owner-rights function the public key may call (89 before). It returns true or false for a recording id, nothing else.
--   2. service_role_all narrowed to the signed-in user and the service key. The signed-in user keeps the access the
--      PUBLIC policy gave (one user, sign-up off). service_role bypasses row level security either way.
-- After this the public key can: read comments of public recordings, add a comment. It can no longer read comments
-- of non-public recordings, or update or delete any comment. Table privileges are not changed.
-- The table has 0 rows and recordings has 0 rows; 0 real calls in 7 days.
-- Rollback: 20261115r_recording_comments_policy_roles_rollback.sql

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.recording_is_public(p_recording_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  select exists (select 1 from public.recordings r where r.id = p_recording_id and r.is_public = true);
$fn$;

REVOKE ALL ON FUNCTION public.recording_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recording_is_public(uuid) TO anon, authenticated, service_role;

ALTER POLICY anon_read_comments ON public.recording_comments
  USING (public.recording_is_public(recording_id));

ALTER POLICY service_role_all ON public.recording_comments TO authenticated, service_role;

COMMIT;
