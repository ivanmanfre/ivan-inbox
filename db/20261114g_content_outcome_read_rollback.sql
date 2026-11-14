-- Rollback of 20261114g_content_outcome_read.sql: the two booking views back to their definitions before it (as
-- pg_get_viewdef printed them on 2026-11-14), the cron job, functions and new views removed. The read tables are kept
-- for the record (drop them by hand if wanted: content_outcome_read_posts, content_outcome_read_rows, content_outcome_reads).
BEGIN;
CREATE OR REPLACE VIEW public.cb37_booking_post_links_v AS
 WITH bk AS MATERIALIZED (
         SELECT b.client_id,
            b.meeting_id,
            b.booked_at,
            b.prospect_id,
            lower(btrim(b.booker_email)) AS booker_email,
            b.verdict
           FROM booking_attributions b
          WHERE b.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])
        ), who AS MATERIALIZED (
         SELECT bk_1.client_id,
            bk_1.meeting_id,
            p.linkedin_profile_id AS person_key,
            p.id AS prospect_id,
            'booking.prospect_id'::text AS identity_evidence
           FROM bk bk_1
             JOIN outreach_prospects p ON p.id = bk_1.prospect_id
          WHERE NULLIF(btrim(p.linkedin_profile_id), ''::text) IS NOT NULL
        UNION
         SELECT bk_1.client_id,
            bk_1.meeting_id,
            p.linkedin_profile_id,
            p.id,
            'booker_email = prospect.email (same client)'::text
           FROM bk bk_1
             JOIN outreach_prospects p ON lower(btrim(p.email)) = bk_1.booker_email
             JOIN outreach_campaigns c ON c.id = p.campaign_id AND COALESCE(c.client_id, 'ivan'::text) = bk_1.client_id
          WHERE bk_1.booker_email IS NOT NULL AND NULLIF(btrim(p.linkedin_profile_id), ''::text) IS NOT NULL
        ), eng AS MATERIALIZED (
         SELECT e_1.client_id,
            e_1.post_key,
            e_1.person_key,
            e_1.first_seen,
            e_1.sources,
            e_1.kinds
           FROM cb37_post_engagers_v e_1
        )
 SELECT w.client_id,
    w.meeting_id,
    bk.booked_at,
    e.post_key,
    w.person_key,
        CASE
            WHEN dm.first_dm IS NOT NULL THEN 'engaged_then_dm_then_booked'::text
            ELSE 'engaged_then_booked'::text
        END AS path,
    jsonb_build_object('booking', jsonb_build_object('meeting_id', w.meeting_id, 'booked_at', bk.booked_at, 'verdict', bk.verdict), 'identity', jsonb_build_object('how', w.identity_evidence, 'prospect_id', w.prospect_id, 'person_key', w.person_key), 'engagement', jsonb_build_object('post_key', e.post_key, 'first_seen', e.first_seen, 'kinds', e.kinds, 'sources', e.sources), 'dm', jsonb_build_object('first_outbound_between_engagement_and_booking', dm.first_dm, 'message_id', dm.msg_id)) AS evidence
   FROM who w
     JOIN bk ON bk.client_id = w.client_id AND bk.meeting_id = w.meeting_id
     JOIN eng e ON e.client_id = w.client_id AND e.person_key = w.person_key AND e.first_seen <= bk.booked_at
     LEFT JOIN LATERAL ( SELECT min(COALESCE(m.sent_at, m.created_at)) AS first_dm,
            (array_agg(m.id ORDER BY (COALESCE(m.sent_at, m.created_at))))[1] AS msg_id
           FROM outreach_prospects p2
             JOIN outreach_campaigns c2 ON c2.id = p2.campaign_id AND COALESCE(c2.client_id, 'ivan'::text) = w.client_id
             JOIN outreach_messages m ON m.prospect_id = p2.id
          WHERE p2.linkedin_profile_id = w.person_key AND m.direction = 'outbound'::text AND m.unipile_message_id IS NOT NULL AND COALESCE(m.sent_at, m.created_at) >= e.first_seen AND COALESCE(m.sent_at, m.created_at) <= bk.booked_at) dm ON true;

