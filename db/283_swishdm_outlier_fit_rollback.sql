-- Restore readers/functions only; retain additive lane constraints and historical SwishDM scores.
BEGIN;
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
  WHERE ((a.client_id = ANY (ARRAY['risedtc'::text, 'arch'::text])) AND a.roster_author);

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
  WHERE ((s.client_id = ANY (ARRAY['ivan'::text, 'risedtc'::text, 'arch'::text])) AND (s.source <> 'backfill-082'::text));

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
                  WHERE (s.post_ref IS NOT NULL)
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
   FROM outlier_readings_v r
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
     LEFT JOIN iv ON d.client_id = 'ivan'::text;

CREATE OR REPLACE FUNCTION public.outlier_recompute_v3(p_client_id text, p_run_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_method   constant text := 'content-evidence-methods-v3';
  c_policy   constant text := 'outlier-policy-v3';
  c_cap      constant integer := 200;
  v_now      timestamptz := now();
  v_app      text := coalesce(current_setting('application_name', true), '');
  v_key      text;
  v_base     text;
  v_study    text;
  v_roster   text;
  v_counts   jsonb;
  v_thr      jsonb;
  v_n_corpus integer;
  v_n_scored integer;
  v_n3       integer;
  v_sha      text;
  v_missing  jsonb := '[]'::jsonb;
  v_existing text;
begin
  if p_client_id is null or p_client_id not in ('ivan','risedtc','arch') then
    raise exception 'outlier_recompute_v3: client % has no outlier corpus', coalesce(p_client_id, '<null>');
  end if;
  if p_run_key is null or btrim(p_run_key) = '' then
    raise exception 'outlier_recompute_v3 requires a run_key';
  end if;
  v_key := left(regexp_replace(lower(btrim(p_run_key)), '[^a-z0-9_-]+', '-', 'g'), 48);

  -- Idempotent run keys (H2 finding 2): a complete v3 study for this client already carrying this run_key
  -- is returned as-is and nothing is written (cron double fire, retry after a partial failure).
  select s.study_id into v_existing
    from public.client_research_studies s
   where s.client_id = p_client_id and s.method_version = c_method and s.state = 'complete'
     and s.manifest ->> 'run_key' = p_run_key
   order by s.created_at desc, s.study_id desc
   limit 1;
  if v_existing is not null then
    return v_existing || ': complete (existing run_key, nothing written)';
  end if;

  v_base  := 'outliers-v3-' || p_client_id || '-' || to_char(v_now at time zone 'UTC', 'YYYYMMDD');
  v_study := v_base;
  if exists (select 1 from public.client_research_studies where client_id = p_client_id and study_id = v_study) then
    v_study := v_base || '-' || v_key;
  end if;
  if exists (select 1 from public.client_research_studies where client_id = p_client_id and study_id = v_study) then
    v_study := v_study || '-' || to_char(clock_timestamp() at time zone 'UTC', 'HH24MISSUS');
  end if;

  select 'client_registry-roster-' || left(encode(sha256(convert_to(coalesce((cr.platform -> 'measurement' -> 'roster')::text, 'null'), 'UTF8')), 'hex'), 12)
    into v_roster from public.client_registry cr where cr.client_id = p_client_id;

  -- (a) the study row, state 'building' (never read by any reader)
  insert into public.client_research_studies
    (client_id, study_id, study_kind, method_version, state, schema_version, manifest, source_paths,
     observation_cutoff, metric_definitions, roster_version, eligibility, excluded_counts, classifier_versions,
     unresolved_discrepancies, missing_inputs)
  values
    (p_client_id, v_study, 'market', c_method, 'building', 1,
     jsonb_build_object('run_key', p_run_key, 'application_name', v_app, 'invoked_at', v_now,
                        'client_id', p_client_id, 'study_id', v_study, 'method_version', c_method, 'state', 'building'),
     jsonb_build_array(jsonb_build_object('path', 'public.outlier_corpus_v', 'sha256', null)),
     v_now, jsonb_build_object(c_policy, 'likes + 3 * reposts'), coalesce(v_roster, 'client_registry-roster-none'),
     jsonb_build_object('id', c_policy, 'repostWeight', 3, 'baseline', 'median of the previous up to 60 eligible posts, strictly earlier',
                        'minimumPriorPosts', 9, 'baselineFloor', 1, 'minimumLikes', 40, 'primaryLift', 3,
                        'sensitivityLifts', jsonb_build_array(4, 5), 'paid', 'excluded from baseline and label',
                        'unknownPaid', 'kept and counted'),
     '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);

  -- (b) corpus snapshot for this client at v_now
  drop table if exists pg_temp.cb15_corpus;
  create temp table cb15_corpus on commit drop as
    select * from public.outlier_corpus_v c
     where c.client_id = p_client_id and (c.published_at is null or c.published_at <= v_now);
  select count(*) into v_n_corpus from pg_temp.cb15_corpus;
  if v_n_corpus = 0 then
    raise exception 'outlier_recompute_v3: empty corpus for %', p_client_id;
  end if;

  -- (c) eligible posts (corpus.py label(): score known, not paid, published_at and author known)
  drop table if exists pg_temp.cb15_elig;
  create temp table cb15_elig on commit drop as
    select c.*,
           row_number() over (partition by c.author_ref order by c.published_at, c.post_ref collate "C") as rn,
           (rank() over (partition by c.author_ref order by c.published_at) - 1)::integer as k
      from pg_temp.cb15_corpus c
     where c.score is not null and c.paid_status <> 'paid' and c.published_at is not null and c.author_ref is not null;
  create index on pg_temp.cb15_elig (author_ref, rn);
  analyze pg_temp.cb15_elig;

  -- (d) trailing baseline: rows rn in [k-59, k] are exactly the last 60 strictly-earlier eligible posts
  drop table if exists pg_temp.cb15_scored;
  create temp table cb15_scored on commit drop as
    select e.client_id, e.post_ref, e.author_ref, e.published_at, e.score, e.likes, e.reposts, e.comments,
           e.observed_at, e.age_days, e.age_class, e.paid_status,
           w.med::numeric as trailing_median, w.n::integer as trailing_n,
           w.first_pub, w.last_pub, w.n_unknown::integer as n_unknown, w.n_organic::integer as n_organic
      from pg_temp.cb15_elig e
     cross join lateral (
       select percentile_cont(0.5) within group (order by b.score::double precision) as med,
              count(*) as n, min(b.published_at) as first_pub, max(b.published_at) as last_pub,
              count(*) filter (where b.paid_status = 'unknown') as n_unknown,
              count(*) filter (where b.paid_status = 'organic') as n_organic
         from pg_temp.cb15_elig b
        where b.author_ref = e.author_ref and b.rn between greatest(1, e.k - 59) and e.k) w
     where e.k >= 9;
  select count(*) into v_n_scored from pg_temp.cb15_scored;

  -- (e) score rows (append-only)
  insert into public.outlier_post_scores
    (client_id, study_id, post_ref, author_ref, published_at, score, trailing_median, trailing_n, ratio, log_lift,
     rank_in_author, age_class, paid_status, is_outlier_3x, is_outlier_4x, is_outlier_5x, created_at,
     likes, reposts, comments, observed_at, age_days, baseline_first_published_at, baseline_last_published_at,
     baseline_unknown_n, method_version)
  select s.client_id, v_study, s.post_ref, s.author_ref, s.published_at, s.score, s.trailing_median, s.trailing_n,
         s.score / greatest(s.trailing_median, 1),
         case when s.score > 0 then ln(s.score / greatest(s.trailing_median, 1)) end,
         rank() over (partition by s.author_ref order by s.score / greatest(s.trailing_median, 1) desc),
         s.age_class, s.paid_status,
         s.score >= 3 * greatest(s.trailing_median, 1) and s.likes >= 40,
         s.score >= 4 * greatest(s.trailing_median, 1) and s.likes >= 40,
         s.score >= 5 * greatest(s.trailing_median, 1) and s.likes >= 40,
         v_now, s.likes, s.reposts, s.comments, s.observed_at, s.age_days, s.first_pub, s.last_pub, s.n_unknown, c_method
    from pg_temp.cb15_scored s;

  select count(*) into v_n3 from public.outlier_post_scores
   where client_id = p_client_id and study_id = v_study and is_outlier_3x;

  -- (f) counts for manifest / findings / limitations
  select jsonb_build_object(
           '3x', count(*) filter (where is_outlier_3x),
           '4x', count(*) filter (where is_outlier_4x),
           '5x', count(*) filter (where is_outlier_5x),
           '3x_excluding_early_only', count(*) filter (where is_outlier_3x and age_class <> 'early_only'))
    into v_thr
    from public.outlier_post_scores where client_id = p_client_id and study_id = v_study;

  select jsonb_build_object(
    'corpus_posts', v_n_corpus,
    'corpus_authors', (select count(distinct author_ref) from pg_temp.cb15_corpus),
    'unknown_metric_posts', (select count(*) from pg_temp.cb15_corpus where score is null),
    'paid_posts_excluded', (select count(*) from pg_temp.cb15_corpus where paid_status = 'paid' and score is not null),
    'eligible_posts', (select count(*) from pg_temp.cb15_elig),
    'scored_posts', v_n_scored,
    'below_min_history_posts', (select count(*) from pg_temp.cb15_elig where k < 9),
    'scored_authors', (select count(distinct author_ref) from pg_temp.cb15_scored),
    'authors_with_3x_outlier', (select count(distinct author_ref) from public.outlier_post_scores
                                 where client_id = p_client_id and study_id = v_study and is_outlier_3x),
    'thresholds', v_thr,
    'paid_status_counts', jsonb_build_object(
        'corpus', (select coalesce(jsonb_object_agg(paid_status, n), '{}'::jsonb) from (select paid_status, count(*) n from pg_temp.cb15_corpus group by 1) x),
        'scored', (select coalesce(jsonb_object_agg(paid_status, n), '{}'::jsonb) from (select paid_status, count(*) n from pg_temp.cb15_scored group by 1) x),
        'outliers_3x', (select coalesce(jsonb_object_agg(paid_status, n), '{}'::jsonb) from (select paid_status, count(*) n from public.outlier_post_scores
                         where client_id = p_client_id and study_id = v_study and is_outlier_3x group by 1) x)),
    'age_class_counts', jsonb_build_object(
        'corpus', (select coalesce(jsonb_object_agg(age_class, n), '{}'::jsonb) from (select age_class, count(*) n from pg_temp.cb15_corpus group by 1) x),
        'scored', (select coalesce(jsonb_object_agg(age_class, n), '{}'::jsonb) from (select age_class, count(*) n from pg_temp.cb15_scored group by 1) x),
        'outliers_3x', (select coalesce(jsonb_object_agg(age_class, n), '{}'::jsonb) from (select age_class, count(*) n from public.outlier_post_scores
                         where client_id = p_client_id and study_id = v_study and is_outlier_3x group by 1) x)),
    'source_counts', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from pg_temp.cb15_corpus group by 1) x))
    into v_counts;

  -- (g) findings: one per 3x outlier (per-finding paid status + unknown_count + paid_status_counts)
  insert into public.client_research_findings
    (client_id, study_id, finding_id, kind, metric_id, observed_value, baseline_value, baseline_n, lift, formula,
     method_version, source_ids, comparator_ids, comparator_n, per_author_results, sample_method, sample_size,
     unknown_count, class_definition, classifier_version, source_dates, capture_dates, age_comparability,
     uncertainty, selection_method, limitations, validation_state)
  select p_client_id, v_study,
         encode(sha256(convert_to(c_method || '|' || p_client_id || '|' || s.post_ref, 'UTF8')), 'hex'),
         'market', c_policy, s.score, greatest(s.trailing_median, 1), s.trailing_n, s.ratio,
         'likes + 3 * reposts', c_method, jsonb_build_array(s.post_ref),
         null, null, null, 'trailing median of the previous up to 60 eligible posts (strictly earlier)', s.trailing_n,
         s.baseline_unknown_n + case when s.paid_status = 'unknown' then 1 else 0 end,
         null, null,
         jsonb_build_object('published_at', s.published_at),
         jsonb_build_object('captured_at', s.observed_at, 'age_days', s.age_days, 'age_class', s.age_class),
         case when s.age_class = 'd7_14' then 'comparable' else 'age_unmatched' end,
         jsonb_build_object(
           'baseline_raw_value', s.trailing_median, 'baseline_floor', 1, 'log_lift', s.log_lift,
           'rank_in_author', s.rank_in_author, 'author_ref', s.author_ref, 'age_class', s.age_class,
           'paid_status', s.paid_status,
           'paid_status_counts', jsonb_build_object(
               'organic', (s.trailing_n - s.baseline_unknown_n) + case when s.paid_status = 'organic' then 1 else 0 end,
               'unknown', s.baseline_unknown_n + case when s.paid_status = 'unknown' then 1 else 0 end,
               'paid_excluded', pe.n),
           'is_outlier_4x', s.is_outlier_4x, 'is_outlier_5x', s.is_outlier_5x,
           'baseline_window', jsonb_build_object('first_published_at', s.baseline_first_published_at,
                                                 'last_published_at', s.baseline_last_published_at),
           'study_threshold_counts', v_thr),
         c_policy,
         -- cb15a3: PLAN contract: limitations = {notes: [strings], paid_status_counts: {organic, paid, unknown}}
         jsonb_build_object('paid_status_counts', jsonb_build_object(
             'organic', (s.trailing_n - s.baseline_unknown_n) + case when s.paid_status = 'organic' then 1 else 0 end,
             'paid', pe.n,
             'unknown', s.baseline_unknown_n + case when s.paid_status = 'unknown' then 1 else 0 end),
           'notes', jsonb_build_array(
           'descriptive, not causal: a post crossing its author''s own baseline is not evidence the FORMAT caused the reach',
           'reach approximated via likes + reposts (public impressions are not available)',
           'baseline = median of the author''s previous ' || s.trailing_n || ' eligible posts, all published strictly earlier (no look-ahead)',
           'age_class=' || s.age_class || case when s.age_class = 'd7_14' then ' (counts read at 7-14 days)'
                                               when s.age_class = 'late' then ' (earliest reading was older than 14 days)'
                                               else ' (only a reading under 7 days exists)' end,
           'paid_status=' || s.paid_status || case when s.paid_status = 'unknown' then ' (no sponsored flag in the source data)' else '' end,
           'paid_status_counts=' || jsonb_build_object(
               'organic', (s.trailing_n - s.baseline_unknown_n) + case when s.paid_status = 'organic' then 1 else 0 end,
               'unknown', s.baseline_unknown_n + case when s.paid_status = 'unknown' then 1 else 0 end,
               'paid_excluded', pe.n)::text,
           'thresholds=' || v_thr::text)),
         'computed'
    from public.outlier_post_scores s
   cross join lateral (
     select count(*)::integer as n from pg_temp.cb15_corpus c
      where c.author_ref = s.author_ref and c.paid_status = 'paid' and c.score is not null
        and c.published_at >= s.baseline_first_published_at and c.published_at < s.published_at) pe
   where s.client_id = p_client_id and s.study_id = v_study and s.is_outlier_3x;

  -- (h) evidence posts: every 3x outlier + the top c_cap by lift, so findings' source_ids resolve in
  --     client_research_study_posts (writer.js / editorial bridge join on canonical_source_id)
  insert into public.client_research_study_posts
    (client_id, study_id, canonical_source_id, source_url, author_id, author_role, published_at, first_captured_at,
     last_captured_at, post_text, artifact_location, artifact_sha256, format_evidence, observed_metrics, observations,
     population, is_own_control, inclusion, exclusion_reason, age_comparability, content_sha256)
  select p_client_id, v_study, c.post_ref, c.source_url, c.author_ref, null, c.published_at,
         ob.first_at, ob.last_at, c.post_text, null, null,
         jsonb_strip_nulls(jsonb_build_object('post_type', c.post_type, 'image_count', c.image_count,
             'format', public.outlier_det_features(c.post_text, c.post_type, c.image_count) ->> 'format', 'source', c.source)),
         jsonb_build_object('likes', c.likes, 'reposts', c.reposts, 'comments', c.comments),
         coalesce(ob.obs, '[]'::jsonb),
         'market', false, 'included', null,
         case when c.age_class = 'd7_14' then 'comparable' else 'age_unmatched' end,
         encode(sha256(convert_to(jsonb_build_array(c.post_ref, c.source_url, c.author_ref, c.published_at, c.post_text)::text, 'UTF8')), 'hex')
    from (select s.post_ref from public.outlier_post_scores s
           where s.client_id = p_client_id and s.study_id = v_study
             and (s.is_outlier_3x or s.post_ref in (
                   select t.post_ref from public.outlier_post_scores t
                    where t.client_id = p_client_id and t.study_id = v_study
                    order by t.log_lift desc nulls last, t.ratio desc, t.post_ref collate "C" limit c_cap))) ev
    join pg_temp.cb15_corpus c on c.post_ref = ev.post_ref
    left join lateral (
      select min(r.reading_at) as first_at, max(r.reading_at) as last_at,
             jsonb_agg(jsonb_build_object('captured_at', r.reading_at, 'source', r.source,
                         'metrics', jsonb_build_object('likes', r.likes, 'reposts', r.reposts, 'comments', r.comments))
                       order by r.reading_at, r.source) as obs
        from public.outlier_readings_v r
       where r.client_id = p_client_id and r.post_ref = c.post_ref and r.reading_at is not null) ob on true;

  -- (i) study hash over the scored arithmetic, missing inputs, final manifest; flip to 'complete' LAST
  select encode(sha256(convert_to(coalesce(string_agg(post_ref || ':' || score::text || ':' || trailing_median::text || ':' || trailing_n::text,
                                                      '|' order by post_ref collate "C"), ''), 'UTF8')), 'hex')
    into v_sha from public.outlier_post_scores where client_id = p_client_id and study_id = v_study;

  if (v_counts ->> 'scored_posts')::integer = 0 then
    v_missing := v_missing || jsonb_build_array('no author has 10 or more eligible posts, so no post could be scored');
  end if;
  if coalesce((v_counts -> 'paid_status_counts' -> 'corpus' ->> 'unknown')::integer, 0) > 0 then
    v_missing := v_missing || jsonb_build_array(
      'paid status is unknown for ' || (v_counts -> 'paid_status_counts' -> 'corpus' ->> 'unknown') || ' of ' || v_n_corpus
      || ' corpus posts (no sponsored flag in the source data); they are kept and counted');
  end if;
  if coalesce((v_counts -> 'age_class_counts' -> 'scored' ->> 'd7_14')::integer, 0) < v_n_scored then
    v_missing := v_missing || jsonb_build_array(
      (v_n_scored - coalesce((v_counts -> 'age_class_counts' -> 'scored' ->> 'd7_14')::integer, 0)) || ' of ' || v_n_scored
      || ' scored posts have no 7-14 day reading (age_class late or early_only)');
  end if;

  update public.client_research_studies
     set state = 'complete',
         manifest = manifest || jsonb_build_object(
           'state', 'complete', 'completed_at', clock_timestamp(), 'counts', v_counts,
           'prereg_sha256', '8b948d43e2b7c13fef779315db55ff256fcca435d32e97774591e1c9084bbc94',
           'feature_version', 'cb15-det-v1',
           'evidence_set', 'client_research_study_posts holds every 3x outlier plus the top ' || c_cap
                           || ' scored posts by log_lift; the full scored population is outlier_post_scores',
           'rules', jsonb_build_object(
             'corpus', 'public.outlier_corpus_v (PREREG corpus; port of lane R corpus.py)',
             'score', 'likes + 3 * reposts; null likes or reposts = unknown, excluded both sides',
             'baseline', 'median of the author''s previous up to 60 eligible posts, published strictly earlier; from the author''s 10th eligible post',
             'ratio', 'score / max(baseline, 1)', 'log_lift', 'ln(score / max(baseline, 1)); null when score = 0',
             'outlier', 'score >= 3 * max(baseline,1) AND likes >= 40 (4x and 5x reported)',
             'paid', 'paid excluded from baselines and labels; unknown kept and counted')),
         publication_window_from = (select min(published_at)::date from pg_temp.cb15_corpus),
         publication_window_to   = (select max(published_at)::date from pg_temp.cb15_corpus),
         excluded_counts = jsonb_build_object(
           'unknown_metric', (v_counts ->> 'unknown_metric_posts')::integer,
           'paid', (v_counts ->> 'paid_posts_excluded')::integer,
           'below_min_history', (v_counts ->> 'below_min_history_posts')::integer),
         missing_inputs = v_missing,
         content_sha256 = v_sha,
         updated_at = clock_timestamp()
   where client_id = p_client_id and study_id = v_study and state = 'building';

  return v_study || ': complete corpus=' || v_n_corpus || ' scored=' || v_n_scored
         || ' 3x=' || (v_thr ->> '3x') || ' 4x=' || (v_thr ->> '4x') || ' 5x=' || (v_thr ->> '5x');
