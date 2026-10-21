-- A recipient LinkedIn will not deliver to is never a failure, on every seat (Ivan 2026-10-21, Ben Chehebar on
-- RISE and Toby Hart on Ivan: "if he's blocked, he shouldn't even appear as an error ... I don't want to see it").
--
-- PR #47 made these rows a quiet "Not delivered" line in DMs (src/lib/inbox.ts isUnreachableRecipient, words in
-- UNREACHABLE_MARKS: 'invalid_recipient', 'blocked_recipient'). This does the same for the two server-side places
-- that still counted or rang them:
--   1. inbox_sends_v.blocked (the per-lane "N blocked" on the Sends / Lanes cards) leaves them out.
--   2. claim_inbox_workflow_notification (the bell + phone push for send_failed_alert, fed by wa-relay from
--      Outreach - Send Messages kFYlfnWd98YaiErH) records such an alert already dismissed and returns
--      created=false, so it is kept for the record but never shows in the bell and never pushes.
--      The sender's alert text only says "status code 422", so the class is read from the row it is about:
--      the recipient's outbound row blocked in the last 30 minutes whose reason, now or in its revisions,
--      carries one of the words. A first-ever 422 whose provider type was not written down still rings.
-- Left alone on purpose: no_connection_with_recipient (fixable with an invite) and InMail quota errors
-- (inmail_failed_422 ... limit_exceeded).
--
-- Rollback: db/20261021_unreachable_not_failed_rollback.sql (the live definitions saved before this ran).

-- The SQL twin of isUnreachableRecipient: keep the words in step with UNREACHABLE_MARKS in src/lib/inbox.ts.
create or replace function public.is_unreachable_recipient_reason(p_reason text)
returns boolean
language sql
immutable
as $$
  select strpos(coalesce(p_reason, ''), 'invalid_recipient') > 0
      or strpos(coalesce(p_reason, ''), 'blocked_recipient') > 0
$$;

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
    count(*) FILTER (WHERE send_blocked_at IS NOT NULL AND send_blocked_reason <> 'discarded_in_inbox'::text
      AND NOT public.is_unreachable_recipient_reason(send_blocked_reason)) AS blocked,
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
  v_text text := coalesce(p_alert->>'title', '') || ' ' || coalesce(p_alert->>'body', '');
  v_name text;
  v_quiet boolean := false;
begin
  if v_key is null or length(v_key) > 1000 then raise exception 'incident_key required'; end if;
  if v_family not in ('system_infra_alarm','send_failed_alert','lane_supply_alarm') then
    raise exception 'family is not a transient workflow alert';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- A recipient LinkedIn will not deliver to (blocked us, cannot receive messages) is not a failure (Ivan 10-21).
  if v_family = 'send_failed_alert' then
    v_name := nullif(btrim(substring(v_text from ' to (.+?)\. Row reset')), '');
    v_quiet := public.is_unreachable_recipient_reason(v_text)
      or (v_name is not null and v_text ~ '\m422\M' and exists (
        select 1
          from public.outreach_messages m
          join public.outreach_prospects p on p.id = m.prospect_id
         where m.direction = 'outbound' and m.sent_at is null
           and m.send_blocked_at > v_now - interval '30 minutes'
           and lower(btrim(p.name)) = lower(v_name)
           and (public.is_unreachable_recipient_reason(m.send_blocked_reason)
             or exists (select 1 from public.outreach_message_revisions r
                         where r.message_id = m.id and public.is_unreachable_recipient_reason(r.old_send_blocked_reason)))));
  end if;

  select * into v_previous from public.inbox_notifications n
   where n.incident_key = v_key order by n.last_seen_at desc, n.created_at desc limit 1 for update;
  if found and v_previous.last_seen_at > v_now - interval '24 hours' then
    update public.inbox_notifications n
       set last_seen_at = v_now, count = n.count + 1,
           dismissed_at = case when v_quiet then coalesce(n.dismissed_at, v_now) else n.dismissed_at end
     where n.id = v_previous.id;
    return query select v_previous.id, false, v_previous.expires_at;
    return;
  end if;

  insert into public.inbox_notifications
    (family, source, dedupe_key, incident_key, severity, title, body, url, media, group_key, tenant,
     first_seen_at, last_seen_at, created_at, expires_at, read_at, dismissed_at)
  values
    (v_family, p_alert->>'source', p_alert->>'dedupe_key', v_key,
     coalesce(p_alert->>'severity','info'), p_alert->>'title', p_alert->>'body',
     p_alert->>'url', p_alert->'media', p_alert->>'group_key', p_alert->>'tenant',
     v_now, v_now, v_now, v_now + interval '4 hours',
     case when v_quiet then v_now end, case when v_quiet then v_now end)
  returning inbox_notifications.id, inbox_notifications.expires_at into v_id, v_expires;
  -- Recorded, never rung: created=false keeps notify.ts from pushing it.
  return query select v_id, not v_quiet, v_expires;
end; $function$;

-- The open bell rows these people already raised (send_failed_alert for a recipient with an unsent row labelled
-- unreachable, now or in its revisions, e.g. Ben's row discarded after the relabel): dismissed, kept.
update public.inbox_notifications n
   set dismissed_at = now()
 where n.family = 'send_failed_alert' and n.dismissed_at is null
   and exists (
     select 1
       from public.outreach_messages m
       join public.outreach_prospects p on p.id = m.prospect_id
      where m.direction = 'outbound' and m.sent_at is null
        and lower(btrim(p.name)) = lower(nullif(btrim(substring(n.title from ' to (.+?)\. Row reset')), ''))
        and (public.is_unreachable_recipient_reason(m.send_blocked_reason)
          or exists (select 1 from public.outreach_message_revisions r
                      where r.message_id = m.id and public.is_unreachable_recipient_reason(r.old_send_blocked_reason))));