CREATE OR REPLACE VIEW public.cb37_booking_coverage_v AS
 WITH bk AS MATERIALIZED (
         SELECT b.client_id,
            b.meeting_id,
            b.booked_at,
            b.prospect_id,
            lower(btrim(b.booker_email)) AS booker_email,
            b.verdict,
            b.meeting_title,
            o.event_type,
            o.meeting_kind
           FROM booking_attributions b
             LEFT JOIN audn_outcomes_v o ON o.client_id = b.client_id AND o.outcome_id = b.meeting_id
          WHERE b.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])
        ), pmap AS MATERIALIZED (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            p.id AS prospect_id,
            lower(btrim(p.email)) AS em,
            NULLIF(btrim(p.linkedin_profile_id), ''::text) AS person_key
           FROM outreach_prospects p
             JOIN outreach_campaigns c ON c.id = p.campaign_id
          WHERE (p.id IN ( SELECT bk_1.prospect_id
                   FROM bk bk_1
                  WHERE bk_1.prospect_id IS NOT NULL)) OR (lower(btrim(p.email)) IN ( SELECT bk_1.booker_email
                   FROM bk bk_1
                  WHERE bk_1.booker_email IS NOT NULL))
        ), persons AS MATERIALIZED (
         SELECT bk_1.client_id,
            bk_1.meeting_id,
            pm.person_key
           FROM bk bk_1
             JOIN pmap pm ON pm.prospect_id = bk_1.prospect_id
          WHERE pm.person_key IS NOT NULL
        UNION
         SELECT bk_1.client_id,
            bk_1.meeting_id,
            pm.person_key
           FROM bk bk_1
             JOIN pmap pm ON pm.client_id = bk_1.client_id AND pm.em = bk_1.booker_email
          WHERE pm.person_key IS NOT NULL
        ), eng AS MATERIALIZED (
         SELECT e.client_id,
            e.person_key,
            min(e.first_seen) AS first_seen_any
           FROM cb37_post_engagers_v e
          GROUP BY e.client_id, e.person_key
        ), any_eng AS (
         SELECT pe.client_id,
            pe.meeting_id,
            min(e.first_seen_any) AS first_seen_any
           FROM persons pe
             JOIN eng e ON e.client_id = pe.client_id AND e.person_key = pe.person_key
          GROUP BY pe.client_id, pe.meeting_id
        ), links AS MATERIALIZED (
         SELECT cb37_booking_post_links_v.client_id,
            cb37_booking_post_links_v.meeting_id,
            count(*) AS n,
            array_agg(DISTINCT cb37_booking_post_links_v.post_key) AS posts,
            array_agg(DISTINCT cb37_booking_post_links_v.path) AS paths
           FROM cb37_booking_post_links_v
          GROUP BY cb37_booking_post_links_v.client_id, cb37_booking_post_links_v.meeting_id
        ), disc AS MATERIALIZED (
         SELECT c.google_event_id AS meeting_id,
            NULLIF(concat_ws(' '::text, c.utm_source, c.utm_medium, c.utm_campaign, c.utm_content, c.booking_source_path, c.referrer_email), ''::text) AS discovery
           FROM calendar_events c
          WHERE (c.google_event_id IN ( SELECT bk_1.meeting_id
                   FROM bk bk_1))
        )
 SELECT bk.client_id,
    bk.meeting_id,
    bk.booked_at,
    bk.verdict,
    bk.meeting_kind,
    bk.event_type,
    COALESCE(l.n, 0::bigint)::integer AS post_links,
    l.posts,
    l.paths,
    d.discovery AS discovery_field,
        CASE
            WHEN l.n > 0 THEN 'linked'::text
            WHEN NOT (EXISTS ( SELECT 1
               FROM persons pe
              WHERE pe.client_id = bk.client_id AND pe.meeting_id = bk.meeting_id)) THEN 'booker identity unresolved: no prospect id and the booker email matches no prospect with a LinkedIn id'::text
            WHEN ae.first_seen_any IS NULL THEN 'booker never engaged any of this account''s posts (in the engager tables)'::text
            WHEN ae.first_seen_any > bk.booked_at THEN 'booker engaged a post, but the first record of it is after the booking'::text
            ELSE 'unexplained'::text
        END AS reason,
    bk.meeting_kind = 'recruiting'::text AS recruiting_meeting,
    bk.event_type = 'cancelled'::text AS cancelled
   FROM bk
     LEFT JOIN links l ON l.client_id = bk.client_id AND l.meeting_id = bk.meeting_id
     LEFT JOIN any_eng ae ON ae.client_id = bk.client_id AND ae.meeting_id = bk.meeting_id
     LEFT JOIN disc d ON d.meeting_id = bk.meeting_id;
