-- 2026-11-17 speed pass: inbox_interest_prospects_v reads enrichment_data ONCE per row. NOT APPLIED: for review.
--
-- Why. The view classifies every prospect (source_lane) with up to ~12 `p.enrichment_data ->> ...` lookups.
-- Postgres detoasts the whole jsonb again for each lookup, and enrichment_data is ~162 MB across ~62k rows,
-- so a plain read of the view cost ~4.5 s of database time (EXPLAIN ANALYZE, 2026-11-17: 4562 ms and 4753 ms).
-- Lanes reads this view six times on open, and inbox_interest_replacement_v reads it twice more (5-8 s per open).
--
-- What. The same view, same columns in the same order, same rows. The only change: a lateral
-- `(SELECT p.enrichment_data || '{}'::jsonb AS ed OFFSET 0) e` makes one detoasted copy per row and the
-- classification and copy_vertical read `e.ed`. The `enrichment_data` column itself is still p.enrichment_data.
-- `|| '{}'` keeps NULL as NULL and adds nothing to an object; on a non-object every ->> is NULL either way.
-- Measured on the live data with the old and new SELECT: identical md5 over every row and column, 4.5 s -> 1.05 s.
--
-- security_invoker = on is written out again on purpose: a replaced view loses options it is not given.
-- Columns, grants and the two dependent views (inbox_interest_perf_v, inbox_interest_replacement_v) are unchanged.

CREATE OR REPLACE VIEW public.inbox_interest_prospects_v WITH (security_invoker = on) AS
SELECT p.id,
    p.campaign_id,
    p.linkedin_url,
    p.linkedin_profile_id,
    p.apollo_id,
    p.name,
    p.headline,
    p.company,
    p.location,
    p.industry,
    p.profile_photo_url,
    p.icp_score,
    p.icp_reasoning,
    p.activity_score,
    p.last_post_date,
    p.last_engagement_date,
    p.post_count_30d,
    p.recent_topics,
    p.stage,
    p.profile_viewed_at,
    p.posts_liked,
    p.posts_commented,
    p.last_engaged_at,
    p.connection_sent_at,
    p.connection_note,
    p.connected_at,
    p.last_dm_sent_at,
    p.dm_count,
    p.last_reply_at,
    p.reply_count,
    p.needs_manual_reply,
    p.next_touch_after,
    p.blacklisted,
    p.notes,
    p.skip_reason,
    p.enrichment_data,
    p.created_at,
    p.updated_at,
    p.seniority,
    p.department,
    p.employee_count,
    p.founded_year,
    p.company_domain,
    p.company_linkedin_url,
    p.email_status,
    p.city,
    p.state,
    p.country,
    p.title,
    p.email,
    p.phone,
    p.annual_revenue,
    p.company_description,
    p.company_keywords,
    p.note_variant,
    p.preferred_channel,
    p.trigger_type,
    p.trigger_detail,
    p.trigger_hook,
    p.trigger_ask,
    p.trigger_source_url,
    p.trigger_confidence,
    p.researched_at,
    p.micro_persona,
    p.messaging_pattern,
    p.research_sources,
    p.skip_state,
    p.skip_state_reason,
    p.skip_state_at,
    p.matched_offer,
    p.offer_angle,
    p.ad_signal,
    p.send_priority,
    p.rescore_attempts,
    p.follower_count,
    p.email_icebreaker,
    p.recent_posts,
    p.email_descriptor,
    p.email_verification,
    p.email_verified_at,
    p.hypertarget_reserved,
    p.scorer_version,
    p.scored_at,
    p.audience_density,
    p.email_campaign_id,
    p.email_loaded_at,
    p.operator_note,
    p.operator_note_at,
    p.connections_count,
    p.liveness_checked_at,
    p.call_booked_at,
    p.recycled_at,
    p.attributed_post_id,
    p.attribution,
    p.attributed_at,
    p.attribution_meta,
    p.booking_variant,
    p.slot_ask,
    p.solved_at,
    COALESCE(c.client_id, 'ivan'::text) AS client_id,
    s.source_lane,
    e.ed ->> 'copy_vertical'::text AS copy_vertical
   FROM outreach_prospects p
     JOIN outreach_campaigns c ON c.id = p.campaign_id
     CROSS JOIN LATERAL ( SELECT p.enrichment_data || '{}'::jsonb AS ed OFFSET 0) e
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN COALESCE(c.client_id, 'ivan'::text) = 'ivan'::text THEN
                    CASE
                        WHEN p.trigger_type = 'profile_view'::text OR (e.ed ->> 'source'::text) = 'profile_view'::text THEN 'profile_view'::text
                        WHEN p.trigger_type = 'content_signal'::text THEN 'content_signal'::text
                        WHEN p.trigger_type = ANY (ARRAY['engaged_post'::text, 'content_engagement'::text]) THEN
                        CASE
                            WHEN (e.ed ->> 'lane'::text) = 'own_post_engager'::text OR (e.ed ->> 'source_kind'::text) = 'own_post_engager'::text OR (e.ed ->> 'source'::text) = 'own_post_engager'::text THEN 'own_post_engager'::text
                            ELSE 'competitor_engager'::text
                        END
                        ELSE NULL::text
                    END
                    WHEN c.client_id = 'risedtc'::text THEN
                    CASE
                        WHEN (e.ed ->> 'source'::text) = 'profile_view'::text THEN 'profile_view'::text
                        WHEN (e.ed ->> 'source'::text) = 'rise_warm_engager'::text AND ((e.ed ->> 'engagement_kind'::text) = ANY (ARRAY['reaction'::text, 'comment'::text])) AND NULLIF(e.ed ->> 'post_id'::text, ''::text) IS NOT NULL AND NULLIF(e.ed ->> 'anchor'::text, ''::text) IS NOT NULL THEN 'competitor_engager'::text
                        WHEN (e.ed ->> 'source'::text) ~~ 'competitor_engager_%'::text THEN 'competitor_engager'::text
                        ELSE NULL::text
                    END
                    WHEN c.client_id = 'arch'::text THEN
                    CASE
                        WHEN (e.ed ->> 'source_kind'::text) = 'profile_view_warm'::text THEN 'profile_view'::text
                        WHEN (e.ed ->> 'source_kind'::text) = 'own_post_engager'::text THEN 'own_post_engager'::text
                        WHEN (e.ed ->> 'source_kind'::text) = ANY (ARRAY['competitor_post_engager'::text, 'pilot_anchor_post_engager'::text]) THEN 'competitor_engager'::text
                        WHEN (e.ed ->> 'source_kind'::text) = 'hand_raise'::text THEN 'content_signal'::text
                        ELSE NULL::text
                    END
                    WHEN c.client_id = 'swishdm'::text AND (e.ed ->> 'source'::text) = 'swishdm_anchor_engager'::text THEN 'competitor_engager'::text
                    ELSE NULL::text
                END AS source_lane) s
  WHERE s.source_lane IS NOT NULL;
