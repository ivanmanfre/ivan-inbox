-- db/283: explicit SwishDM outlier and fit lane; writer stays OFF, planning policy stays draft.

BEGIN;

SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE VIEW public.outlier_corpus_sources_v AS
 WITH v2 AS (
         SELECT DISTINCT ON (s.client_id) s.client_id,
            s.study_id
           FROM client_research_studies s
          WHERE ((s.method_version = 'content-evidence-methods-v2'::text) AND (s.study_kind = 'market'::text) AND (s.client_id = ANY (ARRAY['risedtc'::text, 'arch'::text])))
          ORDER BY s.client_id, s.created_at DESC
        ), fe AS (
         SELECT DISTINCT ON (f.client_id, f.post_ref) f.client_id,
            f.post_ref,
            f.post_type
           FROM outlier_post_format_evidence f
          ORDER BY f.client_id, f.post_ref, f.created_at DESC, f.source
        )
 SELECT 'ivan'::text AS client_id,
    outlier_post_ref(cp.linkedin_post_url) AS post_ref,
    1 AS src_order,
    row_number() OVER (ORDER BY cp.id) AS src_rank,
    COALESCE(outlier_profile_slug(cp.linkedin_profile_url), outlier_post_slug(cp.linkedin_post_url)) AS author_ref,
    cp.linkedin_post_url AS source_url,
    cp.post_date AS published_at,
    COALESCE(cp.post_text, ''::text) AS post_text,
    cp.post_type,
    cp.image_count,
    cp.paid_status,
    'competitor_posts'::text AS source
   FROM competitor_posts cp
  WHERE ((cp.client_id IS NULL) AND (NOT (EXISTS ( SELECT 1
           FROM competitor_roster sr
          WHERE ((sr.active = false) AND (outlier_profile_slug(sr.linkedin_profile_url) = COALESCE(outlier_profile_slug(cp.linkedin_profile_url), outlier_post_slug(cp.linkedin_post_url))))))))
UNION ALL
 SELECT sp.client_id,
        CASE
            WHEN (sp.canonical_source_id ~ '^[0-9]{16,20}$'::text) THEN sp.canonical_source_id
            ELSE outlier_post_ref(sp.source_url)
        END AS post_ref,
    2 AS src_order,
    row_number() OVER (PARTITION BY sp.client_id ORDER BY sp.canonical_source_id) AS src_rank,
        CASE
            WHEN (sp.client_id = 'risedtc'::text) THEN lower(COALESCE(sp.author_id, ''::text))
            ELSE COALESCE(outlier_profile_slug(sp.author_id), outlier_post_slug(sp.source_url))
        END AS author_ref,
    sp.source_url,
    sp.published_at,
    COALESCE(sp.post_text, ''::text) AS post_text,
        CASE
            WHEN (sp.client_id = 'risedtc'::text) THEN fe.post_type
            ELSE (sp.format_evidence ->> 'post_type'::text)
        END AS post_type,
    NULL::integer AS image_count,
    'unknown'::text AS paid_status,
    ('study:'::text || sp.study_id) AS source
   FROM ((client_research_study_posts sp
     JOIN v2 ON (((v2.client_id = sp.client_id) AND (v2.study_id = sp.study_id))))
     LEFT JOIN fe ON (((fe.client_id = sp.client_id) AND (fe.post_ref = sp.canonical_source_id))))
  WHERE ((sp.population = 'market'::text) AND (NOT COALESCE(sp.is_own_control, false)))
UNION ALL
 SELECT a.client_id,
    outlier_post_ref(a.linkedin_post_url) AS post_ref,
    3 AS src_order,
    row_number() OVER (PARTITION BY a.client_id ORDER BY a.id) AS src_rank,
    a.author_slug AS author_ref,
    a.linkedin_post_url AS source_url,
    a.post_date AS published_at,
    COALESCE(a.post_text, ''::text) AS post_text,
    a.post_type,
    a.image_count,
    a.paid_status,
    'audn_competitor_posts'::text AS source
   FROM audn_competitor_roster_attribution_v a
  WHERE ((a.client_id = ANY (ARRAY['risedtc'::text, 'arch'::text])) AND a.roster_author)