-- the cb37 post views back to ivan, risedtc, arch only
CREATE OR REPLACE VIEW public.cb37_post_snapshots_v AS
 SELECT raw_snapshot_id AS snapshot_id,
    client_id,
    COALESCE(canonical_post_id,
        CASE
            WHEN raw_urn_kind IS NULL AND raw_urn_digits IS NOT NULL THEN 'urn:li:activity:'::text || raw_urn_digits
            ELSE NULL::text
        END) AS post_key,
    captured_at,
    impressions,
    reactions,
    comments,
    source,
    impressions IS NOT NULL OR reactions IS NOT NULL AS valued
   FROM audn_identity_resolution_v r
  WHERE client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text]);

CREATE OR REPLACE VIEW public.cb37_post_base_v AS
 WITH ident AS MATERIALIZED (
         SELECT i_1.client_id,
            i_1.canonical_post_id AS post_key,
            i_1.activity_digits,
            i_1.post_urn_digits,
            i_1.published_at,
            i_1.format
           FROM audn_canonical_post_identity_v i_1
          WHERE (i_1.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])) AND i_1.identity_status = 'resolved'::text
        ), txt AS (
         SELECT 'ivan'::text AS client_id,
            o.social_id AS post_key,
            o.post_text AS t,
            o.metrics_updated_at
           FROM own_posts o
        UNION ALL
         SELECT m.client_id,
            m.social_id,
            COALESCE(m.meta ->> 'text'::text, m.title) AS "coalesce",
            NULL::timestamp with time zone AS timestamptz
           FROM client_post_metrics m
          WHERE m.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])
        ), snap AS MATERIALIZED (
         SELECT r.client_id,
            COALESCE(r.canonical_post_id,
                CASE
                    WHEN r.raw_urn_kind IS NULL AND r.raw_urn_digits IS NOT NULL THEN 'urn:li:activity:'::text || r.raw_urn_digits
                    ELSE NULL::text
                END) AS post_key,
            r.captured_at,
            r.impressions,
            r.reactions,
            r.comments,
            r.impressions IS NOT NULL OR r.reactions IS NOT NULL AS valued
           FROM audn_identity_resolution_v r
          WHERE r.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])
        ), snapagg AS (
         SELECT snap.client_id,
            snap.post_key,
            count(*) AS n_all,
            count(*) FILTER (WHERE snap.valued) AS n_valued,
            max(snap.reactions) FILTER (WHERE snap.valued) AS max_react,
            max(snap.comments) FILTER (WHERE snap.valued) AS max_comments
           FROM snap
          GROUP BY snap.client_id, snap.post_key
        ), cc AS (
         SELECT audn_post_collection_coverage.client_id,
            audn_post_collection_coverage.post_social_id AS post_key,
            audn_post_collection_coverage.status,
            audn_post_collection_coverage.note,
            audn_post_collection_coverage.visits
           FROM audn_post_collection_coverage
        )
 SELECT i.client_id,
    i.post_key,
    i.activity_digits,
    i.post_urn_digits,
    i.published_at,
    i.format,
    lower(regexp_replace("left"(COALESCE(( SELECT min(t.t) AS min
           FROM txt t
          WHERE t.client_id = i.client_id AND t.post_key = i.post_key), ''::text), 400), '[^a-zA-Z0-9]+'::text, ''::text, 'g'::text)) AS text_key,
    ( SELECT bool_or(t.metrics_updated_at IS NOT NULL) AS bool_or
           FROM txt t
          WHERE t.client_id = 'ivan'::text AND i.client_id = 'ivan'::text AND t.post_key = i.post_key) AS ivan_tracked,
    COALESCE(s.n_all, 0::bigint) AS n_snap_all,
    COALESCE(s.n_valued, 0::bigint) AS n_snap_valued,
    s.max_react,
    s.max_comments,
    cc.note AS cc_note,
    cc.visits AS cc_visits,
    ( SELECT array_agg(DISTINCT w.w) AS array_agg
           FROM regexp_split_to_table(lower("left"(COALESCE(( SELECT min(t.t) AS min
                   FROM txt t
                  WHERE t.client_id = i.client_id AND t.post_key = i.post_key), ''::text), 600)), '[^a-z0-9]+'::text) w(w)
          WHERE length(w.w) >= 3) AS words,
    ( SELECT lower(regexp_replace(o.post_text, '[^a-zA-Z0-9]+'::text, ''::text, 'g'::text)) AS lower
           FROM own_posts o
          WHERE i.client_id = 'ivan'::text AND o.social_id = i.post_key AND o.post_text IS NOT NULL
         LIMIT 1) AS own_text_norm,
    ( SELECT lower(regexp_replace(m.meta ->> 'text'::text, '[^a-zA-Z0-9]+'::text, ''::text, 'g'::text)) AS lower
           FROM client_post_metrics m
          WHERE m.client_id = i.client_id AND m.social_id = i.post_key AND (m.meta ->> 'text'::text) IS NOT NULL
         LIMIT 1) AS cpm_text_norm,
    ( SELECT length(m.meta ->> 'text'::text) AS length
           FROM client_post_metrics m
          WHERE m.client_id = i.client_id AND m.social_id = i.post_key
         LIMIT 1) AS cpm_text_len
   FROM ident i
     LEFT JOIN snapagg s ON s.client_id = i.client_id AND s.post_key = i.post_key
     LEFT JOIN cc ON cc.client_id = i.client_id AND cc.post_key = i.post_key;

