CREATE OR REPLACE FUNCTION public.x_review_list()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'articles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', a.status, 'title', a.title, 'body_md', a.body_md, 'cover_url', a.cover_url,
        'images', a.images, 'qa', a.qa, 'sources', a.sources, 'x_url', a.x_url, 'error', a.error,
        'lm_slug', a.lm_slug, 'lm_topic', l.topic, 'account', a.account, 'created_at', a.created_at, 'updated_at', a.updated_at)
        order by a.created_at desc)
      from x_articles a left join lm_drafts_v2 l on l.id = a.lm_id
      where auth.uid() is not null and (a.status in ('review','approved','publishing','failed')
        or (a.status = 'published' and a.published_at > now() - interval '3 days'))), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'status', q.status, 'hook', q.hook, 'media_url', q.media_url, 'quoted_url', q.quoted_url,
        'dry_run_shot_url', q.dry_run_shot_url, 'posted_url', q.posted_url, 'error', q.error, 'account', q.account,
        'hook_options', q.source->'hook_options', 'giphy_url', q.source->>'giphy_url',
        'article_title', a.title, 'article_cover', a.cover_url, 'article_body_md', left(a.body_md, 400), 'created_at', q.created_at)
        order by q.created_at desc)
      from x_quote_posts q left join x_articles a on a.id = (q.source->>'x_article_id')::uuid
      where auth.uid() is not null and (q.status in ('draft','approved','posting','failed')
        or (q.status = 'posted' and q.updated_at > now() - interval '3 days'))), '[]'::jsonb));
$function$;
