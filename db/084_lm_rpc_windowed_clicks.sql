-- 084: operator_lead_magnets counts CTA clicks and gate DMs since v_since (91 days), the same
--      window its `since` key, its posts and its comments already use. Through db/079 to 083 the
--      clicks and gate-DM reads were ALL-TIME while both surfaces print them as "since {date}":
--      on 2026-09-18 Ivan's lane read 121 clicks over 18 lead magnets where 25 clicks over 7 fall
--      in the window, and `best_own` crowned a retired lead magnet with 0 clicks in 91 days
--      (whole-branch review, final-review.md B2). Same signature, same keys, same grants.
--      DELIBERATE value change on existing keys: cta_clicks, gate_dms, and everything derived.

create or replace function public.operator_lead_magnets(p_gate text, p_client_id text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_since timestamptz := now() - interval '91 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
  return (
    with lm as (
      -- 080: one row per slug. lead_magnets carried a duplicated slug on Ivan's lane
      -- (agent-ready-letter, twice) and the per-slug joins below multiplied it into 16 rows,
      -- so the catalog denominator read 72 where 57 slugs exist. (083 deleted the older of the
      -- two rows; `distinct on (slug)` stays, because nothing stops a future duplicate.)
      select distinct on (l.slug) l.slug, l.gate_keyword, l.linkedin_social_id, l.post_url, l.title, l.status
      from public.lead_magnets l
      where l.slug is not null
        and ((p_client_id = 'ivan' and l.client_id is null) or l.client_id = p_client_id)
      order by l.slug, l.updated_at desc nulls last, l.created_at desc nulls last
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
      -- 084: gate_keyword_performance is an all-time aggregate of linkedin_comment_events by
      -- post_id; read the events directly so the count honours v_since like every other number.
      select m.slug, count(distinct lce.id) as dms_sent
      from lm m
      join public.linkedin_comment_events lce on lce.post_id = m.linkedin_social_id
      where m.gate_keyword is not null and lce.action_taken = 'dm_sent' and lce.created_at >= v_since
      group by m.slug
    ),
    spine as (
      -- 079: the spine view's comment_gate_dms is count(*) of linkedin_comment_events by
      -- post_id; read that table directly instead of the 1 s view.
      select lce.post_id as post_social_id, count(*) as dms from public.linkedin_comment_events lce
      where p_client_id = 'ivan' and lce.post_id in (select linkedin_social_id from lm where linkedin_social_id is not null)
        and lce.created_at >= v_since  -- 084
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
        where e.event_type = 'cta_click' and e.lm_slug in (select slug from lm)
          and e.created_at >= v_since  -- 084
        group by e.lm_slug
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
    ),
    -- 083: the catalog row is built ONCE here. `lms` aggregates these objects in the catalog
    -- order; `best_own` picks one of the very same objects by a different order, so the answer on
    -- top is always a row the list below also shows.
    lmrows as (
      select jsonb_build_object(
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
                                    then round(a.comments::numeric / a.posts, 2) else null end) as obj,
             coalesce(a.posts, 0) as posts,
             coalesce(c.cta_clicks, 0) as cta_clicks,
             coalesce(d.gate_dms, 0) as gate_dms,
             m.slug as slug
      from lm m
      left join agg a on a.slug = m.slug
      left join dms d on d.slug = m.slug
      left join clicks c on c.slug = m.slug
      left join calls k on k.slug = m.slug
    )
    select jsonb_build_object(
      'since', v_since,
      'calls_note', 'calls is null when no booking carries the lead magnet slug. lm_attribution is the only booking ledger keyed by slug and it holds no production row, so calls reads null on every lane today. A null here means not attributable, it does not mean zero calls.',
      'lms', coalesce((
        select jsonb_agg(obj order by posts desc, cta_clicks desc, slug) from lmrows
      ), '[]'::jsonb),
      -- 083: the operator's own best lead magnet, by the two outcomes a lead magnet exists for.
      -- The surfaces call a row "active" when it shows any activity (a post, a CTA click, a gate
      -- DM or a call: `activeLms` in src/lib/leadMagnets.ts). A row with cta_clicks + gate_dms > 0
      -- is active by that definition, so requiring the sum to be positive IS the active filter,
      -- and it is also what makes this JSON null instead of a zero row when no lead magnet has
      -- earned a click or a DM yet. Never a row with nothing to show.
      'best_own', (
        select obj from lmrows
        where cta_clicks + gate_dms > 0
        order by cta_clicks + gate_dms desc, posts desc, slug
        limit 1
      )
    )
  );
end $function$;

revoke all on function public.operator_lead_magnets(text, text) from public, anon;
grant execute on function public.operator_lead_magnets(text, text) to authenticated, service_role;
