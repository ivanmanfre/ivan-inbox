-- STATUS 2026-11-06: built and tested on temp-table copies; NOT applied yet (Sol cross-review pending). Packet: /tmp/sol-review/verdict-log-score-freeze/
-- Rollback for 299. Removes the triggers and functions. Keeps judge_verdict_log (history) unless Ivan says drop.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS zz_log_prospect_verdicts ON public.outreach_prospects;
DROP TRIGGER IF EXISTS zz_log_ops_draft_decision ON public.ops_drafts;
DROP FUNCTION IF EXISTS public.trg_log_prospect_verdicts();
DROP FUNCTION IF EXISTS public.trg_log_ops_draft_decision();
DROP FUNCTION IF EXISTS public.log_judge_verdict(text,text,uuid,text,jsonb,text,jsonb,text,text,text);
-- To also drop the history: DROP TABLE public.judge_verdict_log; DROP FUNCTION public.judge_verdict_log_immutable();
COMMIT;