CREATE OR REPLACE VIEW public.cb37_engager_fit_v AS
 WITH cpm AS (
         SELECT m.id,
            m.client_id,
            m.social_id AS post_key
           FROM client_post_metrics m
          WHERE m.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])
        ), scores AS (
         SELECT o.client_id,
            pe.provider_id AS person_key,
            pe.icp_score AS s,
            pe.scorer_version AS v,
            pe.scored_at AS at
           FROM post_engagers pe
             JOIN audn_post_owner_resolution_v o ON o.post_social_id = pe.post_social_id AND o.resolution_status = 'resolved'::text
        UNION ALL
         SELECT c.client_id,
            e.profile_id,
            e.icp_score::numeric AS icp_score,
            e.icp_scorer_version,
            e.icp_scored_at
           FROM client_post_engagers e
             JOIN cpm c ON c.id = e.post_id
        UNION ALL
         SELECT c.client_id,
            e.profile_id,
            e.icp_score::numeric AS icp_score,
            e.scorer_version,
            e.scored_at
           FROM post_touch_engagers e
             JOIN cpm c ON c.id = e.post_id
        ), live AS (
         SELECT scores.client_id,
            scores.person_key,
            scores.s,
            scores.v,
            scores.at
           FROM scores
          WHERE scores.s IS NOT NULL AND scores.person_key IS NOT NULL AND (scores.client_id = 'ivan'::text AND (scores.v ~~ 'audn-icp-engager-scoring@v18%'::text OR scores.v = '17'::text) OR scores.client_id = 'risedtc'::text AND (scores.v ~~ 'audn-rise-icp-engager-scoring@v3%'::text OR scores.v = 'rise-engager-v2'::text) OR scores.client_id = 'arch'::text AND (scores.v ~~ 'audn-arch-icp-engager-scoring@v17%'::text OR scores.v = 'arch-engager-v16'::text OR scores.v ~~ 'arch-icp-engager-scoring@v26%'::text))
        )
 SELECT DISTINCT ON (client_id, person_key) client_id,
    person_key,
    s AS fit_score,
    v AS fit_version,
    at AS fit_scored_at,
    s >= 7::numeric AS is_buyer
   FROM live
  ORDER BY client_id, person_key, at DESC NULLS LAST, s DESC;

