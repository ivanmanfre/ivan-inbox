-- STATUS 2026-11-06: built and tested on temp-table copies; NOT applied yet (Sol cross-review pending). Packet: /tmp/sol-review/verdict-log-score-freeze/
-- 299 judge_verdict_log (Ivan 2026-11-06 "apply those", from test t4 2026-11-05).
-- Append-only table + AFTER UPDATE triggers that copy the OVERWRITTEN value when a judge verdict is replaced:
--   * outreach_prospects icp_score / icp_reasoning / scorer_version (stamp_scorer_version resets scored_at on rescoring)
--   * outreach_prospects enrichment_data.scan_owed (deleted on delivery)
--   * ops_drafts body edits, approvals, discards (inbox app ops.ts writes body + approved_at together)
-- Not covered on purpose:
--   * outreach_messages text/approve/discard: already logged by outreach_message_revisions_snapshot.
--   * outreach_messages.reply_intent: set once by the classifiers (reply_intent=is.null guard), never overwritten.
-- Every trigger is AFTER ... FOR EACH ROW, EXCEPTION-guarded, and its WHEN clause cannot raise, so logging can never
-- block or change a production write. No n8n workflow changes.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.judge_verdict_log (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  judge          text        NOT NULL,   -- 'icp_score' | 'scan_owed' | 'ops_draft_decision' | writer-supplied names
  subject_table  text        NOT NULL,
  subject_id     uuid        NOT NULL,
  seat           text,                   -- client seat at write time (ivan, risedtc, arch, swishdm, anna)
  event          text        NOT NULL,   -- 'overwrite' | 'delete' | 'edit' | 'approve' | 'discard' | 'verdict'
  old_verdict    jsonb,                  -- the value that was replaced (NULL for explicit 'verdict' rows)
  new_verdict    jsonb,                  -- the value now in the row
  input_hash     text,                   -- md5 of the judged input fields at write time (fingerprint only)
  input_ref      jsonb,
  model          text,
  rubric_version text,
  reasoning      text,
  source         text        NOT NULL DEFAULT 'trigger',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS judge_verdict_log_subject_idx ON public.judge_verdict_log (subject_table, subject_id, created_at);
CREATE INDEX IF NOT EXISTS judge_verdict_log_judge_idx   ON public.judge_verdict_log (judge, created_at);

-- RLS on, no policies: service_role bypasses; anon/authenticated see nothing.
-- Trigger functions are SECURITY DEFINER so authenticated inbox-app writes still log.
ALTER TABLE public.judge_verdict_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.judge_verdict_log FROM anon, authenticated;

-- Append-only.
CREATE OR REPLACE FUNCTION public.judge_verdict_log_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  RAISE EXCEPTION 'judge_verdict_log is append-only' USING ERRCODE = '42501';
END $f$;
DROP TRIGGER IF EXISTS judge_verdict_log_no_change ON public.judge_verdict_log;
CREATE TRIGGER judge_verdict_log_no_change BEFORE UPDATE OR DELETE ON public.judge_verdict_log
  FOR EACH ROW EXECUTE FUNCTION public.judge_verdict_log_immutable();

-- 1) outreach_prospects: icp score/reasoning/version overwritten, scan_owed changed or deleted.
CREATE OR REPLACE FUNCTION public.trg_log_prospect_verdicts() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE
  v_seat text;
  v_hash text;
  v_old_so jsonb;
  v_new_so jsonb;
BEGIN
  SELECT coalesce(c.client_id, 'ivan') INTO v_seat FROM public.outreach_campaigns c WHERE c.id = NEW.campaign_id;
  v_hash := md5(concat_ws('|', NEW.headline, NEW.title, NEW.company, NEW.employee_count, NEW.industry,
                          NEW.location, NEW.follower_count::text, NEW.company_description));

  -- Only real overwrites (an old score existed). The first score is the row's own value.
  IF OLD.icp_score IS NOT NULL AND
     (OLD.icp_score IS DISTINCT FROM NEW.icp_score
      OR OLD.icp_reasoning IS DISTINCT FROM NEW.icp_reasoning
      OR OLD.scorer_version IS DISTINCT FROM NEW.scorer_version) THEN
    INSERT INTO public.judge_verdict_log (judge, subject_table, subject_id, seat, event, old_verdict, new_verdict,
                                          input_hash, rubric_version, reasoning)
    VALUES ('icp_score', 'outreach_prospects', NEW.id, v_seat, 'overwrite',
            jsonb_build_object('score', OLD.icp_score, 'reasoning', OLD.icp_reasoning,
                               'scorer_version', OLD.scorer_version, 'scored_at', OLD.scored_at,
                               'stage', OLD.stage, 'invited_at', OLD.connection_sent_at),
            jsonb_build_object('score', NEW.icp_score, 'reasoning', NEW.icp_reasoning,
                               'scorer_version', NEW.scorer_version, 'scored_at', NEW.scored_at,
                               'stage', NEW.stage, 'invited_at', NEW.connection_sent_at),
            v_hash, NEW.scorer_version, NEW.icp_reasoning);
  END IF;

  -- The writer bumps scan_owed.updated_at on every retry; ignore that key so only status/reason/inbound changes log.
  v_old_so := OLD.enrichment_data -> 'scan_owed';
  v_new_so := NEW.enrichment_data -> 'scan_owed';
  IF v_old_so IS NOT NULL AND
     (CASE WHEN jsonb_typeof(v_old_so) = 'object' THEN v_old_so - 'updated_at' ELSE v_old_so END)
       IS DISTINCT FROM
     (CASE WHEN jsonb_typeof(v_new_so) = 'object' THEN v_new_so - 'updated_at' ELSE v_new_so END) THEN
    INSERT INTO public.judge_verdict_log (judge, subject_table, subject_id, seat, event, old_verdict, new_verdict)
    VALUES ('scan_owed', 'outreach_prospects', NEW.id, v_seat,
            CASE WHEN v_new_so IS NULL THEN 'delete' ELSE 'overwrite' END,
            v_old_so, v_new_so);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- logging must never block a score / scan write on a hot table
  RAISE WARNING 'judge_verdict_log prospect trigger failed: %', SQLERRM;
  RETURN NULL;
