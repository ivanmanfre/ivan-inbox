-- STATUS 2026-11-06: built and tested on temp-table copies; NOT applied yet (Sol cross-review pending). Packet: /tmp/sol-review/verdict-log-score-freeze/
-- 300 freeze the gate-time ICP score when an invite is sent (Ivan 2026-11-06 "apply those", from tests t4/t6).
-- Problem: rescoring rewrites outreach_prospects.icp_score after the invite (ARCH: 948/1588 invites had scored_at
-- after the invite, judge-outcome-audit 2026-11-03), so a judge cannot be checked against outcomes.
-- Fix: a BEFORE UPDATE trigger copies the score the gate saw (OLD values) into *_at_send columns on the real
-- "invite sent" transition: connection_sent_at NULL -> NOT NULL. Every sender sets that column only after the
-- invite left (ARCH Connection Sender, Connection Request Sender, Send Messages, InMail Follow-up -> Connect,
-- SwishDM sender), so this covers every seat and sender with no workflow change.
-- Written once: only when score_frozen_at is still NULL. A rejoin release (Invitation Withdrawal Sweeper nulls
-- connection_sent_at) and the later re-invite keep the first frozen values. Once frozen, later writes to the frozen
-- columns are reverted to the frozen values (protects against read-modify-write round trips).
-- No backfill: historical rows would only get the post-invite score, which is the problem this fixes.
-- Inserts that arrive already sent are not frozen (no gate ran on our side; 1 of 1595 invites in 14d).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.outreach_prospects
  ADD COLUMN IF NOT EXISTS icp_score_at_send      integer,
  ADD COLUMN IF NOT EXISTS scorer_version_at_send text,
  ADD COLUMN IF NOT EXISTS scored_at_at_send      timestamptz,
  ADD COLUMN IF NOT EXISTS score_frozen_at        timestamptz;

COMMENT ON COLUMN public.outreach_prospects.icp_score_at_send IS 'icp_score the send gate saw, frozen when connection_sent_at first went NULL -> set (migration 300)';
COMMENT ON COLUMN public.outreach_prospects.score_frozen_at IS 'when icp_score_at_send was frozen (first invite transition). NULL = invited before 2026-11-06 or never invited';

CREATE OR REPLACE FUNCTION public.trg_freeze_score_at_send() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  IF OLD.score_frozen_at IS NOT NULL THEN
    NEW.icp_score_at_send      := OLD.icp_score_at_send;
    NEW.scorer_version_at_send := OLD.scorer_version_at_send;
    NEW.scored_at_at_send      := OLD.scored_at_at_send;
    NEW.score_frozen_at        := OLD.score_frozen_at;
  ELSIF OLD.connection_sent_at IS NULL AND NEW.connection_sent_at IS NOT NULL AND NEW.score_frozen_at IS NULL THEN
    -- OLD = the row the sender's gate read before it wrote connection_sent_at.
    NEW.icp_score_at_send      := OLD.icp_score;
    NEW.scorer_version_at_send := OLD.scorer_version;
    NEW.scored_at_at_send      := OLD.scored_at;
    NEW.score_frozen_at        := now();
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block a send write
  RAISE WARNING 'trg_freeze_score_at_send failed: %', SQLERRM;
  RETURN NEW;
END $f$;

-- Named to run after every other BEFORE UPDATE trigger on the table (alphabetical order), so it sees the final NEW.
-- WHEN keeps it off the hot path: it only runs on the first invite transition or on a write that touches frozen values.
DROP TRIGGER IF EXISTS zzzzz_freeze_score_at_send ON public.outreach_prospects;
CREATE TRIGGER zzzzz_freeze_score_at_send BEFORE UPDATE ON public.outreach_prospects
  FOR EACH ROW
  WHEN ((OLD.score_frozen_at IS NULL AND OLD.connection_sent_at IS NULL AND NEW.connection_sent_at IS NOT NULL)
     OR (OLD.score_frozen_at IS NOT NULL AND (
            NEW.score_frozen_at        IS DISTINCT FROM OLD.score_frozen_at
         OR NEW.icp_score_at_send      IS DISTINCT FROM OLD.icp_score_at_send
         OR NEW.scorer_version_at_send IS DISTINCT FROM OLD.scorer_version_at_send
         OR NEW.scored_at_at_send      IS DISTINCT FROM OLD.scored_at_at_send)))
  EXECUTE FUNCTION public.trg_freeze_score_at_send();

COMMIT;
NOTIFY pgrst, 'reload schema';