UNION ALL
 SELECT sp.client_id, sp.post_ref, 4 AS src_order,
        row_number() over (partition by sp.client_id order by sp.post_ref) AS src_rank,
        sp.author_ref, sp.source_url, sp.published_at, coalesce(sp.post_text,''), sp.post_type,
        sp.image_count, sp.paid_status, 'supply:' || sp.selection_source
 FROM public.outlier_supply_posts sp WHERE sp.client_id = 'swishdm' ;

CREATE OR REPLACE VIEW public.outlier_readings_v AS
 WITH v2 AS (
         SELECT DISTINCT ON (s.client_id) s.client_id,
            s.study_id
           FROM client_research_studies s
          WHERE ((s.method_version = 'content-evidence-methods-v2'::text) AND (s.study_kind = 'market'::text) AND (s.client_id = ANY (ARRAY['risedtc'::text, 'arch'::text])))
          ORDER BY s.client_id, s.created_at DESC
        )
 SELECT 'ivan'::text AS client_id,
    outlier_post_ref(cp.linkedin_post_url) AS post_ref,
    cp.updated_at AS reading_at,
    (cp.likes_count)::numeric AS likes,
    (cp.reposts_count)::numeric AS reposts,
    (cp.comments_count)::numeric AS comments,
    cp.paid_status,
    'row:competitor_posts'::text AS source
   FROM competitor_posts cp
  WHERE (cp.client_id IS NULL)
UNION ALL
 SELECT sp.client_id,
        CASE
            WHEN (sp.canonical_source_id ~ '^[0-9]{16,20}$'::text) THEN sp.canonical_source_id
            ELSE outlier_post_ref(sp.source_url)
        END AS post_ref,
    ((o.value ->> 'captured_at'::text))::timestamp with time zone AS reading_at,
    (((o.value -> 'metrics'::text) ->> 'likes'::text))::numeric AS likes,
    (((o.value -> 'metrics'::text) ->> 'reposts'::text))::numeric AS reposts,
    (((o.value -> 'metrics'::text) ->> 'comments'::text))::numeric AS comments,
    'unknown'::text AS paid_status,
    'study_obs'::text AS source
   FROM ((client_research_study_posts sp
     JOIN v2 ON (((v2.client_id = sp.client_id) AND (v2.study_id = sp.study_id))))
     CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN (jsonb_typeof(sp.observations) = 'array'::text) THEN sp.observations
            ELSE '[]'::jsonb
        END) o(value))
  WHERE ((sp.population = 'market'::text) AND (NOT COALESCE(sp.is_own_control, false)))
UNION ALL
 SELECT a.client_id,
    outlier_post_ref(a.linkedin_post_url) AS post_ref,
    a.updated_at AS reading_at,
    (a.likes_count)::numeric AS likes,
    (a.reposts_count)::numeric AS reposts,
    (a.comments_count)::numeric AS comments,
    a.paid_status,
    'row:audn'::text AS source
   FROM audn_competitor_roster_attribution_v a
  WHERE ((a.client_id = ANY (ARRAY['risedtc'::text, 'arch'::text])) AND a.roster_author)
UNION ALL
 SELECT s.client_id,
    outlier_post_ref(s.post_ref) AS post_ref,
    s.observed_at AS reading_at,
    (s.likes)::numeric AS likes,
    (s.reposts)::numeric AS reposts,
    (s.comments)::numeric AS comments,
    COALESCE(s.paid_status, 'unknown'::text) AS paid_status,
    ('snap:'::text || s.source) AS source
   FROM competitor_post_snapshots s
  WHERE ((s.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])) AND (s.source <> 'backfill-082'::text))
UNION ALL
 SELECT sr.client_id, sr.post_ref, sr.reading_at, sr.likes, sr.reposts, sr.comments,
        'unknown'::text AS paid_status, 'supply:' || sr.source
 FROM public.outlier_supply_readings sr WHERE sr.client_id = 'swishdm' ;

