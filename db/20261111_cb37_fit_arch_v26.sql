begin;
set local lock_timeout='3s';
-- CB-37: let the results loop see ARCH buyers. The ARCH whitelist in cb37_engager_fit_v lists audn-arch-icp-engager-scoring@v17% and
-- arch-engager-v16, but ARCH's live scorer stamps are arch-icp-engager-scoring@v26 (post_engagers) and
-- arch-icp-engager-scoring@v26|cb21-scorer|... (post_touch_engagers), so every ARCH engager fell to 'unknown'.
-- Only change: one OR branch in the ARCH clause. Same columns, same order; create or replace keeps owner and grants.
-- Caveat: the list must move again when ARCH's rubric version moves (see cb37-notes.md).
do $guard$
begin
  if md5(pg_get_viewdef('public.cb37_engager_fit_v'::regclass, true)) <> '686021b6a57e664d6fd3b84a053cfb77' then
    raise exception 'cb37_engager_fit_v changed since this file was written; re-read the live definition';
  end if;
end $guard$;

create or replace view public.cb37_engager_fit_v as
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

commit;
