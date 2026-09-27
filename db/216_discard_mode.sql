-- db/216 — decision 12 (blueprint v3, the Lou Nesin question 2026-09-22): discarding a reply draft offers
-- "Discard, I'll reply myself", which keeps the thread under Needs your reply. The discard itself is
-- unchanged (send_blocked_reason = 'discarded_in_inbox', so no drafter redrafts: the RISE Reply Drafter
-- stands down only on that exact reason). The MODE rides a separate nullable column that only the inbox
-- app reads: 'reply_myself', or null for a plain discard. Restore clears it.
-- Checked before applying (2026-09-26): both row triggers on outreach_messages name their columns
-- (revisions snapshot, dupe guard); no view depends on inbox_messages_v.

alter table public.outreach_messages add column if not exists discard_mode text;

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
    lane_of(c.name) AS campaign_lane,
    m.discard_mode
   FROM outreach_messages m
     JOIN outreach_prospects p ON p.id = m.prospect_id
     JOIN outreach_campaigns c ON c.id = p.campaign_id
     LEFT JOIN unipile_chats uc ON uc.chat_id = m.unipile_chat_id
     LEFT JOIN LATERAL ( SELECT x.provider_id
           FROM unipile_chats x
          WHERE x.attendee_provider_id IS NOT NULL AND x.attendee_provider_id = p.linkedin_profile_id
         LIMIT 1) ua ON true
     LEFT JOIN inbox_arch_copy_route_v acr ON acr.prospect_id = m.prospect_id;