CREATE OR REPLACE VIEW public.outlier_corpus_v4_v AS
 WITH src AS (
         SELECT u.client_id,
            u.post_ref,
            u.src_order,
            u.src_rank,
            u.author_ref,
            u.source_url,
            u.published_at,
            u.post_text,
            u.post_type,
            u.image_count,
            u.paid_status,
            u.source,
            u.sel,
            row_number() OVER (PARTITION BY u.client_id, u.post_ref ORDER BY u.src_order, u.src_rank) AS ord
           FROM ( SELECT s.client_id,
                    s.post_ref,
                    s.src_order,
                    s.src_rank,
                    s.author_ref,
                    s.source_url,
                    s.published_at,
                    s.post_text,
                    s.post_type,
                    s.image_count,
                    s.paid_status,
                    s.source,
                        CASE
                            WHEN (s.source = ANY (ARRAY['competitor_posts'::text, 'audn_competitor_posts'::text])) THEN 'roster'::text
                            WHEN (s.source ~~ 'study:%'::text) THEN 'study'::text
                            ELSE 'other'::text
                        END AS sel
                   FROM outlier_corpus_sources_v s
                  WHERE (s.post_ref IS NOT NULL AND s.client_id <> 'swishdm')
                UNION ALL
                 SELECT sp.client_id,
                    sp.post_ref,
                    4 AS src_order,
                    row_number() OVER (PARTITION BY sp.client_id ORDER BY sp.post_ref) AS src_rank,
                    sp.author_ref,
                    sp.source_url,
                    sp.published_at,
                    COALESCE(sp.post_text, ''::text) AS post_text,
                    sp.post_type,
                    sp.image_count,
                    sp.paid_status,
                    ('supply:'::text || sp.selection_source) AS source,
                    sp.selection_source AS sel
                   FROM outlier_supply_posts sp
                  WHERE (sp.post_ref IS NOT NULL)) u
        ), post AS (
         SELECT src.client_id,
            src.post_ref,
            (array_agg(src.published_at ORDER BY src.ord))[1] AS p1,
            (array_agg(src.published_at ORDER BY src.ord) FILTER (WHERE ((src.ord > 1) AND (src.published_at IS NOT NULL) AND (((src.published_at AT TIME ZONE 'UTC'::text))::time without time zone <> '00:00:00'::time without time zone))))[1] AS pn,
            COALESCE((array_agg(src.author_ref ORDER BY src.ord) FILTER (WHERE (COALESCE(src.author_ref, ''::text) <> ''::text)))[1], (array_agg(src.author_ref ORDER BY src.ord))[1]) AS author_ref,
            (array_agg(src.source_url ORDER BY src.ord) FILTER (WHERE (COALESCE(src.source_url, ''::text) <> ''::text)))[1] AS source_url,
            COALESCE((array_agg(src.post_text ORDER BY src.ord) FILTER (WHERE (COALESCE(src.post_text, ''::text) <> ''::text)))[1], ''::text) AS post_text,
            (array_agg(src.post_type ORDER BY src.ord) FILTER (WHERE (COALESCE(src.post_type, ''::text) <> ''::text)))[1] AS post_type,
            (array_agg(src.image_count ORDER BY src.ord) FILTER (WHERE (src.image_count IS NOT NULL)))[1] AS image_count,
            bool_or((src.paid_status = 'paid'::text)) AS src_paid,
            bool_or((src.paid_status = 'organic'::text)) AS src_organic,
            string_agg(DISTINCT src.source, '+'::text ORDER BY src.source) AS source,
            bool_or((src.sel = 'roster'::text)) AS has_roster,
            bool_or((src.sel = 'study'::text)) AS has_study,
            bool_or((src.sel = 'prereg_author_backfill'::text)) AS has_prereg,
            bool_or((src.sel = 'cohort_buyer_adjacent'::text)) AS has_cohort,
            bool_or((src.sel = 'study_roster_one_shot'::text)) AS has_supply_study_roster
           FROM src
          GROUP BY src.client_id, src.post_ref
        ), post2 AS (
         SELECT p_1.client_id,
            p_1.post_ref,
            p_1.p1,
            p_1.pn,
            p_1.author_ref,
            p_1.source_url,
            p_1.post_text,
            p_1.post_type,
            p_1.image_count,
            p_1.src_paid,
            p_1.src_organic,
            p_1.source,
                CASE
                    WHEN ((p_1.p1 IS NOT NULL) AND (((p_1.p1 AT TIME ZONE 'UTC'::text))::time without time zone = '00:00:00'::time without time zone) AND (p_1.pn IS NOT NULL)) THEN p_1.pn
                    ELSE p_1.p1
                END AS published_at,
                CASE
                    WHEN p_1.has_roster THEN 'roster_weekly'::text
                    WHEN (p_1.has_study AND ((p_1.client_id = 'risedtc'::text) OR ((p_1.client_id = 'arch'::text) AND (EXISTS ( SELECT 1
                       FROM (client_registry cr
                         CROSS JOIN LATERAL jsonb_array_elements(
                            CASE
                                WHEN (jsonb_typeof(((cr.platform -> 'measurement'::text) -> 'roster'::text)) = 'array'::text) THEN ((cr.platform -> 'measurement'::text) -> 'roster'::text)
                                ELSE '[]'::jsonb
                            END) ro(value))
                      WHERE ((cr.client_id = 'arch'::text) AND (p_1.author_ref IS NOT NULL) AND ((outlier_profile_slug((ro.value ->> 'url'::text)) = p_1.author_ref) OR (outlier_profile_slug((ro.value ->> 'source_url'::text)) = p_1.author_ref)))))))) THEN 'study_roster_one_shot'::text
                    WHEN p_1.has_supply_study_roster THEN 'study_roster_one_shot'::text
                    WHEN p_1.has_prereg THEN 'prereg_author_backfill'::text
                    WHEN p_1.has_cohort THEN 'cohort_buyer_adjacent'::text
                    WHEN p_1.has_study THEN 'keyword_study'::text
                    ELSE NULL::text
                END AS selection_source
           FROM post p_1
        ), rstat AS (
         SELECT r_1.client_id,
            r_1.post_ref,
            count(*) AS reading_count,
            bool_or((r_1.paid_status = 'paid'::text)) AS r_paid,
            bool_or((r_1.paid_status = 'organic'::text)) AS r_organic
           FROM outlier_readings_v4_v r_1
          WHERE (r_1.post_ref IS NOT NULL)
          GROUP BY r_1.client_id, r_1.post_ref
        ), usable AS (
         SELECT r_1.client_id,
            r_1.post_ref,
            r_1.reading_at,
            max(r_1.likes) AS likes,
            max(r_1.reposts) AS reposts,
            max(r_1.comments) AS comments
           FROM outlier_readings_v4_v r_1
          WHERE ((r_1.post_ref IS NOT NULL) AND (r_1.reading_at IS NOT NULL) AND (r_1.likes IS NOT NULL) AND (r_1.reposts IS NOT NULL))
          GROUP BY r_1.client_id, r_1.post_ref, r_1.reading_at
        ), aged AS (
         SELECT u.client_id,
            u.post_ref,
            u.reading_at,
            u.likes,
            u.reposts,
            u.comments,
            (EXTRACT(epoch FROM (u.reading_at - p_1.published_at)) / 86400.0) AS age
           FROM (usable u
             JOIN post2 p_1 ON (((p_1.client_id = u.client_id) AND (p_1.post_ref = u.post_ref))))
          WHERE (p_1.published_at IS NOT NULL)
        ), ranked AS (
         SELECT a.client_id,
            a.post_ref,
            a.reading_at,
            a.likes,
            a.reposts,
            a.comments,
            a.age,
                CASE
                    WHEN ((a.age >= (7)::numeric) AND (a.age <= (14)::numeric)) THEN 'd7_14'::text
                    WHEN (a.age > (14)::numeric) THEN 'late'::text
                    ELSE 'early_only'::text
                END AS age_class,
            row_number() OVER (PARTITION BY a.client_id, a.post_ref ORDER BY
                CASE
                    WHEN ((a.age >= (7)::numeric) AND (a.age <= (14)::numeric)) THEN 1
                    WHEN (a.age > (14)::numeric) THEN 2
                    ELSE 3
                END,
                CASE
                    WHEN ((a.age >= (7)::numeric) AND (a.age <= (14)::numeric)) THEN a.age
                    WHEN (a.age > (14)::numeric) THEN a.age
                    ELSE (- a.age)
                END, a.reading_at) AS rn
           FROM aged a
        )
 SELECT p.client_id,
    p.post_ref,
    p.author_ref,
    p.published_at,
    p.post_text,
    p.post_type,
    p.image_count,
    r.likes,
    r.reposts,
    r.comments,
    r.reading_at AS observed_at,
    round(r.age, 3) AS age_days,
    COALESCE(r.age_class, 'unknown_metrics'::text) AS age_class,
        CASE
            WHEN (p.src_paid OR COALESCE(st.r_paid, false)) THEN 'paid'::text
            WHEN (p.src_organic OR COALESCE(st.r_organic, false)) THEN 'organic'::text
            ELSE 'unknown'::text
        END AS paid_status,
    p.source,
    p.source_url,
    (r.likes + ((3)::numeric * r.reposts)) AS score,
    COALESCE(st.reading_count, (0)::bigint) AS reading_count,
    p.selection_source
   FROM ((post2 p
     LEFT JOIN ranked r ON (((r.client_id = p.client_id) AND (r.post_ref = p.post_ref) AND (r.rn = 1))))
     LEFT JOIN rstat st ON (((st.client_id = p.client_id) AND (st.post_ref = p.post_ref))));

