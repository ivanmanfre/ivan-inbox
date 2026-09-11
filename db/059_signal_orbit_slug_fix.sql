-- 059_signal_orbit_slug_fix.sql — fixes two identity defects the Identity Skeptic proved (2026-09-11).
--
-- DEFECT 1 (false merges): li_slug() only stripped the `/in/` prefix. For a company page
-- (`/company/x`) or a people-search URL (`/search/results/people/?keywords=…`) it trimmed at the
-- first slash and returned the HOST, so every such URL collided on the single key
-- 'www.linkedin.com'. 16 unrelated entities were merged into one contact (ArcelorMittal Calvert),
-- 6 of them real people, and 3 post_engager links matched on that degenerate key.
-- FIX: li_slug() returns a slug ONLY for a real `/in/` profile path (or a bare slug with no host
-- and no slash). Anything else — company, school, search, post, feed — returns NULL.
--
-- DEFECT 2 (under-merge): li_member_id() matched 'ACoAA' case-sensitively, so 820 live contacts
-- whose URL carries a lowercased or ACwAA-form member id were invisible to the member-id rule.
-- Member ids in this DB are ACoAA (15,864) and ACwAA (318).
-- FIX: match `AC[a-z0-9]AA…` case-insensitively and return the id UPPER/lower-normalised to a
-- comparison key via li_member_key(); li_member_id() keeps returning the id as written so stored
-- values stay byte-identical to LinkedIn's.

create or replace function public.li_member_id(s text) returns text
language sql immutable set search_path = public as $$
  select substring(s from '(?i)(AC[a-zA-Z0-9]AA[0-9A-Za-z_-]{15,})')
$$;

-- Comparison key: case-folded member id. Use this for equality, never the raw value.
create or replace function public.li_member_key(s text) returns text
language sql immutable set search_path = public as $$
  select lower(substring(s from '(?i)(AC[a-zA-Z0-9]AA[0-9A-Za-z_-]{15,})'))
$$;

create or replace function public.li_slug(s text) returns text
language plpgsql immutable set search_path = public as $$
declare t text; path text;
begin
  if s is null then return null; end if;
  t := trim(s);
  if t = '' then return null; end if;
  if li_member_id(t) is not null then return null; end if;   -- member ids live in li_member_id
  if t ~* '^(https?://)?([a-z0-9-]+\.)*linkedin\.com/' then
    -- a LinkedIn URL is only a person when its path is /in/<slug>
    path := regexp_replace(t, '^(https?://)?([a-z0-9-]+\.)*linkedin\.com', '', 'i');
    if path !~* '^/in/' then return null; end if;             -- company / school / search / post / feed
    t := regexp_replace(path, '^/in/', '', 'i');
  elsif t ~ '/' then
    return null;                                              -- some other host, or a path we do not know
  end if;
  t := regexp_replace(t, '[/?#].*$', '');
  t := _urldecode(t);
  t := lower(trim(both '/' from trim(t)));
  if t = '' or t ~ '[/?#]' or t ~* '^(company|school|showcase|posts|feed|search|pub|jobs)$' then return null; end if;
  return t;
end $$;

-- The expression indexes hold values produced by the OLD function; rebuild them or they keep
-- serving the old (wrong) matches.
reindex index public.contacts_li_slug_idx;
reindex index public.outreach_prospects_li_slug_idx;
reindex index public.outreach_prospects_li_mid_idx;

-- ─── case-fold the member-id comparison everywhere ───────────────────────────
-- 820 live contacts carry a lowercased or ACwAA-form member id in their URL that the old
-- case-sensitive rule could not see. Store the id as written; compare on lower().
drop index if exists public.contacts_member_uniq;
create unique index if not exists contacts_member_key_uniq on public.contacts (lower(linkedin_member_id))
  where linkedin_member_id is not null and merged_into is null;
create index if not exists outreach_prospects_li_mid_key_idx on public.outreach_prospects (li_member_key(linkedin_profile_id));
create index if not exists contacts_li_mid_key_idx on public.contacts (li_member_key(linkedin_url));