END $f$;

-- WHEN is evaluated outside the function's EXCEPTION block, so it must not be able to raise:
-- the jsonb '-' operator only runs on objects (it raises on scalars).
DROP TRIGGER IF EXISTS zz_log_prospect_verdicts ON public.outreach_prospects;
CREATE TRIGGER zz_log_prospect_verdicts AFTER UPDATE ON public.outreach_prospects
  FOR EACH ROW
  WHEN (OLD.icp_score IS DISTINCT FROM NEW.icp_score
     OR OLD.icp_reasoning IS DISTINCT FROM NEW.icp_reasoning
     OR OLD.scorer_version IS DISTINCT FROM NEW.scorer_version
     OR (OLD.enrichment_data -> 'scan_owed') IS DISTINCT FROM (NEW.enrichment_data -> 'scan_owed'))
  EXECUTE FUNCTION public.trg_log_prospect_verdicts();

-- 2) ops_drafts: body edits, approvals, discards (ops.ts updates body + approved_at in one statement).
CREATE OR REPLACE FUNCTION public.trg_log_ops_draft_decision() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_event text;
BEGIN
  v_event := concat_ws('+',
    CASE WHEN OLD.body IS DISTINCT FROM NEW.body THEN 'edit' END,
    CASE WHEN OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL THEN 'approve'
         WHEN OLD.approved_at IS NOT NULL AND NEW.approved_at IS NULL THEN 'unapprove' END,
    CASE WHEN NEW.send_blocked_reason IS NOT NULL AND OLD.send_blocked_reason IS DISTINCT FROM NEW.send_blocked_reason THEN 'discard'
         WHEN NEW.send_blocked_reason IS NULL AND OLD.send_blocked_reason IS NOT NULL THEN 'unblock' END);
  IF v_event = '' THEN v_event := 'change'; END IF;
  INSERT INTO public.judge_verdict_log (judge, subject_table, subject_id, seat, event, old_verdict, new_verdict, input_hash)
  VALUES ('ops_draft_decision', 'ops_drafts', NEW.id, NEW.client_id, v_event,
          jsonb_build_object('body', OLD.body, 'approved_at', OLD.approved_at, 'sent_at', OLD.sent_at,
                             'send_blocked_reason', OLD.send_blocked_reason, 'kind', OLD.kind),
          jsonb_build_object('body_md5', md5(coalesce(NEW.body, '')), 'approved_at', NEW.approved_at, 'sent_at', NEW.sent_at,
                             'send_blocked_reason', NEW.send_blocked_reason),
          md5(coalesce(OLD.body, '')));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'judge_verdict_log ops_drafts trigger failed: %', SQLERRM;
  RETURN NULL;
END $f$;

DROP TRIGGER IF EXISTS zz_log_ops_draft_decision ON public.ops_drafts;
CREATE TRIGGER zz_log_ops_draft_decision AFTER UPDATE ON public.ops_drafts
  FOR EACH ROW
  WHEN (OLD.body IS DISTINCT FROM NEW.body
     OR OLD.approved_at IS DISTINCT FROM NEW.approved_at
     OR OLD.send_blocked_reason IS DISTINCT FROM NEW.send_blocked_reason)
  EXECUTE FUNCTION public.trg_log_ops_draft_decision();

-- Writer entry point for judges that never persist a verdict (RISE scan acceptance, park veto, ARCH audit). Unused today.
CREATE OR REPLACE FUNCTION public.log_judge_verdict(p_judge text, p_subject_table text, p_subject_id uuid, p_seat text,
    p_verdict jsonb, p_input_hash text DEFAULT NULL, p_input_ref jsonb DEFAULT NULL, p_model text DEFAULT NULL,
    p_rubric text DEFAULT NULL, p_reasoning text DEFAULT NULL) RETURNS bigint
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
  INSERT INTO public.judge_verdict_log (judge, subject_table, subject_id, seat, event, new_verdict, input_hash, input_ref,
                                        model, rubric_version, reasoning, source)
  VALUES (p_judge, p_subject_table, p_subject_id, p_seat, 'verdict', p_verdict, p_input_hash, p_input_ref,
          p_model, p_rubric, p_reasoning, 'writer') RETURNING id;
$f$;
REVOKE ALL ON FUNCTION public.log_judge_verdict(text,text,uuid,text,jsonb,text,jsonb,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_judge_verdict(text,text,uuid,text,jsonb,text,jsonb,text,text,text) TO service_role;

COMMIT;
