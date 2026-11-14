BEGIN;

-- 20261114g Content Brain outcome: a day-7 result per post, booking-to-post links, and a pooled read every 4 weeks.
--
-- Why (live data 2026-11-14): the brain is judged on impressions, which one viral post swamps (one Warsaw post 18,281
-- views vs a business median near 80). Bookings are the goal, but cb37_booking_post_links_v had 1 row ever. Run 36
-- showed buyer outcomes are too sparse to read post by post, so the read is pooled, per lane, with intervals.
--
-- What this adds
--   1. content_booking_identity_v: two more ways to know who booked (full name + same company), used only when the
--      older two find nobody. The two booking views union it in; every column stays the same. 1 -> 4 linked bookings.
--      Why only 1 before: 115 of 152 RISE bookings come from people who are not prospects (booker email matches no
--      prospect); of the bookings we can name, almost all came through outreach to engagers of other people's posts,
--      and the booker never engaged one of our posts before booking.
--   2. content_post_outcome_d7_v: per post, per lane, day 7: impressions, buyer-fit engagers (the lane's own engager
--      score), engagers who wrote to us. Coverage stated per post. Each lane's fit already uses that lane's buyer
--      (checked 11-14: RISE buyers are DTC founders, ARCH buyers are app/game marketers, Ivan buyers are agency and
--      B2B founders); nothing to fix there.
--   3. content_outcome_reads / _rows / _posts + content_outcome_read(): the pooled read by source (brain, copies of
--      viral posts, remakes of past winners, calls, hand, Poland vs business for Ivan), 28 days of posts ending 8
--      days before the read, 90% Poisson intervals. Fixed 28-day windows (anchor window end 2026-11-06); pg_cron
--      Monday 21:30 UTC runs every matured window without a done read, so none is skipped.
--   4. content_outcome_latest(p_client): the Content Brain page's one small read (authenticated).
--
-- Readers checked with who-reads --no-indirect: cb37_booking_post_links_v is read by cb37_booking_coverage_v,
-- cb37_post_results_v (bookings_linked) and through them cb37_booking_name_candidates_v, cb37_ivan_evidence_rows_v,
-- cb37_refresh/cb37_results/cb37_weekly, cb39_monday_card, cb52_decision_history(_review), content_autopilot_run/_weekly,
-- content_buyer_evidence/_review_refresh, content_plan_timing_ivan, content_reuse_review_v, crons 205/206/211/224.
-- cb37_booking_coverage_v is read by cb37_booking_name_candidates_v and cb37_weekly. All keep their columns; they see
-- 3 more links. Every content_outcome_* / content_booking_identity_v / content_source_kind* name is new (0 readers).
-- Rollback: 20261114g_content_outcome_read_rollback.sql

