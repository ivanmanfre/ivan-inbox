-- 20261102 one-touch own-post engagers on client seats (RISE first). Part 1: registry + candidate rule.
-- Ivan 2026-11-02: "i think one touch is enough IF ICP approved tho."
-- A person who reacts to or comments on ONE of the seat owner's own posts, scored on the seat's engager rubric at
-- or above min_icp with an allowed tier (RISE: tier owner, score >= 7), never a prospect in any tenant, never
-- blacklisted, never a current client (the seat's do-not-target lists), engaged within max_age_days (Ivan 10-25:
-- a warm engager invite goes no later than 7 days after the engagement), becomes ONE approval-held warm-signal card
-- on that seat. Ivan's own seat keeps own_engager_promotion_candidates and its own node, unchanged.
-- Config lives in outreach_seats.settings.own_post_engager; no tenant literal below.
begin;

update public.outreach_seats
   set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('own_post_engager', jsonb_build_object(
         'enabled', true,
         'armed', false,
         'campaign', '8f72efb3-9b41-4fb0-8c4d-552d52d53463',
         'min_icp', 7,
         'tiers', jsonb_build_array('owner'),
         'max_age_days', 7,
         'daily_cap', 3,
         'max_promote_per_run', 5,
         'geo_gate', true,
         'invite_path', 'crs_note',
         'accepted_scorer_prefix', 'audn-rise-icp-engager-scoring@',
         'invite_distances', jsonb_build_array('DISTANCE_2', 'DISTANCE_3', 'OUT_OF_NETWORK'),
         'note_note_variant', 'rise_own_post_engager_v1',
         'template_slug', 'own-engager-casual-dm',
         'template_seat', 'risedtc',
         'dnt_pid_key', 'rise_dnt_pids',
         'dnt_list_key', 'rise_do_not_target'))
 where seat = 'risedtc';

-- Per seat: the campaign a promoted engager lands in and the freshness window. Readers: warm_signal_cards,
-- warm_signal_decide (both invoker rights, so the registry read goes through this definer helper).
create or replace function public.outreach_seat_own_engager_cfg()
 returns table(seat text, client_id text, campaign_id uuid, max_age_days integer, invite_path text)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $f$
  select s.seat, s.client_id, (s.settings->'own_post_engager'->>'campaign')::uuid,
         coalesce((s.settings->'own_post_engager'->>'max_age_days')::integer, 7),
         s.settings->'own_post_engager'->>'invite_path'
  from outreach_seats s
  where s.active and s.client_id is not null
    and coalesce((s.settings->'own_post_engager'->>'enabled')::boolean, false)
    and nullif(s.settings->'own_post_engager'->>'campaign', '') is not null
$f$;
revoke all on function public.outreach_seat_own_engager_cfg() from public, anon;
grant execute on function public.outreach_seat_own_engager_cfg() to authenticated, service_role;

-- The rule. Dry run, the logger node and any replay read the same rows. p_since widens the read window for a
-- replay; freshness is always judged against now() - max_age_days (blocked_by engagement_too_old).
create or replace function public.seat_own_engager_candidates(p_seat text, p_since timestamptz default null)
 returns table(seat text, person_key text, provider_id text, name text, headline text, linkedin_url text, slug text,
               max_icp numeric, tier text, icp_reasoning text, scorer_version text, n_posts integer, commented boolean,
               touches jsonb, first_engaged_at timestamptz, last_engaged_at timestamptz, network_distance text,
               window_ends timestamptz, matched_prospect_id uuid, blocked_by text)
 language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $f$
declare
  v_client text; v_cfg jsonb; v_min numeric; v_tiers text[]; v_age integer; v_since timestamptz;
  v_dnt_pids text[] := array[]::text[]; v_dnt_list text[] := array[]::text[]; v_raw text; v_prefix text;
