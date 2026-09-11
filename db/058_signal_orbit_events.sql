-- 058_signal_orbit_events.sql — Signal Orbit, part 2: one typed, dated event view + the graph RPCs
-- Goal run signal-orbit-live-2026-09-11. Requires 057_signal_orbit_identity.sql.
--
-- signal_events            one row per dated edge between a contact and a tenant's seat (or one of its posts)
-- signal_graph(p_client, p_from, p_to)   → jsonb {people, posts, content_edges, lanes, stats}
-- signal_person(p_client, p_contact)     → jsonb {contact, prospects, events, links}
--
-- Tenant key: 'ivan' | 'arch' | 'risedtc'. Campaigns: coalesce(client_id,'ivan'). profile_view_log.seat and
-- booking_attributions.client_id already use the literal 'ivan'. post_engagers has no client_id: the post decides.
-- Both RPCs are SECURITY DEFINER because post_engagers / profile_view_log / client_post_metrics are service_role-only
-- under RLS; execute is granted to authenticated (the inbox operator) and service_role only, never anon.

-- prospect → contact spine, with tenant + lane
create or replace view public.signal_prospect_links as
select cl.contact_id, p.id as prospect_id, p.campaign_id, coalesce(c.client_id,'ivan') as tenant,
       c.name as campaign_name, public.lane_of(c.name) as lane, p.stage, p.icp_score, p.skip_state,
       p.created_at as prospect_created_at
from public.contact_links cl
join public.outreach_prospects p on p.id::text = cl.source_id
join public.outreach_campaigns c on c.id = p.campaign_id
where cl.source_type = 'outreach_prospect' and cl.review_status <> 'rejected';

create or replace view public.signal_events as
-- 1. the DM ledger, both directions
select pl.contact_id, pl.tenant,
       case when m.direction = 'inbound' then (case when m.channel = 'email' or m.message_type = 'email_reply' then 'email_in' else 'dm_in' end)
            when m.message_type = 'connection_note' then 'invite_note'
            when m.message_type = 'inmail' or m.channel = 'linkedin_inmail' then 'inmail_out'
            when m.message_type = 'email' or m.channel = 'email' then 'email_out'
            else 'dm_out' end as kind,
       m.sent_at as at, pl.prospect_id, pl.campaign_id, null::text as post_id,
       left(m.message_text, 240) as text, 'outreach_messages' as src, m.id::text as src_id
from public.outreach_messages m
join public.signal_prospect_links pl on pl.prospect_id = m.prospect_id
where m.sent_at is not null
union all
-- 2. outbound actions from the engagement log (DMs only where the ledger has no row that day)
select pl.contact_id, pl.tenant,
       case l.action_type when 'connection_request' then 'invite' when 'invite_withdrawn' then 'withdraw'
                          when 'profile_view' then 'view_out' when 'like' then 'like_out' else 'dm_out' end,
       l.created_at, pl.prospect_id, pl.campaign_id, null, left(l.comment_text, 240), 'outreach_engagement_log', l.id::text
from public.outreach_engagement_log l
join public.signal_prospect_links pl on pl.prospect_id = l.prospect_id
where l.action_type in ('connection_request','invite_withdrawn','profile_view','like')
   or (l.action_type in ('dm_sent','dm') and not exists (
        select 1 from public.outreach_messages m where m.prospect_id = l.prospect_id and m.direction = 'outbound'
          and m.message_type in ('dm','manual_reply') and m.sent_at::date = l.created_at::date))
union all
-- 3. prospect date columns (fallbacks + stage facts)
select pl.contact_id, pl.tenant, 'invite', p.connection_sent_at, pl.prospect_id, pl.campaign_id, null, null, 'outreach_prospects', p.id::text || '#invite'
from public.outreach_prospects p join public.signal_prospect_links pl on pl.prospect_id = p.id
where p.connection_sent_at is not null
  and not exists (select 1 from public.outreach_engagement_log l where l.prospect_id = p.id and l.action_type = 'connection_request')
union all
select pl.contact_id, pl.tenant, 'view_out', p.profile_viewed_at, pl.prospect_id, pl.campaign_id, null, null, 'outreach_prospects', p.id::text || '#view'
from public.outreach_prospects p join public.signal_prospect_links pl on pl.prospect_id = p.id
where p.profile_viewed_at is not null
  and not exists (select 1 from public.outreach_engagement_log l where l.prospect_id = p.id and l.action_type = 'profile_view')
