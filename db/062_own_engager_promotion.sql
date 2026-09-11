-- 062 · Own-post engager promotion: the rule as ONE replayable function.
-- goal-runs/own-engager-promotion-2026-09-12.md
--
-- A person who engaged one of IVAN'S OWN posts (post_engagers ⋈ own_posts) is a promotion
-- candidate when ALL hold:
--   · the engager rubric (audn-icp-engager-scoring, written by W0v3SYUL0RsAOwDS) scored them ≥ p_min_icp
--   · they are not already an outreach_prospects row in ANY tenant (member key · slug · contact spine)
--   · not blacklisted anywhere
--   · second touch: a comment on any post, OR reactions on two distinct posts. A single reaction waits.
-- Every person is returned with `blocked_by` (null = promotable) so a dry run and the skeptic read the
-- same rows the workflow reads. The function never writes.
--
-- Applied via the Supabase Management API (empty search_path there → every function sets it).

create or replace function public.own_engager_promotion_candidates(p_min_icp integer default 7)
returns table (
  person_key      text,
  provider_id     text,
  name            text,
  headline        text,
  linkedin_url    text,
  slug            text,
  max_icp         numeric,
  icp_reasoning   text,
  scorer_version  text,
  n_posts         integer,
  commented       boolean,
  touches         jsonb,
  first_engaged_at timestamptz,
  last_engaged_at timestamptz,
  linked_prospect_id uuid,
  blocked_by      text
)
language sql
stable
security definer
set search_path = public
as $$
with ivan as (
  select pe.*,
         coalesce(li_member_key(pe.provider_id), li_member_key(pe.linkedin_url),
                  nullif(lower(pe.member_id), ''), 'name:' || lower(pe.name)) as pk
  from post_engagers pe
  join own_posts o on o.social_id = pe.post_social_id
  where pe.name is not null
),
per as (
  select pk,
         max(provider_id)                                                            as provider_id,
         (array_agg(name order by last_seen_at desc nulls last))[1]                  as name,
         (array_agg(headline order by last_seen_at desc nulls last)
            filter (where headline is not null))[1]                                 as headline,
         (array_agg(linkedin_url order by (li_slug(linkedin_url) is not null) desc,
                                          last_seen_at desc nulls last)
            filter (where linkedin_url is not null))[1]                             as linkedin_url,
         max(icp_score)                                                              as max_icp,
         (array_agg(icp_reasoning order by icp_score desc nulls last, scored_at desc nulls last)
            filter (where icp_reasoning is not null))[1]                            as icp_reasoning,
         (array_agg(scorer_version order by icp_score desc nulls last, scored_at desc nulls last)
            filter (where scorer_version is not null))[1]                           as scorer_version,
         count(distinct post_social_id)::int                                         as n_posts,
         bool_or(engagement_type = 'comment')                                        as commented,
         jsonb_agg(jsonb_build_object('post', post_social_id, 'kind', engagement_type,
                                      'at', first_seen_at, 'score', icp_score,
                                      'comment', left(comment_text, 200))
                   order by first_seen_at)                                           as touches,
         min(first_seen_at)                                                          as first_engaged_at,
         max(last_seen_at)                                                           as last_engaged_at,
         max(prospect_id::text)::uuid                                                as linked_prospect_id
  from ivan
  group by pk
),
chk as (
  select p.*,
         li_slug(p.linkedin_url) as slug,
         exists (select 1 from outreach_prospects op
                  where li_member_key(op.linkedin_profile_id) = p.pk
                     or li_member_key(op.linkedin_url) = p.pk)                              as by_member,
         exists (select 1 from outreach_prospects op
                  where li_slug(p.linkedin_url) is not null
                    and li_slug(op.linkedin_url) = li_slug(p.linkedin_url))                  as by_slug,
         exists (select 1 from contacts c
                  join contact_links cl on cl.contact_id = c.id and cl.source_type = 'outreach_prospect'
                  where c.merged_into is null and lower(c.linkedin_member_id) = p.pk)        as by_spine,
         exists (select 1 from outreach_prospects op
                  where op.blacklisted
                    and (li_member_key(op.linkedin_profile_id) = p.pk
                         or li_member_key(op.linkedin_url) = p.pk
                         or (li_slug(p.linkedin_url) is not null
                             and li_slug(op.linkedin_url) = li_slug(p.linkedin_url))))      as blacklisted
  from per p
)
select pk, provider_id, name, headline, linkedin_url, slug, max_icp, icp_reasoning, scorer_version,
       n_posts, commented, touches, first_engaged_at, last_engaged_at, linked_prospect_id,
       case when max_icp is null                          then 'unscored'
            when max_icp < p_min_icp                      then 'icp_under_floor'
            when blacklisted                              then 'blacklisted'
            when linked_prospect_id is not null
                 or by_member or by_slug or by_spine      then 'already_prospect'
            when provider_id is null                      then 'no_provider_id'
            when not commented and n_posts < 2            then 'waits_second_touch'
            else null end                                 as blocked_by
from chk
order by (case when max_icp is null then 1 else 0 end), max_icp desc nulls last, last_engaged_at desc;
$$;

revoke all on function public.own_engager_promotion_candidates(integer) from public, anon, authenticated;
grant execute on function public.own_engager_promotion_candidates(integer) to service_role;

comment on function public.own_engager_promotion_candidates(integer) is
  'Own-post engager promotion rule (goal-run 2026-09-12). blocked_by null = promotable. Read by W0v3SYUL0RsAOwDS "Promote Own Engagers".';
