-- STATUS: APPLIED 2026-11-06T11:05:30Z to Supabase bjbvqvzbzczjbatgmccb via Management API (Sol gpt-6.1-sol approved round 4). Packet: /tmp/sol-review/verdict-log-score-freeze
-- 300 freeze the gate-time ICP score when an invite is sent (Ivan 2026-11-06 "apply those", from tests t4/t6).
-- Problem: rescoring rewrites outreach_prospects.icp_score after the invite (ARCH: 948/1588 invites had scored_at
-- after the invite, judge-outcome-audit 2026-11-03), so a judge cannot be checked against outcomes.
-- Fix: a BEFORE trigger copies the score in the row at the moment of the real "invite sent" transition
-- (connection_sent_at NULL -> NOT NULL; OLD values) into *_at_send columns. Every sender sets that column only
-- after the invite left (ARCH Connection Sender, Connection Request Sender, Send Messages, InMail Follow-up ->
-- Connect, SwishDM sender), so this covers every seat and sender with no workflow change.
-- The 4 columns are trigger-owned: cleared on INSERT, captured once on the first transition (whatever the writer
-- put in them), and restored to OLD on every other UPDATE. A rejoin release (Invitation Withdrawal Sweeper nulls
-- connection_sent_at) and the later re-invite keep the first frozen values.
-- Known limit (measured 2026-11-06, 30d, 3002 invites): the frozen value is the row's score when the sender
-- PATCHes connection_sent_at, a few seconds after its gate read. A rescore landing inside that gap would be frozen
-- instead. 0 of 3002 invites had a score write in the 2 minutes AFTER the send; 6 had one in the 2 minutes before,
-- all score-then-send sequences (scored 32-110s before the send, i.e. before the sender picked the row).
-- Best-effort evidence only: migration 299 normally logs the pre-change value (judge_verdict_log, judge='icp_score'),
-- so a rescore just before score_frozen_at can usually be spotted there. It is not guaranteed (logging is skipped
-- under lock contention or on any logging error, and a log row near the send does not prove which value the gate read).
-- No backfill: historical rows would only get the post-invite score, which is the problem this fixes.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- ADD COLUMN and CREATE TRIGGER need these; take them first and fail fast (APPLY retries on 55P03).
LOCK TABLE public.outreach_prospects IN ACCESS EXCLUSIVE MODE NOWAIT;

ALTER TABLE public.outreach_prospects
  ADD COLUMN IF NOT EXISTS icp_score_at_send      integer,
  ADD COLUMN IF NOT EXISTS scorer_version_at_send text,
  ADD COLUMN IF NOT EXISTS scored_at_at_send      timestamptz,
  ADD COLUMN IF NOT EXISTS score_frozen_at        timestamptz;

COMMENT ON COLUMN public.outreach_prospects.icp_score_at_send IS 'icp_score in the row when connection_sent_at first went NULL -> set (migration 300). Trigger-owned';
COMMENT ON COLUMN public.outreach_prospects.score_frozen_at IS 'when icp_score_at_send was frozen (first invite transition). NULL = invited before 2026-11-06 or never invited. Trigger-owned';

-- lock_timeout attribute: the function touches no other table today; it is set so any future lookup cannot wait
-- into the caller's statement_timeout.
CREATE OR REPLACE FUNCTION public.trg_freeze_score_at_send() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' SET lock_timeout TO '100ms' AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.icp_score_at_send := NULL; NEW.scorer_version_at_send := NULL;
    NEW.scored_at_at_send := NULL; NEW.score_frozen_at := NULL;
  ELSIF OLD.score_frozen_at IS NULL AND OLD.connection_sent_at IS NULL AND NEW.connection_sent_at IS NOT NULL THEN
    -- first invite transition: capture from OLD whatever the writer sent for the frozen columns
    NEW.icp_score_at_send      := OLD.icp_score;
    NEW.scorer_version_at_send := OLD.scorer_version;
    NEW.scored_at_at_send      := OLD.scored_at;
    NEW.score_frozen_at        := now();
  ELSE
    NEW.icp_score_at_send      := OLD.icp_score_at_send;
    NEW.scorer_version_at_send := OLD.scorer_version_at_send;
    NEW.scored_at_at_send      := OLD.scored_at_at_send;
    NEW.score_frozen_at        := OLD.score_frozen_at;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block a send write
  RAISE WARNING 'trg_freeze_score_at_send failed: %', SQLERRM;
  RETURN NEW;
END $f$;

-- Named to run after every other BEFORE trigger on the table (alphabetical order), so it sees the final NEW.
-- WHEN keeps it off the hot path: it runs only on the first invite transition or when a write touches the columns.
DROP TRIGGER IF EXISTS zzzzz_freeze_score_at_send ON public.outreach_prospects;
CREATE TRIGGER zzzzz_freeze_score_at_send BEFORE UPDATE ON public.outreach_prospects
  FOR EACH ROW
  WHEN ((OLD.score_frozen_at IS NULL AND OLD.connection_sent_at IS NULL AND NEW.connection_sent_at IS NOT NULL)
     OR NEW.score_frozen_at        IS DISTINCT FROM OLD.score_frozen_at
     OR NEW.icp_score_at_send      IS DISTINCT FROM OLD.icp_score_at_send
     OR NEW.scorer_version_at_send IS DISTINCT FROM OLD.scorer_version_at_send
     OR NEW.scored_at_at_send      IS DISTINCT FROM OLD.scored_at_at_send)
  EXECUTE FUNCTION public.trg_freeze_score_at_send();

DROP TRIGGER IF EXISTS zzzzz_freeze_score_at_send_ins ON public.outreach_prospects;
CREATE TRIGGER zzzzz_freeze_score_at_send_ins BEFORE INSERT ON public.outreach_prospects
  FOR EACH ROW
  WHEN (NEW.score_frozen_at IS NOT NULL OR NEW.icp_score_at_send IS NOT NULL
     OR NEW.scorer_version_at_send IS NOT NULL OR NEW.scored_at_at_send IS NOT NULL)
  EXECUTE FUNCTION public.trg_freeze_score_at_send();

COMMIT;
NOTIFY pgrst, 'reload schema';