begin
  select s.client_id, s.settings->'own_post_engager' into v_client, v_cfg
    from outreach_seats s where s.seat = p_seat and s.active;
  -- Ivan's seat (client_id null) has its own rule; an unconfigured or disabled seat returns nothing
  if v_client is null or v_cfg is null or not coalesce((v_cfg->>'enabled')::boolean, false) then return; end if;
  v_min := coalesce((v_cfg->>'min_icp')::numeric, 7);
  v_tiers := coalesce(array(select lower(jsonb_array_elements_text(v_cfg->'tiers'))), array['owner']);
  v_age := coalesce((v_cfg->>'max_age_days')::integer, 7);
  v_since := coalesce(p_since, now() - make_interval(days => v_age));
  -- Sol r1: only the seat's current rubric qualifies (older stamps such as rise-engager-v1 wait for a rescore)
  v_prefix := coalesce(v_cfg->>'accepted_scorer_prefix', '');
  -- current clients: a configured list that cannot be read fails the whole call (never an open gate)
  if nullif(v_cfg->>'dnt_pid_key', '') is not null then
    select ic.value into v_raw from integration_config ic where ic.key = v_cfg->>'dnt_pid_key';
    if v_raw is null then raise exception 'own_engager_dnt_unreadable:%', v_cfg->>'dnt_pid_key'; end if;
    v_dnt_pids := array(select lower(btrim(x)) from jsonb_array_elements_text(v_raw::jsonb) x where btrim(x) <> '');
  end if;
  if nullif(v_cfg->>'dnt_list_key', '') is not null then
    select ic.value into v_raw from integration_config ic where ic.key = v_cfg->>'dnt_list_key';
    if v_raw is null then raise exception 'own_engager_dnt_unreadable:%', v_cfg->>'dnt_list_key'; end if;
    v_dnt_list := array(select trim(regexp_replace(lower(x), '[^a-z0-9]+', ' ', 'g'))
                          from jsonb_array_elements_text(v_raw::jsonb) x
                         where length(regexp_replace(lower(x), '[^a-z0-9]', '', 'g')) >= 4);
  end if;

  return query
  with eng as (
    select pe.*,
           coalesce(li_member_key(pe.provider_id), li_member_key(pe.linkedin_url),
                    nullif(lower(pe.member_id), ''), 'name:' || lower(pe.name)) as pk,
           upper(coalesce(case when jsonb_typeof(pe.raw->'author') = 'object' then pe.raw->'author'->>'network_distance' end,
                          pe.raw->'author_details'->>'network_distance')) as nd_raw,
           -- Sol r1: when they ENGAGED, never when we first saw it (the logger re-reads posts up to 14 days old).
           -- A comment carries its own date; a reaction has none, so its earliest possible time is the post's
           -- publication: conservative, it can only shorten the window. Unknown = null = held.
           case when pe.engagement_type = 'comment' and pe.raw->>'date' ~ '^\d{4}-\d{2}-\d{2}T'
                then least((pe.raw->>'date')::timestamptz, pe.first_seen_at)
                else m.published_at end as eng_at,
           (v_prefix = '' or coalesce(pe.scorer_version, '') like v_prefix || '%') as current_rubric
    from post_engagers pe
    join client_post_metrics m on m.social_id = pe.post_social_id and m.client_id = v_client
    where pe.name is not null and pe.first_seen_at >= v_since
  ),
  per as (
    select e.pk,
           max(e.provider_id) as provider_id,
           (array_agg(e.name order by e.first_seen_at desc))[1] as name,
           (array_agg(e.headline order by e.first_seen_at desc) filter (where e.headline is not null))[1] as headline,
           (array_agg(e.linkedin_url order by (li_slug(e.linkedin_url) !~ '^acoa|^acwa') desc, e.first_seen_at desc)
              filter (where e.linkedin_url is not null))[1] as linkedin_url,
           max(e.icp_score) filter (where e.current_rubric) as max_icp,
           max(e.icp_score) as any_icp,
           (array_agg(lower(substring(e.provenance_detail from '^tier:(.+)$')) order by e.icp_score desc nulls last, e.first_seen_at desc)
              filter (where e.provenance_detail like 'tier:%' and e.current_rubric))[1] as tier,
           (array_agg(e.icp_reasoning order by e.icp_score desc nulls last) filter (where e.icp_reasoning is not null and e.current_rubric))[1] as icp_reasoning,
           (array_agg(e.scorer_version order by e.icp_score desc nulls last) filter (where e.scorer_version is not null and e.current_rubric))[1] as scorer_version,
           count(distinct e.post_social_id)::integer as n_posts,
           bool_or(e.engagement_type = 'comment') as commented,
           jsonb_agg(jsonb_build_object('post', e.post_social_id, 'kind', e.engagement_type, 'at', e.eng_at, 'seen_at', e.first_seen_at,
                                        'score', e.icp_score, 'scorer', e.scorer_version, 'comment', left(e.comment_text, 200)) order by e.first_seen_at) as touches,
           min(e.eng_at) as first_engaged_at,
           max(e.eng_at) as last_engaged_at,
           (array_agg(case when e.nd_raw in ('FIRST_DEGREE', 'DISTANCE_1') then 'DISTANCE_1'
                           when e.nd_raw in ('SECOND_DEGREE', 'DISTANCE_2') then 'DISTANCE_2'
                           when e.nd_raw in ('THIRD_DEGREE', 'DISTANCE_3') then 'DISTANCE_3'
                           when e.nd_raw is not null then e.nd_raw end order by e.first_seen_at desc)
              filter (where e.nd_raw is not null))[1] as network_distance,
           max(e.prospect_id::text)::uuid as linked_prospect_id
    from eng e
    group by e.pk
  ),
  scored as (
    select p.*,
           case when p.max_icp is null and p.any_icp is not null then 'scorer_outdated'
                when p.max_icp is null then 'unscored'
                when p.max_icp < v_min then 'icp_under_floor'
                -- engine_touched rows carry the prospect's stage instead of a tier: already a prospect
                when p.tier is null and p.linked_prospect_id is not null then 'already_prospect'
                when p.tier is null or not (p.tier = any(v_tiers)) then 'tier_not_allowed'
                else null end as score_block
    from per p
  ),
  -- identity and client checks only for people who passed the rubric (the expensive part)
  chk as (
    select s.*,
           (select bool_or(true) from integration_config ic
             where ic.key ~ '_linkedin_id$' and nullif(ic.value, '') is not null
               and lower(ic.value) in (lower(s.provider_id), s.pk)) as own_seat,
           (lower(coalesce(s.provider_id, '')) = any(v_dnt_pids) or s.pk = any(v_dnt_pids)
             or exists (select 1 from unnest(v_dnt_list) d
                         where position(' ' || d || ' ' in
                               ' ' || trim(regexp_replace(lower(coalesce(s.name, '') || ' ' || coalesce(s.headline, '')), '[^a-z0-9]+', ' ', 'g')) || ' ') > 0)) as is_client,
           idm.id as match_id, idm.blacklisted as match_blacklisted,
           exists (select 1 from contacts c join contact_links cl on cl.contact_id = c.id and cl.source_type = 'outreach_prospect'
                    where c.merged_into is null and lower(c.linkedin_member_id) = s.pk) as by_spine
    from scored s
    -- the same legs as own_engager_identity_matches (member key on profile id or URL, public slug, contact spine),
    -- split into index-friendly lookups: that function's OR scans every prospect (3.2s a person, measured 11-02)
    left join lateral (
      select op.id, op.blacklisted
      from (
        select x.id from outreach_prospects x
         where li_member_key(s.provider_id) is not null and li_member_key(x.linkedin_profile_id) = li_member_key(s.provider_id)
        union
        select x.id from outreach_prospects x
         where li_member_key(s.provider_id) is not null and li_member_key(x.linkedin_url) = li_member_key(s.provider_id)
        union
        select x.id from outreach_prospects x
         where li_slug(s.linkedin_url) is not null and li_slug(x.linkedin_url) = li_slug(s.linkedin_url)
        union
        select x.id from contacts c
          join contact_links l on l.contact_id = c.id and l.source_type = 'outreach_prospect'
          join outreach_prospects x on x.id::text = l.source_id
         where c.merged_into is null and li_member_key(s.provider_id) is not null and lower(c.linkedin_member_id) = li_member_key(s.provider_id)
        union
        select x.id from contacts c
          join contact_links l on l.contact_id = c.id and l.source_type = 'outreach_prospect'
          join outreach_prospects x on x.id::text = l.source_id
         where c.merged_into is null and li_slug(s.linkedin_url) is not null and li_slug(c.linkedin_url) = li_slug(s.linkedin_url)
      ) hits
      join outreach_prospects op on op.id = hits.id
      order by op.blacklisted desc limit 1
    ) idm on s.score_block is null
    where s.score_block is null
  )
  select p_seat, s.pk, s.provider_id, s.name, s.headline, s.linkedin_url, li_slug(s.linkedin_url), s.max_icp, s.tier,
         s.icp_reasoning, s.scorer_version, s.n_posts, s.commented, s.touches, s.first_engaged_at, s.last_engaged_at,
         s.network_distance, s.last_engaged_at + make_interval(days => v_age),
         coalesce(c.match_id, s.linked_prospect_id),
         coalesce(s.score_block,
           case when c.own_seat then 'own_seat'
                when c.is_client then 'current_client'
                when c.match_blacklisted then 'blacklisted'
                when c.match_id is not null or s.linked_prospect_id is not null or c.by_spine then 'already_prospect'
                when s.provider_id is null then 'no_provider_id'
                when s.last_engaged_at is null then 'engagement_time_unknown'
                when s.last_engaged_at < now() - make_interval(days => v_age) then 'engagement_too_old'
                -- Sol r1: an invite needs a KNOWN non-connection; a 1st-degree person gets a DM draft; unknown is held
                when s.network_distance is null
                  or not (s.network_distance = 'DISTANCE_1'
                          or s.network_distance in (select jsonb_array_elements_text(coalesce(v_cfg->'invite_distances', '["DISTANCE_2","DISTANCE_3"]'::jsonb))))
                  then 'distance_unknown'
                else null end)
  from scored s
  left join chk c on c.pk = s.pk
  order by (s.score_block is null) desc, s.max_icp desc nulls last, s.last_engaged_at desc;
end;
$f$;
revoke all on function public.seat_own_engager_candidates(text, timestamptz) from public, anon, authenticated;
grant execute on function public.seat_own_engager_candidates(text, timestamptz) to service_role;

commit;