-- 1. Two more ways to know who booked, used only when the older two (booking.prospect_id, booker email = prospect
--    email) find nobody. Both need the booker's full name AND their company, never a name alone:
--    a) the same full name engaged one of this account's posts and the employer that person's headline names
--       (after "@", or after "at" in a job clause such as "Director of Sales at ...") starts with the booker's email company (the domain's first label, 8+ characters, not a generic
--       word, its last letter optional): agencyatom.com -> "Founder @ AgencyAtom",
--       henschelhats.com -> "... at Henschel Hat Company". A company word elsewhere in the headline never counts.
--    b) the same full name is a prospect of this account whose company domain equals the booker's email domain.
--    Free mail domains never count as a company. A booking that maps to more than one person is left out;
--    a person found by both paths gives one row (the prospect path wins).
create or replace view public.content_booking_identity_v as
with b0 as materialized (
  select b.client_id, b.meeting_id, b.prospect_id, lower(btrim(b.booker_email)) as em,
         lower(regexp_replace(btrim(b.booker_name), '\s+', ' ', 'g')) as nm
    from public.booking_attributions b
   where b.client_id = any (array['ivan', 'risedtc', 'arch'])
     and b.booker_name ~ '\S\s+\S'
     and b.booker_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
), pem as materialized (
  select coalesce(c.client_id, 'ivan') as client_id, lower(btrim(p.email)) as em
    from public.outreach_prospects p
    join public.outreach_campaigns c on c.id = p.campaign_id
   where lower(btrim(p.email)) in (select em from b0)
     and nullif(btrim(p.linkedin_profile_id), '') is not null
), bk as materialized (
  select b0.client_id, b0.meeting_id, b0.nm,
         split_part(b0.em, '@', 2) as dom,
         regexp_replace(split_part(split_part(b0.em, '@', 2), '.', 1), '[^a-z0-9]', '', 'g') as lbl
    from b0
   where not exists (select 1 from public.outreach_prospects p
                      where p.id = b0.prospect_id and nullif(btrim(p.linkedin_profile_id), '') is not null)
     and not exists (select 1 from pem where pem.client_id = b0.client_id and pem.em = b0.em)
), corp as materialized (
  select * from bk
   where length(lbl) >= 8
     and lbl !~ '^(marketing|consulting|consultancy|solutions|ecommerce|digitalmarketing|creative|creatives|agency|agencies|business|services|ventures|holdings|partners|international|global|group|media|studio|studios|growth|brand|brands|digital)$'
     and dom !~ '^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|web|zoho|yandex|qq|163|126|btinternet|comcast|verizon|att|sbcglobal|orange|free|libero|t-online|wp|o2|onet|interia)\.'
), en as materialized (
  select distinct x.client_id, x.person_key,
         lower(regexp_replace(btrim(x.name), '\s+', ' ', 'g')) as nm,
         (select array_agg(lower(regexp_replace(seg, '[^a-zA-Z0-9]', '', 'g'))) from (
            select m[1] as seg from regexp_matches(coalesce(x.headline, ''), '@\s*([^|,/•·(@]+)', 'gi') as m
            union all
            select m[1] from regexp_matches(coalesce(x.headline, ''),
              '\m(?:founder|co-?founder|ceo|cto|coo|cmo|cfo|cro|owner|director|head|manager|lead|president|vp|partner|officer|chief|principal|executive|specialist|coordinator|consultant|engineer|associate|analyst)\M[^|•·@]*?\mat\M\s*([^|,/•·(@]+)', 'gi') as m
          ) z) as emp
    from (
      select o.client_id, pe.provider_id as person_key, pe.name, pe.headline
        from public.post_engagers pe
        join public.audn_post_owner_resolution_v o on o.post_social_id = pe.post_social_id and o.resolution_status = 'resolved'
      union all
      select m.client_id, e.profile_id, e.name, e.headline
        from public.client_post_engagers e join public.client_post_metrics m on m.id = e.post_id
      union all
      select m.client_id, e.profile_id, e.name, e.headline
        from public.post_touch_engagers e join public.client_post_metrics m on m.id = e.post_id
    ) x
   where nullif(btrim(x.person_key), '') is not null and x.name ~ '\S\s+\S'
), pdom as materialized (
  select coalesce(oc.client_id, 'ivan') as client_id, p.id, p.linkedin_profile_id, lower(btrim(p.company_domain)) as dom,
         lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) as nm
    from public.outreach_prospects p
    join public.outreach_campaigns oc on oc.id = p.campaign_id
   where lower(btrim(p.company_domain)) in (select dom from corp)
     and nullif(btrim(p.linkedin_profile_id), '') is not null
), found as (
  select c.client_id, c.meeting_id, e.person_key, null::uuid as prospect_id,
         'booker full name = engager name, booker email company = the employer named in the engager headline (same client)'::text as identity_evidence
    from corp c join en e on e.client_id = c.client_id and e.nm = c.nm
   where exists (select 1 from unnest(e.emp) as emp(seg) where emp.seg like left(c.lbl, length(c.lbl) - 1) || '%')
  union
  select c.client_id, c.meeting_id, p.linkedin_profile_id, p.id,
         'booker full name = prospect name, booker email domain = prospect company domain (same client)'::text
    from corp c
    join pdom p on p.dom = c.dom and p.nm = c.nm and p.client_id = c.client_id
), single as (
  select client_id, meeting_id from found group by client_id, meeting_id having count(distinct person_key) = 1
)
select distinct on (f.client_id, f.meeting_id, f.person_key)
       f.client_id, f.meeting_id, f.person_key, f.prospect_id, f.identity_evidence
  from found f join single s on s.client_id = f.client_id and s.meeting_id = f.meeting_id
 order by f.client_id, f.meeting_id, f.person_key, (f.prospect_id is null), f.identity_evidence;