create or replace function public._link_signal_row(
  p_source text, p_id text, p_mid text, p_slug text, p_url text, p_name text, p_headline text, p_icp int, p_ref jsonb
) returns text language plpgsql set search_path = public as $$
declare v uuid; how text; v_url text; k text;
begin
  k := lower(p_mid);
  if p_mid is null and p_slug is null then return 'skip'; end if;
  if exists (select 1 from contact_links where source_type = p_source and source_id = p_id and review_status <> 'rejected') then
    return 'skip';
  end if;
  if k is not null then
    select id into v from contacts where lower(linkedin_member_id) = k and merged_into is null limit 1;
    if v is not null then how := 'mid'; end if;
  end if;
  if v is null and p_slug is not null then
    select id into v from contacts where li_slug(linkedin_url) = p_slug and merged_into is null order by created_at limit 1;
    if v is not null then how := 'slug'; end if;
  end if;
  if v is null then
    v_url := coalesce(nullif(p_url,''),
                      case when p_slug is not null then 'https://www.linkedin.com/in/' || p_slug end,
                      'https://www.linkedin.com/in/' || p_mid);
    select id into v from contacts where linkedin_url = v_url and merged_into is null limit 1;
    if v is null then
      insert into contacts (name, linkedin_url, linkedin_member_id, icp_score, stage, stage_suggested, owner_notes)
      values (coalesce(nullif(p_name,''), '(unknown)'), v_url, p_mid, p_icp, 'new', 'new', nullif(p_headline,''))
      returning id into v;
      how := 'created';
    else
      how := 'url';
    end if;
  end if;
  if how <> 'created' then
    update contacts set
      linkedin_member_id = coalesce(linkedin_member_id,
        case when p_mid is not null and not exists (select 1 from contacts c2 where lower(c2.linkedin_member_id) = k and c2.merged_into is null) then p_mid end),
      icp_score = case when p_icp is null then icp_score else greatest(coalesce(icp_score,-1), p_icp) end,
      name = coalesce(nullif(name,''), nullif(p_name,''))
    where id = v;
  end if;
  insert into contact_links (contact_id, source_type, source_id, source_ref, linked_by, confidence, review_status)
  values (v, p_source, p_id,
          coalesce(p_ref,'{}'::jsonb) || jsonb_build_object('name', p_name, 'headline', p_headline, 'matched_on', how),
          'resolver', case when how = 'created' then 'created' else 'exact' end, 'active')
  on conflict do nothing;
  return how;
end $$;

create or replace function public._signal_backfill_member_ids() returns jsonb
language plpgsql set search_path = public as $$
declare r record; keep uuid; other uuid; merged int := 0; stamped int := 0;
begin
  for r in
    with cand as (
      select cl.contact_id, coalesce(li_member_id(p.linkedin_profile_id), li_member_id(p.linkedin_url)) mid
      from contact_links cl
      join outreach_prospects p on p.id::text = cl.source_id
      where cl.source_type = 'outreach_prospect' and cl.review_status <> 'rejected'
      union all
      select c.id, li_member_id(c.linkedin_url) from contacts c where c.merged_into is null
    ), ranked as (
      select contact_id, mid, count(*) n, row_number() over (partition by contact_id order by count(*) desc) rn
      from cand where mid is not null group by 1,2
    )
    select r0.contact_id, r0.mid from ranked r0 join contacts c on c.id = r0.contact_id and c.merged_into is null where r0.rn = 1
  loop
    select id into other from contacts where lower(linkedin_member_id) = lower(r.mid) and merged_into is null and id <> r.contact_id limit 1;
    if other is not null then
      select case when a.created_at <= b.created_at then a.id else b.id end into keep
      from contacts a, contacts b where a.id = other and b.id = r.contact_id;
      if keep = other then
        perform merge_contacts(other, r.contact_id);
      else
        update contacts set linkedin_member_id = null where id = other;
        perform merge_contacts(r.contact_id, other);
        update contacts set linkedin_member_id = r.mid where id = r.contact_id;
      end if;
      merged := merged + 1;
    else
      update contacts set linkedin_member_id = r.mid
      where id = r.contact_id and merged_into is null and linkedin_member_id is distinct from r.mid;
      if found then stamped := stamped + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('stamped', stamped, 'merged', merged);
end $$;
