-- db/204 — "Needs your reply" honours the reply detector (Ivan, 2026-09-22: "some people
-- here doesn't need a follow up idk why they appear on needs ur reply").
--
-- Andy Brenits ("No thank you, not Needed."), Matias Gonzalez ("No, thanks!!") and
-- Jonathan S. ("Don't message me again") sat in the block for 8-13 days. The detector had
-- stamped each inbound reply_intent = 'negative' and blacklisted the prospect, but the view
-- carried neither column, so the app re-judged the text with a phrase list (which knows
-- "no thanks" and not "no thank you") and the stage (a decline stays 'replied').
--
-- inbox_messages_v gains two columns at the END so CREATE OR REPLACE VIEW is legal;
-- security_invoker stays on. Applied via the Management API on 2026-09-22.
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
    p.skip_reason AS prospect_skip_reason,
    m.reply_intent,
    p.blacklisted AS prospect_blacklisted
   FROM outreach_messages m
     JOIN outreach_prospects p ON p.id = m.prospect_id
     JOIN outreach_campaigns c ON c.id = p.campaign_id
     LEFT JOIN unipile_chats uc ON uc.chat_id = m.unipile_chat_id
     LEFT JOIN LATERAL ( SELECT x.provider_id FROM unipile_chats x
          WHERE x.attendee_provider_id IS NOT NULL AND x.attendee_provider_id = p.linkedin_profile_id LIMIT 1) ua ON true;