CREATE OR REPLACE VIEW public.cb37_post_engagers_v AS
 WITH cpm AS (
         SELECT m.id,
            m.client_id,
            m.social_id AS post_key
           FROM client_post_metrics m
          WHERE m.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])
        ), raw AS (
         SELECT o.client_id,
            o.canonical_post_id AS post_key,
            pe.provider_id AS person_key,
            pe.engagement_type AS kind,
            'post_engagers'::text AS src,
            pe.first_seen_at AS seen
           FROM post_engagers pe
             JOIN audn_post_owner_resolution_v o ON o.post_social_id = pe.post_social_id AND o.resolution_status = 'resolved'::text
        UNION ALL
         SELECT c.client_id,
            c.post_key,
            e.profile_id,
            e.kind,
            'client_post_engagers'::text,
            e.seen_at
           FROM client_post_engagers e
             JOIN cpm c ON c.id = e.post_id
        UNION ALL
         SELECT c.client_id,
            c.post_key,
            e.profile_id,
            e.kind,
            'post_touch_engagers'::text,
            e.seen_at
           FROM post_touch_engagers e
             JOIN cpm c ON c.id = e.post_id
        )
 SELECT r.client_id,
    r.post_key,
    r.person_key,
    array_agg(DISTINCT r.kind) AS kinds,
    array_agg(DISTINCT r.src) AS sources,
    f.fit_score,
    f.fit_version,
        CASE
            WHEN f.fit_score IS NULL THEN 'unknown'::text
            WHEN f.fit_score >= 7::numeric THEN 'buyer'::text
            ELSE 'not_buyer'::text
        END AS fit,
    min(r.seen) AS first_seen
   FROM raw r
     LEFT JOIN cb37_engager_fit_v f ON f.client_id = r.client_id AND f.person_key = r.person_key
  WHERE r.person_key IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM audn_excluded_person_v x
          WHERE x.client_id = r.client_id AND x.person_key = r.person_key))
  GROUP BY r.client_id, r.post_key, r.person_key, f.fit_score, f.fit_version;

