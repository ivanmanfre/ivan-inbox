-- 086 — operator_lead_magnets reads the new stamps
-- goal-run lm-own-side-attribution-2026-09-17, phase P3.
--
-- WHY
-- db/085 + the three pushed workflows put a lead-magnet slug on the post row itself:
-- `own_posts_scored.lead_magnet_slug` (projected from scheduled_posts) on Ivan's lane and
-- `client_post_metrics.lead_magnet_slug` on the client lanes. The RPC only knew two ways to
-- attribute a post: the lead magnet's `linkedin_social_id`, and (Ivan only) the slug on
-- own_posts_scored. The client slug column was invisible to it, and no lane could say how much
-- of its own output was attributable at all.
--
-- WHAT CHANGES (create or replace only; signature, gate, volatility and security unchanged)
-- 1. `attributed` now unions three sources and counts each post once by social id:
--      the existing linkedin_social_id / post_url path,
--      Ivan    own_posts_scored.lead_magnet_slug,
--      clients client_post_metrics.lead_magnet_slug, scoped by client_id.
--    Each source table is read ONCE into its own CTE (`own`, `cpm`) and joined, instead of the
--    per-lead-magnet join against the view the old `attributed` used. own_posts_scored carries a
--    correlated `also_promoted_by` count and a full lm_events aggregate, so reading it once per
--    call rather than once per slug is what keeps the 57-slug Ivan lane inside its budget.
-- 2. `calls` is aggregated once over lm_attribution instead of a correlated count per slug, and
--    now honours v_since, ignores canceled bookings, and only counts a slug that exists in
--    lead_magnets for THIS lane. While the lane has no real booking the key stays null on every
--    row and `calls_note` stays in the payload byte for byte. The first real booking on a lane
--    flips that lane to real numbers (0 allowed) and drops `calls_note` for that lane only.
-- 3. Two additive top-level keys, `attributed_posts` / `unattributed_posts`: the lane's OWN posts
--    since v_since that do / do not resolve to one of its lead magnets. Ivan's denominator is
--    own_posts; the client lanes' is client_post_metrics by client_id. Ivan's rows in
--    client_post_metrics (client_id = 'ivan') are deliberately NOT a second source for Ivan.
--
-- INVARIANTS
--   * `distinct on (l.slug)` kept (080: a duplicated slug multiplied the catalog denominator).
--   * every existing key keeps its name, type and value except on lead magnets that gained a
--     stamped post inside the window; those are listed in OUT/03-readout.md with the post.
--   * anon execute stays false; grants re-issued below exactly as they were.
--
-- ROLLBACK: snapshots/operator_lead_magnets.pre-086.json holds the pre-change definition verbatim.

begin;

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
    -- 086: each post source is read ONCE, windowed here, then joined to lm. The old shape joined
    -- own_posts_scored per lead magnet; that view carries a correlated subquery per row, so on a
    -- 57-slug lane it was scanned 57 times.
    own as (
      select o.social_id, o.posted_at, o.num_comments, o.lead_magnet_slug
      from public.own_posts_scored o
      where p_client_id = 'ivan' and o.posted_at >= v_since
    ),
    cpm as (
      select c.social_id, c.published_at, c.comments, c.lead_magnet_slug, c.post_url
      from public.client_post_metrics c
      where p_client_id <> 'ivan' and c.client_id = p_client_id and c.published_at >= v_since
    ),
    -- Posts attributed to a lead magnet. A post is attributed by its explicit slug stamp or by
    -- matching the lead magnet's linkedin_social_id / post_url. Nothing is inferred from text.
    -- `union` (not `union all`) plus count(distinct post_key) below: a post that matches two ways
    -- is one post.
    attributed as (
      select m.slug, o.social_id as post_key, o.posted_at, o.num_comments as comments
      from lm m
      join own o
        on o.lead_magnet_slug = m.slug
        or (m.linkedin_social_id is not null and o.social_id = m.linkedin_social_id)
      union
      select m.slug, c.social_id, c.published_at, c.comments
      from lm m
      join cpm c
        on c.lead_magnet_slug = m.slug                                            -- 086, new
        or (m.linkedin_social_id is not null and c.social_id = m.linkedin_social_id)
        or (m.post_url is not null and c.post_url = m.post_url)
    ),
    agg as (
      select slug,
             count(distinct post_key) as posts,
             coalesce(sum(comments), 0) as comments,
             min(posted_at) as first_post,
             max(posted_at) as last_post
      from attributed group by slug
    ),
    -- 086: the lane's own output in the window, and how much of it resolves to a lead magnet.
    -- Ivan's denominator is own_posts (not own_posts_scored, which is one row per own_post
    -- anyway, and not his client_post_metrics rows).
    lane_posts as (
      select o.social_id from public.own_posts o
       where p_client_id = 'ivan' and o.posted_at >= v_since and o.social_id is not null
      union all
      select c.social_id from public.client_post_metrics c
       where p_client_id <> 'ivan' and c.client_id = p_client_id
         and c.published_at >= v_since and c.social_id is not null
    ),
    lane_counts as (
      select count(*) filter (where a.post_key is not null) as attributed_posts,
             count(*) filter (where a.post_key is null)     as unattributed_posts
      from (select distinct social_id from lane_posts) lp
      left join (select distinct post_key from attributed) a on a.post_key = lp.social_id
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
    -- Calls are only claimed where a booking actually carries the slug, is not canceled, and
    -- landed inside the same window as every other number here. 086: aggregated once, and the
    -- `in (select slug from lm)` filter is what scopes the ledger to THIS lane -- lm_attribution
    -- has no client_id of its own. Null means not attributable, never zero calls: see calls_note.
    calls as (
      select m.slug, coalesce(b.booked, 0) as booked
      from lm m
      left join (
        select a.lm_slug, count(*) as booked
        from public.lm_attribution a
        where a.lm_slug in (select slug from lm)
          and coalesce(a.status, '') <> 'canceled'
          and coalesce(a.booked_at, a.created_at) >= v_since
        group by a.lm_slug
      ) b on b.lm_slug = m.slug
    ),
    calls_total as (select coalesce(sum(booked), 0) as n from calls),
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
               -- 086: while the lane has no real booking at all, every row reads null and
               -- calls_note explains it. Once one booking lands, the lane reports real numbers
               -- and a lead magnet with none reads 0, which is a fact rather than a gap.
               'calls', case when (select n from calls_total) > 0 then k.booked else null end,
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
      'attributed_posts', (select attributed_posts from lane_counts),
      'unattributed_posts', (select unattributed_posts from lane_counts),
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
    -- 086: calls_note is a statement about a lane with no attributable booking. It stays exactly
    -- as it was while that is true, and disappears for a lane the moment a real booking lands.
    || case when (select n from calls_total) > 0 then '{}'::jsonb else jsonb_build_object(
         'calls_note', 'calls is null when no booking carries the lead magnet slug. lm_attribution is the only booking ledger keyed by slug and it holds no production row, so calls reads null on every lane today. A null here means not attributable, it does not mean zero calls.')
       end
  );
end $function$;

-- Grants re-issued exactly as they were before 086. anon is never granted.
revoke all on function public.operator_lead_magnets(text, text) from public;
grant execute on function public.operator_lead_magnets(text, text) to authenticated;
grant execute on function public.operator_lead_magnets(text, text) to service_role;

commit;