revoke all on public.content_booking_identity_v from public, anon, authenticated;
grant select on public.content_booking_identity_v to service_role;

-- 2. The two booking views read the new identities too. Every column, its name, type and order is unchanged.
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
             JOIN pmap pm ON pm.prospect_id = bk_1.prospect_id
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

-- 2b. SwishDM joins the cb37 post views (its posts are in client_post_metrics since 2026-11-14). Only the client
--     list changes ('swishdm' added); every column is the same. SwishDM has no engager score yet, so its engagers
--     read as fit unknown. Readers checked: they all select by client (p_client, an explicit list, or 'ivan').
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
  WHERE client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text]);

CREATE OR REPLACE VIEW public.cb37_post_base_v AS
 WITH ident AS MATERIALIZED (
         SELECT i_1.client_id,
            i_1.canonical_post_id AS post_key,
            i_1.activity_digits,
            i_1.post_urn_digits,
            i_1.published_at,
            i_1.format
           FROM audn_canonical_post_identity_v i_1
          WHERE (i_1.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])) AND i_1.identity_status = 'resolved'::text
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
          WHERE m.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])
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
          WHERE r.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])
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
          WHERE m.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])
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
          WHERE m.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])
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
          WHERE d.status = 'published'::text AND d.published_at IS NOT NULL AND (d.client_id IS NULL OR (d.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])))
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
          WHERE (r.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])) AND r.canonical_post_id IS NULL AND r.raw_urn_kind IS NULL AND r.raw_urn_digits IS NOT NULL
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

-- 3. Where a post came from, in a few plain groups. Reads the provenance the drafting tools already write
--    (taxonomy source / source label / writer / origin / structure); it judges no content. First match wins.
create or replace function public.content_source_kind(p_how_made text, p_lane text, p_label text, p_tax jsonb)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select case
    when p_how_made = 'brain' then 'brain'
    when p_how_made = 'no_draft' then 'no_record'
    when s ~ '(outlier|x-outlier-adapter|proven.winner|copy test|copy_99|format adapted from|format test|copied shape|competitor|borrowed winner|winner_replica|adaptation|shape ·|repurposed from (?!your))' then 'viral_copy'
    when s ~ '(repurposed from your|\mrework\M)' then 'own_repurpose'
    when s ~ '(\mcalls?\M|\mmeet\M|check-in|bi-weekly|transcript)' then 'call'
    when s ~ '(lead.magnet|\mlm launch)' then 'lead_magnet'
    when s ~ '(manual|hand-picked|supplied copy|personal-pass|personal post|inbox selection)' then 'hand'
    else 'other' end
  from (select lower(concat_ws(' | ', p_lane, p_label,
               case when jsonb_typeof(p_tax) = 'object' then p_tax ->> 'writer' end,
               case when jsonb_typeof(p_tax) = 'object' then p_tax ->> 'origin' end,
               case when jsonb_typeof(p_tax) = 'object' then p_tax ->> 'structure_used' end)) as s) x
$f$;

create or replace function public.content_source_kind_label(p_kind text)
returns text language sql immutable set search_path = public, pg_temp as $f$
  select case p_kind
    when 'brain' then 'Content Brain'
    when 'viral_copy' then 'Copies of viral posts'
    when 'own_repurpose' then 'Remakes of past winners'
    when 'call' then 'From calls'
    when 'lead_magnet' then 'Free resource posts'
    when 'hand' then 'Written or picked by hand'
    when 'other' then 'Other planned posts'
    when 'no_record' then 'Posted outside the app'
    when 'not_linked' then 'Not linked to a draft yet'
    when 'poland' then 'Poland'
    when 'business' then 'Business'
    when 'not_read' then 'Not sorted yet'
    when 'all' then 'All posts'
    else p_kind end
$f$;

