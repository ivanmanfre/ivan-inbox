-- Rollback for db/20261021_unreachable_not_failed.sql: the live definitions saved 2026-10-21 18:2xZ
-- (pg_get_viewdef / pg_get_functiondef) before the change was applied.

create or replace view public.inbox_sends_v with (security_invoker = on) as
 WITH dedup AS (
         SELECT DISTINCT ON (m.prospect_id, m.message_text, m.sent_at) COALESCE(c.client_id, 'ivan'::text) AS client_id,
            m.message_type,
            COALESCE(m.channel, 'linkedin'::text) AS channel,
            m.sent_at,
            m.send_blocked_at,
            m.send_blocked_reason
           FROM outreach_messages m
             JOIN outreach_prospects p ON p.id = m.prospect_id
             LEFT JOIN outreach_campaigns c ON c.id = p.campaign_id
          WHERE m.direction = 'outbound'::text AND (m.message_type = ANY (ARRAY['connection_note'::text, 'dm'::text, 'inmail'::text, 'email'::text])) AND (COALESCE(c.client_id, 'ivan'::text) <> 'ivan'::text OR m.sent_at >= '2026-07-11 00:00:00+00'::timestamp with time zone OR m.send_blocked_at >= '2026-07-11 00:00:00+00'::timestamp with time zone)
          ORDER BY m.prospect_id, m.message_text, m.sent_at, m.id
        )
 SELECT client_id,
    message_type,
    channel,
    count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent_total,
    count(*) FILTER (WHERE sent_at >= (now() - '24:00:00'::interval)) AS sent_24h,
    count(*) FILTER (WHERE sent_at >= (now() - '7 days'::interval)) AS sent_7d,
    count(*) FILTER (WHERE sent_at >= (now() - '30 days'::interval)) AS sent_30d,
    count(*) FILTER (WHERE send_blocked_at IS NOT NULL AND send_blocked_reason <> 'discarded_in_inbox'::text) AS blocked,
    max(sent_at) AS last_sent
   FROM dedup
  GROUP BY client_id, message_type, channel;

CREATE OR REPLACE FUNCTION public.claim_inbox_workflow_notification(p_alert jsonb)
 RETURNS TABLE(id uuid, created boolean, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_key text := nullif(p_alert->>'incident_key', '');
  v_family text := p_alert->>'family';
  v_now timestamptz := clock_timestamp();
  v_previous public.inbox_notifications%rowtype;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_key is null or length(v_key) > 1000 then raise exception 'incident_key required'; end if;
  if v_family not in ('system_infra_alarm','send_failed_alert','lane_supply_alarm') then
    raise exception 'family is not a transient workflow alert';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select * into v_previous from public.inbox_notifications n
   where n.incident_key = v_key order by n.last_seen_at desc, n.created_at desc limit 1 for update;
  if found and v_previous.last_seen_at > v_now - interval '24 hours' then
    update public.inbox_notifications n
       set last_seen_at = v_now, count = n.count + 1
     where n.id = v_previous.id;
    return query select v_previous.id, false, v_previous.expires_at;
    return;
  end if;

  insert into public.inbox_notifications
    (family, source, dedupe_key, incident_key, severity, title, body, url, media, group_key, tenant,
     first_seen_at, last_seen_at, created_at, expires_at)
  values
    (v_family, p_alert->>'source', p_alert->>'dedupe_key', v_key,
     coalesce(p_alert->>'severity','info'), p_alert->>'title', p_alert->>'body',
     p_alert->>'url', p_alert->'media', p_alert->>'group_key', p_alert->>'tenant',
     v_now, v_now, v_now, v_now + interval '4 hours')
  returning inbox_notifications.id, inbox_notifications.expires_at into v_id, v_expires;
  return query select v_id, true, v_expires;
end; $function$
;

drop function if exists public.is_unreachable_recipient_reason(text);
