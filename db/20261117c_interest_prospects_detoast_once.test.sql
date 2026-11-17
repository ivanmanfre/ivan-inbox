-- Rolled-back test of 20261117c. Nothing is committed: the block always ends in an exception.
-- Passes when the new view returns exactly the rows the old one did (md5 over every row and column) and keeps
-- security_invoker. Run as postgres through the Management API; read the result from the exception text.
DO $t$
DECLARE before_md5 text; after_md5 text; before_n bigint; after_n bigint; opts text[];
BEGIN
  SELECT md5(string_agg(v::text, '|' ORDER BY v.id)), count(*) INTO before_md5, before_n FROM public.inbox_interest_prospects_v v;
  EXECUTE $mig$
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
  WHERE s.source_lane IS NOT NULL
$mig$;
  SELECT md5(string_agg(v::text, '|' ORDER BY v.id)), count(*) INTO after_md5, after_n FROM public.inbox_interest_prospects_v v;
  SELECT reloptions INTO opts FROM pg_class WHERE oid = 'public.inbox_interest_prospects_v'::regclass;
  RAISE EXCEPTION 'TEST RESULT: same_rows=% rows=%/% security_invoker=% (rolled back)',
    before_md5 = after_md5, before_n, after_n, 'security_invoker=on' = ANY (opts);
END
$t$;