end;
$function$;

CREATE OR REPLACE FUNCTION public.outlier_recompute_v4(p_client_id text, p_run_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_method   constant text := 'content-evidence-methods-v4';
  c_label    constant text := 'label-v4';
  c_prereg   constant text := 'e97a609dc75f062c709b7d133359a74ea0a058065572cb7776bffa6d78d2a0ac';
  c_cut      constant timestamptz := '2026-09-24T00:00:00Z';
  c_wcap     constant double precision := ln(20::double precision);
  v_now      timestamptz := now();
  v_app      text := coalesce(current_setting('application_name', true), '');
  v_key      text;
  v_base     text;
  v_study    text;
  v_existing text;
  v_mat      jsonb;          -- global maturity decision
  v_multi    bigint;
  v_pairs    bigint;
  v_proj     boolean;
  v_curve    jsonb := null;  -- {bin: g}
  v_bins     integer[];
  v_vals     double precision[];
  v_wts      double precision[];
  v_i        integer;
  v_j        integer;
  v_merged   boolean;
  v_sig_r    double precision;
  v_sig_c    double precision;
  v_src_r    text;           -- study that pinned sigma_w_reach
  v_src_c    text;           -- study that pinned sigma_w_conv
  v_n_corpus integer;
  v_n_rows   integer;
  v_counts   jsonb;
  v_v3_study text;
begin
  if p_client_id is null or p_client_id not in ('ivan','risedtc','arch') then
    raise exception 'outlier_recompute_v4: client % has no outlier corpus', coalesce(p_client_id, '<null>');
  end if;
  if p_run_key is null or btrim(p_run_key) = '' then
    raise exception 'outlier_recompute_v4 requires a run_key';
  end if;
  v_key := left(regexp_replace(lower(btrim(p_run_key)), '[^a-z0-9_-]+', '-', 'g'), 48);

  -- idempotent run key: an existing complete v4 study of this client with this run_key is returned, nothing written
  select s.study_id into v_existing from public.outlier_studies_v4 s
   where s.client_id = p_client_id and s.state = 'complete' and s.run_key = p_run_key
   order by s.created_at desc, s.study_id desc limit 1;
  if v_existing is not null then
    return v_existing || ': complete (existing run_key, nothing written)';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('cb17_outlier_recompute_v4:' || p_client_id)) then
    raise exception 'outlier_recompute_v4: another v4 recompute of % is running', p_client_id;
  end if;

  v_base  := 'outliers-v4-' || p_client_id || '-' || to_char(v_now at time zone 'UTC', 'YYYYMMDD') || '-' || v_key;
  v_study := v_base;
  if exists (select 1 from public.outlier_studies_v4 where study_id = v_study) then
    v_study := v_base || '-' || to_char(clock_timestamp() at time zone 'UTC', 'HH24MISSUS');
  end if;

  -- pinned global maturity decision: only a boolean projection_used pins (D15: a JSON null never pins)
  select s.manifest -> 'pinned' -> 'maturity' into v_mat
    from public.outlier_studies_v4 s
   where s.state = 'complete' and jsonb_typeof(s.manifest -> 'pinned' -> 'maturity' -> 'projection_used') = 'boolean'
   order by s.created_at, s.study_id limit 1;

  select st.study_id into v_v3_study from public.outlier_current_study_v st where st.client_id = p_client_id;

  insert into public.outlier_studies_v4 (study_id, client_id, run_key, state, manifest, created_at)
  values (v_study, p_client_id, p_run_key, 'building',
          jsonb_build_object('run_key', p_run_key, 'application_name', v_app, 'invoked_at', v_now,
                             'client_id', p_client_id, 'study_id', v_study, 'method_version', c_method,
                             'label_version', c_label, 'prereg_sha256', c_prereg, 'state', 'building'),
          v_now);

  -- (a) corpus snapshot
  drop table if exists pg_temp.c4_corpus;
  create temp table c4_corpus on commit drop as
    select c.*,
           (c.selection_source in ('prereg_author_backfill','cohort_buyer_adjacent')
            or (c.client_id = 'risedtc' and c.published_at >= c_cut)) as is_holdout
      from public.outlier_corpus_v4_v c
     where c.client_id = p_client_id and (c.published_at is null or c.published_at <= v_now);
  select count(*) into v_n_corpus from pg_temp.c4_corpus;
  if v_n_corpus = 0 then
    raise exception 'outlier_recompute_v4: empty corpus for %', p_client_id;
  end if;

  -- (b) maturity decision (global, pinned at the first complete v4 study of any client)
  if v_mat is null then
    with p as materialized (
      select client_id, post_ref, published_at from public.outlier_corpus_v4_v where published_at is not null
    ), r as (
      select client_id, post_ref, reading_at from public.outlier_readings_v4_v
       where post_ref is not null and reading_at is not null and likes is not null and reposts is not null
    ), a as (
      select r.client_id, r.post_ref,
             count(distinct (r.reading_at at time zone 'UTC')::date) as nd,
             bool_or(extract(epoch from r.reading_at - p.published_at) / 86400.0 < 7) as e,
             bool_or(extract(epoch from r.reading_at - p.published_at) / 86400.0 >= 7) as m
        from r join p on p.client_id = r.client_id and p.post_ref = r.post_ref
       group by r.client_id, r.post_ref
    )
    select count(*) filter (where nd >= 2), count(*) filter (where e and m) into v_multi, v_pairs from a;
    v_mat := jsonb_build_object('multi_day_posts', v_multi, 'early_mature_pairs', v_pairs,
                                'projection_used', (v_multi >= 300 and v_pairs >= 50),
                                'rule', '(a) >= 300 posts with readings on >= 2 distinct days AND (b) >= 50 posts with one reading at age < 7 d and one at age >= 7 d; pooled over ivan, risedtc, arch',
                                'decided_in_study', v_study, 'decided_at', v_now);
  end if;
  v_proj := coalesce((v_mat ->> 'projection_used')::boolean, false);

  -- (c) projection curve (per client, non-holdout multi-day posts), only when projection_used
  if v_proj then
    drop table if exists pg_temp.c4_rd;
    create temp table c4_rd on commit drop as
      select c.post_ref, u.reading_at,
             extract(epoch from u.reading_at - c.published_at)::double precision / 86400.0 as age,
             (u.likes + u.reposts)::double precision as s
        from pg_temp.c4_corpus c
        join (select r.post_ref, r.reading_at, max(r.likes) as likes, max(r.reposts) as reposts
                from public.outlier_readings_v4_v r
               where r.client_id = p_client_id and r.post_ref is not null and r.reading_at is not null
                 and r.likes is not null and r.reposts is not null
               group by r.post_ref, r.reading_at) u on u.post_ref = c.post_ref
       where not c.is_holdout and c.published_at is not null;
    with multi as (
      select post_ref from pg_temp.c4_rd group by post_ref
      having count(distinct (reading_at at time zone 'UTC')::date) >= 2
    ), lat as (
      select distinct on (d.post_ref) d.post_ref, d.reading_at, d.s
        from pg_temp.c4_rd d join multi using (post_ref)
       order by d.post_ref, d.reading_at desc
    ), x as (
      select floor(d.age)::integer as bin, ln((d.s + 1) / (l.s + 1)) as x
        from pg_temp.c4_rd d join lat l on l.post_ref = d.post_ref
       where d.reading_at < l.reading_at and d.age >= 0 and d.age < 7
    ), med as (
      select bin, percentile_cont(0.5) within group (order by x) as m, count(*)::double precision as n
        from x group by bin
    )
    select array_agg(bin order by bin), array_agg(m order by bin), array_agg(n order by bin)
      into v_bins, v_vals, v_wts from med;
    if v_bins is not null then
      -- PAVA, non-decreasing in age: merge adjacent violators into pooled blocks (weighted means)
      declare
        b_val double precision[] := v_vals; b_wt double precision[] := v_wts; b_len integer[];
        v_out double precision[] := '{}';
      begin
        b_len := array_fill(1, array[cardinality(v_vals)]);
        loop
          v_merged := false;
          v_i := 1;
          while v_i < cardinality(b_val) loop
            if b_val[v_i] > b_val[v_i + 1] then
              b_val[v_i] := (b_val[v_i] * b_wt[v_i] + b_val[v_i + 1] * b_wt[v_i + 1]) / (b_wt[v_i] + b_wt[v_i + 1]);
              b_wt[v_i]  := b_wt[v_i] + b_wt[v_i + 1];
              b_len[v_i] := b_len[v_i] + b_len[v_i + 1];
              b_val := b_val[1:v_i] || b_val[v_i + 2:cardinality(b_val)];
              b_wt  := b_wt[1:v_i]  || b_wt[v_i + 2:cardinality(b_wt)];
              b_len := b_len[1:v_i] || b_len[v_i + 2:cardinality(b_len)];
              v_merged := true;
            else
              v_i := v_i + 1;
            end if;
          end loop;
          exit when not v_merged;
        end loop;
        for v_i in 1 .. cardinality(b_val) loop
          for v_j in 1 .. b_len[v_i] loop v_out := v_out || b_val[v_i]; end loop;
        end loop;
        select jsonb_object_agg(v_bins[i]::text, round(v_out[i]::numeric, 6)) into v_curve
          from generate_subscripts(v_bins, 1) i;
      end;
    end if;
  end if;

  -- (d) rows: not paid, published_at and author known; gated flag; reach score (projected for early_only when a
  --     curve exists); conversation score
  drop table if exists pg_temp.c4_gate;
  create temp table c4_gate on commit drop as
    select distinct public.outlier_post_ref(g.post_ref) as post_ref
      from public.competitor_gated_posts g
     where coalesce(g.client_id, 'ivan') = p_client_id and g.is_gated;

  drop table if exists pg_temp.c4_rows;
  create temp table c4_rows on commit drop as
    select c.post_ref, c.author_ref, c.published_at, c.selection_source, c.age_class, c.age_days, c.paid_status,
           c.likes, c.reposts, c.comments, c.is_holdout,
           g.gated,
           case when c.likes is null or c.reposts is null then null
                when v_proj and v_curve is not null and c.age_class = 'early_only' and c.age_days is not null
                  then (c.likes + c.reposts) * exp(-(
                        coalesce((v_curve ->> (select max(k::integer) from jsonb_object_keys(v_curve) k
                                                where k::integer <= greatest(floor(c.age_days), 0))::text),
                                 v_curve ->> (select min(k::integer) from jsonb_object_keys(v_curve) k)::text))::numeric)
                else c.likes + c.reposts end as reach_score,
           (v_proj and v_curve is not null and c.age_class = 'early_only' and c.likes is not null and c.reposts is not null) as projected,
           case when g.gated then null else c.comments end as conv_score,
           case when c.age_class = 'early_only' then 0.5 else 1 end::numeric as w_mat
      from pg_temp.c4_corpus c
      cross join lateral (
        select coalesce((public.outlier_det_features(c.post_text, c.post_type, c.image_count) ->> 'comment_gate')::boolean, false)
               or exists (select 1 from pg_temp.c4_gate x where x.post_ref = c.post_ref) as gated) g
     where c.paid_status <> 'paid' and c.published_at is not null and c.author_ref is not null;
  select count(*) into v_n_rows from pg_temp.c4_rows;

  -- (e) per-outcome eligibility, rank, trailing baseline (same windowing as v3)
  drop table if exists pg_temp.c4_er;
  create temp table c4_er on commit drop as
    select r.post_ref, r.author_ref, r.published_at, r.reach_score as s,
           row_number() over (partition by r.author_ref order by r.published_at, r.post_ref collate "C") as rn,
           (rank() over (partition by r.author_ref order by r.published_at) - 1)::integer as k
      from pg_temp.c4_rows r where r.reach_score is not null;
  create index on pg_temp.c4_er (author_ref, rn);
  analyze pg_temp.c4_er;
  drop table if exists pg_temp.c4_ec;
  create temp table c4_ec on commit drop as
    select r.post_ref, r.author_ref, r.published_at, r.conv_score as s,
           row_number() over (partition by r.author_ref order by r.published_at, r.post_ref collate "C") as rn,
           (rank() over (partition by r.author_ref order by r.published_at) - 1)::integer as k
      from pg_temp.c4_rows r where r.conv_score is not null;
  create index on pg_temp.c4_ec (author_ref, rn);
  analyze pg_temp.c4_ec;

  drop table if exists pg_temp.c4_br;
  create temp table c4_br on commit drop as
    select e.post_ref, e.s, greatest(w.med, 1)::numeric as b, w.n::integer as n
      from pg_temp.c4_er e
     cross join lateral (
       select percentile_cont(0.5) within group (order by b.s::double precision) as med, count(*) as n
         from pg_temp.c4_er b
        where b.author_ref = e.author_ref and b.rn between greatest(1, e.k - 59) and e.k) w
     where e.k >= 9;
  drop table if exists pg_temp.c4_bc;
  create temp table c4_bc on commit drop as
    select e.post_ref, e.s, greatest(w.med, 1)::numeric as b, w.n::integer as n
      from pg_temp.c4_ec e
     cross join lateral (
       select percentile_cont(0.5) within group (order by b.s::double precision) as med, count(*) as n
         from pg_temp.c4_ec b
        where b.author_ref = e.author_ref and b.rn between greatest(1, e.k - 59) and e.k) w
     where e.k >= 9;

  -- (f) labelled rows (either outcome) with log lifts
  drop table if exists pg_temp.c4_lab;
  create temp table c4_lab on commit drop as
    select r.*, br.b as rb, br.n as rn_, bc.b as cb, bc.n as cn_,
           case when br.b is not null then ln(greatest(r.reach_score, 0.5) / br.b) end as rll,
           case when bc.b is not null then ln(greatest(r.conv_score, 0.5) / bc.b) end as cll
      from pg_temp.c4_rows r
      left join pg_temp.c4_br br on br.post_ref = r.post_ref
      left join pg_temp.c4_bc bc on bc.post_ref = r.post_ref
     where br.b is not null or bc.b is not null;

  -- (g) sigma_w per outcome: pinned from the client's FIRST complete v4 study whose manifest holds a NUMBER for that
  --     key (D15: a JSON null never pins); else computed here and pinned by this study.
  select (s.manifest -> 'pinned' ->> 'sigma_w_reach')::double precision, s.study_id into v_sig_r, v_src_r
    from public.outlier_studies_v4 s
   where s.client_id = p_client_id and s.state = 'complete' and jsonb_typeof(s.manifest -> 'pinned' -> 'sigma_w_reach') = 'number'
   order by s.created_at, s.study_id limit 1;
  select (s.manifest -> 'pinned' ->> 'sigma_w_conv')::double precision, s.study_id into v_sig_c, v_src_c
    from public.outlier_studies_v4 s
   where s.client_id = p_client_id and s.state = 'complete' and jsonb_typeof(s.manifest -> 'pinned' -> 'sigma_w_conv') = 'number'
   order by s.created_at, s.study_id limit 1;
  if v_src_r is null then
    -- D15: "winsorised at ln 20" = SYMMETRIC clip of log_lift to [-ln 20, +ln 20] (both tails; the 0.5 floor sits in
    -- the lower tail for large-baseline authors).
    with x as (
      select author_ref, greatest(-c_wcap, least(c_wcap, rll::double precision)) as x
        from pg_temp.c4_lab
       where rll is not null and selection_source in ('roster_weekly','study_roster_one_shot') and published_at < c_cut
    ), d as (select author_ref, x - avg(x) over (partition by author_ref) as dx from x)
    select case when count(*) - count(distinct author_ref) > 0
                then sqrt(sum(dx * dx) / (count(*) - count(distinct author_ref))) end
      into v_sig_r from d;
    v_src_r := case when v_sig_r is not null then v_study end;   -- a null sigma is recorded but never pins
  end if;
  if v_src_c is null then
    -- D15: "winsorised at ln 20" = SYMMETRIC clip of log_lift to [-ln 20, +ln 20] (both tails; the 0.5 floor sits in
    -- the lower tail for large-baseline authors).
    with x as (
      select author_ref, greatest(-c_wcap, least(c_wcap, cll::double precision)) as x
        from pg_temp.c4_lab
       where cll is not null and selection_source in ('roster_weekly','study_roster_one_shot') and published_at < c_cut
    ), d as (select author_ref, x - avg(x) over (partition by author_ref) as dx from x)
    select case when count(*) - count(distinct author_ref) > 0
                then sqrt(sum(dx * dx) / (count(*) - count(distinct author_ref))) end
      into v_sig_c from d;
    v_src_c := case when v_sig_c is not null then v_study end;
  end if;

  -- (h) score rows (append-only)
  insert into public.outlier_post_scores_v4
    (study_id, client_id, post_ref, author_ref, published_at, selection_source, age_class, age_days, paid_status,
     likes, reposts, comments, reach_score, conv_score, gated, reach_baseline, reach_n, conv_baseline, conv_n,
     reach_log_lift, conv_log_lift, reach_y3, reach_y4, reach_y5, conv_y3, conv_y4, conv_y5,
     reach_p3, reach_p5, conv_p3, conv_p5, reach_ord, conv_ord, w_ev_reach, w_ev_conv, w_mat, created_at)
  select v_study, p_client_id, l.post_ref, l.author_ref, l.published_at, l.selection_source, l.age_class, l.age_days,
         l.paid_status, l.likes, l.reposts, l.comments,
         case when l.rb is not null then l.reach_score end,
         case when l.cb is not null then l.conv_score end,
         l.gated, l.rb, l.rn_, l.cb, l.cn_, round(l.rll, 6), round(l.cll, 6),
         l.reach_score >= 3 * l.rb, l.reach_score >= 4 * l.rb, l.reach_score >= 5 * l.rb,
         l.conv_score >= 3 * l.cb, l.conv_score >= 4 * l.cb, l.conv_score >= 5 * l.cb,
         case when l.rb is not null and v_sig_r > 0 then round((0.5 * (1 + erf(((l.rll::double precision - ln(3::double precision))
                / (1.2533 * v_sig_r / sqrt(l.rn_::double precision))) / sqrt(2::double precision))))::numeric, 6) end,
         case when l.rb is not null and v_sig_r > 0 then round((0.5 * (1 + erf(((l.rll::double precision - ln(5::double precision))
                / (1.2533 * v_sig_r / sqrt(l.rn_::double precision))) / sqrt(2::double precision))))::numeric, 6) end,
         case when l.cb is not null and v_sig_c > 0 then round((0.5 * (1 + erf(((l.cll::double precision - ln(3::double precision))
                / (1.2533 * v_sig_c / sqrt(l.cn_::double precision))) / sqrt(2::double precision))))::numeric, 6) end,
         case when l.cb is not null and v_sig_c > 0 then round((0.5 * (1 + erf(((l.cll::double precision - ln(5::double precision))
                / (1.2533 * v_sig_c / sqrt(l.cn_::double precision))) / sqrt(2::double precision))))::numeric, 6) end,
         case when l.rb is null then null when l.reach_score < 2 * l.rb then '<2x' when l.reach_score < 3 * l.rb then '2-3x'
              when l.reach_score < 5 * l.rb then '3-5x' else '>=5x' end,
         case when l.cb is null then null when l.conv_score < 2 * l.cb then '<2x' when l.conv_score < 3 * l.cb then '2-3x'
              when l.conv_score < 5 * l.cb then '3-5x' else '>=5x' end,
         case when l.rb is not null then round(least(1::numeric, l.rb / 13.33), 6) end,
         case when l.cb is not null then round(least(1::numeric, l.cb / 13.33), 6) end,
         l.w_mat, v_now
    from pg_temp.c4_lab l;

  -- (i) manifest counts. OUTCOME counts only over NON-holdout rows.
  select jsonb_build_object(
    'corpus_posts', v_n_corpus,
    'corpus_by_selection_source', (select coalesce(jsonb_object_agg(coalesce(selection_source, 'null'), n), '{}'::jsonb)
                                   from (select selection_source, count(*) n from pg_temp.c4_corpus group by 1) x),
    'corpus_authors', (select count(distinct author_ref) from pg_temp.c4_corpus),
    'paid_posts_excluded', (select count(*) from pg_temp.c4_corpus where paid_status = 'paid'),
    'unknown_metric_posts', (select count(*) from pg_temp.c4_corpus where likes is null or reposts is null),
    'paid_status_counts', (select coalesce(jsonb_object_agg(paid_status, n), '{}'::jsonb)
                           from (select paid_status, count(*) n from pg_temp.c4_corpus group by 1) x),
    'rows_non_paid', v_n_rows,
    'gated_posts', (select count(*) from pg_temp.c4_rows where gated),
    'gated_posts_by_selection_source', (select coalesce(jsonb_object_agg(selection_source, n), '{}'::jsonb)
                                        from (select selection_source, count(*) n from pg_temp.c4_rows where gated group by 1) x),
    'projected_rows', (select count(*) from pg_temp.c4_rows where projected),
    'reach', jsonb_build_object(
       'eligible', (select count(*) from pg_temp.c4_er),
       'below_min_history', (select count(*) from pg_temp.c4_er where k < 9),
       'labelled', (select count(*) from pg_temp.c4_br),
       'labelled_by_selection_source', (select coalesce(jsonb_object_agg(selection_source, n), '{}'::jsonb)
             from (select selection_source, count(*) n from pg_temp.c4_lab where rb is not null group by 1) x),
       'labelled_holdout_rows', (select count(*) from pg_temp.c4_lab where rb is not null and is_holdout),
       'non_holdout', (select jsonb_build_object(
             'labelled', count(*), 'y3', count(*) filter (where reach_score >= 3 * rb),
             'y4', count(*) filter (where reach_score >= 4 * rb), 'y5', count(*) filter (where reach_score >= 5 * rb),
             'authors_with_y3', count(distinct author_ref) filter (where reach_score >= 3 * rb),
             'w_ev_lt_1', count(*) filter (where rb < 13.33),
             'age_class', (select coalesce(jsonb_object_agg(age_class, n), '{}'::jsonb) from (select age_class, count(*) n
                            from pg_temp.c4_lab where rb is not null and not is_holdout group by 1) z))
             from pg_temp.c4_lab where rb is not null and not is_holdout)),
    'conversation', jsonb_build_object(
       'eligible', (select count(*) from pg_temp.c4_ec),
       'below_min_history', (select count(*) from pg_temp.c4_ec where k < 9),
       'labelled', (select count(*) from pg_temp.c4_bc),
       'labelled_holdout_rows', (select count(*) from pg_temp.c4_lab where cb is not null and is_holdout),
       'non_holdout', (select jsonb_build_object(
             'labelled', count(*), 'y3', count(*) filter (where conv_score >= 3 * cb),
             'y4', count(*) filter (where conv_score >= 4 * cb), 'y5', count(*) filter (where conv_score >= 5 * cb),
             'authors_with_y3', count(distinct author_ref) filter (where conv_score >= 3 * cb))
             from pg_temp.c4_lab where cb is not null and not is_holdout))
  ) into v_counts;
  -- p3-band shares need the stored p (non-holdout only)
  v_counts := v_counts || jsonb_build_object('soft_band_non_holdout', (
    select jsonb_build_object(
      'reach_y3_positives', count(*) filter (where s.reach_y3),
      'reach_y3_positives_p3_in_0.2_0.8', count(*) filter (where s.reach_y3 and s.reach_p3 between 0.2 and 0.8),
      'conv_y3_positives', count(*) filter (where s.conv_y3),
      'conv_y3_positives_p3_in_0.2_0.8', count(*) filter (where s.conv_y3 and s.conv_p3 between 0.2 and 0.8),
      'reach_conv_both_labelled', count(*) filter (where s.reach_y3 is not null and s.conv_y3 is not null),
      'reach_and_conv_y3', count(*) filter (where s.reach_y3 and s.conv_y3),
      'reach_or_conv_y3', count(*) filter (where s.reach_y3 is not null and s.conv_y3 is not null and (s.reach_y3 or s.conv_y3)))
    from public.outlier_post_scores_v4 s
    join pg_temp.c4_lab l on l.post_ref = s.post_ref
    where s.study_id = v_study and not l.is_holdout));

  update public.outlier_studies_v4
     set state = 'complete',
         completed_at = clock_timestamp(),
         manifest = manifest || jsonb_build_object(
           'state', 'complete', 'completed_at', clock_timestamp(), 'counts', v_counts,
           'v3_study_id_at_build', v_v3_study,
           'pinned', jsonb_build_object(
              'sigma_w_reach', round(v_sig_r::numeric, 6), 'sigma_w_conv', round(v_sig_c::numeric, 6),
              'sigma_w_source_study', v_src_r, 'sigma_w_reach_source_study', v_src_r, 'sigma_w_conv_source_study', v_src_c,
              'sigma_w_rule', 'pooled within-author SD of log_lift clipped SYMMETRICALLY to [-ln 20, ln 20] (D15); each key pinned by the first complete study holding a number for it; rows selection_source in (roster_weekly, study_roster_one_shot) and published_at < 2026-09-24T00:00:00Z; labelled rows of the source study',
              'maturity', v_mat),
           'projection', jsonb_build_object('used', v_proj, 'curve_g_by_day_bin', v_curve,
              'applies_to', 'reach score of early_only rows: s14 = s_obs * exp(-g(floor(age))) (ln s14 = ln s_obs - g; D15)',
              'fit_rows', 'non-holdout posts of this client with readings on >= 2 distinct days; non-latest readings at 0 <= age < 7'),
           'rules', jsonb_build_object(
              'corpus', 'public.outlier_corpus_v4_v (outlier_corpus_v algorithm + outlier_supply_posts/readings)',
              'reach', 'likes + reposts', 'conversation', 'comments; NULL when comment-gated (det comment_gate or competitor_gated_posts.is_gated)',
              'baseline', 'per outcome: median of the author''s previous up to 60 eligible posts (strictly earlier); from the 10th eligible post; b = max(median, 1)',
              'log_lift', 'ln(max(s, 0.5) / b)', 'hard', 's >= k*b, k in 3,4,5; no likes floor',
              'soft', 'Phi((log_lift - ln k) / (1.2533 * sigma_w / sqrt(n)))',
              'w_ev', 'min(1, b / 13.33) per outcome', 'w_mat', '0.5 for early_only, else 1',
              'paid', 'excluded from baselines and labels; unknown kept and counted',
              'holdout_rows', 'prereg_author_backfill, cohort_buyer_adjacent, risedtc published_at >= 2026-09-24: no outcome counts in this manifest'))
   where study_id = v_study and state = 'building';

  return v_study || ': complete corpus=' || v_n_corpus
         || ' reach_labelled=' || (v_counts -> 'reach' ->> 'labelled')
         || ' reach_y3_non_holdout=' || coalesce(v_counts -> 'reach' -> 'non_holdout' ->> 'y3', '0')
         || ' conv_labelled=' || (v_counts -> 'conversation' ->> 'labelled')
         || ' gated=' || (v_counts ->> 'gated_posts')
         || ' projection_used=' || v_proj::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.outlier_recompute_all(p_run_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_client text;
  v_out    jsonb := '{}'::jsonb;
  v_res    text;
  v_err    text;
  v_now    timestamptz := now();
begin
  foreach v_client in array array['ivan','risedtc','arch'] loop
    begin
      v_res := public.outlier_recompute_v3(v_client, p_run_key);
      v_out := v_out || jsonb_build_object(v_client, v_res);
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into public.client_research_studies
        (client_id, study_id, study_kind, method_version, state, schema_version, manifest, observation_cutoff,
         missing_inputs)
      values
        (v_client,
         'outliers-v3-' || v_client || '-' || to_char(v_now at time zone 'UTC', 'YYYYMMDD') || '-failed-'
           || to_char(clock_timestamp() at time zone 'UTC', 'HH24MISSUS'),
         'market', 'content-evidence-methods-v3', 'failed', 1,
         jsonb_build_object('run_key', p_run_key, 'application_name', coalesce(current_setting('application_name', true), ''),
                            'invoked_at', v_now, 'state', 'failed', 'error', v_err),
         v_now, jsonb_build_array('recompute failed: ' || v_err));
      v_out := v_out || jsonb_build_object(v_client, 'failed: ' || v_err);
    end;
  end loop;
  return v_out::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.outlier_recompute_v4_all(p_run_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_client text;
  v_out    jsonb := '{}'::jsonb;
  v_res    text;
  v_err    text;
  v_now    timestamptz := now();
begin
  foreach v_client in array array['ivan','risedtc','arch'] loop
    begin
      v_res := public.outlier_recompute_v4(v_client, p_run_key);
      v_out := v_out || jsonb_build_object(v_client, v_res);
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into public.outlier_studies_v4 (study_id, client_id, run_key, state, manifest, created_at, completed_at)
      values ('outliers-v4-' || v_client || '-' || to_char(v_now at time zone 'UTC', 'YYYYMMDD') || '-failed-'
                || to_char(clock_timestamp() at time zone 'UTC', 'HH24MISSUS'),
              v_client, coalesce(p_run_key, '<null>'), 'failed',
              jsonb_build_object('run_key', p_run_key, 'application_name', coalesce(current_setting('application_name', true), ''),
                                 'invoked_at', v_now, 'state', 'failed', 'error', v_err),
              v_now, clock_timestamp());
      v_out := v_out || jsonb_build_object(v_client, 'failed: ' || v_err);
    end;
  end loop;
  return v_out::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.operator_outliers(p_gate text, p_client text, p_platform text DEFAULT 'all'::text, p_week date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_li_study text; v_li_at timestamptz; v_x_study text; v_x_at timestamptz;
  v_model jsonb; v_words jsonb; v_model_version text;
  v_rows jsonb; v_weeks jsonb; v_li jsonb; v_x jsonb;
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client is null or p_client not in ('ivan', 'risedtc', 'arch') or not public.lane_allowed(p_client) then
    raise exception 'unknown seat';
  end if;
  if coalesce(p_platform, 'all') not in ('all', 'linkedin', 'x') then raise exception 'unknown platform'; end if;

  select c.study_id, c.created_at into v_li_study, v_li_at
    from public.outlier_current_study_v c where c.client_id = p_client;
  select s.study_id, max(s.created_at) into v_x_study, v_x_at
    from public.x_outlier_scores s where s.client_id = p_client
   group by s.study_id order by max(s.created_at) desc, s.study_id desc limit 1;
  select m.coefficients, m.plain_words, m.model_version into v_model, v_words, v_model_version
    from public.outlier_recipe_models m where m.client_id = p_client and m.stage = 'draft'
   order by m.fitted_at desc, m.model_version desc limit 1;

  with li as (
    select 'linkedin'::text as platform, s.post_ref as post_id, s.author_ref as author_key, s.published_at,
           s.ratio as lift, s.trailing_median as baseline, s.trailing_n as baseline_n, s.score,
           s.likes, s.reposts, s.comments, null::bigint as views, s.is_outlier_5x as is_5x,
           c.post_text as text, c.source_url as url, c.post_type, c.image_count,
           (select nullif(btrim(a.competitor_name), '') from public.audn_competitor_posts a
             where a.client_id = s.client_id and a.linkedin_post_url like '%' || s.post_ref || '%'
               and nullif(btrim(a.competitor_name), '') is not null limit 1) as name_a,
           (select nullif(btrim(p.competitor_name), '') from public.competitor_posts p
             where p.linkedin_post_url like '%' || s.post_ref || '%'
               and (p.client_id = s.client_id or (s.client_id = 'ivan' and p.client_id is null))
               and nullif(btrim(p.competitor_name), '') is not null limit 1) as name_c,
           lab.topic_class, lab.angle, lab.proof_type, lab.stakes
      from public.outlier_post_scores s
      left join public.outlier_corpus_v c on c.client_id = s.client_id and c.post_ref = s.post_ref
      left join lateral (
        select l.topic_class, l.angle, l.proof_type, l.stakes from public.outlier_post_labels l
         where l.client_id = s.client_id and l.subject_kind = 'post' and l.post_ref = s.post_ref
           and l.labeller = 'A' and l.label_version = 'cb15-rubric-v1'
         order by l.labelled_at desc, l.label_id desc limit 1) lab on true
     where s.client_id = p_client and s.study_id = v_li_study and s.is_outlier_3x
       and coalesce(p_platform, 'all') in ('all', 'linkedin')
  ), xx as (
    select 'x'::text as platform, s.post_id, s.author_handle as author_key, s.published_at,
           s.ratio as lift, s.trailing_median as baseline, s.trailing_n as baseline_n, s.score,
           s.likes::numeric as likes, s.reposts::numeric as reposts, p.replies::numeric as comments, p.views,
           s.is_outlier_5x as is_5x, p.text, p.url, null::text as post_type, null::integer as image_count,
           nullif(btrim(p.author_name), '') as name_a, null::text as name_c,
           null::text as topic_class, null::text as angle, null::text as proof_type, null::text as stakes
      from public.x_outlier_scores s
      join public.x_competitor_posts p on p.client_id = s.client_id and p.post_id = s.post_id
     where s.client_id = p_client and s.study_id = v_x_study and s.is_outlier_3x
       and coalesce(p_platform, 'all') in ('all', 'x')
  ), allp as (
    select * from li union all select * from xx
  ), wk as (
    select a.*, (date_trunc('week', a.published_at at time zone 'UTC'))::date as week from allp a
  ), sel as (
    select w.* from wk w where p_week is null or w.week = date_trunc('week', p_week)::date
  ), traits as (
    select s.platform, s.post_id,
           coalesce(jsonb_agg(jsonb_build_object('key', i.k, 'words', coalesce(v_words ->> i.k, i.k),
                                                 'weight', round((v_model ->> i.k)::numeric, 3))
                              order by abs((v_model ->> i.k)::numeric) desc, i.k)
                    filter (where v_model ? i.k and (v_model ->> i.k)::numeric <> 0), '[]'::jsonb) as t
      from sel s
      cross join lateral unnest(public.outlier_indicators(
          public.outlier_det_features(coalesce(s.text, ''), s.post_type, s.image_count),
          case when s.platform = 'linkedin' and s.topic_class is not null
               then jsonb_build_object('topic_class', s.topic_class, 'angle', s.angle, 'proof_type', s.proof_type, 'stakes', s.stakes)
               else '{}'::jsonb end, 'draft')) i(k)
     group by s.platform, s.post_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', s.platform, 'post_id', s.post_id,
           'author', coalesce(s.name_a, s.name_c, case when s.platform = 'x' then '@' || s.author_key
                                                     else initcap(replace(regexp_replace(s.author_key, '-[0-9a-z]*[0-9][0-9a-z]*$', ''), '-', ' ')) end),
           'author_key', s.author_key,
           'author_url', case when s.platform = 'x' then 'https://x.com/' || s.author_key
                              else 'https://www.linkedin.com/in/' || s.author_key end,
           'text', s.text, 'url', s.url, 'published_at', s.published_at, 'week', s.week,
           'lift', round(s.lift, 2), 'baseline', round(s.baseline, 1), 'baseline_n', s.baseline_n,
           'score', s.score, 'likes', s.likes, 'reposts', s.reposts, 'comments', s.comments, 'views', s.views,
           'is_5x', s.is_5x,
           'labels', case when s.topic_class is null then null else jsonb_build_object('topic_class', s.topic_class,
                     'angle', s.angle, 'proof_type', s.proof_type, 'stakes', s.stakes) end,
           'personal', (s.angle = 'personal' or s.topic_class = 'founder_life_career'),
           'traits', coalesce(t.t, '[]'::jsonb),
           'traits_note', case when s.platform = 'x' then 'form traits only: topic and angle are labelled on LinkedIn posts' end,
           'buyer', case when b.post_key is null then null else jsonb_build_object(
                      'judged', b.n_judged, 'icp7', b.n_icp7, 'share', b.icp7_share, 'excluded', b.n_excluded,
                      'state', case when b.n_judged >= 5 then 'read' else 'too_few' end) end,
           'idea', idea.v)
         order by s.published_at desc, s.platform, s.post_id), '[]'::jsonb)
    into v_rows
    from sel s
    left join traits t on t.platform = s.platform and t.post_id = s.post_id
    left join public.post_buyer_share_v b
      on s.platform = 'linkedin' and b.client_id = p_client and b.subject = 'competitor_post' and b.post_key = s.post_id
    left join lateral (
      select jsonb_build_object('id', l.id, 'status', l.status, 'table', 'lm_idea_candidates') as v
        from public.lm_idea_candidates l
       where p_client = 'ivan' and l.source_ref = 'outlier:' || s.platform || ':' || s.post_id
      union all
      select jsonb_build_object('id', ci.id, 'status', ci.status, 'table', 'client_ideas')
        from public.client_ideas ci
       where p_client <> 'ivan' and ci.client_id = p_client and ci.source_ref = 'outlier:' || s.platform || ':' || s.post_id
      limit 1) idea on true;

  select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'n', w.n) order by w.week desc), '[]'::jsonb) into v_weeks
    from (select week, count(*) n from (
            select (date_trunc('week', s.published_at at time zone 'UTC'))::date week from public.outlier_post_scores s
             where s.client_id = p_client and s.study_id = v_li_study and s.is_outlier_3x and coalesce(p_platform, 'all') in ('all', 'linkedin')
            union all
            select (date_trunc('week', s.published_at at time zone 'UTC'))::date from public.x_outlier_scores s
             where s.client_id = p_client and s.study_id = v_x_study and s.is_outlier_3x and coalesce(p_platform, 'all') in ('all', 'x')) z
          group by week) w;

  select jsonb_build_object('study_id', v_li_study, 'as_of', v_li_at,
           'scored', count(*), 'outliers', count(*) filter (where is_outlier_3x), 'authors', count(distinct author_ref))
    into v_li from public.outlier_post_scores where client_id = p_client and study_id = v_li_study;
  select case when v_x_study is null then null else jsonb_build_object('study_id', v_x_study, 'as_of', v_x_at,
           'scored', count(*) filter (where k >= 9), 'outliers', count(*) filter (where is_outlier_3x),
           'authors', count(distinct author_handle)) end
    into v_x from public.x_outlier_scores where client_id = p_client and study_id = v_x_study;

  return jsonb_build_object('ok', true, 'client', p_client, 'platform', coalesce(p_platform, 'all'), 'week', p_week,
    'studies', jsonb_build_object('linkedin', v_li, 'x', v_x),
    'recipe', jsonb_build_object('model_version', v_model_version, 'stage', 'draft'),
    'rule', 'An outlier is a post that scored at least 3x its author''s own median (likes + 3 x reposts, previous up to 60 posts) with 40+ likes. Buyer share = commenters judged ICP 7+ of 10; it shows who commented, never that the post produced a buyer.',
    'weeks', v_weeks, 'rows', v_rows);