union all
select pl.contact_id, pl.tenant, 'connected', p.connected_at, pl.prospect_id, pl.campaign_id, null, null, 'outreach_prospects', p.id::text || '#connected'
from public.outreach_prospects p join public.signal_prospect_links pl on pl.prospect_id = p.id where p.connected_at is not null
union all
select pl.contact_id, pl.tenant, 'booked', p.call_booked_at, pl.prospect_id, pl.campaign_id, null, null, 'outreach_prospects', p.id::text || '#booked'
from public.outreach_prospects p join public.signal_prospect_links pl on pl.prospect_id = p.id where p.call_booked_at is not null
union all
-- 4. bookings attributed to a prospect (when the prospect row itself carries no booked date)
select pl.contact_id, pl.tenant, 'booked', coalesce(b.meeting_start, b.booked_at, b.created_at), pl.prospect_id, pl.campaign_id, null,
       left(b.meeting_title, 240), 'booking_attributions', b.meeting_id
from public.booking_attributions b join public.signal_prospect_links pl on pl.prospect_id = b.prospect_id
where b.prospect_id is not null
  and not exists (select 1 from public.outreach_prospects p where p.id = b.prospect_id and p.call_booked_at is not null)
union all
-- 5. inbound profile views (three seats)
select cl.contact_id, v.seat, 'view_in', coalesce(v.viewed_at, v.captured_at), v.prospect_id,
       (select pl.campaign_id from public.signal_prospect_links pl where pl.prospect_id = v.prospect_id limit 1),
       null, left(v.viewer_headline, 240), 'profile_view_log', v.id::text
