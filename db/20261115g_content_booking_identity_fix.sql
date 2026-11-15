BEGIN;

-- 20261115g Booking-to-post identity: two fixes from the cross-review of 20261114g (its final state was re-reviewed
-- on 2026-11-15; both findings checked on live data before writing this).
--
-- 1. content_booking_identity_v, employer named in an engager headline. The job clause (role word ... "at" employer)
--    could run across a comma or a second "at": "Founder at AgencyAtom, previously at OtherCo" gave only "otherco" (a
--    real employer lost) and "Founder, speaker at AgencyAtom Summit" gave an employer from an event. The span between
--    the role word and "at" now:
--      - stays inside one clause: no comma, slash, semicolon or line break, and no sentence end (. ! ? followed by
--        a space; a single-letter initial such as "U.S." is not a sentence end);
--      - never crosses another "at";
--      - never contains a speaking or event word (speaker, speaking, spoke, keynote, panelist, moderator, presenter,
--        presenting, attending, attended, exhibiting, exhibitor, talking), so "Founder speaking at X Summit" gives
--        no employer;
--      - may contain a balanced bracket under the same rules: "Director of Sales (EMEA) at X" keeps X.
--    Known cost: a real title holding one of those words ("Director of Speaker Relations at X") or a longer dotted
--    abbreviation before "at" ("VP Mktg. at X") gives no employer. Of the 117 distinct live headlines with "at", 0
--    lose an employer against the first version of this fix and 1 gets one back (a "(UK)" title).
--    Live data: 10 identity rows before, 10 after, 0 dropped, 0 added.
-- 2. The booking.prospect_id path never checked that the prospect belongs to the booking's client. A booking that
--    pointed at another client's prospect would have linked through that client's person. It now needs the prospect's
--    campaign to belong to the booking's client, with the same rule the email path already uses
--    (COALESCE(campaign.client_id, 'ivan') = booking client; Ivan's campaigns have no client_id). Applied in
--    cb37_booking_post_links_v (who), cb37_booking_coverage_v (persons) and the fallback check in
--    content_booking_identity_v. Live data: 72 bookings carry a prospect_id (arch 11, ivan 25, risedtc 36); all 72
--    prospects sit in a campaign of the same client, so no row changes today.
--
-- Columns, grants and every other line of the three views are unchanged (bodies are pg_get_viewdef of the live views
-- with only the lines above edited). Readers: database objects only (cb37_*, cb39_monday_card, cb52_*, content_*;
-- crons 205, 206, 211, 224, 358).
-- Rollback: 20261115g_content_booking_identity_fix_rollback.sql

CREATE OR REPLACE VIEW public.content_booking_identity_v AS
 WITH b0 AS MATERIALIZED (
         SELECT b.client_id,
            b.meeting_id,
            b.prospect_id,
            lower(btrim(b.booker_email)) AS em,
            lower(regexp_replace(btrim(b.booker_name), '\s+'::text, ' '::text, 'g'::text)) AS nm
           FROM booking_attributions b
          WHERE (b.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])) AND b.booker_name ~ '\S\s+\S'::text AND b.booker_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text
        ), pem AS MATERIALIZED (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            lower(btrim(p.email)) AS em
           FROM outreach_prospects p
             JOIN outreach_campaigns c ON c.id = p.campaign_id
          WHERE (lower(btrim(p.email)) IN ( SELECT b0.em
                   FROM b0)) AND NULLIF(btrim(p.linkedin_profile_id), ''::text) IS NOT NULL
        ), bk AS MATERIALIZED (
         SELECT b0.client_id,
            b0.meeting_id,
            b0.nm,
            split_part(b0.em, '@'::text, 2) AS dom,
            regexp_replace(split_part(split_part(b0.em, '@'::text, 2), '.'::text, 1), '[^a-z0-9]'::text, ''::text, 'g'::text) AS lbl
           FROM b0
          WHERE NOT (EXISTS ( SELECT 1
                   FROM outreach_prospects p
                     JOIN outreach_campaigns c ON c.id = p.campaign_id AND COALESCE(c.client_id, 'ivan'::text) = b0.client_id
                  WHERE p.id = b0.prospect_id AND NULLIF(btrim(p.linkedin_profile_id), ''::text) IS NOT NULL)) AND NOT (EXISTS ( SELECT 1
                   FROM pem
                  WHERE pem.client_id = b0.client_id AND pem.em = b0.em))
        ), corp AS MATERIALIZED (
         SELECT bk.client_id,
            bk.meeting_id,
            bk.nm,
            bk.dom,
            bk.lbl
           FROM bk
          WHERE length(bk.lbl) >= 8 AND bk.lbl !~ '^(marketing|consulting|consultancy|solutions|ecommerce|digitalmarketing|creative|creatives|agency|agencies|business|services|ventures|holdings|partners|international|global|group|media|studio|studios|growth|brand|brands|digital)$'::text AND bk.dom !~ '^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|web|zoho|yandex|qq|163|126|btinternet|comcast|verizon|att|sbcglobal|orange|free|libero|t-online|wp|o2|onet|interia)\.'::text
        ), en AS MATERIALIZED (
         SELECT DISTINCT x.client_id,
            x.person_key,
            lower(regexp_replace(btrim(x.name), '\s+'::text, ' '::text, 'g'::text)) AS nm,
            ( SELECT array_agg(lower(regexp_replace(z.seg, '[^a-zA-Z0-9]'::text, ''::text, 'g'::text))) AS array_agg
                   FROM ( SELECT m.m[1] AS seg
                           FROM regexp_matches(COALESCE(x.headline, ''::text), '@\s*([^|,/•·(@]+)'::text, 'gi'::text) m(m)
                        UNION ALL
                         SELECT m.m[1] AS m
                           FROM regexp_matches(COALESCE(x.headline, ''::text), '\m(?:founder|co-?founder|ceo|cto|coo|cmo|cfo|cro|owner|director|head|manager|lead|president|vp|partner|officer|chief|principal|executive|specialist|coordinator|consultant|engineer|associate|analyst)\M(?:\m\w\.|(?!\m(?:at|speak\w*|spoke|keynot\w*|panell?ists?|moderator|moderating|presenter|presenting|attending|attended|exhibiting|exhibitor|talking)\M|[.!?]\s)[^|•·@,/();\n\r]|\((?:\m\w\.|(?!\m(?:at|speak\w*|spoke|keynot\w*|panell?ists?|moderator|moderating|presenter|presenting|attending|attended|exhibiting|exhibitor|talking)\M|[.!?]\s)[^|•·@,/();\n\r])*\))*\mat\M\s*([^|,/•·(@]+)'::text, 'gi'::text) m(m)) z) AS emp
           FROM ( SELECT o.client_id,
                    pe.provider_id AS person_key,
                    pe.name,
                    pe.headline
                   FROM post_engagers pe
                     JOIN audn_post_owner_resolution_v o ON o.post_social_id = pe.post_social_id AND o.resolution_status = 'resolved'::text
                UNION ALL
                 SELECT m.client_id,
                    e.profile_id,
                    e.name,
                    e.headline
                   FROM client_post_engagers e
                     JOIN client_post_metrics m ON m.id = e.post_id
                UNION ALL
                 SELECT m.client_id,
                    e.profile_id,
                    e.name,
                    e.headline
                   FROM post_touch_engagers e
                     JOIN client_post_metrics m ON m.id = e.post_id) x
          WHERE NULLIF(btrim(x.person_key), ''::text) IS NOT NULL AND x.name ~ '\S\s+\S'::text
        ), pdom AS MATERIALIZED (
         SELECT COALESCE(oc.client_id, 'ivan'::text) AS client_id,
            p.id,
            p.linkedin_profile_id,
            lower(btrim(p.company_domain)) AS dom,
            lower(regexp_replace(btrim(p.name), '\s+'::text, ' '::text, 'g'::text)) AS nm
           FROM outreach_prospects p
             JOIN outreach_campaigns oc ON oc.id = p.campaign_id
          WHERE (lower(btrim(p.company_domain)) IN ( SELECT corp.dom
                   FROM corp)) AND NULLIF(btrim(p.linkedin_profile_id), ''::text) IS NOT NULL
        ), found AS (
         SELECT c.client_id,
            c.meeting_id,
            e.person_key,
            NULL::uuid AS prospect_id,
            'booker full name = engager name, booker email company = the employer named in the engager headline (same client)'::text AS identity_evidence
           FROM corp c
             JOIN en e ON e.client_id = c.client_id AND e.nm = c.nm
          WHERE (EXISTS ( SELECT 1
                   FROM unnest(e.emp) emp(seg)
                  WHERE emp.seg ~~ ("left"(c.lbl, length(c.lbl) - 1) || '%'::text)))
        UNION
         SELECT c.client_id,
            c.meeting_id,
            p.linkedin_profile_id,
            p.id,
            'booker full name = prospect name, booker email domain = prospect company domain (same client)'::text AS text
           FROM corp c
             JOIN pdom p ON p.dom = c.dom AND p.nm = c.nm AND p.client_id = c.client_id
        ), single AS (
         SELECT found.client_id,
            found.meeting_id
           FROM found
          GROUP BY found.client_id, found.meeting_id
         HAVING count(DISTINCT found.person_key) = 1
        )
 SELECT DISTINCT ON (f.client_id, f.meeting_id, f.person_key) f.client_id,
    f.meeting_id,
    f.person_key,
    f.prospect_id,
    f.identity_evidence
   FROM found f
     JOIN single s ON s.client_id = f.client_id AND s.meeting_id = f.meeting_id
  ORDER BY f.client_id, f.meeting_id, f.person_key, (f.prospect_id IS NULL), f.identity_evidence;

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
             JOIN outreach_campaigns c ON c.id = p.campaign_id AND COALESCE(c.client_id, 'ivan'::text) = bk_1.client_id
          WHERE NULLIF(btrim(p.linkedin_profile_id), ''::text) IS NOT NULL
        UNION
         SELECT bk_1.client_id,
            bk_1.meeting_id,
            p.linkedin_profile_id,
            p.id,
            'booker_email = prospect.email (same client)'::text AS text
           FROM bk bk_1
             JOIN outreach_prospects p ON lower(btrim(p.email)) = bk_1.booker_email
             JOIN outreach_campaigns c ON c.id = p.campaign_id AND COALESCE(c.client_id, 'ivan'::text) = bk_1.client_id
          WHERE bk_1.booker_email IS NOT NULL AND NULLIF(btrim(p.linkedin_profile_id), ''::text) IS NOT NULL
        UNION
         SELECT i.client_id,
            i.meeting_id,
            i.person_key,
            i.prospect_id,
            i.identity_evidence
           FROM content_booking_identity_v i
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
             JOIN pmap pm ON pm.prospect_id = bk_1.prospect_id AND pm.client_id = bk_1.client_id
          WHERE pm.person_key IS NOT NULL
        UNION
         SELECT bk_1.client_id,
            bk_1.meeting_id,
            pm.person_key
           FROM bk bk_1
             JOIN pmap pm ON pm.client_id = bk_1.client_id AND pm.em = bk_1.booker_email
          WHERE pm.person_key IS NOT NULL
        UNION
         SELECT i.client_id,
            i.meeting_id,
            i.person_key
           FROM content_booking_identity_v i
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

COMMIT;
