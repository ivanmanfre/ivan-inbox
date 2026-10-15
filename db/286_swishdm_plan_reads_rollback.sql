-- Revert only the new onboarding read surface. No data/configuration was changed by db/286.
BEGIN;
DROP FUNCTION IF EXISTS public.content_plan_week_onboarding(text,timestamptz);
DROP FUNCTION IF EXISTS public.cb51_decision_history_onboarding(text);
COMMIT;