from public.profile_view_log v
join public.contact_links cl on cl.source_type = 'profile_view' and cl.source_id = v.id::text and cl.review_status <> 'rejected'
union all
-- 6. reactions / comments on own posts (tenant = the post's owner)
select cl.contact_id, coalesce(m.client_id, 'ivan'), e.engagement_type, coalesce(e.first_seen_at, e.last_seen_at), e.prospect_id,
       (select pl.campaign_id from public.signal_prospect_links pl where pl.prospect_id = e.prospect_id limit 1),
       e.post_social_id, left(coalesce(e.comment_text, e.reaction_type), 240), 'post_engagers', e.id::text
from public.post_engagers e
join public.contact_links cl on cl.source_type = 'post_engager' and cl.source_id = e.id::text and cl.review_status <> 'rejected'
left join public.client_post_metrics m on m.social_id = e.post_social_id
union all
-- 7. judged engagers on client posts
select cl.contact_id, e.client_id, e.kind, e.seen_at, null,
       null, m.social_id, left(e.headline, 240), 'client_post_engagers', e.id::text
from public.client_post_engagers e
join public.contact_links cl on cl.source_type = 'client_post_engager' and cl.source_id = e.id::text and cl.review_status <> 'rejected'
join public.client_post_metrics m on m.id = e.post_id
union all
-- 8. comment authors on client posts
select cl.contact_id, c.client_id, 'comment', coalesce(c.posted_at, c.created_at), null, null, c.post_urn, left(c.text, 240), 'client_post_comments', c.id::text
from public.client_post_comments c
join public.contact_links cl on cl.source_type = 'client_post_comment' and cl.source_id = c.id::text and cl.review_status <> 'rejected'
union all
-- 9. Ivan's comments on other people's posts, and their replies
select cl.contact_id, 'ivan', 'comment_out', coalesce(g.posted_at, g.commented_at), null, null, null, left(g.comment_text, 240), 'commenting_log', g.id::text
from public.commenting_log g
join public.contact_links cl on cl.source_type = 'commenting_target' and cl.source_id = g.target_id::text and cl.review_status <> 'rejected'
where coalesce(g.posted_at, g.commented_at) is not null
union all
select cl.contact_id, 'ivan', 'reply', g.reply_received_at, null, null, null, left(g.post_excerpt, 240), 'commenting_log', g.id::text || '#reply'
from public.commenting_log g
join public.contact_links cl on cl.source_type = 'commenting_target' and cl.source_id = g.target_id::text and cl.review_status <> 'rejected'
where g.reply_received_at is not null;

grant select on public.signal_prospect_links, public.signal_events to authenticated, service_role;
revoke all on public.signal_prospect_links, public.signal_events from anon;

-- ─── signal_graph ────────────────────────────────────────────────────────────
-- Stage index: 0 signal (moved / we moved on them) · 1 reached (invite/DM/InMail/email out) · 2 connected · 3 replied · 4 booked
drop function if exists public.signal_graph(text, date, date);
create or replace function public.signal_graph(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; t0 timestamptz := clock_timestamp();
begin
  if auth.role() not in ('authenticated','service_role') then raise exception 'signal_graph: not allowed'; end if;
  if p_client not in ('ivan','arch','risedtc') then raise exception 'signal_graph: unknown tenant %', p_client; end if;

  -- window first (the selective scan), then the all-time events of only those people
  with win as materialized (
    select contact_id, kind, at, prospect_id, campaign_id, post_id, text
    from signal_events
    where tenant = p_client and contact_id is not null and at is not null
      and at >= p_from::timestamptz and at < (p_to + 1)::timestamptz
  ),
  who as materialized (select distinct contact_id from win),
  ev as materialized (
    select e.contact_id, e.kind, e.at
    from signal_events e join who w on w.contact_id = e.contact_id
    where e.tenant = p_client and e.at is not null
  ),
  facts as (
    select e.contact_id,
      min(e.at) filter (where e.kind in ('reaction','comment','reply','view_in','view_out','like_out','comment_out')) s0,
      min(e.at) filter (where e.kind in ('invite','invite_note','withdraw','dm_out','inmail_out','email_out')) s1,
      min(e.at) filter (where e.kind = 'connected') s2,
      min(e.at) filter (where e.kind in ('dm_in','email_in')) s3,
      min(e.at) filter (where e.kind = 'booked') s4,
      min(e.at) filter (where e.kind in ('reaction','comment','reply','view_in')) first_in,
      min(e.at) t0, max(e.at) t1,
      bool_or(e.kind = 'view_in') v, bool_or(e.kind in ('reaction','comment','reply')) pg,
      count(*) filter (where e.kind in ('dm_in','email_in')) dmi,
      count(*) filter (where e.kind in ('dm_out','inmail_out')) dmo,
      count(*) filter (where e.at > now() - interval '24 hours') fresh
    from ev e join who w on w.contact_id = e.contact_id
    group by e.contact_id
  ),
  pros as (
    select distinct on (pl.contact_id) pl.contact_id, pl.prospect_id, pl.campaign_id, pl.campaign_name, pl.lane, pl.stage, pl.icp_score, pl.skip_state
    from signal_prospect_links pl join who w on w.contact_id = pl.contact_id
    where pl.tenant = p_client
    order by pl.contact_id, pl.prospect_created_at desc
  ),
  evlist as (
    select contact_id, jsonb_agg(jsonb_build_object('t', kind, 'd', at, 'x', left(text,120), 'p', post_id) order by at) filter (where rn <= 40) ev
    from (select w.*, row_number() over (partition by contact_id order by at desc) rn from win w) x
    group by contact_id
  ),
  people as (
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'n', c.name, 'ti', coalesce(c.owner_notes, cl_head.h, ''), 'c', coalesce(c.company,''),
      'i', coalesce(pr.icp_score, c.icp_score), 'url', c.linkedin_url, 'mid', c.linkedin_member_id,
      'pid', pr.prospect_id, 'camp', pr.campaign_id, 'lane', coalesce(pr.lane, 'content'), 'pstage', pr.stage, 'skip', pr.skip_state,
      'st', case when f.s4 is not null then 4 when f.s3 is not null then 3 when f.s2 is not null then 2 when f.s1 is not null then 1 else 0 end,
      'sd', jsonb_build_array(f.s0, f.s1, coalesce(f.s2, f.s3, f.s4), coalesce(f.s3, f.s4), f.s4),
      't0', f.t0, 't1', f.t1, 'fresh', f.fresh,
      'inb', (f.first_in is not null and f.first_in <= coalesce(f.s1, 'infinity'::timestamptz)),
      'reached', f.s1 is not null, 'v', f.v, 'pg', f.pg, 'dmi', f.dmi, 'dmo', f.dmo,
      'ev', coalesce(el.ev, '[]'::jsonb)
    ) order by f.t0) j, count(*) n
    from facts f
    join contacts c on c.id = f.contact_id
    left join pros pr on pr.contact_id = f.contact_id
    left join evlist el on el.contact_id = f.contact_id
    left join lateral (select cl.source_ref->>'headline' h from contact_links cl where cl.contact_id = f.contact_id and cl.source_ref ? 'headline' order by cl.created_at desc limit 1) cl_head on true
  ),
  postrows as (
    select o.social_id id, o.posted_at d, left(o.post_text, 160) txt, o.num_likes li, o.num_comments cm, o.num_impressions im, o.linkedin_url url, o.id::text row_id
    from own_posts o where p_client = 'ivan' and o.social_id is not null
      and (o.posted_at::date between p_from and p_to or o.social_id in (select post_id from win where post_id is not null))
    union all
    select m.social_id, m.published_at, left(m.title, 160), m.reactions, m.comments, m.impressions, m.post_url, m.id::text
    from client_post_metrics m where m.client_id = p_client and m.social_id is not null
      and (m.published_at::date between p_from and p_to or m.social_id in (select post_id from win where post_id is not null))
  ),
  posts as (
    select jsonb_agg(jsonb_build_object('id', id, 'd', d, 'txt', txt, 'li', li, 'cm', cm, 'im', im, 'url', url, 'row', row_id) order by d) j, count(*) n from postrows
  ),
  cedges as (
    select jsonb_agg(jsonb_build_object('s', contact_id, 't', post_id, 'k', kind, 'd', d)) j, count(*) n
    from (select contact_id, post_id, kind, min(at) d from win where post_id is not null and kind in ('reaction','comment') group by 1,2,3) x
  ),
  lanes as (
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'lane', lane_of(c.name), 'active', (c.is_active and not c.archived),
                                        'n', (select count(distinct pr.contact_id) from pros pr where pr.campaign_id = c.id)) order by c.name) j
    from outreach_campaigns c
    where coalesce(c.client_id,'ivan') = p_client
      and ((c.is_active and not c.archived) or exists (select 1 from pros pr where pr.campaign_id = c.id))
  )
  select jsonb_build_object(
    'tenant', p_client, 'from', p_from, 'to', p_to, 'generated_at', now(),
    'people', coalesce(people.j, '[]'::jsonb), 'posts', coalesce(posts.j, '[]'::jsonb),
    'content_edges', coalesce(cedges.j, '[]'::jsonb), 'lanes', coalesce(lanes.j, '[]'::jsonb),
    'stats', jsonb_build_object('people', people.n, 'posts', posts.n, 'content_edges', cedges.n,
      'events', (select count(*) from win),
      -- clock domain. t_min_abs is the true earliest touch; t_min is the 1st percentile, because a
      -- handful of imported 2013-2020 LinkedIn chats would otherwise collapse the whole dial into a
      -- sliver. The client lays out on t_min and pins anything older to the domain start.
      't_min_abs', (select min(at) from win),
      't_min', (select percentile_cont(0.01) within group (order by extract(epoch from at))
                from win),
      't_max', (select max(at) from win),
      'ms', round(extract(epoch from clock_timestamp() - t0) * 1000))
  ) into result
  from people, posts, cedges, lanes;
  return result;
