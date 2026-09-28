-- Restore old visibility while retaining incident_key and the claim function,
-- so a rollback cannot reset push suppression after dismiss/expiry.
-- Deploy the prior edge function alongside this rollback only after assessing
-- duplicate-push risk; the new claim is safe to leave installed.
update public.inbox_notifications set expires_at = null
 where family in ('system_infra_alarm','send_failed_alert','lane_supply_alarm');
drop index if exists public.inbox_notifications_expiry;
create or replace view public.inbox_notifications_v with (security_invoker = on) as
  select id, family, source, dedupe_key, severity, title, body, url, media, group_key, tenant,
         count, first_seen_at, last_seen_at, created_at, read_at, dismissed_at, pushed_at,
         expires_at, incident_key
    from public.inbox_notifications;