CREATE OR REPLACE VIEW public.outlier_readings_v4_v AS
 SELECT r.client_id,
    r.post_ref,
    r.reading_at,
    r.likes,
    r.reposts,
    r.comments,
    r.paid_status,
    r.source
   FROM outlier_readings_v r WHERE r.client_id <> 'swishdm'
UNION ALL
 SELECT sr.client_id,
    sr.post_ref,
    sr.reading_at,
    sr.likes,
    sr.reposts,
    sr.comments,
    'unknown'::text AS paid_status,
    ('supply:'::text || sr.source) AS source
   FROM outlier_supply_readings sr;

ALTER TABLE public.cb30_post_checks DROP CONSTRAINT cb30_post_checks_client_id_check;
ALTER TABLE public.cb30_post_checks ADD CONSTRAINT cb30_post_checks_client_id_check CHECK ((client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])));

ALTER TABLE public.outlier_studies_v4 DROP CONSTRAINT outlier_studies_v4_client_chk;
ALTER TABLE public.outlier_studies_v4 ADD CONSTRAINT outlier_studies_v4_client_chk CHECK ((client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])));

ALTER TABLE public.outlier_post_scores_v4 DROP CONSTRAINT outlier_post_scores_v4_client_chk;
ALTER TABLE public.outlier_post_scores_v4 ADD CONSTRAINT outlier_post_scores_v4_client_chk CHECK ((client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])));

