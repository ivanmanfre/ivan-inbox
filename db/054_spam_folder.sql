-- db/054 — the "Likely spam" folder (Ivan, 2026-09-07, on John Adegboye's Upwork pitch
-- reaching his inbox as a Rise "Replied" thread with five pushes and a reply draft).
--
-- Applied 2026-09-07 via the Management API. Two objects change; nothing new is created.
--
-- 1. inbox_messages_v gains prospect_skip_reason. The app files a thread whose prospect
--    carries skip_reason = 'inbound_vendor_pitch' (the RISE reply detector's vendor
--    verdict, and the inbox's own Spam button) under the "Likely spam" chip: out of every
--    other lane and out of the badge, never out of reach.
-- 2. notify_inbox_push skips an inbound row whose prospect carries that marker, so a
--    filed pitch never rings the phone. Everything else pushes exactly as before.
--
-- Column added at the END so CREATE OR REPLACE VIEW is legal; security_invoker stays on.
create or replace view public.inbox_messages_v with (security_invoker = on) as
 SELECT m.id, m.prospect_id, m.direction, m.message_text, m.message_type,
    COALESCE(m.channel, 'linkedin'::text) AS channel,
    m.sent_at, m.approved_at, m.read_at, m.created_at, m.send_blocked_at, m.send_blocked_reason,
    m.unipile_chat_id, m.ai_model,
    p.name AS prospect_name, p.company AS prospect_company, p.headline AS prospect_headline,
    p.stage AS prospect_stage, p.email AS prospect_email, p.profile_photo_url,
    c.name AS campaign_name, COALESCE(c.client_id, 'ivan'::text) AS client_id,
    m.snoozed_until, m.snoozed_at,
    p.linkedin_url AS prospect_linkedin_url,
    COALESCE(uc.provider_id, ua.provider_id) AS chat_provider_id,
    p.skip_reason AS prospect_skip_reason
   FROM outreach_messages m
     JOIN outreach_prospects p ON p.id = m.prospect_id
     JOIN outreach_campaigns c ON c.id = p.campaign_id
     LEFT JOIN unipile_chats uc ON uc.chat_id = m.unipile_chat_id
     LEFT JOIN LATERAL ( SELECT x.provider_id FROM unipile_chats x
          WHERE x.attendee_provider_id IS NOT NULL AND x.attendee_provider_id = p.linkedin_profile_id LIMIT 1) ua ON true;

-- The x-inbox-secret value is a PLACEHOLDER here, as in db/002; the live function holds it.
create or replace function public.notify_inbox_push() returns trigger
language plpgsql security definer as $fn$
declare v_skip text;
begin
  if new.direction = 'inbound' then
    select p.skip_reason into v_skip from public.outreach_prospects p where p.id = new.prospect_id;
    if v_skip is distinct from 'inbound_vendor_pitch' then
      perform net.http_post(
        url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-push',
        headers := jsonb_build_object('Content-Type','application/json',
                                      'x-inbox-secret','<INBOX_PUSH_SECRET>'),
        body := jsonb_build_object('message_id', new.id)
      );
    end if;
  end if;
  return new;
end $fn$;
