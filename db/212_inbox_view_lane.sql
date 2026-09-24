-- db/212 — thread list carries its campaign lane (Ivan, 2026-09-24: "on inbox we can see
-- the different lanes we are sending to with a tag no? specially for davorin's").
--
-- outreach_prospects.enrichment_data->>'lane' already holds the campaign lane (ARCH:
-- company_expansion, engager_warm, hiring_signal, funding_signal, new_in_role, profile_view,
-- israel_trip, cold_games/cold_apps, sponsor_team/sponsor_mined, soft_launch, orbit_pilot_*,
-- test_geo_ads, hand_raise, warm_games/warm_apps; RISE: company_expansion, ad_library_engager,
-- ad_velocity, hand_raise; Ivan: skool_owner, adlib_twin_engager, own_post_engager,
-- podcast_guest — read live 2026-09-24 via the mgmt API, read-only). It only ever lacked a
-- surface. Denormalising it onto inbox_messages_v means the DM thread list gets the field on
-- the SAME row it already selects with `select('*')` — no extra query per thread.
--
-- inbox_messages_v gains one column at the END so CREATE OR REPLACE VIEW is legal;
-- security_invoker stays on. Applied via the Management API on 2026-09-24.
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
    p.blacklisted AS prospect_blacklisted,
    p.enrichment_data->>'lane' AS lane
   FROM outreach_messages m
     JOIN outreach_prospects p ON p.id = m.prospect_id
     JOIN outreach_campaigns c ON c.id = p.campaign_id
     LEFT JOIN unipile_chats uc ON uc.chat_id = m.unipile_chat_id
     LEFT JOIN LATERAL ( SELECT x.provider_id FROM unipile_chats x
          WHERE x.attendee_provider_id IS NOT NULL AND x.attendee_provider_id = p.linkedin_profile_id LIMIT 1) ua ON true;
