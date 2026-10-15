-- Restore exact pre-cleanup switch values and job active states.
BEGIN;
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_beliefs_ivan' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_beliefs_risedtc' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_buyer_ivan' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_guard_arch' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_guard_ivan' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_guard_risedtc' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_numbers_ivan' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_seed_arch' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_seed_ivan' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_seed_risedtc' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_supply_arch' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_supply_ivan' AND value='false';
UPDATE public.integration_config SET value='true',updated_at=now() WHERE key='cb46_supply_risedtc' AND value='false';
UPDATE public.cb45_flags SET value='true'::jsonb,updated_at=now() WHERE key='shadow_claim_check' AND value='false'::jsonb;
SELECT cron.alter_job(103,active:=true);
SELECT cron.alter_job(104,active:=true);
SELECT cron.alter_job(148,active:=true);
SELECT cron.alter_job(149,active:=true);
SELECT cron.alter_job(150,active:=true);
COMMIT;
-- n8n workflow rollback: run n8nac@1.8.1 workflow activate XLRstm42IdC9WHmy
-- and n8nac@1.8.1 workflow activate lFdFXWp6ptw3hhKd from the initialized workspace.