end $$;

-- ─── signal_person ───────────────────────────────────────────────────────────
drop function if exists public.signal_person(text, uuid);
create or replace function public.signal_person(p_client text, p_contact uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() not in ('authenticated','service_role') then raise exception 'signal_person: not allowed'; end if;
  return jsonb_build_object(
    'contact', (select to_jsonb(c.*) from contacts c where c.id = p_contact),
    'prospects', (select coalesce(jsonb_agg(jsonb_build_object('id', pl.prospect_id, 'campaign_id', pl.campaign_id, 'campaign', pl.campaign_name,
                    'lane', pl.lane, 'stage', pl.stage, 'icp', pl.icp_score, 'skip_state', pl.skip_state, 'tenant', pl.tenant) order by pl.prospect_created_at desc), '[]'::jsonb)
                  from signal_prospect_links pl where pl.contact_id = p_contact),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('t', kind, 'd', at, 'x', text, 'p', post_id, 'src', src, 'pid', prospect_id) order by at), '[]'::jsonb)
               from (select * from signal_events where contact_id = p_contact and tenant = p_client order by at desc limit 400) e),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('type', source_type, 'id', source_id, 'conf', confidence, 'ref', source_ref)), '[]'::jsonb)
              from contact_links where contact_id = p_contact and review_status <> 'rejected')
  );
end $$;

revoke all on function public.signal_graph(text, date, date) from public, anon;
revoke all on function public.signal_person(text, uuid) from public, anon;
grant execute on function public.signal_graph(text, date, date) to authenticated, service_role;
grant execute on function public.signal_person(text, uuid) to authenticated, service_role;
