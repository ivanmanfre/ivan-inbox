-- 057_signal_orbit_identity.sql — Signal Orbit, part 1: identity spine for every LinkedIn touch
-- Goal run signal-orbit-live-2026-09-11. Applied via the Management API (see goal-runs/…-out/01-data.md).
--
-- What this does
--   1. URL helpers: li_member_id() pulls the ACoAA… member id out of any LinkedIn URL/id;
--      li_slug() normalises a profile URL or bare public id to a lowercase, url-decoded slug.
--   2. contacts.linkedin_member_id — member id first, slug second (the old resolver matched the raw URL string,
--      which produced 57 member ids spread over 114 contact rows).
--   3. Backfill member ids from outreach_prospects.linkedin_profile_id, merge the duplicate contacts.
--   4. _resolve_signal_sources(): links post_engagers / profile_view_log / commenting_targets /
--      client_post_engagers / client_post_comments into contact_links (source_type per table, confidence 'exact'
--      when matched on member id or slug, 'created' when a new contact had to be made).
--   5. resolve_contacts() gains the member-id + slug rules and calls _resolve_signal_sources() — the existing
--      pg_cron job `crm-resolve-contacts` (*/30) keeps everything fresh with no new scheduler.
--   6. post_engagers.prospect_id / profile_view_log.prospect_id backfill by member id, then slug.

-- ─── 1. helpers ──────────────────────────────────────────────────────────────
create or replace function public._urldecode(s text) returns text
language plpgsql immutable set search_path = public as $$
declare b bytea := ''::bytea; i int := 1; n int; c text;
begin
  if s is null then return null; end if;
  if position('%' in s) = 0 then return s; end if;
  n := length(s);
  while i <= n loop
    c := substr(s, i, 1);
    if c = '%' and i + 2 <= n and substr(s, i+1, 2) ~ '^[0-9A-Fa-f]{2}$' then
      b := b || decode(substr(s, i+1, 2), 'hex'); i := i + 3;
    else
      b := b || convert_to(c, 'UTF8'); i := i + 1;
    end if;
  end loop;
  return convert_from(b, 'UTF8');
exception when others then return s;
end $$;

create or replace function public.li_member_id(s text) returns text
language sql immutable set search_path = public as $$
  select substring(s from '(ACoAA[0-9A-Za-z_-]{20,})')
$$;

-- Accepts a full profile URL, a bare public id, or a member id. Returns the lowercase slug, or NULL when the
-- input is empty or is a member id (member ids are case-sensitive and live in li_member_id instead).
create or replace function public.li_slug(s text) returns text
language plpgsql immutable set search_path = public as $$
declare t text;
begin
  if s is null then return null; end if;
  t := trim(s);
  if t = '' then return null; end if;
  if li_member_id(t) is not null then return null; end if;
  t := regexp_replace(t, '^https?://', '', 'i');
  t := regexp_replace(t, '^(www\.|[a-z]{2,3}\.)?linkedin\.com/in/', '', 'i');
  t := regexp_replace(t, '[/?#].*$', '');
  t := _urldecode(t);
  t := lower(trim(both '/' from trim(t)));
  if t = '' or t ~ '/' then return null; end if;
  return t;
end $$;

-- ─── 2. contacts.linkedin_member_id ──────────────────────────────────────────
alter table public.contacts add column if not exists linkedin_member_id text;
create unique index if not exists contacts_member_uniq on public.contacts (linkedin_member_id)
  where linkedin_member_id is not null and merged_into is null;
drop index if exists public.contacts_li_slug_idx;
create index if not exists contacts_li_slug_idx on public.contacts (li_slug(linkedin_url));
-- the backfills join prospects on the same two keys
create index if not exists outreach_prospects_li_mid_idx on public.outreach_prospects (li_member_id(linkedin_profile_id));
create index if not exists outreach_prospects_li_slug_idx on public.outreach_prospects (li_slug(linkedin_url));

-- ─── 3. backfill member ids + merge the raw-string duplicates ────────────────
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
    select id into other from contacts where linkedin_member_id = r.mid and merged_into is null and id <> r.contact_id limit 1;
    if other is not null then
      -- the same person under two URL spellings → keep the older contact, merge the newer into it
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

