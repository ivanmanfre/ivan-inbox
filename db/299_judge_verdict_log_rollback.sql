-- STATUS: rollback for the migration applied 2026-11-06T11:05Z. NOT run. Run with: python3 /tmp/sol-review/verdict-log-score-freeze/apply.py <this file> (300 rollback first, then 299)
-- Rollback for 299. Removes the triggers and functions. Keeps judge_verdict_log (history) unless Ivan says drop.
-- DROP TRIGGER takes ACCESS EXCLUSIVE, so the locks are taken first with NOWAIT (retry on 55P03).
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.outreach_prospects IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.ops_drafts IN ACCESS EXCLUSIVE MODE NOWAIT;
DROP TRIGGER IF EXISTS zz_log_prospect_verdicts ON public.outreach_prospects;
DROP TRIGGER IF EXISTS zz_log_ops_draft_decision ON public.ops_drafts;
DROP FUNCTION IF EXISTS public.trg_log_prospect_verdicts();
DROP FUNCTION IF EXISTS public.trg_log_ops_draft_decision();
DROP FUNCTION IF EXISTS public.log_judge_verdict(text,text,uuid,text,jsonb,text,jsonb,text,text,text);
-- To also drop the history: DROP TABLE public.judge_verdict_log; DROP FUNCTION public.judge_verdict_log_immutable();
COMMIT;