end;
$function$;

CREATE OR REPLACE FUNCTION public.operator_outlier_use(p_gate text, p_client text, p_platform text, p_post_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ref text; v_row jsonb; v_id uuid; v_first text; v_author text; v_src text; v_lines text[]; v_i int; v_status text; v_table text;
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client is null or p_client not in ('ivan', 'risedtc', 'arch') or not public.lane_allowed(p_client) then
    raise exception 'unknown seat';
  end if;
  if coalesce(p_platform, '') not in ('linkedin', 'x') or p_post_id is null or p_post_id !~ '^[0-9]+$' then
    raise exception 'bad outlier reference';
  end if;
  v_ref := 'outlier:' || p_platform || ':' || p_post_id;
  select r into v_row from jsonb_array_elements(public.cb22_inputs(p_gate,p_client)->'top') r
   where r->>'post_id'=p_post_id and r->>'platform'=p_platform limit 1;
  perform pg_advisory_xact_lock(hashtext('operator_outlier_use:' || p_client || ':' || v_ref));

  if p_client = 'ivan' then
    select l.id,l.status,l.source_ref into v_id,v_status,v_ref from public.lm_idea_candidates l where l.source_ref in (v_ref,'cb22:'||p_platform||':'||p_post_id) order by l.created_at,l.id limit 1;
  else
    select ci.id,ci.status,ci.source_ref into v_id,v_status,v_ref from public.client_ideas ci where ci.client_id = p_client and ci.source_ref in (v_ref,'cb22:'||p_platform||':'||p_post_id) order by ci.created_at,ci.id limit 1;
  end if;
  v_table := case when p_client='ivan' then 'lm_idea_candidates' else 'client_ideas' end;
  if v_id is not null then
    if p_client='ivan' and v_status='pending' then
      if v_row is null then raise exception 'not a current accepted idea of this client'; end if;
      update public.lm_idea_candidates set status='reviewing' where id=v_id and status='pending';
      v_status := 'reviewing';
    end if;
    return jsonb_build_object('ok', true, 'created', false, 'id', v_id, 'status',v_status,'table',v_table, 'source_ref', v_ref);
  end if;

  v_ref := 'outlier:'||p_platform||':'||p_post_id;
  if v_row is null then raise exception 'not a current accepted idea of this client'; end if;
  -- The current accepted source is the authorization; keep fuller stored outlier
  -- evidence where available, and the accepted search/steady source otherwise.
  select coalesce((select r from jsonb_array_elements(public.operator_outliers(p_gate,p_client,p_platform,null)->'rows') r
   where r->>'post_id'=p_post_id and r->>'platform'=p_platform limit 1),v_row) into v_row;

  v_lines := array(select btrim(l) from unnest(string_to_array(regexp_replace(coalesce(v_row ->> 'text', ''), E'\\r', '', 'g'), E'\n')) l
                    where btrim(l) <> '');
  v_first := coalesce(v_lines[1], '');
  v_i := 2;
  while length(v_first) < 40 and v_i <= coalesce(array_length(v_lines, 1), 0) loop
    v_first := v_first || ' ' || v_lines[v_i]; v_i := v_i + 1;
  end loop;
  v_first := left(v_first, 200);
  v_author := v_row ->> 'author';
  v_src := case when p_platform = 'x' then 'x_viral' else 'competitor' end;

  if p_client = 'ivan' then
    insert into public.lm_idea_candidates (source, raw_topic, normalized_topic, evidence, status, content_type, source_ref, raw_context)
    values (v_src, left(coalesce(v_row ->> 'text', v_first), 4000), v_first,
      jsonb_build_array(jsonb_build_object(
        'who', v_author, 'tier', 'OBSERVATION', 'author', v_author, 'platform', p_platform,
        'excerpt', left(coalesce(v_row ->> 'text', ''), 600), 'url', v_row ->> 'url',
        'likes', v_row -> 'likes', 'reposts', v_row -> 'reposts', 'comments', v_row -> 'comments',
        'lift', v_row -> 'lift', 'baseline', v_row -> 'baseline', 'baseline_n', v_row -> 'baseline_n',
        'buyer', v_row -> 'buyer', 'traits', v_row -> 'traits', 'picked_via', 'inbox outliers: Use this')),
      'reviewing', 'post', v_ref,
      'Outlier from ' || v_author || ' (' || (v_row ->> 'lift') || 'x its author''s own median). Picked in the inbox Outliers view.')
    returning id into v_id;
    return jsonb_build_object('ok', true, 'created', true, 'id', v_id, 'table', 'lm_idea_candidates', 'status','reviewing', 'source_ref', v_ref);
  end if;

  insert into public.client_ideas (client_id, hook, title, source_label, source_ref, format, status, idea, score_breakdown, meta)
  values (p_client, v_first, left('Outlier from ' || v_author || ': ' || v_first, 140),
    case when p_platform = 'x' then 'From outliers (X)' else 'From outliers (LinkedIn)' end,
    v_ref, 'post', 'staged',
    jsonb_build_object('id', v_ref, 'kind', 'post', 'hook', v_first, 'status', 'idea', 'source_url', v_row ->> 'url',
                       'source_label', case when p_platform = 'x' then 'From outliers (X)' else 'From outliers (LinkedIn)' end,
                       'sourced_at', now()),
    jsonb_build_object('source_author', v_author, 'lift', v_row -> 'lift', 'baseline', v_row -> 'baseline',
                       'baseline_n', v_row -> 'baseline_n', 'likes', v_row -> 'likes', 'buyer', v_row -> 'buyer',
                       'traits', v_row -> 'traits'),
    jsonb_build_object('picked_via', 'inbox outliers: Use this', 'platform', p_platform, 'post_id', p_post_id, 'lane', 'outlier'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'created', true, 'id', v_id, 'table', 'client_ideas', 'status','staged', 'source_ref', v_ref);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb22_inputs(p_gate text, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_judge constant text := public.cb27_judge_version(p_client);   -- CB-27: per client (Ivan stays cb22-fit-v1)
  c_identity constant text := '(ivan-?manfredi|ivanmanfre|iv[aá]n manfredi|mattan-?danino|mattan danino|risedtc|davorin-?smit|davorin smit|billy-?mackie|billy mackie|david-?dinsmore|david dinsmore)';
  v_week date := (date_trunc('week', now() at time zone 'UTC'))::date;
  v_all jsonb; v_top jsonb; v_buyers jsonb; v_counts jsonb; v_run jsonb; v_line numeric; v_extra jsonb := '[]'::jsonb;
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  -- CB-28 (P3 a): p_client = 'counts' is the light seat-switch read: per client, the latest promotion run's window rows that are in review
  -- (an idea still waiting: ivan pending/reviewing, client staged) or recommended (logged, no idea yet). No outlier or corpus read.
  if p_client = 'counts' then
    return jsonb_build_object('ok', true, 'counts', (
      select coalesce(jsonb_object_agg(cl.c, jsonb_build_object('in_review', coalesce(z.ir, 0), 'recommended', coalesce(z.rc, 0))), '{}'::jsonb)
        from unnest(array['ivan', 'risedtc', 'arch']) cl(c)
        left join lateral (
          select count(*) filter (where st = 'in_review') ir, count(*) filter (where st = 'recommended') rc from (
            select case
                     when coalesce(
                            (select l.status from public.lm_idea_candidates l where cl.c = 'ivan' and l.source_ref in ('cb22:' || s.platform || ':' || s.post_id, 'outlier:' || s.platform || ':' || s.post_id) limit 1),
                            (select ci.status from public.client_ideas ci where cl.c <> 'ivan' and ci.client_id = cl.c and ci.source_ref in ('cb22:' || s.platform || ':' || s.post_id, 'outlier:' || s.platform || ':' || s.post_id) limit 1),
                            '') in ('pending', 'reviewing', 'staged') then 'in_review'
                     when exists (select 1 from public.lm_idea_candidates l where cl.c = 'ivan' and l.source_ref in ('cb22:' || s.platform || ':' || s.post_id, 'outlier:' || s.platform || ':' || s.post_id))
                       or exists (select 1 from public.client_ideas ci where cl.c <> 'ivan' and ci.client_id = cl.c and ci.source_ref in ('cb22:' || s.platform || ':' || s.post_id, 'outlier:' || s.platform || ':' || s.post_id)) then 'decided'
                     when exists (select 1 from public.cb22_promotion_log g where g.client_id = cl.c and g.platform = s.platform and g.post_id = s.post_id and g.action = 'recommend') then 'recommended'
                   end st
              from public.cb22_promotion_scores s
             where s.client_id = cl.c and s.published_at >= now() - interval '21 days' and coalesce(s.why, '') not in ('own_or_excluded_author', 'no_text', 'media_only')
               and s.run_key = (select r.run_key from public.cb22_runs r where r.finished_at is not null and r.summary ? cl.c order by r.finished_at desc limit 1)
          ) q) z on true));
  end if;
  if p_client is null or p_client not in ('ivan', 'risedtc', 'arch') or not public.lane_allowed(p_client) then raise exception 'unknown seat'; end if;
  v_all := public.operator_outliers(p_gate, p_client, 'all', null);

  -- CB-27 (risedtc/arch only): steady-strong and search posts join the watch-list outliers, one row per post id.
  -- CB-28: steady rows read their text from cb27_steady_posts (stored at promotion), never the corpus view. The tag stays on non-3x
  -- rows here (display only); the amended steady eligibility lives in cb22_promote.
  if p_client <> 'ivan' then
    select percentile_cont(0.5) within group (order by s.likes::float8)::numeric into v_line
      from public.outlier_post_scores s join public.outlier_current_study_v c on c.client_id = s.client_id and c.study_id = s.study_id
     where s.client_id = p_client and s.is_outlier_3x;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_extra from (
      select jsonb_build_object('platform', 'linkedin', 'post_id', s.post_ref, 'author_key', s.author_ref,
               'author', coalesce(sp.author, initcap(replace(regexp_replace(s.author_ref, '-[0-9a-z]*[0-9][0-9a-z]*$', ''), '-', ' '))),
               'author_url', 'https://www.linkedin.com/in/' || s.author_ref, 'url', sp.url, 'text', sp.text, 'published_at', s.published_at,
               'lift', round(s.ratio, 2), 'likes', s.likes, 'comments', s.comments, 'views', null, 'is_5x', false, 'buyer', null,
               'idea', (select jsonb_build_object('id', ci.id, 'status', ci.status, 'table', 'client_ideas') from public.client_ideas ci
                         where ci.client_id = p_client and ci.source_ref = 'outlier:linkedin:' || s.post_ref limit 1),
               'sources', jsonb_build_array('steady')) x
        from public.outlier_post_scores s
        join public.outlier_current_study_v st on st.client_id = s.client_id and st.study_id = s.study_id
        left join public.cb27_steady_posts sp on sp.client_id = s.client_id and sp.post_id = s.post_ref
       where v_line is not null and s.client_id = p_client and not s.is_outlier_3x and s.likes >= v_line and s.published_at >= now() - interval '21 days'
      union all
      select jsonb_build_object('platform', 'linkedin', 'post_id', p.post_id, 'author_key', p.author_key, 'author', p.author,
               'author_url', p.author_url, 'url', p.url, 'text', p.text, 'published_at', p.published_at, 'lift', null, 'likes', p.likes,
               'comments', p.comments, 'views', null, 'is_5x', false, 'buyer', null,
               'idea', (select jsonb_build_object('id', ci.id, 'status', ci.status, 'table', 'client_ideas') from public.client_ideas ci
                         where ci.client_id = p_client and ci.source_ref = 'outlier:linkedin:' || p.post_id limit 1),
               'sources', jsonb_build_array('search'))
        from public.cb27_posts p
       where v_line is not null and p.client_id = p_client and p.published_at >= now() - interval '21 days' and p.likes >= v_line
         and p.last_seen_at - p.published_at >= interval '5 days') q;
  end if;

  -- W1c (perf only, same output): `w` is MATERIALIZED so idea_any's subqueries run once per row instead of once per
  -- reference (the inlined CTE chain evaluated them 9x per row), and the ivan idea lookup reads one pre-filtered
  -- pass of lm_idea_candidates (no index on source_ref: every correlated probe was a full seq scan, ~3.9 ms each).
  with lm as materialized (
    select l.id, l.status, l.source_ref, l.created_at from public.lm_idea_candidates l
     where p_client = 'ivan' and l.source_ref like 'cb22:%'
  ), nt as materialized (
    -- CB-28 (perf only, same output): the latest calendar note per post in one pass (cb27_promotion_notes has no (client, post) index)
    select distinct on (n.platform, n.post_id) n.platform, n.post_id, n.calendar_note from public.cb27_promotion_notes n
     where p_client <> 'ivan' and n.client_id = p_client and n.calendar_note is not null order by n.platform, n.post_id, n.created_at desc
  ), r0 as (
    select x ->> 'platform' platform, x ->> 'post_id' post_id, x ->> 'author' author, x ->> 'author_key' author_key, x ->> 'author_url' author_url,
           x ->> 'url' url, x ->> 'text' txt, (x ->> 'published_at')::timestamptz published_at, (x ->> 'lift')::numeric lift,
           x -> 'likes' likes, x -> 'comments' comments, x -> 'views' views, x -> 'buyer' buyer, x -> 'idea' idea, (x ->> 'is_5x')::boolean is_5x,
           coalesce(x -> 'sources', '["outlier"]'::jsonb) sources, case when x ? 'sources' then 1 else 0 end src_rank
      from jsonb_array_elements(coalesce(v_all -> 'rows', '[]'::jsonb) || v_extra) x
  ), r as (
    -- one row per post id: the watch-list row wins, sources merged (CB-27); for Ivan v_extra is empty and this is the CB-22 row set
    select distinct on (r0.platform, r0.post_id) r0.platform, r0.post_id, r0.author, r0.author_key, r0.author_url, r0.url, r0.txt, r0.published_at, r0.lift,
           r0.likes, r0.comments, r0.views, r0.buyer, r0.idea, r0.is_5x, g.sources
      from r0 join (select z.platform, z.post_id, jsonb_agg(distinct s) sources from r0 z, jsonb_array_elements_text(z.sources) s group by 1, 2) g  -- CB-28: one grouped pass (same output)
        on g.platform is not distinct from r0.platform and g.post_id is not distinct from r0.post_id
      order by r0.platform, r0.post_id, r0.src_rank
  ), w as materialized (
    select r.*, j.fit, j.purpose, j.lane, j.reason,
           (select l.action from public.cb22_promotion_log l where l.client_id = p_client and l.platform = r.platform and l.post_id = r.post_id
             order by (l.action = 'review') desc limit 1) as logged,
           coalesce((select jsonb_build_object('id', l.id, 'status', l.status, 'table', 'lm_idea_candidates', 'source_ref', l.source_ref) from lm l
                      where p_client = 'ivan' and l.source_ref = 'cb22:' || r.platform || ':' || r.post_id order by l.created_at limit 1),
                    (select jsonb_build_object('id', ci.id, 'status', ci.status, 'table', 'client_ideas', 'source_ref', ci.source_ref) from public.client_ideas ci
                      where p_client <> 'ivan' and ci.client_id = p_client and ci.source_ref = 'cb22:' || r.platform || ':' || r.post_id limit 1),
                    case when jsonb_typeof(r.idea) = 'object' then r.idea || jsonb_build_object('source_ref', 'outlier:' || r.platform || ':' || r.post_id) end) as idea_any,
           (select jsonb_build_object('seller', s.seller, 'sells', s.sells, 'reason', s.reason) from public.cb27_seller_checks s
             where p_client <> 'ivan' and s.client_id = p_client and s.author_key = lower(r.author_key) and s.checked_at >= now() - interval '90 days'
             order by s.checked_at desc, s.id desc limit 1) as seller,
           (select n.calendar_note from nt n where n.platform = r.platform and n.post_id = r.post_id) as calendar_note
      from r
      left join public.cb22_fit_judgments j on j.client_id = p_client and j.platform = r.platform and j.post_id = r.post_id
                                           and j.judge_version = c_judge and j.seat = 'A'
     where r.published_at >= now() - interval '21 days'
       and coalesce(btrim(r.txt), '') <> ''
       -- CB-30c: a post whose why-it-took-off check failed never shows on Inputs
       and not exists (select 1 from public.cb30_post_checks k where k.client_id = p_client and k.platform = r.platform and k.post_id = r.post_id
                          and (k.engagement <> 'idea' or k.topic = 'stretch' or (p_client <> 'ivan' and k.audience = 'other')))
       and not (coalesce(r.author_key, '') ~* c_identity or coalesce(r.author, '') ~* c_identity
                or exists (select 1 from public.audn_excluded_person_v e where lower(btrim(e.person_key)) = lower(coalesce(r.author_key, ''))))
       and not (r.platform = 'x' and (
             length(btrim(regexp_replace(regexp_replace(r.txt, '(https?://\S+|@\w+|#\w+)', '', 'g'), '\s+', ' ', 'g'))) < 60
          or coalesce(array_length(regexp_split_to_array(btrim(regexp_replace(r.txt, '(https?://\S+|@\w+|#\w+)', '', 'g')), '\s+'), 1), 0) < 8))
  ), ranked as (
    -- in_review only while the idea still waits in the review queue (ivan pending/reviewing, client staged);
    -- a decided idea (approved, live, rejected, archived...) is 'decided' and ranks below the on-strategy ones
    select w.*, case
             when w.idea_any is not null and coalesce(w.idea_any ->> 'status', '') in ('pending', 'reviewing', 'staged') then 'in_review'
             when w.idea_any is not null then 'decided'
             when w.logged = 'recommend' then 'recommended' end as state
      from w
  ), tiered as (
    -- tier: 0 in review, 1 recommended, 2 judged on-strategy (fit 6+), 3 not judged yet, 4 decided idea, 5 judged off-strategy
    select ranked.*, case when state = 'in_review' then 0 when state = 'recommended' then 1 when state = 'decided' then 4 when fit >= 6 then 2 when fit is null then 3 else 5 end as tier
      from ranked
  ), top as (
    -- CB-30d: only posts that passed everything; never unjudged or off-strategy fillers
    select * from tiered t
     where t.tier = 0
        or (t.tier in (1, 2)
            and exists (select 1 from public.cb30_post_checks k where k.client_id = p_client and k.platform = t.platform and k.post_id = t.post_id)
            and (p_client = 'ivan'
                 or coalesce(t.lift, case when (t.likes #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then (t.likes #>> '{}')::numeric end
                                     / nullif((select b.median_likes from public.cb30_author_baselines b where b.client_id = p_client
                                                 and b.author_key = lower(t.author_key) and b.fetched_at >= now() - interval '30 days'), 0)) >= 3))
     order by tier, fit desc nulls last, lift desc nulls last, published_at desc, post_id limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', rk, 'platform', platform, 'post_id', post_id, 'author', author, 'author_url', author_url, 'url', url,
           'text', left(txt, 600), 'published_at', published_at, 'lift', round(lift, 1), 'likes', likes, 'comments', comments, 'views', views,
           'is_5x', is_5x, 'buyer', buyer, 'fit', fit, 'purpose', purpose, 'lane', lane, 'reason', reason, 'state', state, 'idea', idea_any)
           || case when p_client = 'ivan' then '{}'::jsonb else jsonb_build_object('sources', sources, 'seller', seller, 'calendar_note', calendar_note, 'likes_line', v_line) end
         order by rk), '[]'::jsonb),
         (select jsonb_build_object('window', count(*), 'recommended', count(*) filter (where state = 'recommended'),
                                    'in_review', count(*) filter (where state = 'in_review'), 'judged', count(*) filter (where fit is not null),
                                    'on_strategy', count(*) filter (where fit >= 6))
                 || case when p_client = 'ivan' then '{}'::jsonb else jsonb_build_object('search', count(*) filter (where sources ? 'search'),
                                                    'steady', count(*) filter (where sources ? 'steady'), 'seller', count(*) filter (where seller ->> 'seller' = 'true')) end from tiered)
    into v_top, v_counts
    from (select t.*, row_number() over (order by tier, fit desc nulls last, lift desc nulls last, published_at desc, post_id) rk from top t) z;

  with e as (
    select client_id, profile_id, public_slug, linkedin_url, name, headline, kind, icp_score, icp_reasoning, seen_at, post_id
      from public.post_touch_engagers where client_id = p_client and seen_at >= now() - interval '7 days'
    union all
    select client_id, profile_id, public_slug, linkedin_url, name, headline, kind, icp_score, icp_reasoning, seen_at, post_id
      from public.client_post_engagers where client_id = p_client and seen_at >= now() - interval '7 days'
  ), p as (
    select coalesce(nullif(e.profile_id, ''), 'slug:' || e.public_slug) person, max(e.name) name, max(e.headline) headline,
           max(e.icp_score) icp, (array_agg(e.icp_reasoning order by e.icp_score desc nulls last))[1] why,
           max(coalesce(nullif(e.linkedin_url, ''), case when nullif(e.public_slug, '') is not null then 'https://www.linkedin.com/in/' || e.public_slug end)) url,
           count(distinct e.post_id) posts, bool_or(e.kind = 'comment') commented, max(e.seen_at) last_seen,
           (array_agg(m.title order by e.seen_at desc))[1] post_title
      from e left join public.client_post_metrics m on m.id = e.post_id
     where e.icp_score >= 7
       and not exists (select 1 from public.audn_excluded_person_v x where lower(btrim(x.person_key)) in (lower(coalesce(e.profile_id, '')), lower(coalesce(e.public_slug, ''))))
       and coalesce(nullif(e.profile_id, ''), nullif(e.public_slug, '')) is not null
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'headline', left(headline, 160), 'icp', icp, 'why', left(why, 200), 'url', url,
           'posts', posts, 'commented', commented, 'last_seen', last_seen, 'post_title', left(post_title, 90)) order by icp desc, posts desc, name), '[]'::jsonb)
    into v_buyers from (select * from p order by icp desc, posts desc, name limit 8) z;

  select jsonb_build_object('run_key', r.run_key, 'mode', r.mode, 'finished_at', r.finished_at) into v_run
    from public.cb22_runs r where r.mode = 'apply' and r.finished_at is not null order by r.finished_at desc limit 1;

  return jsonb_build_object('ok', true, 'client', p_client, 'week_start', v_week, 'top', v_top, 'buyers', v_buyers,
    'counts', v_counts || jsonb_build_object('outliers', jsonb_array_length(coalesce(v_all -> 'rows', '[]'::jsonb)),
                                            'buyers', (select count(*) from jsonb_array_elements(v_buyers))),
    'last_run', v_run,
    'rule', case when p_client <> 'ivan' then 'Top posts: the last 21 days of this client''s outliers (3x its author''s own median), steady-strong posts from watched authors and search posts (both at or over the client''s likes line), people-reviewed first, then the strategy-fit judge, then lift. Sells to this reader = the author sells services to this client''s reader; a display tag only, it never blocks or demotes a post. Buyers: people judged ICP 7+ of 10 who reacted to or commented on this client''s own posts in the last 7 days; who engaged, never what caused it.' else 'Top outliers: the last 21 days of this client''s outliers (3x its author''s own median), people-reviewed first, then the strategy-fit judge, then lift. Buyers: people judged ICP 7+ of 10 who reacted to or commented on this client''s own posts in the last 7 days; who engaged, never what caused it.' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb22_promote(p_gate text, p_mode text, p_run_key text, p_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  -- PREREG-PROMOTION.json (pre-registered; change = new version + new prereg)
  -- CB-27 (PREREG-CB27 promotion): the judge version is per client, public.cb27_judge_version(client); Ivan stays on cb22-fit-v1.
  c_window_days constant int := 21;
  c_strong_floor constant numeric := 5.0;
  c_fit_review constant int := 8;
  c_fit_recommend constant int := 7;         -- CB-30c (2026-09-30): 6 -> 7 for risedtc/arch; the rubric's 5-6 band means "needs a stretch"
  c_fit_check constant int := 6;             -- CB-30c: every post Inputs can show (fit >= 6) gets the why-it-took-off check, all three clients
  c_fit_recommend_ivan constant int := 7;  -- CB-23 PREREG-PROMOTION.amend-2: Ivan's Recommended bar 6 -> 7
  c_cap_review constant int := 3;
  c_cap_recommend constant int := 5;
  c_media_min_chars constant int := 60;
  c_media_min_words constant int := 8;
  c_settle_days constant int := 5;          -- CB-27: a lane post is eligible once >= 5 days old at its likes read
  c_seller_days constant int := 90;         -- CB-27: seller checks are cached 90 days
  -- CB-30 (2026-09-30, Ivan "can't you apply it now"): risedtc/arch only. Before a post is promoted, Opus answers "did the likes come from
  -- the post's own idea, and is the idea about the reader's world?" (cb27_prompts 'cb30-reach-v1', stored per post in cb30_post_checks).
  -- engagement <> 'idea' or topic = 'stretch' => hold. No check yet => hold ('check pending'); never a default.
  -- CB-30c: Ivan's lane gets the same check (engagement + topic only; his personal lane is broad, so audience is not applied to him).
  -- CB-30b (same day, Ivan "yes"): prompt 'cb30-reach-v2' adds audience (reader|adjacent|other; other => hold), and every risedtc/arch post
  -- must beat its author's own median likes by >= 3x: lift for watched/steady rows, cb30_author_baselines (Apify, cached 30 d) for search rows.
  c_min_lift constant numeric := 3.0;
  c_baseline_days constant int := 30;
  c_identity constant text := '(ivan-?manfredi|ivanmanfre|iv[aá]n manfredi|mattan-?danino|mattan danino|risedtc|davorin-?smit|davorin smit|billy-?mackie|billy mackie|david-?dinsmore|david dinsmore)';
  v_week date := (date_trunc('week', now() at time zone 'UTC'))::date;
  v_client text; v_rows jsonb; v_r jsonb; v_c record; v_prompt text; v_brief text; v_policy jsonb; v_tpl text;
  v_out jsonb := '{}'::jsonb; v_list jsonb; v_j jsonb; v_n int; v_bad int; v_ok int;
  v_rev_week int; v_rec_week int; v_rank int; v_ref text; v_id uuid; v_first text; v_lines text[]; v_i int;
  v_name text; v_title text; v_body text; v_top_author text; v_top_lift numeric; v_buyers text; v_promoted int; v_created int;
  v_summary jsonb := '{}'::jsonb;
  v_clients text[];
  v_rec_bar int; v_recommended int;
  v_ver text; v_line numeric; v_staged int; v_note text; v_src text; v_label text; v_pv text;
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_mode not in ('prompt', 'pool', 'judgments', 'dry', 'apply', 'sellers_pool', 'sellers', 'checks_pool', 'checks', 'baselines_pool', 'baselines') then raise exception 'unknown mode'; end if;
  if p_mode in ('dry', 'apply', 'judgments', 'sellers', 'checks', 'baselines') and coalesce(btrim(p_run_key), '') = '' then raise exception 'run_key required'; end if;
  -- CB-22's guard kept for every mode (H2 r1 finding 9): no judge prompt row, no promotion
  if not exists (select 1 from public.cb22_fit_prompt where version = public.cb27_judge_version('ivan')) then raise exception 'judge prompt missing'; end if;

  if p_mode = 'prompt' then
    v_client := p_payload ->> 'client';
    if v_client not in ('ivan', 'risedtc', 'arch') then raise exception 'unknown seat'; end if;
    v_ver := public.cb27_judge_version(v_client);
    select body into v_tpl from public.cb22_fit_prompt where version = v_ver;
    if v_tpl is null then raise exception 'judge prompt missing'; end if;
    select brief into v_brief from public.cb22_fit_brief_v where client_id = v_client;
    if v_brief is null then raise exception 'no adopted strategy for %', v_client; end if;
    if v_ver = 'cb22-fit-v2' then
      -- fit-v2: the brief minus the pre-registered calendar-capacity lines (exact whole-line match, order kept)
      v_brief := array_to_string(array(select l from unnest(string_to_array(v_brief, E'\n')) with ordinality u(l, i)
                                        where not exists (select 1 from public.cb27_fit_v2_brief_strip s where s.client_id = v_client and s.line = u.l)
                                        order by u.i), E'\n');
    end if;
    v_prompt := replace(replace(replace(replace(v_tpl, '{{BRIEF}}', v_brief), '{{PLATFORM}}', coalesce(p_payload ->> 'platform', 'linkedin')),
                  '{{LANE_LINE}}', case when v_client = 'ivan'
                    then 'Also name the lane: "service" (LinkedIn inbound and outbound for agency founders) or "personal_reach" (Ivan''s own identity and life, Poland as the polemic arm), or "none".'
                    else 'Set lane to "client" when fit is 5 or more, else "none".' end),
                  '{{TEXT}}', left(coalesce(p_payload ->> 'text', ''), 3000));
    return jsonb_build_object('ok', true, 'judge_version', v_ver, 'prompt', v_prompt,
                              'prompt_sha256', encode(extensions.digest(v_prompt, 'sha256'), 'hex'));
  end if;

  -- payload.clients limits a pool/dry/apply call to some clients (one per call keeps each call far under the 8 s
  -- PostgREST statement timeout); absent = all three.
  v_clients := coalesce((select array_agg(x) from jsonb_array_elements_text(p_payload -> 'clients') x where x in ('ivan', 'risedtc', 'arch')),
                        array['ivan', 'risedtc', 'arch']);
  if p_mode = 'judgments' then
    v_clients := coalesce((select array_agg(distinct x ->> 'client') from jsonb_array_elements(coalesce(p_payload -> 'judgments', '[]'::jsonb)) x
                            where x ->> 'client' in ('ivan', 'risedtc', 'arch')), array[]::text[]);
  end if;
  if p_mode in ('sellers', 'checks', 'baselines') then
    v_clients := coalesce((select array_agg(distinct x ->> 'client') from jsonb_array_elements(coalesce(p_payload -> case when p_mode = 'baselines' then 'rows' else 'checks' end, '[]'::jsonb)) x
                            where x ->> 'client' in ('risedtc', 'arch') or (p_mode = 'checks' and x ->> 'client' = 'ivan')), array[]::text[]);
  end if;
  -- One candidate table for every other mode, rebuilt per call (no state kept between calls).
  -- CB-27 columns: sources (outlier | steady | search), is_eligible, likes_line, author_info, personal.
  create temp table if not exists cb22_cand (
    client_id text, platform text, post_id text, author text, author_key text, text text, url text,
    published_at timestamptz, lift numeric, likes numeric, has_idea boolean, blocked text, row jsonb,
    strong_threshold numeric, is_strong boolean, prompt text, prompt_sha256 text,
    sources text[], is_eligible boolean, likes_line numeric, author_info text, personal boolean
  ) on commit drop;
  truncate pg_temp.cb22_cand;

  foreach v_client in array v_clients loop
    continue when not public.lane_allowed(v_client);
    v_rows := public.operator_outliers(p_gate, v_client, 'all', null) -> 'rows';
    insert into pg_temp.cb22_cand (client_id, platform, post_id, author, author_key, text, url, published_at, lift, likes, has_idea, row, sources, personal)
    select v_client, r ->> 'platform', r ->> 'post_id', r ->> 'author', r ->> 'author_key', r ->> 'text', r ->> 'url',
           (r ->> 'published_at')::timestamptz, (r ->> 'lift')::numeric, (r ->> 'likes')::numeric,
           (r -> 'idea') is not null and jsonb_typeof(r -> 'idea') = 'object', r, array['outlier'], coalesce((r ->> 'personal')::boolean, false)
      from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) r;
    -- strong threshold per client x platform, from the whole current study: max(floor, median lift of its outliers)
    update pg_temp.cb22_cand c set strong_threshold = t.th
      from (select platform, greatest(c_strong_floor, percentile_cont(0.5) within group (order by lift::float8))::numeric as th
              from pg_temp.cb22_cand where client_id = v_client group by platform) t
     where c.client_id = v_client and c.platform = t.platform;
  end loop;

  -- keep the window only (the threshold above was read from the whole study first)
  delete from pg_temp.cb22_cand where published_at is null or published_at < now() - make_interval(days => c_window_days);
  update pg_temp.cb22_cand set is_strong = coalesce(lift >= strong_threshold, false) where true;   -- PostgREST safeupdate needs a WHERE
  update pg_temp.cb22_cand set is_eligible = is_strong where true;

  -- CB-27: risedtc/arch only. Steady-strong (a watched author's LinkedIn post in the current study, likes >= the client's line; CB-28:
  -- 3x outliers included) and lane posts (cb27_posts over the line, >= 5 days old at their likes read). One row per post id; sources merged.
  foreach v_client in array v_clients loop
    continue when v_client not in ('risedtc', 'arch') or not public.lane_allowed(v_client);
    select percentile_cont(0.5) within group (order by s.likes::float8)::numeric into v_line
      from public.outlier_post_scores s join public.outlier_current_study_v c on c.client_id = s.client_id and c.study_id = s.study_id
     where s.client_id = v_client and s.is_outlier_3x;
    update pg_temp.cb22_cand set likes_line = v_line where client_id = v_client;
    continue when v_line is null;
    -- CB-28 amendment (PREREG-CB28 amendment_steady): the steady clause no longer excludes 3x outliers. A watched 3x outlier already in the
    -- set that is under the strong line but at or over the likes line is steady-strong (same row, source merged).
    update pg_temp.cb22_cand x set sources = x.sources || array['steady'], is_eligible = true
      from public.outlier_post_scores s join public.outlier_current_study_v st on st.client_id = s.client_id and st.study_id = s.study_id
     where x.client_id = v_client and x.platform = 'linkedin' and not x.is_strong and not ('steady' = any(x.sources))
       and s.client_id = v_client and s.post_ref = x.post_id and s.likes >= v_line and s.published_at >= now() - make_interval(days => c_window_days);
    insert into pg_temp.cb22_cand (client_id, platform, post_id, author, author_key, text, url, published_at, lift, likes, has_idea, row,
                                   strong_threshold, is_strong, sources, is_eligible, likes_line, personal)
    select v_client, 'linkedin', s.post_ref, coalesce(nm.n, initcap(replace(regexp_replace(s.author_ref, '-[0-9a-z]*[0-9][0-9a-z]*$', ''), '-', ' '))),
           s.author_ref, cv.post_text, cv.source_url, s.published_at, s.ratio, s.likes, false,
           jsonb_build_object('likes', s.likes, 'reposts', s.reposts, 'comments', s.comments, 'lift', round(s.ratio, 2), 'baseline', round(s.trailing_median, 1),
                              'baseline_n', s.trailing_n),
           null, false, array['steady'], true, v_line, coalesce(lab.personal, false)
      from public.outlier_post_scores s
      join public.outlier_current_study_v st on st.client_id = s.client_id and st.study_id = s.study_id
      left join public.outlier_corpus_v cv on cv.client_id = s.client_id and cv.post_ref = s.post_ref
      left join lateral (select nullif(btrim(a.competitor_name), '') n from public.audn_competitor_posts a
                          where a.client_id = s.client_id and a.linkedin_post_url like '%' || s.post_ref || '%' and nullif(btrim(a.competitor_name), '') is not null
                          limit 1) nm on true
      left join lateral (select (l.angle = 'personal' or l.topic_class = 'founder_life_career') personal from public.outlier_post_labels l
                          where l.client_id = s.client_id and l.subject_kind = 'post' and l.post_ref = s.post_ref and l.labeller = 'A' and l.label_version = 'cb15-rubric-v1'
                          order by l.labelled_at desc, l.label_id desc limit 1) lab on true
     where s.client_id = v_client and s.likes >= v_line
       and s.published_at >= now() - make_interval(days => c_window_days)
       and not exists (select 1 from pg_temp.cb22_cand x where x.client_id = v_client and x.platform = 'linkedin' and x.post_id = s.post_ref);
    -- CB-28 (P3 b): store the steady rows' text so cb22_inputs never reads outlier_corpus_v at request time
    insert into public.cb27_steady_posts as t (client_id, post_id, author, url, text)
    select c.client_id, c.post_id, c.author, c.url, c.text from pg_temp.cb22_cand c
     where c.client_id = v_client and c.platform = 'linkedin' and 'steady' = any(c.sources) and coalesce(btrim(c.text), '') <> ''
    on conflict (client_id, post_id) do update set author = excluded.author, url = excluded.url, text = excluded.text, stored_at = now()
     where (t.author, t.url, t.text) is distinct from (excluded.author, excluded.url, excluded.text);
    update pg_temp.cb22_cand x set sources = x.sources || array['search'], is_eligible = true, author_info = p.author_info
      from public.cb27_posts p
     where x.client_id = v_client and x.platform = 'linkedin' and p.client_id = v_client and p.post_id = x.post_id
       and p.likes >= v_line and p.last_seen_at - p.published_at >= make_interval(days => c_settle_days);
    insert into pg_temp.cb22_cand (client_id, platform, post_id, author, author_key, text, url, published_at, lift, likes, has_idea, row,
                                   strong_threshold, is_strong, sources, is_eligible, likes_line, author_info, personal)
    select v_client, 'linkedin', p.post_id, p.author, p.author_key, p.text, p.url, p.published_at, null, p.likes, false,
           jsonb_build_object('likes', p.likes, 'reposts', p.reposts, 'comments', p.comments),
           null, false, array['search'], true, v_line, p.author_info, false
      from public.cb27_posts p
     where p.client_id = v_client and p.published_at >= now() - make_interval(days => c_window_days)
       and p.likes >= v_line and p.last_seen_at - p.published_at >= make_interval(days => c_settle_days)
       and not exists (select 1 from pg_temp.cb22_cand x where x.client_id = v_client and x.platform = 'linkedin' and x.post_id = p.post_id);
  end loop;

  -- blocked, first reason wins
  update pg_temp.cb22_cand c set blocked = case
      when exists (select 1 from public.audn_excluded_person_v e where lower(btrim(e.person_key)) = lower(coalesce(c.author_key, '')))
        or coalesce(c.author_key, '') ~* c_identity or coalesce(c.author, '') ~* c_identity then 'own_or_excluded_author'
      when coalesce(btrim(c.text), '') = '' then 'no_text'
      when c.platform = 'x' and (
             length(btrim(regexp_replace(regexp_replace(c.text, '(https?://\S+|@\w+|#\w+)', '', 'g'), '\s+', ' ', 'g'))) < c_media_min_chars
          or coalesce(array_length(regexp_split_to_array(btrim(regexp_replace(c.text, '(https?://\S+|@\w+|#\w+)', '', 'g')), '\s+'), 1), 0) < c_media_min_words)
        then 'media_only'
      when c.has_idea or exists (select 1 from public.cb22_promotion_log l where l.client_id = c.client_id and l.platform = c.platform and l.post_id = c.post_id and l.action = 'review')
        or exists (select 1 from public.lm_idea_candidates l where c.client_id = 'ivan' and l.source_ref in ('cb22:' || c.platform || ':' || c.post_id, 'outlier:' || c.platform || ':' || c.post_id))
        or exists (select 1 from public.client_ideas ci where ci.client_id = c.client_id and ci.source_ref in ('cb22:' || c.platform || ':' || c.post_id, 'outlier:' || c.platform || ':' || c.post_id))
        then 'already_an_idea'
      else null end
   where true;   -- PostgREST safeupdate needs a WHERE

  if p_mode = 'pool' then
    for v_c in select * from pg_temp.cb22_cand c
                where c.is_eligible and c.blocked is null
                  and not exists (select 1 from public.cb22_fit_judgments j where j.client_id = c.client_id and j.platform = c.platform
                                     and j.post_id = c.post_id and j.judge_version = public.cb27_judge_version(c.client_id) and j.seat = 'A')
                order by c.client_id, c.lift desc nulls last, case when c.client_id = 'ivan' then 0 else coalesce(c.likes, 0) end desc, c.post_id loop
      v_j := public.cb22_promote(p_gate, 'prompt', null, jsonb_build_object('client', v_c.client_id, 'platform', v_c.platform, 'text', v_c.text));
      v_out := jsonb_set(v_out, array[v_c.client_id], coalesce(v_out -> v_c.client_id, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'client', v_c.client_id, 'platform', v_c.platform, 'post_id', v_c.post_id, 'author', v_c.author, 'lift', v_c.lift,
        'prompt', v_j ->> 'prompt', 'prompt_sha256', v_j ->> 'prompt_sha256')
        || case when v_c.client_id = 'ivan' then '{}'::jsonb else jsonb_build_object('judge_version', v_j ->> 'judge_version', 'sources', to_jsonb(v_c.sources), 'likes', v_c.likes) end));
    end loop;
    return jsonb_build_object('ok', true, 'judge_version', public.cb27_judge_version('ivan'), 'pool', v_out,
      'counts', (select jsonb_object_agg(client_id, jsonb_build_object('window', n, 'strong', s, 'blocked', b)
                                            || case when client_id = 'ivan' then '{}'::jsonb else jsonb_build_object('steady', st, 'search', se, 'eligible', el) end) from (
                   select client_id, count(*) n, count(*) filter (where is_strong) s, count(*) filter (where blocked is not null) b,
                          count(*) filter (where 'steady' = any(sources)) st, count(*) filter (where 'search' = any(sources)) se, count(*) filter (where is_eligible) el
                     from pg_temp.cb22_cand group by client_id) z));
  end if;

  if p_mode = 'judgments' then
    v_ok := 0; v_bad := 0;
    for v_j in select * from jsonb_array_elements(coalesce(p_payload -> 'judgments', '[]'::jsonb)) loop
      if not exists (select 1 from pg_temp.cb22_cand c where c.client_id = v_j ->> 'client' and c.platform = v_j ->> 'platform' and c.post_id = v_j ->> 'post_id')
         or coalesce(v_j ->> 'fit', '') !~ '^[0-9]{1,2}$' or (v_j ->> 'fit')::int > 10
         or coalesce(v_j ->> 'purpose', '') not in ('reach', 'consideration', 'buyer', 'none')
         or coalesce(v_j ->> 'seat', '') not in ('A', 'B')
         or coalesce(btrim(v_j ->> 'reason'), '') = '' or coalesce(v_j ->> 'prompt_sha256', '') !~ '^[0-9a-f]{64}$' then
        v_bad := v_bad + 1; continue;
      end if;
      insert into public.cb22_fit_judgments (client_id, platform, post_id, judge_version, seat, fit, purpose, lane, reason, served_model, prompt_sha256, run_key)
      values (v_j ->> 'client', v_j ->> 'platform', v_j ->> 'post_id', public.cb27_judge_version(v_j ->> 'client'), v_j ->> 'seat', (v_j ->> 'fit')::smallint, v_j ->> 'purpose',
              case when v_j ->> 'lane' in ('service', 'personal_reach', 'client', 'none') then v_j ->> 'lane' else null end,
              left(btrim(v_j ->> 'reason'), 400), left(v_j ->> 'served_model', 80), v_j ->> 'prompt_sha256', p_run_key)
      on conflict (client_id, platform, post_id, judge_version, seat) do nothing;
      get diagnostics v_n = row_count; v_ok := v_ok + v_n;
    end loop;
    return jsonb_build_object('ok', true, 'inserted', v_ok, 'refused', v_bad);
  end if;

  -- CB-27 seller check (PREREG seller_check): one prompt per (client, author) among eligible, unblocked candidates at fit >= 6 with no
  -- check in the last 90 days; the post shown is that author's best-fit candidate. The workflow asks Opus and stores via 'sellers'.
  -- CB-28: the answer is a display tag on Inputs only; it never changes eligibility, order, Recommended or Review.
  if p_mode = 'sellers_pool' then
    select body into v_tpl from public.cb27_prompts where version = 'cb27-seller-v1';
    for v_c in select distinct on (c.client_id, lower(c.author_key)) c.*, j.fit
                 from pg_temp.cb22_cand c
                 join public.cb22_fit_judgments j on j.client_id = c.client_id and j.platform = c.platform and j.post_id = c.post_id
                                                 and j.judge_version = public.cb27_judge_version(c.client_id) and j.seat = 'A'
                where c.client_id in ('risedtc', 'arch') and c.is_eligible and c.blocked is null and j.fit >= c_fit_recommend
                  and coalesce(c.author_key, '') <> ''
                  and not exists (select 1 from public.cb27_seller_checks s where s.client_id = c.client_id and s.author_key = lower(c.author_key)
                                     and s.checked_at >= now() - make_interval(days => c_seller_days))
                order by c.client_id, lower(c.author_key), j.fit desc, c.likes desc nulls last, c.post_id loop
      v_prompt := replace(replace(replace(replace(replace(replace(replace(v_tpl,
        '{{READER}}', case v_c.client_id when 'risedtc' then 'Reader — DTC brand OWNER, sells their own products to consumers.'
                                         else 'Reader — game studio + apps people who own UA and creator budgets.' end),
        '{{COMPETITOR_LINE}}', case v_c.client_id when 'risedtc' then 'Not the reader — agencies, marketers, service providers. They are competitors.'
                                   else 'What he sells: Influencer / creator performance marketing. A competitor sells influencer, creator or UA services to game and app studios.' end),
        '{{NAME}}', coalesce(v_c.author, v_c.author_key)),
        '{{INFO}}', coalesce(nullif(btrim(v_c.author_info), ''), 'not available')),
        '{{URL}}', case when v_c.author_key ~ '^[a-z0-9%_-]+$' then 'https://www.linkedin.com/in/' || v_c.author_key else coalesce(v_c.author_key, '') end),
        '{{TEXT}}', left(coalesce(v_c.text, ''), 2500)),
        '{{PLATFORM}}', v_c.platform);
      v_out := jsonb_set(v_out, array[v_c.client_id], coalesce(v_out -> v_c.client_id, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'client', v_c.client_id, 'author_key', lower(v_c.author_key), 'author', v_c.author, 'post_id', v_c.post_id, 'platform', v_c.platform,
        'prompt', v_prompt, 'prompt_sha256', encode(extensions.digest(v_prompt, 'sha256'), 'hex'))));
    end loop;
    return jsonb_build_object('ok', true, 'pool', v_out);
  end if;

  if p_mode = 'sellers' then
    v_ok := 0; v_bad := 0;
    for v_j in select * from jsonb_array_elements(coalesce(p_payload -> 'checks', '[]'::jsonb)) loop
      if not exists (select 1 from pg_temp.cb22_cand c where c.client_id = v_j ->> 'client' and lower(c.author_key) = v_j ->> 'author_key' and c.post_id = v_j ->> 'post_id')
         or coalesce(v_j ->> 'seller', '') not in ('true', 'false', 'unclear') or coalesce(btrim(v_j ->> 'reason'), '') = ''
         or coalesce(v_j ->> 'served_model', '') not like '%opus%' or coalesce(v_j ->> 'prompt_sha256', '') !~ '^[0-9a-f]{64}$' then
        v_bad := v_bad + 1; continue;
      end if;
      insert into public.cb27_seller_checks (client_id, author_key, author, info, post_id, seller, sells, reason, served_model, prompt_sha256, run_key)
      select v_j ->> 'client', v_j ->> 'author_key', c.author, c.author_info, c.post_id, v_j ->> 'seller', left(v_j ->> 'sells', 200), left(btrim(v_j ->> 'reason'), 400),
             left(v_j ->> 'served_model', 80), v_j ->> 'prompt_sha256', p_run_key
        from pg_temp.cb22_cand c where c.client_id = v_j ->> 'client' and c.post_id = v_j ->> 'post_id' limit 1;
      v_ok := v_ok + 1;
    end loop;
    return jsonb_build_object('ok', true, 'inserted', v_ok, 'refused', v_bad);
  end if;

  -- CB-30: why-it-took-off check. One prompt per eligible, unblocked risedtc/arch candidate at fit >= 6 with no stored check (cached forever).
  if p_mode = 'checks_pool' then
    select body into v_tpl from public.cb27_prompts where version = 'cb30-reach-v2';
    if v_tpl is null then raise exception 'check prompt missing'; end if;
    for v_c in select c.*, j.fit, j.reason as fit_reason
                 from pg_temp.cb22_cand c
                 join public.cb22_fit_judgments j on j.client_id = c.client_id and j.platform = c.platform and j.post_id = c.post_id
                                                 and j.judge_version = public.cb27_judge_version(c.client_id) and j.seat = 'A'
                where c.client_id in ('ivan', 'risedtc', 'arch') and (c.is_eligible or c.client_id = 'ivan') and c.blocked is null and j.fit >= c_fit_check
                  and not exists (select 1 from public.cb30_post_checks k where k.client_id = c.client_id and k.platform = c.platform and k.post_id = c.post_id
                                     and k.audience is not null)
                order by c.client_id, j.fit desc, c.likes desc nulls last, c.post_id loop
      v_prompt := replace(replace(replace(replace(replace(replace(replace(replace(v_tpl,
        '{{READER}}', case v_c.client_id when 'risedtc' then 'Owners of DTC brands: founders who sell their own physical products online to consumers and pay for growth (ads, agencies, marketing hires).'
                                         when 'arch' then 'People at mobile game studios and app companies who own user acquisition (UA) and influencer or creator marketing budgets.'
                                         else 'Founders of agencies and B2B service businesses who want to win clients through LinkedIn inbound and outbound, plus people who follow Ivan''s own life and choices as a solo founder (his personal-reach lane).' end),
        '{{FIT_REASON}}', coalesce(nullif(btrim(v_c.fit_reason), ''), 'not given')),
        '{{NAME}}', coalesce(v_c.author, v_c.author_key, 'unknown')),
        '{{INFO}}', coalesce(nullif(btrim(v_c.author_info), ''), 'not available')),
        '{{LIKES}}', coalesce(v_c.row ->> 'likes', round(v_c.likes)::text, 'unknown')),
        '{{COMMENTS}}', coalesce(v_c.row ->> 'comments', 'unknown')),
        '{{REPOSTS}}', coalesce(v_c.row ->> 'reposts', 'unknown')),
        '{{TEXT}}', left(coalesce(v_c.text, ''), 3000));
      v_out := jsonb_set(v_out, array[v_c.client_id], coalesce(v_out -> v_c.client_id, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'client', v_c.client_id, 'platform', v_c.platform, 'post_id', v_c.post_id, 'author', v_c.author,
        'prompt', v_prompt, 'prompt_sha256', encode(extensions.digest(v_prompt, 'sha256'), 'hex'))));
    end loop;
    return jsonb_build_object('ok', true, 'pool', v_out);
  end if;

  if p_mode = 'checks' then
    v_ok := 0; v_bad := 0;
    for v_j in select * from jsonb_array_elements(coalesce(p_payload -> 'checks', '[]'::jsonb)) loop
      if not exists (select 1 from pg_temp.cb22_cand c where c.client_id = v_j ->> 'client' and c.platform = v_j ->> 'platform' and c.post_id = v_j ->> 'post_id')
         or coalesce(v_j ->> 'engagement', '') not in ('idea', 'job_ad', 'repost', 'borrowed_media', 'paid_promo', 'bait', 'announcement')
         or coalesce(v_j ->> 'topic', '') not in ('direct', 'stretch') or coalesce(v_j ->> 'audience', '') not in ('reader', 'adjacent', 'other')
         or coalesce(btrim(v_j ->> 'reason'), '') = ''
         or coalesce(v_j ->> 'served_model', '') not like '%opus%' or coalesce(v_j ->> 'prompt_sha256', '') !~ '^[0-9a-f]{64}$' then
        v_bad := v_bad + 1; continue;
      end if;
      insert into public.cb30_post_checks (client_id, platform, post_id, engagement, topic, audience, reason, served_model, prompt_sha256, run_key, prompt_version)
      values (v_j ->> 'client', v_j ->> 'platform', v_j ->> 'post_id', v_j ->> 'engagement', v_j ->> 'topic', v_j ->> 'audience', left(btrim(v_j ->> 'reason'), 400),
              left(v_j ->> 'served_model', 80), v_j ->> 'prompt_sha256', p_run_key, 'cb30-reach-v2')
      on conflict (client_id, platform, post_id) do update set engagement = excluded.engagement, topic = excluded.topic, audience = excluded.audience,
        reason = excluded.reason, served_model = excluded.served_model, prompt_sha256 = excluded.prompt_sha256, run_key = excluded.run_key,
        prompt_version = excluded.prompt_version, checked_at = now()
       where public.cb30_post_checks.audience is null;
      get diagnostics v_n = row_count; v_ok := v_ok + v_n;
    end loop;
    return jsonb_build_object('ok', true, 'inserted', v_ok, 'refused', v_bad);
  end if;

  -- CB-30b: author baselines for search posts (no own-author lift yet) that passed fit >= 6 and the v2 check. The workflow fetches each
  -- author's recent posts (Apify, research actor, no cookies) and stores the median via 'baselines'. Cached 30 days per author.
  if p_mode = 'baselines_pool' then
    for v_c in select distinct on (c.client_id, lower(c.author_key)) c.client_id, lower(c.author_key) author_key, c.author, p.author_url
                 from pg_temp.cb22_cand c
                 join public.cb22_fit_judgments j on j.client_id = c.client_id and j.platform = c.platform and j.post_id = c.post_id
                                                 and j.judge_version = public.cb27_judge_version(c.client_id) and j.seat = 'A'
                 join public.cb30_post_checks k on k.client_id = c.client_id and k.platform = c.platform and k.post_id = c.post_id
                 join public.cb27_posts p on p.client_id = c.client_id and p.post_id = c.post_id
                where c.client_id in ('risedtc', 'arch') and c.is_eligible and c.blocked is null and j.fit >= c_fit_recommend and c.lift is null
                  and k.engagement = 'idea' and k.topic = 'direct' and k.audience in ('reader', 'adjacent')
                  and coalesce(c.author_key, '') <> '' and coalesce(p.author_url, '') <> ''
                  and not exists (select 1 from public.cb30_author_baselines b where b.client_id = c.client_id and b.author_key = lower(c.author_key)
                                     and b.fetched_at >= now() - make_interval(days => c_baseline_days))
                order by c.client_id, lower(c.author_key), j.fit desc loop
      v_out := jsonb_set(v_out, array[v_c.client_id], coalesce(v_out -> v_c.client_id, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'client', v_c.client_id, 'author_key', v_c.author_key, 'author', v_c.author, 'author_url', v_c.author_url)));
    end loop;
    return jsonb_build_object('ok', true, 'pool', v_out);
  end if;

  if p_mode = 'baselines' then
    v_ok := 0; v_bad := 0;
    for v_j in select * from jsonb_array_elements(coalesce(p_payload -> 'rows', '[]'::jsonb)) loop
      if not exists (select 1 from pg_temp.cb22_cand c where c.client_id = v_j ->> 'client' and lower(c.author_key) = v_j ->> 'author_key')
         or coalesce(v_j ->> 'n_posts', '') !~ '^[0-9]{1,3}$' or (v_j ->> 'n_posts')::int < 3
         or coalesce(v_j ->> 'median_likes', '') !~ '^[0-9]+(\.[0-9]+)?$' then
        v_bad := v_bad + 1; continue;
      end if;
      insert into public.cb30_author_baselines as b (client_id, author_key, author_url, n_posts, median_likes, max_likes, run_key)
      values (v_j ->> 'client', v_j ->> 'author_key', left(v_j ->> 'author_url', 500), (v_j ->> 'n_posts')::int, (v_j ->> 'median_likes')::numeric,
              nullif(v_j ->> 'max_likes', '')::numeric, p_run_key)
      on conflict (client_id, author_key) do update set author_url = excluded.author_url, n_posts = excluded.n_posts, median_likes = excluded.median_likes,
        max_likes = excluded.max_likes, run_key = excluded.run_key, fetched_at = now();
      v_ok := v_ok + 1;
    end loop;
    return jsonb_build_object('ok', true, 'inserted', v_ok, 'refused', v_bad);
  end if;

  -- dry / apply: score every window candidate
  if exists (select 1 from public.cb22_promotion_scores where run_key = p_run_key and client_id = any(v_clients)) then raise exception 'run_key already used'; end if;
  if exists (select 1 from public.cb22_runs where run_key = p_run_key and mode <> p_mode) then raise exception 'run_key used by another mode'; end if;
  insert into public.cb22_runs (run_key, mode) values (p_run_key, p_mode) on conflict (run_key) do nothing;
  foreach v_client in array v_clients loop
    select weekly_policy into v_policy from public.cb22_fit_brief_v where client_id = v_client;
    select count(*) filter (where action = 'review'), count(*) into v_rev_week, v_rec_week
      from public.cb22_promotion_log where client_id = v_client and week_start = v_week;
    v_rank := 0; v_promoted := 0;
    v_rec_bar := case when v_client = 'ivan' then c_fit_recommend_ivan else c_fit_recommend end;
    v_staged := case when v_client = 'ivan' then null else (select count(*) from public.client_ideas where client_id = v_client and status = 'staged') end;
    for v_c in
      select c.*, j.fit, j.purpose, j.lane, j.reason as fit_reason,
             coalesce((v_policy ->> 'status') = 'adopted' and coalesce((v_policy -> 'allocation' -> 'values' ->> j.purpose)::int, 0) > 0, false) as purpose_allowed,
             exists (select 1 from public.cb22_promotion_log l where l.client_id = c.client_id and l.platform = c.platform and l.post_id = c.post_id and l.action = 'recommend') as was_recommended,
             sel.seller, sel.sells, sel.reason as seller_reason,
             chk.engagement as chk_engagement, chk.topic as chk_topic, chk.reason as chk_reason, chk.audience as chk_audience,
             bl.median_likes as bl_median,
             coalesce(c.lift, c.likes / nullif(bl.median_likes, 0)) as eff_lift
        from pg_temp.cb22_cand c
        left join public.cb22_fit_judgments j on j.client_id = c.client_id and j.platform = c.platform and j.post_id = c.post_id
                                             and j.judge_version = public.cb27_judge_version(c.client_id) and j.seat = 'A'
        left join lateral (select s.seller, s.sells, s.reason from public.cb27_seller_checks s
                            where c.client_id <> 'ivan' and s.client_id = c.client_id and s.author_key = lower(c.author_key)
                              and s.checked_at >= now() - make_interval(days => c_seller_days)
                            order by s.checked_at desc, s.id desc limit 1) sel on true
        left join public.cb30_post_checks chk on chk.client_id = c.client_id and chk.platform = c.platform and chk.post_id = c.post_id
        left join public.cb30_author_baselines bl on c.client_id <> 'ivan' and c.lift is null and bl.client_id = c.client_id and bl.author_key = lower(c.author_key)
                                                 and bl.fetched_at >= now() - make_interval(days => c_baseline_days)
       where c.client_id = v_client
       order by coalesce(c.blocked is null and c.is_eligible and j.fit >= v_rec_bar, false) desc, j.fit desc nulls last,
                c.lift desc nulls last, case when v_client = 'ivan' then 0 else coalesce(c.likes, 0) end desc, c.published_at desc, c.post_id
    loop
      declare v_verdict text; v_why text;
      begin
        if v_client = 'ivan' then
          -- unchanged CB-22/CB-23 verdict block
          if v_c.blocked is not null then v_verdict := 'blocked'; v_why := v_c.blocked;
          elsif not v_c.is_strong then v_verdict := 'hold'; v_why := format('lift %s below this client''s strong line %s', round(v_c.lift, 2), round(v_c.strong_threshold, 2));
          elsif v_c.fit is null then v_verdict := 'hold'; v_why := 'not judged yet';
          elsif v_c.fit < v_rec_bar then v_verdict := 'hold'; v_why := format('fit %s below %s', v_c.fit, v_rec_bar);
          elsif v_c.chk_engagement is null then v_verdict := 'hold'; v_why := 'why-it-took-off check pending';
          elsif v_c.chk_engagement <> 'idea' then v_verdict := 'hold';
            v_why := format('likes came from %s, not the idea: %s', replace(v_c.chk_engagement, '_', ' '), v_c.chk_reason);
          elsif v_c.chk_topic = 'stretch' then v_verdict := 'hold'; v_why := format('topic is a stretch: %s', v_c.chk_reason);
          elsif not v_c.purpose_allowed then v_verdict := 'hold'; v_why := format('slot %s not in the adopted weekly plan', v_c.purpose);
          elsif v_c.fit >= c_fit_review and v_rev_week < c_cap_review and v_rec_week < c_cap_recommend then
            v_verdict := 'review'; v_why := format('strong (%sx vs line %s) and fit %s for the %s slot', round(v_c.lift, 2), round(v_c.strong_threshold, 2), v_c.fit, v_c.purpose);
            v_rev_week := v_rev_week + 1; v_rec_week := v_rec_week + 1;
          elsif v_c.was_recommended then v_verdict := 'hold'; v_why := 'already recommended (once ever)';
          elsif v_rec_week < c_cap_recommend then
            v_verdict := 'recommend'; v_why := format('strong (%sx) and fit %s for the %s slot', round(v_c.lift, 2), v_c.fit, v_c.purpose)
                                          || case when v_c.fit >= c_fit_review then ', review cap of 3 reached' else '' end;
            v_rec_week := v_rec_week + 1;
          else v_verdict := 'hold'; v_why := 'weekly cap reached';
          end if;
          v_note := null;
        else
          -- CB-27 (risedtc/arch): eligible = strong 3x OR steady-strong OR lane post; calendar room is a note only (never lowers fit, never
          -- blocks Recommended). CB-28: seller status is a display tag only, never a hold or a demotion. Thresholds and caps unchanged.
          v_src := case when 'outlier' = any(v_c.sources) and v_c.is_strong then format('strong (%sx vs line %s)', round(v_c.lift, 2), round(v_c.strong_threshold, 2))
                        when v_c.lift is null and v_c.bl_median is not null then format('search post (%s likes, %sx its author''s usual %s)', round(v_c.likes), round(v_c.eff_lift, 1), round(v_c.bl_median))
                        when 'steady' = any(v_c.sources) then format('steady-strong (%s likes, line %s)', round(v_c.likes), round(v_c.likes_line))
                        else format('search post (%s likes, line %s)', round(v_c.likes), round(v_c.likes_line)) end;
          v_note := case when v_c.purpose is null or v_c.purpose = 'none' then null
                         else format('Calendar: the %s slot has %s a week in the adopted plan; %s ideas wait in this client''s review backlog.', v_c.purpose,
                                     coalesce(v_policy -> 'allocation' -> 'values' ->> v_c.purpose, '0'), v_staged)
                              || case when v_c.personal then coalesce(' Personal posts, from the strategy: ' ||
                                        (select string_agg(b.line, ' ' order by b.line) from public.cb27_fit_v2_brief_strip b where b.client_id = v_client), '') else '' end end;
          if v_c.blocked is not null then v_verdict := 'blocked'; v_why := v_c.blocked;
          elsif not v_c.is_eligible then v_verdict := 'hold'; v_why := format('lift %s below this client''s strong line %s', round(v_c.lift, 2), round(v_c.strong_threshold, 2));
          elsif v_c.fit is null then v_verdict := 'hold'; v_why := 'not judged yet';
          elsif v_c.fit < v_rec_bar then v_verdict := 'hold'; v_why := format('fit %s below %s', v_c.fit, v_rec_bar);
          elsif v_c.chk_engagement is null or v_c.chk_audience is null then v_verdict := 'hold'; v_why := 'why-it-took-off check pending';
          elsif v_c.chk_engagement <> 'idea' then v_verdict := 'hold';
            v_why := format('likes came from %s, not the idea: %s', replace(v_c.chk_engagement, '_', ' '), v_c.chk_reason);
          elsif v_c.chk_topic = 'stretch' then v_verdict := 'hold'; v_why := format('topic is a stretch for this reader: %s', v_c.chk_reason);
          elsif v_c.chk_audience = 'other' then v_verdict := 'hold'; v_why := format('written to a different audience: %s', v_c.chk_reason);
          elsif v_c.eff_lift is null then v_verdict := 'hold'; v_why := 'author''s normal not measured yet';
          elsif v_c.eff_lift < c_min_lift then v_verdict := 'hold';
            v_why := format('only %sx its author''s normal', round(v_c.eff_lift, 1))
                     || case when v_c.bl_median is not null then format(' (%s likes vs usual %s)', round(v_c.likes), round(v_c.bl_median)) else '' end;
          elsif not v_c.purpose_allowed then v_verdict := 'hold'; v_why := format('slot %s not in the adopted weekly plan', v_c.purpose);
          elsif v_c.fit >= c_fit_review and v_rev_week < c_cap_review and v_rec_week < c_cap_recommend then
            v_verdict := 'review'; v_why := format('%s and fit %s for the %s slot', v_src, v_c.fit, v_c.purpose) || coalesce('. ' || v_note, '');
            v_rev_week := v_rev_week + 1; v_rec_week := v_rec_week + 1;
          elsif v_c.was_recommended then v_verdict := 'hold'; v_why := 'already recommended (once ever)';
          elsif v_rec_week < c_cap_recommend then
            v_verdict := 'recommend'; v_why := format('%s and fit %s for the %s slot', v_src, v_c.fit, v_c.purpose)
                                          || case when v_c.fit >= c_fit_review then ', review cap of 3 reached' else '' end || coalesce('. ' || v_note, '');
            v_rec_week := v_rec_week + 1;
          else v_verdict := 'hold'; v_why := 'weekly cap reached';
          end if;
          if v_c.fit is not null then
            insert into public.cb27_promotion_notes (run_key, client_id, platform, post_id, sources, seller, seller_reason, calendar_note)
            values (p_run_key, v_client, v_c.platform, v_c.post_id, v_c.sources, v_c.seller, v_c.seller_reason, v_note)
            on conflict do nothing;
          end if;
        end if;
        v_rank := v_rank + 1;
        insert into public.cb22_promotion_scores (run_key, mode, client_id, platform, post_id, author, published_at, lift, strong_threshold,
                                                  is_strong, fit, purpose, lane, fit_reason, purpose_allowed, verdict, why, rank)
        values (p_run_key, p_mode, v_client, v_c.platform, v_c.post_id, v_c.author, v_c.published_at, v_c.lift, v_c.strong_threshold,
                v_c.is_strong, v_c.fit, v_c.purpose, v_c.lane, v_c.fit_reason, v_c.purpose_allowed, v_verdict, v_why, v_rank);

        if p_mode = 'apply' and v_verdict in ('review', 'recommend') then
          v_ref := 'outlier:' || v_c.platform || ':' || v_c.post_id;
          v_id := null;
          if v_verdict = 'review' then
            -- the SAME lock key as operator_outlier_use, then re-read: a Use this tap that committed meanwhile wins
            perform pg_advisory_xact_lock(hashtext('operator_outlier_use:' || v_client || ':' || v_ref));
            if (v_client = 'ivan' and exists (select 1 from public.lm_idea_candidates l where l.source_ref in (v_ref, 'cb22:' || v_c.platform || ':' || v_c.post_id)))
               or (v_client <> 'ivan' and exists (select 1 from public.client_ideas ci where ci.client_id = v_client and ci.source_ref in (v_ref, 'cb22:' || v_c.platform || ':' || v_c.post_id))) then
              update public.cb22_promotion_scores set verdict = 'blocked', why = 'already_an_idea (Use this landed during the run)'
               where run_key = p_run_key and client_id = v_client and platform = v_c.platform and post_id = v_c.post_id;
              v_rev_week := v_rev_week - 1; v_rec_week := v_rec_week - 1;
              continue;
            end if;
            v_lines := array(select btrim(l) from unnest(string_to_array(regexp_replace(coalesce(v_c.text, ''), E'\\r', '', 'g'), E'\n')) l where btrim(l) <> '');
            v_first := coalesce(v_lines[1], ''); v_i := 2;
            while length(v_first) < 40 and v_i <= coalesce(array_length(v_lines, 1), 0) loop v_first := v_first || ' ' || v_lines[v_i]; v_i := v_i + 1; end loop;
            v_first := left(v_first, 200);
            if v_client = 'ivan' then
              insert into public.lm_idea_candidates (source, raw_topic, normalized_topic, evidence, status, content_type, source_ref, raw_context)
              values (case when v_c.platform = 'x' then 'x_viral' else 'competitor' end, left(coalesce(v_c.text, v_first), 4000), v_first,
                jsonb_build_array(jsonb_build_object('who', v_c.author, 'tier', 'OBSERVATION', 'author', v_c.author, 'platform', v_c.platform,
                  'excerpt', left(coalesce(v_c.text, ''), 600), 'url', v_c.url, 'likes', v_c.row -> 'likes', 'reposts', v_c.row -> 'reposts',
                  'comments', v_c.row -> 'comments', 'lift', v_c.row -> 'lift', 'baseline', v_c.row -> 'baseline', 'baseline_n', v_c.row -> 'baseline_n',
                  'buyer', v_c.row -> 'buyer', 'traits', v_c.row -> 'traits',
                  'fit', v_c.fit, 'purpose', v_c.purpose, 'lane', v_c.lane, 'fit_reason', v_c.fit_reason,
                  'picked_via', 'content brain: outlier promoted (CB-22)', 'promoted_by', 'cb22')),
                'pending', 'post', v_ref,
                'Content brain · Outlier: ' || v_c.author || ' (' || round(v_c.lift, 2) || 'x its author''s own median), fit ' || v_c.fit || '/10 for the ' || v_c.purpose || ' slot. ' || v_c.fit_reason)
              returning id into v_id;
            else
              -- CB-27: a strong 3x outlier keeps CB-22's label; a steady-strong or search post is labelled "From top posts (LinkedIn)"
              v_label := case when v_c.is_strong and 'outlier' = any(v_c.sources) then (case when v_c.platform = 'x' then 'From outliers (X)' else 'From outliers (LinkedIn)' end)
                              else 'From top posts (LinkedIn)' end;
              v_pv := case when v_c.is_strong and 'outlier' = any(v_c.sources) then 'content brain: outlier promoted (CB-22)'
                           when 'steady' = any(v_c.sources) then 'content brain: steady-strong post promoted (CB-27)'
                           else 'content brain: search post promoted (CB-27)' end;
              insert into public.client_ideas (client_id, hook, title, source_label, source_ref, format, status, idea, score_breakdown, meta)
              values (v_client, v_first, left(case when v_label like 'From outliers%' then 'Outlier from ' else 'Top post from ' end || v_c.author || ': ' || v_first, 140),
                v_label, v_ref, 'post', 'staged',
                jsonb_build_object('id', v_ref, 'kind', 'post', 'hook', v_first, 'status', 'idea', 'source_url', v_c.url,
                                   'source_label', v_label, 'sourced_at', now()),
                jsonb_build_object('source_author', v_c.author, 'lift', v_c.row -> 'lift', 'baseline', v_c.row -> 'baseline', 'baseline_n', v_c.row -> 'baseline_n',
                                   'likes', v_c.row -> 'likes', 'buyer', v_c.row -> 'buyer', 'traits', v_c.row -> 'traits',
                                   'fit', v_c.fit, 'purpose', v_c.purpose, 'fit_reason', v_c.fit_reason, 'promoted_by', 'cb22',
                                   'sources', to_jsonb(v_c.sources), 'likes_line', v_c.likes_line, 'seller', v_c.seller, 'calendar_note', v_note),
                jsonb_build_object('picked_via', v_pv, 'platform', v_c.platform, 'post_id', v_c.post_id,
                                   'lane', case when v_c.is_strong and 'outlier' = any(v_c.sources) then 'outlier' when 'steady' = any(v_c.sources) then 'steady_strong' else 'post_search' end,
                                   'author', v_c.author, 'lift', v_c.lift, 'url', v_c.url, 'calendar_note', v_note))
              returning id into v_id;
            end if;
            v_promoted := v_promoted + 1;
          end if;
          insert into public.cb22_promotion_log (run_key, client_id, platform, post_id, action, week_start, author, lift, fit, purpose, lane, reason,
                                                 source_ref, idea_table, idea_id)
          values (p_run_key, v_client, v_c.platform, v_c.post_id, v_verdict, v_week, v_c.author, v_c.lift, v_c.fit, v_c.purpose, v_c.lane,
                  v_c.fit_reason || case when v_client <> 'ivan' and v_note is not null then ' | ' || v_note else '' end,
                  case when v_verdict = 'review' then v_ref end,
                  case when v_verdict = 'review' then (case when v_client = 'ivan' then 'lm_idea_candidates' else 'client_ideas' end) end, v_id);
        end if;
      end;
    end loop;

    v_summary := v_summary || jsonb_build_object(v_client, (select jsonb_object_agg(verdict, n) from (
        select verdict, count(*) n from public.cb22_promotion_scores where run_key = p_run_key and client_id = v_client group by verdict) z));

    -- Monday brief: one feed-only line per client per week (never pushed), apply mode only
    if p_mode = 'apply' then
      v_name := case v_client when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end;
      select count(*) into v_created from public.cb22_promotion_log where client_id = v_client and week_start = v_week and action = 'review';
      select l.author, l.lift into v_top_author, v_top_lift from public.cb22_promotion_log l
       where l.client_id = v_client and l.week_start = v_week and l.action = 'review' order by l.fit desc, l.lift desc nulls last limit 1;
      select string_agg(nm, ', ' order by sc desc, nm) into v_buyers from (
        select max(e.name) nm, max(e.icp_score) sc from (
          select client_id, profile_id, public_slug, name, icp_score, seen_at from public.post_touch_engagers
          union all select client_id, profile_id, public_slug, name, icp_score, seen_at from public.client_post_engagers) e
         where e.client_id = v_client and e.seen_at >= now() - interval '7 days' and e.icp_score >= 7
           and not exists (select 1 from public.audn_excluded_person_v x where lower(btrim(x.person_key)) in (lower(coalesce(e.profile_id, '')), lower(coalesce(e.public_slug, ''))))
         group by coalesce(nullif(e.profile_id, ''), 'slug:' || e.public_slug)
         order by 2 desc, 1 limit 4) b;
      select count(*) into v_recommended from public.cb22_promotion_log where client_id = v_client and week_start = v_week and action = 'recommend';
      -- CB-23 PREREG-PROMOTION.amend-2: the title names the Recommended count
      v_title := case when v_created = 0 then format('Content brain, %s: 0 to review, %s recommended', v_name, v_recommended)
                      else format('Content brain, %s: %s outlier%s promoted to review', v_name, v_created, case when v_created = 1 then '' else 's' end)
                           || case when v_recommended > 0 then format(', %s recommended', v_recommended) else '' end end;
      v_body := format('%s outlier%s promoted to review%s. Buyer-fit engagers last week: %s.', v_created, case when v_created = 1 then '' else 's' end,
                       case when v_top_author is not null then format(', top one: %s', v_top_author)
                                 || case when v_top_lift is not null then format(', %sx', round(v_top_lift, 1)) else '' end else '' end,
                       coalesce(v_buyers, 'none'));
      -- one line per client per week; a later apply the same week refreshes its text (never re-pushed: pushed_at stays null)
      update public.inbox_notifications n set title = left(v_title, 200), body = left(v_body, 4000), last_seen_at = now()
       where n.dedupe_key = 'cb22-brief-' || v_client || '-' || v_week and n.pushed_at is null;
      insert into public.inbox_notifications (family, source, dedupe_key, severity, title, body, url, tenant)
      select 'reporting_digest', 'cb22-promotion', 'cb22-brief-' || v_client || '-' || v_week, 'info', left(v_title, 200), left(v_body, 4000),
             '#exp/d/content/inputs' || case when v_client = 'ivan' then '' else '?lane=' || v_client end,
             case v_client when 'risedtc' then 'rise' when 'arch' then 'arch' end
       where not exists (select 1 from public.inbox_notifications n where n.dedupe_key = 'cb22-brief-' || v_client || '-' || v_week);
    end if;
  end loop;

  update public.cb22_runs set finished_at = clock_timestamp(), summary = coalesce(summary, '{}'::jsonb) || v_summary where run_key = p_run_key;
  return jsonb_build_object('ok', true, 'mode', p_mode, 'run_key', p_run_key, 'week_start', v_week, 'summary', v_summary);
end;
$function$;
COMMIT;
