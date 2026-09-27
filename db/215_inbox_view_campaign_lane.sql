-- db/215 — every DM thread carries its CAMPAIGN lane (lane_of(campaign name), db/056), so the DMs rebuild
-- can put a lane chip on every row (blueprint v3 decision 3). The stored per-person lane (db/212,
-- enrichment_data->>'lane') is set on almost every ARCH row but on ~1 of 1,000 Ivan and RISE rows
-- (live read 2026-09-26: ivan 1069 null / 1 set, risedtc 913 null / 40 set), so the screen shows `lane`
-- when set and falls back to this column. Additive: one column appended at the end, nothing else changes.

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
    p.linkedin_url AS prospect_linkedin_url,
    COALESCE(uc.provider_id, ua.provider_id) AS chat_provider_id,
    p.skip_reason AS prospect_skip_reason,
    m.reply_intent,
    p.blacklisted AS prospect_blacklisted,
    p.enrichment_data ->> 'lane'::text AS lane,
    acr.copy_route,
    lane_of(c.name) AS campaign_lane
   FROM outreach_messages m
     JOIN outreach_prospects p ON p.id = m.prospect_id
     JOIN outreach_campaigns c ON c.id = p.campaign_id
     LEFT JOIN unipile_chats uc ON uc.chat_id = m.unipile_chat_id
     LEFT JOIN LATERAL ( SELECT x.provider_id
           FROM unipile_chats x
          WHERE x.attendee_provider_id IS NOT NULL AND x.attendee_provider_id = p.linkedin_profile_id
         LIMIT 1) ua ON true
     LEFT JOIN inbox_arch_copy_route_v acr ON acr.prospect_id = m.prospect_id;
