drop trigger if exists editorial_audn_project_insert on public.audn_post_metric_snapshots;
drop trigger if exists editorial_audn_preserve_first on public.audn_post_metric_snapshots;
drop function if exists public.editorial_project_audn_capture_trigger();
drop function if exists public.editorial_project_audn_capture(bigint);
drop function if exists public.editorial_preserve_audn_capture();
drop function if exists public.editorial_audn_payload(public.audn_post_metric_snapshots);
-- Deliberately retain the conflict ledger, projection/veto rows, immutable guard and eligible
-- reader view. Projected outcomes are append-only; deleting their quarantine metadata would
-- re-expose preserved-but-conflicted evidence after rollback.
