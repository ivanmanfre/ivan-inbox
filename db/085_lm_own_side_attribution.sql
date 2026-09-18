-- 085 — own-side lead-magnet attribution: stamp forward
-- goal-run lm-own-side-attribution-2026-09-17, phase P1 (items A2 + B1).
--
-- WHY
-- `own_posts_scored.lead_magnet_slug` is not a stored column: it is projected from
-- `scheduled_posts` through a LATERAL that joins ONLY on `clickup_task_id`. Measured
-- 2026-09-18 over the last 180 days of published posts:
--     scheduled_posts.unipile_social_id  = own_posts.social_id        140/162 = 86.4%
--     scheduled_posts.clickup_task_id    = own_posts.clickup_task_id  105/162 = 64.8%
-- The weak key is used because `Own Post Performance Tracker` (XMuGMZJlcF9pB3Db) upserts
-- own_posts on conflict(social_id) WITHOUT clickup_task_id, so a metrics refresh leaves the
-- column null on 74 of 197 rows in the window. The publisher (0Ym6bP7gEmskPJZn, node
-- `Store in own_posts`) does write both, which is why the social-id key is the stronger one.
--
-- WHAT CHANGES
-- A2: widen the LATERAL to `(unipile_social_id = social_id OR clickup_task_id = clickup_task_id)`,
--     with the empty-string unipile_social_id rows excluded (14 rows in the window are
--     status='posted' with unipile_social_id = '' and would otherwise match nothing/anything),
--     and an ORDER BY that prefers the social-id match so the queue row that actually produced
--     the post wins over any weaker clickup match.
-- B1: `client_post_metrics.lead_magnet_slug`, nullable, no default, no backfill here.
--
-- INVARIANTS (verified after apply, see the goal-run report)
--   * column list of own_posts_scored unchanged in name, order and type
--   * exactly one view row per own_posts row (LIMIT 1 in the LATERAL); before = after = 257
--   * no duplicate social_id
--   * dependents still compile: view audn_classification_source_resolution_v;
--     functions audn_benchmark_payload_v15, audn_themes_payload, audn_writer_context,
--     operator_lead_magnets
--
-- ROLLBACK: snapshots/own_posts_scored.pre-085.sql holds the pre-change definition verbatim.

begin;

-- ── A2 ────────────────────────────────────────────────────────────────────────
create or replace view public.own_posts_scored as
 SELECT o.id,
    o.linkedin_url,
    o.social_id,
    o.num_impressions,
    o.num_likes,
    o.num_comments,
    o.num_shares,
    o.pillar,
    o.hook_type,
    o.hook_pattern,
    o.topic_category,
    o.post_type,
    o.post_text,
    o.posted_at,
    o.metrics_updated_at,
    o.clickup_task_id,
    o.source,
    COALESCE(sp.post_kind, 'reach'::text) AS post_kind,
    sp.lead_magnet_slug,
    cap.captures_all AS named_leads,
    cap.captures_30d AS named_leads_30d,
    cap.capture_rate_pct,
    GREATEST(COALESCE(( SELECT count(*) AS count
           FROM scheduled_posts sp2
          WHERE sp2.lead_magnet_slug = sp.lead_magnet_slug), 0::bigint) - 1, 0::bigint) AS also_promoted_by
   FROM own_posts o
     LEFT JOIN LATERAL ( SELECT sp1.post_kind,
            sp1.lead_magnet_slug
           FROM scheduled_posts sp1
          -- 085: the social id is the exact identity of the queue row that produced this post;
          -- clickup_task_id is kept as the pre-085 fallback for rows the publisher never stamped.
          -- NULLIF drops the 14 posted-but-empty unipile_social_id rows from the match.
          WHERE NULLIF(sp1.unipile_social_id, ''::text) = o.social_id
             OR sp1.clickup_task_id = o.clickup_task_id
          ORDER BY ((NULLIF(sp1.unipile_social_id, ''::text) = o.social_id) IS TRUE) DESC,
                   (sp1.lead_magnet_slug IS NOT NULL) DESC,
                   (sp1.post_kind = 'capture'::text) DESC,
                   sp1.created_at DESC,
                   sp1.id
         LIMIT 1) sp ON true
     LEFT JOIN ( SELECT lm_events.lm_slug,
            count(DISTINCT
                CASE
                    WHEN lm_events.event_type = 'capture'::text THEN lm_events.email
                    ELSE NULL::text
                END) AS captures_all,
            count(DISTINCT
                CASE
                    WHEN lm_events.event_type = 'capture'::text AND lm_events.created_at > (now() - '30 days'::interval) THEN lm_events.email
                    ELSE NULL::text
                END) AS captures_30d,
                CASE
                    WHEN count(DISTINCT
                    CASE
                        WHEN lm_events.event_type = 'view'::text THEN lm_events.id
                        ELSE NULL::uuid
                    END) > 0 THEN round(100.0 * count(DISTINCT
                    CASE
                        WHEN lm_events.event_type = 'capture'::text THEN lm_events.email
                        ELSE NULL::text
                    END)::numeric / count(DISTINCT
                    CASE
                        WHEN lm_events.event_type = 'view'::text THEN lm_events.id
                        ELSE NULL::uuid
                    END)::numeric, 1)
                    ELSE 0::numeric
                END AS capture_rate_pct
           FROM lm_events
          GROUP BY lm_events.lm_slug) cap ON cap.lm_slug = sp.lead_magnet_slug;

-- ── B1 ────────────────────────────────────────────────────────────────────────
-- Nullable, no default. Filled by the two live trackers (RiiDfqrFgNJK0oTW ARCH,
-- rrprmLeoU0pjpEmq RISE) from carousel_drafts.source_detail.lm_ref / taxonomy.lm_slug,
-- and by the P2 exact-key backfill. Every reader of this table names its columns
-- explicitly (audited 2026-09-18: no `select=*`, no positional insert anywhere in
-- workflows/, personal-site/ or ivan-inbox/), so the new column breaks nothing.
alter table public.client_post_metrics
  add column if not exists lead_magnet_slug text;

comment on column public.client_post_metrics.lead_magnet_slug is
  'Lead magnet this post promotes. Exact keys only (lead_magnets.linkedin_social_id, or the draft''s durable source_detail.lm_ref via carousel_drafts.source_post_id). Never inferred from post text. Added by goal-run lm-own-side-attribution-2026-09-17.';

commit;