CREATE OR REPLACE VIEW public.cb37_draft_post_links_v AS
 WITH d AS (
         SELECT d.id AS draft_id,
            COALESCE(d.client_id, 'ivan'::text) AS client_id,
            d.published_at,
            d.source_post_id,
            COALESCE(audn_urn_digits(d.source_post_id),
                CASE
                    WHEN d.source_post_id ~ '^[0-9]{10,}$'::text THEN d.source_post_id
                    ELSE NULL::text
                END) AS spid_digits,
            lower(regexp_replace("left"(COALESCE(d.post_body, ''::text), 400), '[^a-zA-Z0-9]+'::text, ''::text, 'g'::text)) AS text_key,
            ( SELECT array_agg(DISTINCT w.w) AS array_agg
                   FROM regexp_split_to_table(lower("left"(COALESCE(d.post_body, ''::text), 600)), '[^a-z0-9]+'::text) w(w)
                  WHERE length(w.w) >= 3) AS words
           FROM carousel_drafts d
          WHERE d.status = 'published'::text AND d.published_at IS NOT NULL AND (d.client_id IS NULL OR (d.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])))
        ), b AS MATERIALIZED (
         SELECT cb37_post_base_v.client_id,
            cb37_post_base_v.post_key,
            cb37_post_base_v.activity_digits,
            cb37_post_base_v.post_urn_digits,
            cb37_post_base_v.published_at,
            cb37_post_base_v.format,
            cb37_post_base_v.text_key,
            cb37_post_base_v.ivan_tracked,
            cb37_post_base_v.n_snap_all,
            cb37_post_base_v.n_snap_valued,
            cb37_post_base_v.max_react,
            cb37_post_base_v.max_comments,
            cb37_post_base_v.cc_note,
            cb37_post_base_v.cc_visits,
            cb37_post_base_v.words,
            cb37_post_base_v.own_text_norm,
            cb37_post_base_v.cpm_text_norm,
            cb37_post_base_v.cpm_text_len
           FROM cb37_post_base_v
        ), orphan AS MATERIALIZED (
         SELECT r.client_id,
            'urn:li:activity:'::text || r.raw_urn_digits AS post_key,
            count(*) AS n_all,
            count(*) FILTER (WHERE r.impressions IS NOT NULL OR r.reactions IS NOT NULL) AS n_valued
           FROM audn_identity_resolution_v r
          WHERE (r.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])) AND r.canonical_post_id IS NULL AND r.raw_urn_kind IS NULL AND r.raw_urn_digits IS NOT NULL
          GROUP BY r.client_id, ('urn:li:activity:'::text || r.raw_urn_digits)
        ), own AS (
         SELECT d.draft_id,
            d.client_id,
            d.published_at,
            d.source_post_id,
            d.spid_digits,
            d.text_key,
            d.words,
            ( SELECT min(b.post_key) AS min
                   FROM b
                  WHERE b.client_id = d.client_id AND d.spid_digits IS NOT NULL AND (b.activity_digits = d.spid_digits OR b.post_urn_digits = d.spid_digits)) AS own_key
           FROM d
        ), own2 AS (
         SELECT o_1.draft_id,
            o_1.client_id,
            o_1.published_at,
            o_1.source_post_id,
            o_1.spid_digits,
            o_1.text_key,
            o_1.words,
            o_1.own_key,
            COALESCE(o_1.own_key,
                CASE
                    WHEN o_1.spid_digits IS NOT NULL THEN 'urn:li:activity:'::text || o_1.spid_digits
                    ELSE NULL::text
                END) AS own_post_key,
            ob.cc_note,
            ob.ivan_tracked,
            COALESCE(ob.n_snap_valued, orp.n_valued, 0::bigint) AS own_valued,
            COALESCE(ob.n_snap_all, orp.n_all, 0::bigint) AS own_all
           FROM own o_1
             LEFT JOIN b ob ON ob.client_id = o_1.client_id AND ob.post_key = o_1.own_key
             LEFT JOIN orphan orp ON orp.client_id = o_1.client_id AND orp.post_key = ('urn:li:activity:'::text || o_1.spid_digits) AND o_1.own_key IS NULL
        ), own3 AS (
         SELECT o_1.draft_id,
            o_1.client_id,
            o_1.published_at,
            o_1.source_post_id,
            o_1.spid_digits,
            o_1.text_key,
            o_1.words,
            o_1.own_key,
            o_1.own_post_key,
            o_1.cc_note,
            o_1.ivan_tracked,
            o_1.own_valued,
            o_1.own_all,
                CASE
                    WHEN o_1.spid_digits IS NULL THEN NULL::text
                    WHEN o_1.cc_note = 'unipile_read_failed'::text THEN 'not_on_account'::text
                    WHEN o_1.own_valued > 0 THEN 'live'::text
                    WHEN (now() - o_1.published_at) < '2 days'::interval THEN 'pending'::text
                    WHEN o_1.client_id = 'ivan'::text AND COALESCE(o_1.ivan_tracked, false) = false THEN 'not_on_account'::text
                    WHEN o_1.own_all > 0 AND o_1.own_valued = 0 THEN 'not_on_account'::text
                    ELSE 'unknown'::text
                END AS own_state,
            concat_ws('; '::text,
                CASE
                    WHEN o_1.cc_note IS NOT NULL THEN 'engager logger: '::text || o_1.cc_note
                    ELSE NULL::text
                END,
                CASE
                    WHEN o_1.client_id = 'ivan'::text AND o_1.own_key IS NOT NULL AND COALESCE(o_1.ivan_tracked, false) = false THEN 'absent from Ivan tracker account listing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN o_1.own_all > 0 AND o_1.own_valued = 0 THEN o_1.own_all || ' snapshots, all values null'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN o_1.own_valued = 0 AND o_1.own_all = 0 AND o_1.spid_digits IS NOT NULL THEN '0 snapshots'::text
                    ELSE NULL::text
                END) AS own_evidence
           FROM own2 o_1
        ), cand AS (
         SELECT y.draft_id,
            y.post_key,
            y.published_at,
            y.prefix_match,
            y.overlap,
            y.rn,
            y.rn_post
           FROM ( SELECT x.draft_id,
                    x.post_key,
                    x.published_at,
                    x.prefix_match,
                    x.overlap,
                    row_number() OVER (PARTITION BY x.draft_id ORDER BY x.prefix_match DESC, x.overlap DESC, (abs(EXTRACT(epoch FROM x.published_at - x.dpub)))) AS rn,
                    row_number() OVER (PARTITION BY x.post_key ORDER BY x.prefix_match DESC, x.overlap DESC, (abs(EXTRACT(epoch FROM x.published_at - x.dpub)))) AS rn_post
                   FROM ( SELECT o_1.draft_id,
                            o_1.published_at AS dpub,
                            b.post_key,
                            b.published_at,
                            length(o_1.text_key) >= 40 AND "left"(b.text_key, 40) = "left"(o_1.text_key, 40) AS prefix_match,
                                CASE
                                    WHEN cardinality(o_1.words) >= 20 AND cardinality(b.words) >= 20 THEN COALESCE((( SELECT count(*) AS count
                                       FROM unnest(o_1.words) w(w)
                                      WHERE w.w = ANY (b.words)))::numeric / NULLIF(LEAST(cardinality(o_1.words), cardinality(b.words)), 0)::numeric, 0::numeric)
                                    ELSE 0::numeric
                                END AS overlap
                           FROM own3 o_1
                             JOIN b ON b.client_id = o_1.client_id AND b.n_snap_valued > 0 AND b.post_key IS DISTINCT FROM o_1.own_post_key AND NOT (EXISTS ( SELECT 1
                                   FROM own3 o2
                                  WHERE o2.client_id = o_1.client_id AND o2.own_post_key = b.post_key AND o2.own_state <> 'not_on_account'::text)) AND (o_1.spid_digits IS NULL AND b.published_at >= (o_1.published_at - '02:00:00'::interval) AND b.published_at <= (o_1.published_at + '4 days'::interval) OR o_1.own_state = 'not_on_account'::text AND b.published_at >= o_1.published_at AND b.published_at <= (o_1.published_at + '4 days'::interval))) x
                  WHERE x.prefix_match OR x.overlap >= 0.6) y
          WHERE y.rn_post = 1
        )
 SELECT o.client_id,
    o.draft_id,
    o.published_at AS draft_published_at,
    o.source_post_id,
        CASE
            WHEN o.spid_digits IS NOT NULL AND o.own_state <> 'not_on_account'::text THEN o.own_post_key
            WHEN c.post_key IS NOT NULL THEN c.post_key
            WHEN o.own_post_key IS NOT NULL THEN o.own_post_key
            ELSE 'draft:'::text || o.draft_id
        END AS post_key,
        CASE
            WHEN o.spid_digits IS NOT NULL AND o.own_state <> 'not_on_account'::text THEN 'source_post_id'::text
            WHEN c.post_key IS NOT NULL AND o.spid_digits IS NULL THEN 'text_time_match'::text
            WHEN c.post_key IS NOT NULL THEN 'repost_text_match'::text
            WHEN o.own_post_key IS NOT NULL THEN 'source_post_id'::text
            ELSE 'unlinked'::text
        END AS link_method,
        CASE
            WHEN o.spid_digits IS NOT NULL AND o.own_state <> 'not_on_account'::text THEN o.own_state
            WHEN c.post_key IS NOT NULL THEN 'live'::text
            WHEN o.own_post_key IS NOT NULL THEN o.own_state
            ELSE 'unknown'::text
        END AS post_state,
        CASE
            WHEN c.post_key IS NOT NULL AND o.spid_digits IS NOT NULL THEN ((('own post '::text || o.own_post_key) || ' not on account ('::text) || o.own_evidence) || '); same text reposted'::text
            WHEN c.post_key IS NOT NULL THEN 'draft had no post id; same text posted within 4 days'::text
            ELSE NULLIF(o.own_evidence, ''::text)
        END AS state_evidence,
    o.own_post_key
   FROM own3 o
     LEFT JOIN cand c ON c.draft_id = o.draft_id AND c.rn = 1;

select cron.unschedule('content-outcome-read') where exists (select 1 from cron.job where jobname = 'content-outcome-read');
drop function if exists public.content_outcome_latest(text);
drop function if exists public.content_outcome_read_due();
drop function if exists public.content_outcome_read(timestamptz, text);
drop function if exists public.content_outcome_rate_ci(int, int);
drop view if exists public.content_post_outcome_d7_v;
drop function if exists public.content_source_kind_label(text);
drop function if exists public.content_source_kind(text, text, text, jsonb);
drop view if exists public.content_booking_identity_v;
COMMIT;