-- 4. The day-7 outcome of every published post, per lane. Fixed age: impressions from the reading 6 to 8 days after
--    publishing (cb37 imp_7d), engagers first recorded by day 7, buyer fit = the lane's own engager score
--    (cb37_engager_fit_v: Ivan audn-icp-engager-scoring, RISE audn-rise-icp-engager-scoring, ARCH
--    arch-icp-engager-scoring; score 7+ = buyer), and engagers who wrote to us (DM or reply, a reaction counts)
--    after their engagement was first recorded and by day 7.
--    Counts are null unless a collection by day 7 is shown: an engager first recorded by day 7, or a successful
--    collection visit (audn_post_collection_coverage status 'collected', last_visited_at) by day 7, or a reading at
--    day 7 or later showing no reactions and no comments. Impressions come from the regular reading nearest day 7
--    (6 to 8 days); backfill readings are never used.
--    Buyer counts are null when every engager is unscored, and for SwishDM (no buyer score yet).
--    d7_mature = the post is 8+ days old. A post LinkedIn no longer shows (client_post_live_state 'deleted') is
--    marked deleted with no numbers. A late backfill reading never counts as day 7. SwishDM: only commenters are
--    collected (coverage 'comments_only' once any are).
create or replace view public.content_post_outcome_d7_v as
with r as materialized (
  select r.client_id, r.post_key, r.draft_id, r.how_made, r.lane, r.published_at, r.imp_7d, r.engager_coverage, r.bookings_linked
    from public.cb37_post_results_v r
   where r.published_at is not null
), eall as materialized (
  select e.client_id, e.post_key, e.person_key, e.fit, e.fit_version, e.first_seen, r.published_at
    from public.cb37_post_engagers_v e
    join r on r.client_id = e.client_id and r.post_key = e.post_key
), e as materialized (
  select * from eall where first_seen <= published_at + interval '7 days'
), visit as (
  select c.client_id, c.post_social_id as post_key, c.last_visited_at from public.audn_post_collection_coverage c
   where c.status = 'collected'
), snap as materialized (
  select s.client_id, s.post_key, s.captured_at, s.impressions, s.reactions, s.comments
    from public.cb37_post_snapshots_v s
    join r on r.client_id = s.client_id and r.post_key = s.post_key
   where s.valued and coalesce(s.source, '') not like 'backfill%'
), pros as materialized (
  select coalesce(c.client_id, 'ivan') as client_id, p.linkedin_profile_id as person_key, p.id as prospect_id
    from public.outreach_prospects p
    join public.outreach_campaigns c on c.id = p.campaign_id
   where p.linkedin_profile_id in (select person_key from e)
), wrote as materialized (
  select distinct e.client_id, e.post_key, e.person_key, e.fit
    from e
    join pros p on p.client_id = e.client_id and p.person_key = e.person_key
    join public.outreach_messages m on m.prospect_id = p.prospect_id and m.direction = 'inbound'
   where coalesce(m.sent_at, m.created_at) >= greatest(e.first_seen, e.published_at)
     and coalesce(m.sent_at, m.created_at) <= e.published_at + interval '7 days'
), agg as (
  select client_id, post_key, count(*) as n,
         count(*) filter (where fit = 'buyer') as nb,
         count(*) filter (where fit = 'unknown') as nu,
         array_agg(distinct split_part(fit_version, '|', 1)) filter (where fit_version is not null) as fitv
    from e group by client_id, post_key
), wagg as (
  select client_id, post_key, count(*) as nw, count(*) filter (where fit = 'buyer') as nwb
    from wrote group by client_id, post_key
), meet as (
  select client_id, post_key, array_agg(distinct meeting_id order by meeting_id) as meetings
    from public.cb37_booking_post_links_v group by client_id, post_key
), gone as (
  select client_id, post_social_id from public.client_post_live_state where state = 'deleted'
), base as (
  select r.*, d.source_label, d.taxonomy,
         exists (select 1 from gone g where g.client_id = r.client_id and g.post_social_id = audn_urn_digits(r.post_key)) as deleted,
         (select s.impressions from snap s
           where s.client_id = r.client_id and s.post_key = r.post_key
             and s.captured_at between r.published_at + interval '6 days' and r.published_at + interval '8 days'
           order by abs(extract(epoch from s.captured_at - r.published_at) - 604800), s.captured_at limit 1) as imp_d7_clean,
         exists (select 1 from snap s where s.client_id = r.client_id and s.post_key = r.post_key
                    and s.captured_at >= r.published_at + interval '7 days'
                    and s.reactions = 0 and s.comments = 0) as zero_after_d7,
         exists (select 1 from e x where x.client_id = r.client_id and x.post_key = r.post_key)
           or exists (select 1 from visit v where v.client_id = r.client_id and v.post_key = r.post_key
                         and v.last_visited_at <= r.published_at + interval '7 days') as seen_by_d7
    from r
    left join public.carousel_drafts d on d.id = r.draft_id
), cov as (
  select b.*,
         case
           when b.deleted then 'deleted'
           when b.engager_coverage = 'none_expected' and b.zero_after_d7 then 'none_expected'
           when b.engager_coverage = 'none_expected' then 'zero_not_shown_at_day7'
           when b.engager_coverage <> 'collected' then b.engager_coverage
           when not b.seen_by_d7 then 'not_shown_by_day7'
           when b.client_id = 'swishdm' then 'comments_only'
           else 'collected'
         end as c
    from base b
)
select b.client_id, b.post_key, b.draft_id, b.published_at,
       public.content_source_kind(b.how_made, b.lane, b.source_label, b.taxonomy) as source_kind,
       left(concat_ws(' | ', b.how_made, b.lane, nullif(b.source_label, b.lane)), 240) as source_evidence,
       case when b.client_id = 'ivan' then
         case public.content_card_poland(b.draft_id) when true then 'poland' when false then 'business' else 'not_read' end
       end as ivan_topic,
       now() >= b.published_at + interval '8 days' as d7_mature,
       case when b.deleted then null else b.imp_d7_clean end as imp_d7,
       b.c as engager_coverage_d7,
       case when b.c in ('collected', 'none_expected', 'comments_only') then coalesce(a.n, 0)::int end as engagers_d7,
       case when b.c in ('collected', 'none_expected') and b.client_id <> 'swishdm'
                 and not (coalesce(a.n, 0) > 0 and a.nu = a.n) then coalesce(a.nb, 0)::int end as buyer_engagers_d7,
       case when b.c in ('collected', 'none_expected', 'comments_only') then coalesce(a.nu, 0)::int end as fit_unknown_d7,
       case when b.c in ('collected', 'none_expected', 'comments_only') then coalesce(w.nw, 0)::int end as wrote_back_d7,
       case when b.c in ('collected', 'none_expected') and b.client_id <> 'swishdm'
                 and not (coalesce(a.n, 0) > 0 and a.nu = a.n) then coalesce(w.nwb, 0)::int end as buyer_wrote_back_d7,
       a.fitv as fit_versions,
       b.bookings_linked,
       b.deleted,
       coalesce(mt.meetings, '{}'::text[]) as linked_meetings
  from cov b
  left join agg a on a.client_id = b.client_id and a.post_key = b.post_key
  left join wagg w on w.client_id = b.client_id and w.post_key = b.post_key
  left join meet mt on mt.client_id = b.client_id and mt.post_key = b.post_key;
