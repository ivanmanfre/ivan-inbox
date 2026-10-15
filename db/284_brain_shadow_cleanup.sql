-- Retire unused CB46 switches and non-steering CB18/19/45 shadow work.
-- Live fleet + SQL dependency audit: ~/.local/state/cb-cleanup-1015/resume/.
-- CB18 supply/labels and CB40 preregistered confirmation remain active.
-- All data, functions, models and historical assignments are preserved.
BEGIN;
DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE (jobid,jobname) IN
    ((103,'cb18_shadow_score'),(104,'cb18_eval_count'),(148,'cb19_posterior_weekly'),(149,'cb19_bandit_batch'),(150,'cb19_consideration_snapshot'))) <> 5 THEN
    RAISE EXCEPTION 'Shadow job identities changed; re-audit before cleanup';
  END IF;
END $$;
UPDATE public.integration_config SET value='false',updated_at=now()
WHERE key IN (
    'cb46_beliefs_ivan',
    'cb46_beliefs_risedtc',
    'cb46_buyer_ivan',
    'cb46_guard_arch',
    'cb46_guard_ivan',
    'cb46_guard_risedtc',
    'cb46_numbers_ivan',
    'cb46_seed_arch',
    'cb46_seed_ivan',
    'cb46_seed_risedtc',
    'cb46_supply_arch',
    'cb46_supply_ivan',
    'cb46_supply_risedtc'
) AND value='true' AND NOT is_secret;
UPDATE public.cb45_flags SET value='false'::jsonb,updated_at=now()
WHERE key='shadow_claim_check' AND value='true'::jsonb;
SELECT cron.alter_job(jobid,active:=false) FROM cron.job
WHERE (jobid,jobname) IN
 ((103,'cb18_shadow_score'),(104,'cb18_eval_count'),(148,'cb19_posterior_weekly'),(149,'cb19_bandit_batch'),(150,'cb19_consideration_snapshot')) AND active;
COMMIT;
