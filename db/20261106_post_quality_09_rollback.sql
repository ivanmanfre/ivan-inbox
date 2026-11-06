-- Rollback for 20261106_post_quality_09.sql (and _data.sql: see the note at the end).
begin;

select cron.unschedule(jobid) from cron.job where jobname in ('ivan-own-post-relink', 'ivan-rerun-stamp');

-- 4. re-link: put every dropped dead twin back, give the draft link back to it, point drafts at the old URN.
update public.own_posts o set clickup_task_id = null
  from public.own_post_relinks r where r.moved_task_id and o.id = r.live_id and o.clickup_task_id = r.draft_id;
insert into public.own_posts select (jsonb_populate_record(null::public.own_posts, r.dead_row)).*
  from public.own_post_relinks r where not exists (select 1 from public.own_posts o where o.id = r.dead_id);
update public.carousel_drafts d set source_post_id = r.draft_source_post_before
  from public.own_post_relinks r where r.draft_id = d.id::text and d.source_post_id = r.live_social_id and r.draft_source_post_before is not null;
drop function if exists public.ivan_own_post_relink(boolean);
-- keep public.own_post_relinks as the record of what ran; drop it by hand once the rollback is verified.

-- 3. line flags (qa.line_flags stays on rows as inert data; nothing reads it after the inbox revert)
drop function if exists public.operator_line_flags_keep(text, uuid, text);
drop function if exists public.ivan_line_flags_save(uuid, text, jsonb, text, text);
drop function if exists public.ivan_line_flags_due(int);
drop function if exists public.ivan_rerun_stamp(int);
drop view if exists public.ivan_line_flag_targets_v;

-- 2. re-run gate
drop trigger if exists zzz_ivan_rerun_gate on public.carousel_drafts;
drop function if exists public.ivan_rerun_gate();
drop function if exists public.ivan_rerun_check(text, uuid, timestamptz);
drop function if exists public.ivan_body_sha(text);
drop function if exists public.ivan_post_shingles(text);

-- 1. boost marks: a newer not-boosted mark is the audit-safe undo (marks are append-only history)
insert into public.own_post_boost_marks (client_id, post_ref, boosted, marked_by, post_ref_input)
select client_id, post_ref, false, 'build-09 rollback', post_ref_input from public.own_post_boost_marks
 where marked_by like 'build-09 2026-11-06:%';

CREATE OR REPLACE FUNCTION public.cb51_own_winners(p_client text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT m.social_id, m.post_url, m.published_at, m.impressions, m.reactions, m.comments,
           nullif(btrim(coalesce(ft.t, m.meta ->> 'text')), '') AS body, substring(m.social_id FROM '([0-9]{6,})$') AS num
      FROM public.client_post_metrics m
      -- meta.text is cut at 500 chars; the full text lives in own_posts (Ivan) or client_post_state (client seats)
      LEFT JOIN LATERAL (
        SELECT t FROM (
          SELECT o.post_text AS t FROM public.own_posts o
           WHERE p_client = 'ivan' AND o.social_id ~ (':' || substring(m.social_id FROM '([0-9]{6,})$') || '$') AND coalesce(o.post_text, '') <> ''
          UNION ALL
          SELECT s.post_text FROM public.client_post_state s
           WHERE p_client <> 'ivan' AND s.client_id = p_client AND s.post_urn ~ (':' || substring(m.social_id FROM '([0-9]{6,})$') || '$') AND coalesce(s.post_text, '') <> ''
        ) z ORDER BY length(t) DESC LIMIT 1) ft ON true
     WHERE m.client_id = p_client AND p_client IN ('ivan', 'risedtc', 'arch')
       AND m.published_at > p_now - interval '90 days' AND m.published_at <= p_now
       AND m.impressions > 0
       AND coalesce(m.meta ->> 'is_repost', 'false') <> 'true'
       AND NOT coalesce(m.meta ? 'job_posting', false)),
  med AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b.impressions)::numeric AS md, count(*) AS n
      FROM base b WHERE b.published_at < p_now - interval '3 days'),
  used AS (
    SELECT EXISTS (SELECT 1 FROM public.cb34_p2_members x
                    WHERE x.client_id = p_client AND x.source_ref LIKE 'outlier:linkedin:own-%'
                      AND x.week_start = (date_trunc('week', p_now AT TIME ZONE 'UTC'))::date) AS yes),
  cand AS (
    SELECT b.*, 'own-' || p_client || '-' || b.num AS ref, med.md
      FROM base b, med, used
     WHERE NOT used.yes AND med.n >= 5 AND med.md > 0 AND b.impressions >= 2 * med.md
       -- a stub caption (a video post's one-liner) holds nothing the text writer can learn from
       AND length(coalesce(b.body, '')) >= 150 AND b.num IS NOT NULL AND b.post_url ~* '^https://'
       AND public.cb35_live_source_draft(p_client, 'outlier:linkedin:own-' || p_client || '-' || b.num) IS NULL
       AND public.cb35_source_cooldown(p_client, 'outlier:linkedin:own-' || p_client || '-' || b.num, NULL, 21) IS NULL
     ORDER BY b.impressions DESC
     LIMIT 8)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'ref', c.ref, 'kind', 'own_winner',
           'author', CASE p_client WHEN 'ivan' THEN 'Ivan Manfredi' WHEN 'risedtc' THEN 'Mattan Danino' ELSE 'Davorin Smit' END || ' (own post)',
           'date', to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'ratio', round(c.impressions / c.md, 2), 'likes', c.reactions, 'comments', c.comments,
           'impressions', c.impressions, 'median_impressions', round(c.md),
           'url', c.post_url, 'text', c.body, 'post_type', NULL)
         ORDER BY c.impressions DESC), '[]'::jsonb)
    FROM cand c
$function$;

commit;

-- _data.sql (the 11 Nov re-run pulled back to Review): NOT reverted here on purpose. Re-dating that post is
-- Ivan's call; do it from the inbox (Schedule), never by script.
