-- 079: operator_lead_magnets cold path. db/078 made the warm call 95 ms but the first call after
--      a pause still took ~5.5 s (the two heavy views read cold) against the authenticated role's
--      8 s statement timeout, and the section failed on the first load more than once on
--      2026-09-16. cta_clicks now reads lm_events directly (same count(distinct id) of cta_click per
--      slug the two views compute) and comment_gate_dms reads linkedin_comment_events directly.
--      Same signature, output fingerprints compared before/after in the run's GATES.md.

create or replace function public.operator_lead_magnets(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
  return (
    with lm as (
      select l.slug, l.gate_keyword, l.linkedin_social_id, l.post_url, l.title, l.status
      from public.lead_magnets l
      where l.slug is not null
        and ((p_client_id = 'ivan' and l.client_id is null) or l.client_id = p_client_id)
    ),
    -- Posts attributed to a lead magnet. Ivan's own posts live in own_posts_scored; the client
    -- lanes' live in client_post_metrics. A post is attributed by its explicit slug stamp or by
    -- matching the lead magnet's linkedin_social_id / post_url. Nothing is inferred from text.
    attributed as (
      select m.slug, o.social_id as post_key, o.posted_at, o.num_comments as comments
      from lm m
      join public.own_posts_scored o
        on p_client_id = 'ivan'
       and (o.lead_magnet_slug = m.slug
            or (m.linkedin_social_id is not null and o.social_id = m.linkedin_social_id))
      where o.posted_at >= v_since
      union
      select m.slug, c.social_id, c.published_at, c.comments
      from lm m
      join public.client_post_metrics c
        on p_client_id <> 'ivan'
       and c.client_id = p_client_id
       and ((m.linkedin_social_id is not null and c.social_id = m.linkedin_social_id)
            or (m.post_url is not null and c.post_url = m.post_url))
      where c.published_at >= v_since
    ),
    agg as (
      select slug,
             count(distinct post_key) as posts,
             coalesce(sum(comments), 0) as comments,
             min(posted_at) as first_post,
             max(posted_at) as last_post
      from attributed group by slug
    ),
    -- Gate DMs: the keyword worker's own ledger, plus Ivan's outcome spine for posts that
    -- carry the lead magnet's social id. Whichever is larger is reported, never the sum, so a
    -- post counted in both ledgers is not double counted.
    -- 078: each view is read ONCE into a per-key aggregate instead of once per lead magnet
    -- (72 correlated view scans took ~3 s on Ivan's lane and timed the section out).
    gk as (
      select g.slug, sum(g.dms_sent) as dms_sent from public.gate_keyword_performance g
      where g.slug in (select slug from lm) group by g.slug
    ),
    spine as (
      -- 079: the spine view's comment_gate_dms is count(*) of linkedin_comment_events by
      -- post_id; read that table directly instead of the 1 s view.
      select lce.post_id as post_social_id, count(*) as dms from public.linkedin_comment_events lce
      where p_client_id = 'ivan' and lce.post_id in (select linkedin_social_id from lm where linkedin_social_id is not null)
      group by lce.post_id
    ),
    dms as (
      select m.slug,
             greatest(coalesce(gk.dms_sent, 0), coalesce(spine.dms, 0)) as gate_dms
      from lm m
      left join gk on gk.slug = m.slug
      left join spine on spine.post_social_id = m.linkedin_social_id
    ),
    -- 079: lm_dashboard_performance and lm_performance both count distinct cta_click events
    -- per slug over lm_events (3 s cold through the views); read the events once.
    clicks as (
      select m.slug, coalesce(ev.cta, 0) as cta_clicks
      from lm m
      left join (
        select e.lm_slug, count(distinct e.id) as cta from public.lm_events e
        where e.event_type = 'cta_click' and e.lm_slug in (select slug from lm) group by e.lm_slug
      ) ev on ev.lm_slug = m.slug
    ),
    -- Calls are only claimed where a booking actually carries the slug. lm_attribution held a
    -- single test row at build time, so this returns null on every lane today. Null means not
    -- attributable, never zero calls: see calls_note.
    calls as (
      select m.slug,
             (select count(*) from public.lm_attribution a
              where a.lm_slug = m.slug and a.booked_at is not null) as booked
      from lm m
    )
    select jsonb_build_object(
      'since', v_since,
      'calls_note', 'calls is null when no booking carries the lead magnet slug. lm_attribution is the only booking ledger keyed by slug and it holds no production row, so calls reads null on every lane today. A null here means not attributable, it does not mean zero calls.',
      'lms', coalesce((
        select jsonb_agg(jsonb_build_object(
            'slug', m.slug,
            'title', m.title,
            'status', m.status,
            'keyword', m.gate_keyword,
            'posts', coalesce(a.posts, 0),
            'comments', coalesce(a.comments, 0),
            'gate_dms', d.gate_dms,
            'cta_clicks', c.cta_clicks,
            'calls', case when k.booked > 0 then k.booked else null end,
            'first_post', a.first_post,
            'last_post', a.last_post,
            'per_post_comments', case when coalesce(a.posts, 0) > 0
                                 then round(a.comments::numeric / a.posts, 2) else null end)
          order by coalesce(a.posts, 0) desc, coalesce(c.cta_clicks, 0) desc, m.slug)
        from lm m
        left join agg a on a.slug = m.slug
        left join dms d on d.slug = m.slug
        left join clicks c on c.slug = m.slug
        left join calls k on k.slug = m.slug
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.operator_lead_magnets(text, text) from public, anon;
grant execute on function public.operator_lead_magnets(text, text) to authenticated, service_role;