ALTER TABLE public.cb22_fit_judgments DROP CONSTRAINT cb22_fit_judgments_client_id_check;
ALTER TABLE public.cb22_fit_judgments ADD CONSTRAINT cb22_fit_judgments_client_id_check CHECK ((client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])));

ALTER TABLE public.cb22_promotion_scores DROP CONSTRAINT cb22_promotion_scores_client_id_check;
ALTER TABLE public.cb22_promotion_scores ADD CONSTRAINT cb22_promotion_scores_client_id_check CHECK ((client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])));

ALTER TABLE public.cb22_promotion_log DROP CONSTRAINT cb22_promotion_log_client_id_check;
ALTER TABLE public.cb22_promotion_log ADD CONSTRAINT cb22_promotion_log_client_id_check CHECK ((client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text, 'swishdm'::text])));

CREATE OR REPLACE VIEW public.cb22_fit_brief_v AS
WITH d AS (
         SELECT DISTINCT ON (v.client_id) v.client_id,
            v.version,
            v.payload
           FROM editorial_direction_versions v
          WHERE (v.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])) AND ((v.payload -> 'weekly_policy'::text) ->> 'status'::text) = 'adopted'::text
          ORDER BY v.client_id, v.created_at DESC, v.version DESC
        ), secs AS (
         SELECT d_1.client_id,
            string_agg((('## '::text || (x.s ->> 'title'::text)) || '
'::text) || (x.s ->> 'body'::text), '

'::text ORDER BY x.ord) AS txt
           FROM d d_1
             CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(d_1.payload -> 'base_strategy'::text) = 'object'::text THEN (d_1.payload -> 'base_strategy'::text) -> 'sections'::text
                    WHEN jsonb_typeof(d_1.payload -> 'base_strategy'::text) = 'string'::text THEN ((d_1.payload ->> 'base_strategy'::text)::jsonb) -> 'sections'::text
                    ELSE '[]'::jsonb
                END) WITH ORDINALITY x(s, ord)
          WHERE (x.s ->> 'key'::text) = ANY (ARRAY['buyer'::text, 'offer'::text, 'angles'::text, 'personal'::text, 'never'::text])
          GROUP BY d_1.client_id
        ), iv AS (
         SELECT "substring"(av.body, 'Locked identity line \(verbatim[^)]*\):\*\* "([^"]+)"'::text) AS identity,
            "substring"(fm.body, '(- Two lanes only[^\n]*)'::text) AS lanes,
            av.version AS av_v,
            fm.version AS fm_v
           FROM content_prompts av,
            content_prompts fm
          WHERE av.slug = 'author-voice'::text AND fm.slug = 'format-mix-policy-2026'::text
        )
 SELECT d.client_id,
    d.version AS direction_version,
    d.payload -> 'weekly_policy'::text AS weekly_policy,
    concat_ws('

'::text,
        CASE
            WHEN d.client_id = 'ivan'::text THEN (('Identity line (locked, author-voice v'::text || iv.av_v) || '): '::text) || iv.identity
            ELSE NULL::text
        END,
        CASE
            WHEN d.client_id = 'ivan'::text THEN ((('Lanes (format-mix-policy-2026 v'::text || iv.fm_v) || '):'::text) || '
'::text) || iv.lanes
            ELSE NULL::text
        END, s.txt, ((((('## Weekly plan (adopted)'::text || '
'::text) || 'Objective: '::text) || COALESCE((d.payload -> 'weekly_policy'::text) ->> 'objective'::text, ''::text)) || '
'::text) || 'Slots per week: '::text) || COALESCE((((d.payload -> 'weekly_policy'::text) -> 'allocation'::text) -> 'values'::text)::text, '{}'::text)) AS brief
   FROM d
     JOIN secs s ON s.client_id = d.client_id
     LEFT JOIN iv ON d.client_id = 'ivan'::text
UNION ALL
 SELECT d.client_id, d.version, d.payload -> 'weekly_policy',
        'PLANNING CONTEXT ONLY. Strategy and weekly mix await approval; do not invent results or copy another author. No publishing or writing activation is authorized.' || E'\n\n' ||
        coalesce((SELECT string_agg('## ' || (s->>'title') || E'\n' || (s->>'body'), E'\n\n' ORDER BY ord)
          FROM jsonb_array_elements(d.payload->'base_strategy'->'sections') WITH ORDINALITY x(s,ord)
          WHERE s->>'key' IN ('buyer','offer','angles','sources')), '')
 FROM (SELECT DISTINCT ON (client_id) client_id, version, payload
       FROM public.editorial_direction_versions WHERE client_id='swishdm'
       ORDER BY client_id, created_at DESC, version DESC) d;


DO $patch$
DECLARE d text := pg_get_functiondef('public.outlier_recompute_v3(text,text)'::regprocedure);
BEGIN

  IF position($old$'ivan','risedtc','arch'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: outlier_recompute_v3'; END IF;
  d := replace(d, $old$'ivan','risedtc','arch'$old$, $new$'ivan','risedtc','arch','swishdm'$new$);

  EXECUTE d;
END
$patch$;

DO $patch$
DECLARE d text := pg_get_functiondef('public.outlier_recompute_v4(text,text)'::regprocedure);
BEGIN

  IF position($old$'ivan','risedtc','arch'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: outlier_recompute_v4'; END IF;
  d := replace(d, $old$'ivan','risedtc','arch'$old$, $new$'ivan','risedtc','arch','swishdm'$new$);

  EXECUTE d;
END
$patch$;

DO $patch$
DECLARE d text := pg_get_functiondef('public.outlier_recompute_all(text)'::regprocedure);
BEGIN

  IF position($old$'ivan','risedtc','arch'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: outlier_recompute_all'; END IF;
  d := replace(d, $old$'ivan','risedtc','arch'$old$, $new$'ivan','risedtc','arch','swishdm'$new$);

  EXECUTE d;
END
$patch$;

DO $patch$
DECLARE d text := pg_get_functiondef('public.outlier_recompute_v4_all(text)'::regprocedure);
BEGIN

  IF position($old$'ivan','risedtc','arch'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: outlier_recompute_v4_all'; END IF;
  d := replace(d, $old$'ivan','risedtc','arch'$old$, $new$'ivan','risedtc','arch','swishdm'$new$);

  EXECUTE d;
END
$patch$;

DO $patch$
DECLARE d text := pg_get_functiondef('public.operator_outliers(text,text,text,date)'::regprocedure);
BEGIN

  IF position($old$'ivan', 'risedtc', 'arch'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: operator_outliers'; END IF;
  d := replace(d, $old$'ivan', 'risedtc', 'arch'$old$, $new$'ivan', 'risedtc', 'arch', 'swishdm'$new$);

  EXECUTE d;
END
$patch$;

DO $patch$
DECLARE d text := pg_get_functiondef('public.operator_outlier_use(text,text,text,text)'::regprocedure);
BEGIN

  IF position($old$'ivan', 'risedtc', 'arch'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: operator_outlier_use'; END IF;
  d := replace(d, $old$'ivan', 'risedtc', 'arch'$old$, $new$'ivan', 'risedtc', 'arch', 'swishdm'$new$);

  EXECUTE d;
END
$patch$;

DO $patch$
DECLARE d text := pg_get_functiondef('public.cb22_inputs(text,text)'::regprocedure);
BEGIN

  IF position($old$and not (coalesce(r.author_key, '') ~* c_identity$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_inputs'; END IF;
  d := replace(d, $old$and not (coalesce(r.author_key, '') ~* c_identity$old$, $new$and not (p_client = 'swishdm' and (coalesce(r.author_key, '') || ' ' || coalesce(r.author, '')) ~* '(jonathan.?kiekbusch|swishdm)')
       and not (coalesce(r.author_key, '') ~* c_identity$new$);

  IF position($old$'ivan', 'risedtc', 'arch'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_inputs'; END IF;
  d := replace(d, $old$'ivan', 'risedtc', 'arch'$old$, $new$'ivan', 'risedtc', 'arch', 'swishdm'$new$);

  EXECUTE d;
END
$patch$;

DO $patch$
DECLARE d text := pg_get_functiondef('public.cb22_promote(text,text,text,jsonb)'::regprocedure);
BEGIN

  IF position($old$continue when v_client not in ('risedtc', 'arch')$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_promote'; END IF;
  d := replace(d, $old$continue when v_client not in ('risedtc', 'arch')$old$, $new$continue when v_client not in ('risedtc', 'arch', 'swishdm')$new$);

  IF position($old$where x ->> 'client' in ('risedtc', 'arch') or (p_mode = 'checks' and x ->> 'client' = 'ivan')$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_promote'; END IF;
  d := replace(d, $old$where x ->> 'client' in ('risedtc', 'arch') or (p_mode = 'checks' and x ->> 'client' = 'ivan')$old$, $new$where x ->> 'client' in ('risedtc', 'arch') or (p_mode = 'checks' and x ->> 'client' in ('ivan', 'swishdm'))$new$);

  IF position($old$when 'arch' then 'People at mobile game studios and app companies who own user acquisition (UA) and influencer or creator marketing budgets.'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_promote'; END IF;
  d := replace(d, $old$when 'arch' then 'People at mobile game studios and app companies who own user acquisition (UA) and influencer or creator marketing budgets.'$old$, $new$when 'arch' then 'People at mobile game studios and app companies who own user acquisition (UA) and influencer or creator marketing budgets.'
                                         when 'swishdm' then 'US and Canadian ecommerce founders, CEOs and CMOs with room for $5k+ per month on SEO, AI search and digital PR that support customer acquisition.'$new$);

  IF position($old$then 'own_or_excluded_author'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_promote'; END IF;
  d := replace(d, $old$then 'own_or_excluded_author'$old$, $new$or (c.client_id = 'swishdm' and (coalesce(c.author_key, '') || ' ' || coalesce(c.author, '')) ~* '(jonathan.?kiekbusch|swishdm)') then 'own_or_excluded_author'$new$);

  IF position($old$v_client not in ('ivan', 'risedtc', 'arch')$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_promote'; END IF;
  d := replace(d, $old$v_client not in ('ivan', 'risedtc', 'arch')$old$, $new$v_client is null or v_client not in ('ivan', 'risedtc', 'arch')$new$);

  IF position($old$array['ivan', 'risedtc', 'arch']);$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_promote'; END IF;
  d := replace(d, $old$array['ivan', 'risedtc', 'arch']);$old$, $new$case when p_payload ? 'clients' then array[]::text[] else array['ivan', 'risedtc', 'arch'] end);$new$);

  IF position($old$  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_promote'; END IF;
  d := replace(d, $old$  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;$old$, $new$  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  -- An explicit scope is a restriction, never a hint. Validate it before building pools or writing judgments.
  if p_payload ? 'clients' then
    if jsonb_typeof(p_payload->'clients') is distinct from 'array' then raise exception 'invalid client scope'; end if;
    if jsonb_array_length(p_payload->'clients')=0 or exists (
      select 1 from jsonb_array_elements(p_payload->'clients') x
      where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('ivan','risedtc','arch','swishdm')) then
      raise exception 'invalid client scope';
    end if;
  end if;
  if p_mode in ('judgments','sellers','checks','baselines') then
    if jsonb_typeof(coalesce(p_payload->case when p_mode='judgments' then 'judgments' when p_mode='baselines' then 'rows' else 'checks' end,'[]'::jsonb)) is distinct from 'array' then
      raise exception 'invalid scoped rows';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(p_payload->case when p_mode='judgments' then 'judgments' when p_mode='baselines' then 'rows' else 'checks' end,'[]'::jsonb)) x
      where coalesce(x->>'client','') not in ('ivan','risedtc','arch','swishdm')
        or (p_mode in ('sellers','baselines') and x->>'client' not in ('risedtc','arch'))
        or (p_payload ? 'clients' and not (p_payload->'clients' @> jsonb_build_array(x->>'client')))) then
      raise exception 'row outside client scope';
    end if;
  end if;
$new$);

  IF position($old$'ivan', 'risedtc', 'arch'$old$ IN d) = 0 THEN RAISE EXCEPTION '283 base drift: cb22_promote'; END IF;
  d := replace(d, $old$'ivan', 'risedtc', 'arch'$old$, $new$'ivan', 'risedtc', 'arch', 'swishdm'$new$);

  EXECUTE d;
END
$patch$;

COMMIT;
