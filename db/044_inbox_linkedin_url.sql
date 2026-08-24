-- 044: the conversation carries its own LinkedIn link.
--
-- Ivan, 2026-08-24, on Evan T. ("my email is Evan@kuvola.com" — the reply that needs a
-- calendar invite sent by hand): "can we have the LinkedIn chat URL on the inbox DMs on
-- each DM so I can copy and send to Mattan when the chat requires him to do something
-- manual? In this case, he needs to manually invite this guy to the meeting."
--
-- 🔴 IT IS THE PROFILE URL, AND THAT IS THE ONLY REAL LINK WE HOLD.
-- outreach_messages.unipile_chat_id is a Unipile id (Evan's is `j6k84xrlXBGSk4vs4Kcxkw`),
-- NOT a LinkedIn conversation id, so it does not resolve to a
-- linkedin.com/messaging/thread/… address. lib/inbox.ts records the same fact where the
-- context-gap escalation hands Mattan a link. Messaging from the profile opens the
-- EXISTING thread, so the profile URL lands him in the chat.
--
-- Coverage is total: 12,482 of 12,482 outreach_prospects rows carry linkedin_url, so no
-- row surfaces a dead affordance.
--
-- Body identical to the live view except the appended final column. CREATE OR REPLACE
-- keeps the existing grants (anon + authenticated hold SELECT) and security_invoker=on,
-- and the new column is added LAST so every existing column keeps its name, type and
-- position — the only shape PostgreSQL allows a view to be replaced in.
create or replace view public.inbox_messages_v with (security_invoker = on) as
 SELECT m.id,
    m.prospect_id,
    m.direction,
    m.message_text,
    m.message_type,
    COALESCE(m.channel, 'linkedin'::text) AS channel,
    m.sent_at,
    m.approved_at,
    m.read_at,
    m.created_at,
    m.send_blocked_at,
    m.send_blocked_reason,
    m.unipile_chat_id,
    m.ai_model,
    p.name AS prospect_name,
    p.company AS prospect_company,
    p.headline AS prospect_headline,
    p.stage AS prospect_stage,
    p.email AS prospect_email,
    p.profile_photo_url,
    c.name AS campaign_name,
    COALESCE(c.client_id, 'ivan'::text) AS client_id,
    m.snoozed_until,
    m.snoozed_at,
    p.linkedin_url AS prospect_linkedin_url
   FROM outreach_messages m
     JOIN outreach_prospects p ON p.id = m.prospect_id
     JOIN outreach_campaigns c ON c.id = p.campaign_id;
