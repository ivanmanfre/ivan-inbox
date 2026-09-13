-- db/067_campaign_control_snapshots.down.sql — the rollback for db/067.
-- Drops only what 067 created. UNAPPLIED in this run.
drop view if exists public.campaign_control_latest_v;
drop policy if exists campaign_control_snapshots_select_authenticated on public.campaign_control_snapshots;
drop index if exists public.campaign_control_snapshots_kind_generated_idx;
drop table if exists public.campaign_control_snapshots;