revoke all on public.content_post_outcome_d7_v from public, anon, authenticated;
grant select on public.content_post_outcome_d7_v to service_role;

-- 5. The pooled read every 4 weeks: one row per read, one per lane x group, and the frozen per-post rows behind it.
--    Windows are a fixed 28-day sequence anchored on 2026-11-06 (window end); a read lands 8 days after its window
--    ends, so every post has its day-7 numbers.
create table if not exists public.content_outcome_reads (
  read_id text primary key,
  as_of timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  trigger text not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  error text,
  summary jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists public.content_outcome_read_rows (
  read_id text not null references public.content_outcome_reads(read_id) on delete cascade,
  client_id text not null,
  dimension text not null check (dimension in ('lane', 'source_kind', 'ivan_topic')),
  grp text not null,
  label text not null,
  posts int not null,
  imp_posts int not null,
  imp_median numeric, imp_p25 numeric, imp_p75 numeric,
  buyer_posts int not null,
  buyer_sum int, buyer_per_post numeric, buyer_lo numeric, buyer_hi numeric,
  wrote_posts int,
  wrote_sum int, wrote_per_post numeric, wrote_lo numeric, wrote_hi numeric,
  bookings_linked int,
  fit_versions text[],
  coverage jsonb,
  primary key (read_id, client_id, dimension, grp)
);
create table if not exists public.content_outcome_read_posts (
  read_id text not null references public.content_outcome_reads(read_id) on delete cascade,
  client_id text not null,
  post_key text not null,
  draft_id uuid,
  published_at timestamptz,
  source_kind text,
  source_evidence text,
  ivan_topic text,
  imp_d7 int,
  engager_coverage_d7 text,
  engagers_d7 int, buyer_engagers_d7 int, fit_unknown_d7 int, wrote_back_d7 int, buyer_wrote_back_d7 int,
  fit_versions text[],
  bookings_linked int,
  linked_meetings text[],
  primary key (read_id, client_id, post_key)
);
alter table public.content_outcome_reads enable row level security;
alter table public.content_outcome_read_rows enable row level security;
alter table public.content_outcome_read_posts enable row level security;
revoke all on public.content_outcome_reads, public.content_outcome_read_rows, public.content_outcome_read_posts from public, anon, authenticated;
grant all on public.content_outcome_reads, public.content_outcome_read_rows, public.content_outcome_read_posts to service_role;

-- 90% Poisson interval for a per-post rate: k events over n posts (cb37_poisson_ci90 holds k <= 300).
create or replace function public.content_outcome_rate_ci(k int, n int)
returns numeric[] language sql stable set search_path = public, pg_temp as $f$
  select case when n is null or n <= 0 or k is null then null
              when k <= 300 then (select array[round(lo / n, 3), round(hi / n, 3)] from public.cb37_poisson_ci90 where cb37_poisson_ci90.k = content_outcome_rate_ci.k)
              else array[round((k - 1.645 * sqrt(k::numeric)) / n, 3), round((k + 1.645 * sqrt(k::numeric)) / n, 3)] end
$f$;

-- The read for one 28-day window ending p_window_end (00:00 UTC). Groups are compared only inside one lane.
create or replace function public.content_outcome_read(p_window_end timestamptz, p_trigger text default 'manual')
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
set statement_timeout = '900s'
set timezone = 'UTC'
as $f$
declare
  w_end timestamptz := date_trunc('day', p_window_end);
  w_start timestamptz := date_trunc('day', p_window_end) - interval '28 days';
  rid text := 'co-' || to_char(date_trunc('day', p_window_end) at time zone 'UTC', 'YYYYMMDD');
  n_posts int; n_rows int; s jsonb;
begin
  if mod((extract(epoch from w_end - timestamptz '2026-11-06 00:00:00+00') / 86400)::numeric, 28) <> 0 then
    return jsonb_build_object('skipped', 'window end not in the 28-day sequence from 2026-11-06', 'window_end', w_end);
  end if;
  if w_end > now() - interval '8 days' then
    return jsonb_build_object('skipped', 'window not mature', 'window_end', w_end);
  end if;
  perform pg_advisory_xact_lock(hashtext('content_outcome_read:' || rid));
  if exists (select 1 from public.content_outcome_reads where read_id = rid and status = 'done') then
    return jsonb_build_object('skipped', 'already done', 'read_id', rid);
  end if;
  delete from public.content_outcome_reads where read_id = rid;
  insert into public.content_outcome_reads (read_id, as_of, window_start, window_end, trigger)
  values (rid, now(), w_start, w_end, coalesce(p_trigger, 'manual'));
  begin
    insert into public.content_outcome_read_posts
    select rid, o.client_id, o.post_key, o.draft_id, o.published_at, o.source_kind, o.source_evidence, o.ivan_topic,
           o.imp_d7, o.engager_coverage_d7, o.engagers_d7, o.buyer_engagers_d7, o.fit_unknown_d7, o.wrote_back_d7,
           o.buyer_wrote_back_d7, o.fit_versions, o.bookings_linked, o.linked_meetings
      from public.content_post_outcome_d7_v o
     where o.published_at >= w_start and o.published_at < w_end and o.d7_mature;  -- deleted posts kept as 'deleted', left out below
    get diagnostics n_posts = row_count;

    insert into public.content_outcome_read_rows
    select rid, g.client_id, g.dimension, g.grp, public.content_source_kind_label(g.grp),
           count(*)::int,
           count(p.imp_d7)::int,
           percentile_cont(0.5) within group (order by p.imp_d7),
           percentile_cont(0.25) within group (order by p.imp_d7),
           percentile_cont(0.75) within group (order by p.imp_d7),
           count(p.buyer_engagers_d7)::int,
           sum(p.buyer_engagers_d7)::int,
           round(avg(p.buyer_engagers_d7), 3),
           (public.content_outcome_rate_ci(sum(p.buyer_engagers_d7)::int, count(p.buyer_engagers_d7)::int))[1],
           (public.content_outcome_rate_ci(sum(p.buyer_engagers_d7)::int, count(p.buyer_engagers_d7)::int))[2],
           count(p.wrote_back_d7)::int,
           sum(p.wrote_back_d7)::int,
           round(avg(p.wrote_back_d7), 3),
           (public.content_outcome_rate_ci(sum(p.wrote_back_d7)::int, count(p.wrote_back_d7)::int))[1],
           (public.content_outcome_rate_ci(sum(p.wrote_back_d7)::int, count(p.wrote_back_d7)::int))[2],
           (select count(distinct m) from public.content_outcome_read_posts q, unnest(q.linked_meetings) m
             where q.read_id = rid and q.client_id = g.client_id and q.engager_coverage_d7 is distinct from 'deleted'
               and (g.dimension = 'lane' or (g.dimension = 'source_kind' and q.source_kind = g.grp)
                    or (g.dimension = 'ivan_topic' and q.ivan_topic = g.grp)))::int,
           (select array_agg(distinct v order by v) from public.content_outcome_read_posts q, unnest(q.fit_versions) v
             where q.read_id = rid and q.client_id = g.client_id and q.engager_coverage_d7 is distinct from 'deleted'
               and (g.dimension = 'lane' or (g.dimension = 'source_kind' and q.source_kind = g.grp)
                    or (g.dimension = 'ivan_topic' and q.ivan_topic = g.grp))),
           jsonb_build_object(
             'no_day7_impressions', count(*) - count(p.imp_d7),
             'engagers_not_collected', count(*) filter (where p.engager_coverage_d7 in ('not_collected', 'no_data')),
             'engagers_not_shown_by_day7', count(*) filter (where p.engager_coverage_d7 in ('not_shown_by_day7', 'zero_not_shown_at_day7')),
             'comments_only', count(*) filter (where p.engager_coverage_d7 = 'comments_only'),
             'all_engagers_unscored', count(*) filter (where p.engagers_d7 > 0 and p.buyer_engagers_d7 is null and p.engager_coverage_d7 in ('collected', 'none_expected')),
             'engagers_fit_unknown', coalesce(sum(p.fit_unknown_d7), 0),
             'buyer_wrote_back', coalesce(sum(p.buyer_wrote_back_d7), 0))
      from public.content_outcome_read_posts p
      cross join lateral (values (p.client_id, 'lane', 'all'), (p.client_id, 'source_kind', p.source_kind),
                                 (p.client_id, 'ivan_topic', p.ivan_topic)) as g(client_id, dimension, grp)
     where p.read_id = rid and g.grp is not null and p.engager_coverage_d7 is distinct from 'deleted'
     group by g.client_id, g.dimension, g.grp;
    get diagnostics n_rows = row_count;
    update public.content_outcome_read_rows x
       set coverage = x.coverage || jsonb_build_object('deleted_left_out',
             (select count(*) from public.content_outcome_read_posts q where q.read_id = rid and q.client_id = x.client_id and q.engager_coverage_d7 = 'deleted'))
     where x.read_id = rid and x.dimension = 'lane';

    select jsonb_build_object('posts', n_posts, 'rows', n_rows,
             'lanes', coalesce(jsonb_object_agg(x.client_id, x.posts), '{}'::jsonb))
      into s
      from public.content_outcome_read_rows x where x.read_id = rid and x.dimension = 'lane';
    update public.content_outcome_reads set status = 'done', summary = s, finished_at = now() where read_id = rid;
    return jsonb_build_object('read_id', rid, 'window_start', w_start, 'window_end', w_end) || s;
  exception
    when query_canceled then
      update public.content_outcome_reads set status = 'failed', error = 'canceled: ' || left(sqlerrm, 480), finished_at = now() where read_id = rid;
      return jsonb_build_object('read_id', rid, 'failed', sqlerrm);
    when others then
      update public.content_outcome_reads set status = 'failed', error = left(sqlerrm, 500), finished_at = now() where read_id = rid;
      return jsonb_build_object('read_id', rid, 'failed', sqlerrm);
  end;
end
$f$;

-- Weekly tick: runs every window in the fixed 28-day sequence (anchor 2026-11-06) that has matured and has no done
-- read, oldest first, at most 3 per tick. A failed window is retried the next Monday; no window is skipped.
create or replace function public.content_outcome_read_due()
returns jsonb language plpgsql security definer set search_path = public, pg_temp set timezone = 'UTC' as $f$
declare
  w timestamptz := timestamptz '2026-11-06 00:00:00+00';
  res jsonb := '[]'::jsonb; n int := 0;
begin
  while w <= now() - interval '8 days' and n < 3 loop
    if not exists (select 1 from public.content_outcome_reads where read_id = 'co-' || to_char(w at time zone 'UTC', 'YYYYMMDD') and status = 'done') then
      res := res || jsonb_build_array(public.content_outcome_read(w, 'pg_cron:content-outcome-read'));
      n := n + 1;
    end if;
    w := w + interval '28 days';
  end loop;
  return jsonb_build_object('ran', n, 'results', res);
end
$f$;

-- The page's one read: the latest done read for one lane, plus the read for the window right before it.
-- Allowed for the service role, a direct database session, or an operator entitled to the lane (cb34 entitlement;
-- SwishDM has none of its own, so it uses Ivan's).
create or replace function public.content_outcome_latest(p_client text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' as $f$
declare res jsonb;
begin
  if p_client is null or p_client <> all (array['ivan', 'risedtc', 'arch', 'swishdm']) then return null; end if;
  if not (coalesce(auth.role(), '') = 'service_role'
          or coalesce(current_setting('request.jwt.claims', true), '') = ''
          or public.cb34_p2_operator_lane_allowed(case when p_client = 'swishdm' then 'ivan' else p_client end)) then
    raise exception 'lane access denied' using errcode = '42501';
  end if;
  with r as (
    select * from public.content_outcome_reads
     where status = 'done' and read_id ~ '^co-[0-9]{8}$'
       and mod((extract(epoch from window_end - timestamptz '2026-11-06 00:00:00+00') / 86400)::numeric, 28) = 0
     order by window_end desc limit 1
  ), prev as (
    select x.* from public.content_outcome_reads x, r
     where x.status = 'done' and x.read_id ~ '^co-[0-9]{8}$' and x.window_end = r.window_start
  ), rows_of as (
    select read_id, jsonb_agg(jsonb_build_object(
             'dimension', dimension, 'grp', grp, 'label', label, 'posts', posts, 'imp_posts', imp_posts,
             'imp_median', imp_median, 'imp_p25', imp_p25, 'imp_p75', imp_p75, 'buyer_posts', buyer_posts,
             'buyer_sum', buyer_sum, 'buyer_per_post', buyer_per_post, 'buyer_lo', buyer_lo, 'buyer_hi', buyer_hi,
             'wrote_posts', wrote_posts, 'wrote_sum', wrote_sum, 'wrote_per_post', wrote_per_post, 'wrote_lo', wrote_lo, 'wrote_hi', wrote_hi,
             'bookings_linked', bookings_linked, 'fit_versions', fit_versions, 'coverage', coverage)
             order by dimension, posts desc, grp) as rows
      from public.content_outcome_read_rows
     where client_id = p_client and read_id in (select read_id from r union all select read_id from prev)
     group by read_id
  )
  select jsonb_build_object(
      'read', (select jsonb_build_object('read_id', r.read_id, 'as_of', r.as_of, 'window_start', r.window_start,
                                         'window_end', r.window_end, 'rows', coalesce(ro.rows, '[]'::jsonb))
                 from r left join rows_of ro on ro.read_id = r.read_id),
      'prev', (select jsonb_build_object('read_id', p.read_id, 'window_start', p.window_start, 'window_end', p.window_end,
                                         'rows', coalesce(ro.rows, '[]'::jsonb))
                 from prev p left join rows_of ro on ro.read_id = p.read_id))
    into res;
  return res;
end
$f$;
revoke all on function public.content_outcome_read(timestamptz, text) from public, anon, authenticated;
revoke all on function public.content_outcome_read_due() from public, anon, authenticated;
revoke all on function public.content_outcome_latest(text) from public, anon;
grant execute on function public.content_outcome_latest(text) to authenticated, service_role;
grant execute on function public.content_outcome_read(timestamptz, text), public.content_outcome_read_due() to service_role;

-- Monday 21:30 UTC, after the weekly cb37 refresh (20:15).
select cron.schedule('content-outcome-read', '30 21 * * 1', $c$select public.content_outcome_read_due()$c$);

COMMIT;