-- ─── 4. link the five signal sources into the spine ──────────────────────────
-- Returns how the row was placed: 'mid' | 'slug' | 'url' | 'created' | 'skip'
create or replace function public._link_signal_row(
  p_source text, p_id text, p_mid text, p_slug text, p_url text, p_name text, p_headline text, p_icp int, p_ref jsonb
) returns text language plpgsql set search_path = public as $$
declare v uuid; how text; v_url text;
begin
  if p_mid is null and p_slug is null then return 'skip'; end if;
  if exists (select 1 from contact_links where source_type = p_source and source_id = p_id and review_status <> 'rejected') then
    return 'skip';
  end if;
  if p_mid is not null then
    select id into v from contacts where linkedin_member_id = p_mid and merged_into is null limit 1;
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
        case when p_mid is not null and not exists (select 1 from contacts c2 where c2.linkedin_member_id = p_mid and c2.merged_into is null) then p_mid end),
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

create or replace function public._bump(j jsonb, k1 text, k2 text) returns jsonb
language sql immutable set search_path = public as $$
  -- jsonb_set cannot create the parent object, so seed it first
  select jsonb_set(coalesce(j,'{}'::jsonb) || jsonb_build_object(k1, coalesce(j -> k1, '{}'::jsonb)),
                   array[k1, k2], to_jsonb(coalesce((j #>> array[k1, k2])::int, 0) + 1), true)
$$;

create or replace function public._resolve_signal_sources() returns jsonb
language plpgsql set search_path = public as $$
declare r record; out jsonb := '{}'::jsonb; how text; n int;
begin
  -- post_engagers (Ivan + RISE + ARCH own-post engagers; tenant derives from the post)
  for r in
    select e.id, coalesce(li_member_id(e.provider_id), li_member_id(e.member_id), li_member_id(e.linkedin_url)) mid,
           li_slug(e.linkedin_url) slug, e.linkedin_url url, e.name, e.headline, e.icp_score::int icp,
           jsonb_build_object('post', e.post_social_id, 'type', e.engagement_type, 'seen', e.first_seen_at) ref
    from post_engagers e
    where not exists (select 1 from contact_links cl where cl.source_type='post_engager' and cl.source_id=e.id::text and cl.review_status<>'rejected')
  loop
    how := _link_signal_row('post_engager', r.id::text, r.mid, r.slug, r.url, r.name, r.headline, r.icp, r.ref);
    out := _bump(out, 'post_engager', how);
  end loop;

  -- profile_view_log (3 seats)
  for r in
    select v.id, li_member_id(v.viewer_provider_id) mid, li_slug(v.viewer_public_id) slug,
           case when li_slug(v.viewer_public_id) is not null then 'https://www.linkedin.com/in/' || li_slug(v.viewer_public_id) end url,
           v.viewer_name name, v.viewer_headline headline, null::int icp,
           jsonb_build_object('seat', v.seat, 'viewed_at', v.viewed_at, 'distance', v.distance) ref
    from profile_view_log v
    where not exists (select 1 from contact_links cl where cl.source_type='profile_view' and cl.source_id=v.id::text and cl.review_status<>'rejected')
  loop
    how := _link_signal_row('profile_view', r.id::text, r.mid, r.slug, r.url, r.name, r.headline, r.icp, r.ref);
    out := _bump(out, 'profile_view', how);
  end loop;

  -- commenting_targets (people whose posts Ivan comments on)
  for r in
    select t.id, coalesce(li_member_id(t.linkedin_profile_id), li_member_id(t.linkedin_url)) mid, li_slug(t.linkedin_url) slug,
           t.linkedin_url url, t.name, t.title headline, null::int icp,
           jsonb_build_object('status', t.status, 'class', t.class, 'company', t.company) ref
    from commenting_targets t
    where not exists (select 1 from contact_links cl where cl.source_type='commenting_target' and cl.source_id=t.id::text and cl.review_status<>'rejected')
  loop
    how := _link_signal_row('commenting_target', r.id::text, r.mid, r.slug, r.url, r.name, r.headline, r.icp, r.ref);
    out := _bump(out, 'commenting_target', how);
  end loop;

  -- client_post_engagers (judged sides on client posts)
  for r in
    select e.id, coalesce(li_member_id(e.profile_id), li_member_id(e.linkedin_url)) mid,
           coalesce(li_slug(e.public_slug), li_slug(e.linkedin_url)) slug, e.linkedin_url url, e.name, e.headline, null::int icp,
           jsonb_build_object('client_id', e.client_id, 'post_id', e.post_id, 'kind', e.kind, 'side', e.side) ref
    from client_post_engagers e
    where not exists (select 1 from contact_links cl where cl.source_type='client_post_engager' and cl.source_id=e.id::text and cl.review_status<>'rejected')
  loop
    how := _link_signal_row('client_post_engager', r.id::text, r.mid, r.slug, r.url, r.name, r.headline, r.icp, r.ref);
    out := _bump(out, 'client_post_engager', how);
  end loop;

  -- client_post_comments (comment authors on client posts)
  for r in
    select c.id, coalesce(li_member_id(c.author_provider_id), li_member_id(c.author_profile_url)) mid, li_slug(c.author_profile_url) slug,
           c.author_profile_url url, c.author_name name, c.author_headline headline, c.icp_score icp,
           jsonb_build_object('client_id', c.client_id, 'post_urn', c.post_urn, 'posted_at', c.posted_at) ref
    from client_post_comments c
    where (c.author_provider_id is not null or c.author_profile_url is not null)
      and not exists (select 1 from contact_links cl where cl.source_type='client_post_comment' and cl.source_id=c.id::text and cl.review_status<>'rejected')
  loop
    how := _link_signal_row('client_post_comment', r.id::text, r.mid, r.slug, r.url, r.name, r.headline, r.icp, r.ref);
    out := _bump(out, 'client_post_comment', how);
  end loop;

  -- prospect_id backfills: member id first, then slug; Ivan-lane posts → Ivan campaigns, client posts → that client
  -- member id pass
  update post_engagers e set prospect_id = p.id
  from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
  where e.prospect_id is null and li_member_id(e.provider_id) is not null
    and li_member_id(p.linkedin_profile_id) = li_member_id(e.provider_id)
    and coalesce(c.client_id,'ivan') = coalesce((select m.client_id from client_post_metrics m where m.social_id = e.post_social_id limit 1), 'ivan');
  get diagnostics n = row_count;
  out := jsonb_set(out, '{post_engagers_prospect_backfilled_mid}', to_jsonb(n), true);
  -- slug pass
  update post_engagers e set prospect_id = p.id
  from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
  where e.prospect_id is null and li_slug(e.linkedin_url) is not null
    and li_slug(p.linkedin_url) = li_slug(e.linkedin_url)
    and coalesce(c.client_id,'ivan') = coalesce((select m.client_id from client_post_metrics m where m.social_id = e.post_social_id limit 1), 'ivan');
  get diagnostics n = row_count;
  out := jsonb_set(out, '{post_engagers_prospect_backfilled_slug}', to_jsonb(n), true);

  update profile_view_log v set prospect_id = p.id
  from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
  where v.prospect_id is null and li_member_id(v.viewer_provider_id) is not null
    and li_member_id(p.linkedin_profile_id) = li_member_id(v.viewer_provider_id)
    and coalesce(c.client_id,'ivan') = v.seat;
  get diagnostics n = row_count;
  out := jsonb_set(out, '{profile_view_prospect_backfilled_mid}', to_jsonb(n), true);
  update profile_view_log v set prospect_id = p.id
  from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
  where v.prospect_id is null and li_slug(v.viewer_public_id) is not null
    and li_slug(p.linkedin_url) = li_slug(v.viewer_public_id)
    and coalesce(c.client_id,'ivan') = v.seat;
  get diagnostics n = row_count;
  out := jsonb_set(out, '{profile_view_prospect_backfilled_slug}', to_jsonb(n), true);

  return out;
end $$;

-- ─── 5. resolve_contacts(): member id first, raw URL, slug, email, fuzzy name; then the signal sources ─
-- Body = the 2026-09-11 live function (backup: ~/.claude/backups/signal-orbit-2026-09-11/resolve_contacts.before.sql)
-- plus: (a) linkedin_profile_id member-id lookup before the URL lookup, (b) li_slug() lookup after it,
-- (c) linkedin_member_id stamped on link/create, (d) perform _resolve_signal_sources() before stage refresh.
create or replace function public.resolve_contacts() returns jsonb
language plpgsql set search_path = public as $function$
declare
  rec record; v_contact uuid;
  v_created int := 0; v_linked int := 0; v_pending int := 0;
  src text; sid text; s_name text; s_li text; s_email text; s_company text; s_icp int; s_mid text; s_slug text;
  a jsonb; t int; e int; seeded int; sig jsonb;
begin
  for rec in
    select 'outreach_prospect'::text as source_type, p.id::text as source_id,
           p.name, p.linkedin_url, p.email, p.company, p.icp_score,
           coalesce(li_member_id(p.linkedin_profile_id), li_member_id(p.linkedin_url)) as mid,
           jsonb_build_object('stage', p.stage) as source_ref, p.stage as micro
    from outreach_prospects p
    where not exists (select 1 from contact_links cl
                      where cl.source_type='outreach_prospect' and cl.source_id=p.id::text and cl.review_status <> 'rejected')
    union all
    select 'lead', l.id::text, l.name, l.linkedin_url, null::text, l.company, l.icp_score,
           li_member_id(l.linkedin_url),
           jsonb_build_object('engagement_type', l.engagement_type), null
    from leads l
    where not exists (select 1 from contact_links cl
                      where cl.source_type='lead' and cl.source_id=l.id::text and cl.review_status <> 'rejected')
  loop
    src := rec.source_type; sid := rec.source_id; s_name := rec.name;
    s_li := nullif(trim(rec.linkedin_url),''); s_email := nullif(lower(trim(rec.email)),'');
    s_company := rec.company; s_icp := rec.icp_score; s_mid := rec.mid; s_slug := li_slug(s_li); v_contact := null;
    if s_mid is not null then select id into v_contact from contacts where linkedin_member_id=s_mid and merged_into is null limit 1; end if;
    if v_contact is null and s_li is not null then select id into v_contact from contacts where linkedin_url=s_li and merged_into is null limit 1; end if;
    if v_contact is null and s_slug is not null then select id into v_contact from contacts where li_slug(linkedin_url)=s_slug and merged_into is null order by created_at limit 1; end if;
    if v_contact is null and s_email is not null then select id into v_contact from contacts where lower(email)=s_email and merged_into is null limit 1; end if;
    if v_contact is not null then
      insert into contact_links(contact_id, source_type, source_id, source_ref, linked_by, confidence, review_status)
      values (v_contact, src, sid, rec.source_ref, 'resolver', 'exact', 'active');
      update contacts set email=coalesce(email,s_email), linkedin_url=coalesce(linkedin_url,s_li),
        linkedin_member_id = coalesce(linkedin_member_id,
          case when s_mid is not null and not exists (select 1 from contacts c2 where c2.linkedin_member_id=s_mid and c2.merged_into is null) then s_mid end),
        company=coalesce(company,s_company), icp_score=greatest(coalesce(icp_score,-1),coalesce(s_icp,-1)),
        name=coalesce(nullif(name,''),s_name) where id=v_contact;
      v_linked := v_linked + 1; continue;
    end if;
    if s_li is null and s_name is not null then
      select id into v_contact from contacts where merged_into is null and similarity(name,s_name)>=0.55
        and (s_company is null or company is null or similarity(coalesce(company,''),s_company)>=0.4)
        order by similarity(name,s_name) desc limit 1;
      if v_contact is not null then
        insert into contact_links(contact_id, source_type, source_id, source_ref, linked_by, confidence, review_status)
        values (v_contact, src, sid, rec.source_ref, 'resolver', 'fuzzy', 'pending');
        v_pending := v_pending + 1; continue;
      end if;
    end if;
    insert into contacts(name, company, linkedin_url, linkedin_member_id, email, icp_score, stage, stage_suggested)
    values (coalesce(nullif(s_name,''),'(unknown)'), s_company, s_li, s_mid, s_email, s_icp,
            _crm_canon_stage(src, rec.micro), _crm_canon_stage(src, rec.micro))
    returning id into v_contact;
    insert into contact_links(contact_id, source_type, source_id, source_ref, linked_by, confidence, review_status)
    values (v_contact, src, sid, rec.source_ref, 'resolver', 'exact', 'active');
    v_created := v_created + 1;
  end loop;

  a := _resolve_assessments(); v_created := v_created + (a->>'created')::int; v_linked := v_linked + (a->>'linked')::int;
  t := _resolve_transcripts(); v_pending := v_pending + t;
  e := _resolve_email_threads(); v_linked := v_linked + e;
  sig := _resolve_signal_sources();

  perform refresh_stage_suggestions();
  update contacts set stage = stage_suggested
  where merged_into is null and stage_manual = false and stage_suggested is not null and stage_suggested <> stage;
  get diagnostics seeded = row_count;
  perform refresh_last_activity();

  return jsonb_build_object('created', v_created, 'linked', v_linked, 'pending', v_pending, 'email_linked', e, 'stage_seeded', seeded, 'signal', sig);
end; $function$;

revoke all on function public._resolve_signal_sources() from public, anon;
revoke all on function public._signal_backfill_member_ids() from public, anon;
revoke all on function public._link_signal_row(text,text,text,text,text,text,text,int,jsonb) from public, anon;
