-- 304 open tracking truth, part 2: context, finalize, nightly relabel, backfill.
-- Plan Task 3. Requires 303. No reader changes here; nothing in this file can send, draft or ring.
-- Round 3 (rulings P1-P7): every fact a label uses is a fact about the request or the address (network, referrer,
-- user agent, owner flags, slugs, times, and the stored `near_send`), never another row's label, so one relabel pass
-- gives the same answer as the first label would with the same rows. `eligible` (may feed automation) is granted
-- only by scan_open_label on the FIRST label of a fresh row (inserted under 10 minutes ago), by the page_opens insert
-- trigger (305), or once by open_release_grant(). reclassify_opens can only revoke it.
-- Round 4 (rulings R1, R2): no address-based owner class (an owner flag elsewhere on the address is only
-- suspect:owner_address), and a scanner address is confirmed by 3+ different RECIPIENTS, not 3+ different links.

-- The outbound messages (any channel: LinkedIn, InMail, email) carrying this exact link that went out in the 15
-- minutes before the open, one row per message with its recipient (prospect_id, null when the message has none).
-- The slug must end at a non-slug character, so /scan/acme never matches a message about /scan/acme-2.
create or replace function public.scan_open_sends(p_id bigint)
returns table (prospect_id uuid) language sql stable security definer set search_path = public, pg_temp as $$
  select m.prospect_id
    from (select so.opened_at, lower(so.company_slug) as slug,
                 regexp_replace(lower(so.company_slug), '([^a-z0-9_-])', '\\\1', 'g') as slug_re
            from public.scan_opens so where so.id = p_id) r
    join public.outreach_messages m
      on m.direction = 'outbound' and m.sent_at is not null
     and m.sent_at between r.opened_at - interval '15 minutes' and r.opened_at
     and (lower(m.message_text) ~ ('/scan/' || r.slug_re || '([^a-z0-9_-]|$)')
          or (r.slug like 'arch-%' and lower(m.message_text) ~ ('madebyarch\.com/' || substr(r.slug_re, 6) || '([^a-z0-9_-]|$)')))
$$;

-- A message carrying this link went out in the 15 minutes before the open (recipient known or not).
create or replace function public.scan_open_near_send(p_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.scan_open_sends(p_id))
$$;

-- The same for a page open. A SwishDM report link is /compare/<token>; a shared page is /shared/<page>.
create or replace function public.page_open_sends(p_page text, p_at timestamptz)
returns table (prospect_id uuid) language sql stable security definer set search_path = public, pg_temp as $$
  select m.prospect_id from public.outreach_messages m
   where m.direction = 'outbound' and m.sent_at is not null
     and m.sent_at between p_at - interval '15 minutes' and p_at
     and lower(m.message_text) ~ ((case when p_page ~ '^swishdm/compare/[a-z2-7]{20}$'
                                       then '/compare/' || substring(p_page from '([a-z2-7]{20})$')
                                       else '/shared/' || regexp_replace(lower(p_page), '([^a-z0-9_-])', '\\\1', 'g') end)
                                  || '([^a-z0-9_-]|$)')
$$;

create or replace function public.page_open_near_send(p_page text, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.page_open_sends(p_page, p_at))
$$;

-- One scan open's facts (rulings P2-P4). Rows of the same address (ip_hash) are read by their own stored facts:
--   burst:        3+ distinct scans from this address inside one 10-minute span that includes this row (non-owner rows).
--   near_send:    scan_open_near_send for this row, computed now.
--   addr_scanner: the address is on the Microsoft network and its opens with no LinkedIn referrer, not by the owner,
--                 each within 15 minutes after a message carrying that link, reach 3+ DIFFERENT RECIPIENTS (the
--                 prospect ids of those messages; a message with no known recipient counts for none). Ruling R2.
--   addr_owner:   another row of this address carried the owner flag (any time).
--   many_scans:   the address appears on 8+ different scans (any period, this row included).
drop function if exists public.scan_open_context(bigint);
create or replace function public.scan_open_context(p_id bigint)
returns table (burst boolean, near_send boolean, addr_scanner boolean, addr_owner boolean, many_scans boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with r as (
    select so.id, so.ip_hash, so.opened_at, so.is_owner, lower(so.company_slug) as slug,
           public.open_from_linkedin(so.referrer_host, so.user_agent) as li,
           public.scan_open_near_send(so.id) as near,
           public.open_is_microsoft(coalesce(n.asn, so.net_asn), coalesce(n.org, so.net_org)) as addr_ms
      from public.scan_opens so left join public.open_networks n on n.ip_hash = so.ip_hash
     where so.id = p_id),
  a as (
    select o.id, o.opened_at, o.is_owner, lower(o.company_slug) as slug, o.near_send,
           public.open_from_linkedin(o.referrer_host, o.user_agent) as li
      from public.scan_opens o, r
     where r.ip_hash is not null and o.ip_hash = r.ip_hash and o.id <> r.id)
  select
    r.ip_hash is not null and exists (
      select 1 from (select a.opened_at as at from a where not a.is_owner union all select r.opened_at) w
       where w.at between r.opened_at - interval '10 minutes' and r.opened_at
         and (select count(distinct x.slug) from (
                select a.slug from a where not a.is_owner and a.opened_at between w.at and w.at + interval '10 minutes'
                union all select r.slug where r.opened_at between w.at and w.at + interval '10 minutes') x) >= 3),
    r.near,
    case when r.ip_hash is not null and r.addr_ms then (
      select count(distinct s.prospect_id) from (
        select a.id from a where a.near_send and not a.li and not a.is_owner
        union all select r.id where r.near and not r.li and not r.is_owner) x
      cross join lateral public.scan_open_sends(x.id) s
       where s.prospect_id is not null) >= 3 else false end,
    r.ip_hash is not null and exists (select 1 from a where a.is_owner),
    r.ip_hash is not null and (select count(distinct x.slug) from (select a.slug from a union all select r.slug) x) >= 8
  from r
$$;

-- The same facts for a page open (shared pages, SwishDM reports). Called by the page_opens trigger before the row
-- exists (p_id null) and by the relabel. Page rows store an address hash only when the tracker has its salt; a row
-- without one gets burst_no_address instead (same organization + city + user agent, 3+ different pages, 10 minutes).
drop function if exists public.page_open_context(text, text, timestamptz, bigint);
drop function if exists public.page_open_context(text, text, timestamptz, bigint, text, text, text, text);
create or replace function public.page_open_context(p_page text, p_ip_hash text, p_at timestamptz, p_id bigint,
  p_org text, p_city text, p_user_agent text, p_referrer text)
returns table (burst boolean, burst_no_address boolean, near_send boolean, addr_scanner boolean, addr_owner boolean,
               many_pages boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select public.page_open_near_send(p_page, p_at) as near, public.open_from_linkedin(p_referrer, p_user_agent) as li),
  a as (
    select o.id, o.created_at as at, o.page, o.is_external, o.near_send,
           public.open_from_linkedin(o.referrer, o.user_agent) as li
      from public.page_opens o
     where p_ip_hash is not null and o.ip_hash = p_ip_hash and o.id is distinct from p_id),
  b as (
    select o.created_at as at, o.page from public.page_opens o
     where p_ip_hash is null and nullif(p_org, '') is not null and o.ip_hash is null and o.is_external
       and o.org = p_org and o.city is not distinct from p_city and o.user_agent is not distinct from p_user_agent
       and o.id is distinct from p_id
       and o.created_at between p_at - interval '10 minutes' and p_at + interval '10 minutes')
  select
    p_ip_hash is not null and exists (
      select 1 from (select a.at from a where a.is_external union all select p_at) w
       where w.at between p_at - interval '10 minutes' and p_at
         and (select count(distinct x.page) from (
                select a.page from a where a.is_external and a.at between w.at and w.at + interval '10 minutes'
                union all select p_page) x) >= 3),
    p_ip_hash is null and nullif(p_org, '') is not null and exists (
      select 1 from (select b.at from b union all select p_at) w
       where w.at between p_at - interval '10 minutes' and p_at
         and (select count(distinct x.page) from (
                select b.page from b where b.at between w.at and w.at + interval '10 minutes'
                union all select p_page) x) >= 3),
    me.near,
    case when p_ip_hash is not null and public.open_is_microsoft(null, p_org) then (
      select count(distinct s.prospect_id) from (
        select a.page, a.at from a where a.near_send and not a.li and a.is_external
        union all select p_page, p_at where me.near and not me.li) x
      cross join lateral public.page_open_sends(x.page, x.at) s
       where s.prospect_id is not null) >= 3 else false end,
    p_ip_hash is not null and exists (select 1 from a where not a.is_external),
    p_ip_hash is not null and (select count(distinct x.page) from (select a.page from a union all select p_page) x) >= 8
  from me
$$;

-- Labels one scan open. first_label = nothing (no finalize, relabel or backfill) ever labelled the row; the row is
-- locked, so two calls cannot both be first. eligible (ruling P6): the first label of a fresh row (inserted under 10
-- minutes ago) that is human grants it; any other call keeps it only while the row stays human, never grants it.
-- Lookup failure is not a signal (P5): with no network the classifier uses the other evidence; the nightly relabel
-- picks a later lookup up from open_networks. net_known = the row has an ASN or an organization.
drop function if exists public.scan_open_label(bigint, int, text, text, text);
create or replace function public.scan_open_label(p_id bigint, p_asn int, p_org text, p_country text, p_city text)
returns table (open_class text, class_reason text, first_label boolean, opened_at timestamptz, eligible boolean, net_known boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.scan_opens;
  v_asn int := p_asn;
  v_org text := p_org;
  c record;
  v_class text; v_reason text; v_first boolean; v_elig boolean;
begin
  select * into r from public.scan_opens s where s.id = p_id for update;
  if not found then return; end if;
  if r.ip_hash is not null and (p_org is not null or p_asn is not null) then
    insert into public.open_networks (ip_hash, asn, org, country_code, city, source)
    values (r.ip_hash, p_asn, p_org, p_country, p_city, 'edge_lookup')
    on conflict (ip_hash) do update set
      asn = coalesce(excluded.asn, open_networks.asn), org = coalesce(excluded.org, open_networks.org),
      country_code = coalesce(excluded.country_code, open_networks.country_code),
      city = coalesce(excluded.city, open_networks.city), source = 'edge_lookup', last_seen = now();
    select n.asn, n.org into v_asn, v_org from public.open_networks n where n.ip_hash = r.ip_hash;
  elsif r.ip_hash is not null then
    select n.asn, n.org into v_asn, v_org from public.open_networks n where n.ip_hash = r.ip_hash;
    update public.open_networks set last_seen = now() where ip_hash = r.ip_hash;
  end if;
  select * into c from public.scan_open_context(p_id);
  select k.open_class, k.class_reason into v_class, v_reason
    from public.scan_open_classify(r.is_owner, r.user_agent, r.referrer_host, r.device_type, v_asn, v_org,
                                   c.burst, c.near_send, c.addr_scanner, c.addr_owner, c.many_scans) k;
  v_first := r.open_class is null and r.classified_at is null;
  v_elig := v_class = 'human' and case when v_first and r.opened_at > now() - interval '10 minutes' then true else r.eligible end;
  update public.scan_opens s
     set net_asn = v_asn, net_org = v_org, near_send = c.near_send, open_class = v_class, class_reason = v_reason,
         classified_at = now(), eligible = v_elig
   where s.id = p_id;
  return query select v_class, v_reason, v_first, r.opened_at, v_elig, (v_asn is not null or nullif(v_org, '') is not null);
end $$;

create or replace function public.scan_open_finalize(p_id bigint, p_asn int, p_org text, p_country text, p_city text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l record;
begin
  select * into l from public.scan_open_label(p_id, p_asn, p_org, p_country, p_city);
  if l.open_class is null then
    return jsonb_build_object('open_class', null, 'class_reason', 'no_row', 'eligible', false, 'ring', false);
  end if;
  return jsonb_build_object('open_class', l.open_class, 'class_reason', l.class_reason, 'eligible', l.eligible, 'ring', false);
end $$;

-- Relabel history. Plain UPDATEs only: no notify, no draft, no ring (page_opens' trigger is BEFORE INSERT; scan_opens
-- has no trigger). First the stored near_send of every row in range, from the messages as they are now; then one
-- labelling pass (no label reads another row's label). eligible can only go from true to false here (P6). Every
-- row it reads gets classified_at, so a relabelled row can never take a first-label grant or ring later.
create or replace function public.reclassify_opens(p_since timestamptz default now() - interval '90 days')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_scan int; v_page int; v_rev_scan int; v_rev_page int;
begin
  -- the network a later open of the same address found (lookup retry)
  update public.scan_opens so set net_asn = coalesce(so.net_asn, n.asn), net_org = coalesce(so.net_org, n.org)
    from public.open_networks n
   where n.ip_hash = so.ip_hash and so.opened_at >= p_since
     and ((so.net_asn is null and n.asn is not null) or (so.net_org is null and n.org is not null));

  update public.scan_opens so set near_send = x.n
    from (select s.id, public.scan_open_near_send(s.id) as n from public.scan_opens s where s.opened_at >= p_since) x
   where so.id = x.id and so.near_send is distinct from x.n;
  update public.page_opens po set near_send = x.n
    from (select o.id, public.page_open_near_send(o.page, o.created_at) as n from public.page_opens o where o.created_at >= p_since) x
   where po.id = x.id and po.near_send is distinct from x.n;

  with s as (
    select so.id, so.open_class as old_class, so.class_reason as old_reason, so.eligible as old_elig, k.open_class, k.class_reason
      from public.scan_opens so
      left join public.open_networks n on n.ip_hash = so.ip_hash
      cross join lateral public.scan_open_context(so.id) x
      cross join lateral public.scan_open_classify(so.is_owner, so.user_agent, so.referrer_host, so.device_type,
                                                   coalesce(so.net_asn, n.asn), coalesce(so.net_org, n.org),
                                                   x.burst, x.near_send, x.addr_scanner, x.addr_owner, x.many_scans) k
     where so.opened_at >= p_since),
  u as (
    update public.scan_opens t
       set open_class = s.open_class, class_reason = s.class_reason, classified_at = now(),
           eligible = t.eligible and s.open_class = 'human'
      from s
     where t.id = s.id and ((t.open_class, t.class_reason) is distinct from (s.open_class, s.class_reason)
                            or t.classified_at is null or (t.eligible and s.open_class <> 'human'))
    returning (s.old_class, s.old_reason) is distinct from (s.open_class, s.class_reason) as changed,
              s.old_elig and s.open_class <> 'human' as revoked)
  select count(*) filter (where changed), count(*) filter (where revoked) into v_scan, v_rev_scan from u;

  with p as (
    select po.id, po.open_class as old_class, po.class_reason as old_reason, po.eligible as old_elig, k.open_class, k.class_reason
      from public.page_opens po
      cross join lateral public.page_open_context(po.page, po.ip_hash, po.created_at, po.id, po.org, po.city, po.user_agent, po.referrer) x
      cross join lateral public.page_open_classify(po.is_external, po.org, po.user_agent, po.referrer, x.burst, x.burst_no_address,
                                                   x.near_send, x.addr_scanner, x.addr_owner, x.many_pages) k
     where po.created_at >= p_since),
  u as (
    update public.page_opens t
       set open_class = p.open_class, class_reason = p.class_reason, classified_at = now(),
           eligible = t.eligible and p.open_class = 'human'
      from p
     where t.id = p.id and ((t.open_class, t.class_reason) is distinct from (p.open_class, p.class_reason)
                            or t.classified_at is null or (t.eligible and p.open_class <> 'human'))
    returning (p.old_class, p.old_reason) is distinct from (p.open_class, p.class_reason) as changed,
              p.old_elig and p.open_class <> 'human' as revoked)
  select count(*) filter (where changed), count(*) filter (where revoked) into v_page, v_rev_page from u;

  return jsonb_build_object('scan_changed', v_scan, 'page_changed', v_page,
                            'scan_eligibility_revoked', v_rev_scan, 'page_eligibility_revoked', v_rev_page);
end $$;

-- Ruling P6(b): ONCE, at release, grant eligibility to rows that the live readers already treat as evidence on release
-- day AND that the new rules label human. The live rule set (2026-11-17), as a union over every reader: a scan open
-- that is not the owner's, has no tool user agent and came 5+ minutes after the first message carrying that link
-- (ivan/rise evidence RPCs, came-back and interest cards each add their own narrower conditions, which they still
-- apply to links sent before the cutover, db/306); a SwishDM report page open from outside our country (the nudge
-- drafter's read). The marker row makes a second call a no-op, whoever calls it.
create or replace function public.open_release_grant()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_scan int; v_page int;
begin
  insert into public.integration_config (key, value) values ('open_eligibility_granted_at', now()::text)
  on conflict (key) do nothing;
  if not found then return jsonb_build_object('granted', false, 'reason', 'already_ran'); end if;
  with links as (
    select coalesce(lower(substring(m.message_text from '/scan/([A-Za-z0-9_-]+)')),
                    'arch-' || lower(substring(m.message_text from 'madebyarch\.com/([A-Za-z0-9_-]+-audit)'))) as slug,
           min(m.sent_at) as first_sent
      from public.outreach_messages m
     where m.direction = 'outbound' and m.sent_at is not null
       and m.message_text ~ '(/scan/[A-Za-z0-9_-]+|madebyarch\.com/[A-Za-z0-9_-]+-audit)'
     group by 1),
  g as (
    update public.scan_opens so set eligible = true
      from links l
     where lower(so.company_slug) = l.slug and so.open_class = 'human' and not so.eligible and so.is_owner = false
       and so.opened_at > l.first_sent + interval '5 minutes'
       and coalesce(so.user_agent, '') !~* 'headless|bot|crawler|spider|preview'
    returning so.id)
  select count(*) into v_scan from g;
  with g as (
    update public.page_opens po set eligible = true
     where po.open_class = 'human' and not po.eligible and po.is_external and po.page ~ '^swishdm/compare/[a-z2-7]{20}$'
    returning po.id)
  select count(*) into v_page from g;
  return jsonb_build_object('granted', true, 'scan', v_scan, 'page', v_page);
end $$;

revoke all on function public.scan_open_sends(bigint) from public, anon, authenticated;
revoke all on function public.page_open_sends(text, timestamptz) from public, anon, authenticated;
revoke all on function public.scan_open_near_send(bigint) from public, anon, authenticated;
revoke all on function public.page_open_near_send(text, timestamptz) from public, anon, authenticated;
revoke all on function public.scan_open_context(bigint) from public, anon, authenticated;
revoke all on function public.page_open_context(text, text, timestamptz, bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.scan_open_label(bigint, int, text, text, text) from public, anon, authenticated;
revoke all on function public.scan_open_finalize(bigint, int, text, text, text) from public, anon, authenticated;
revoke all on function public.reclassify_opens(timestamptz) from public, anon, authenticated;
revoke all on function public.open_release_grant() from public, anon, authenticated;
grant execute on function public.scan_open_sends(bigint) to service_role;
grant execute on function public.page_open_sends(text, timestamptz) to service_role;
grant execute on function public.scan_open_near_send(bigint) to service_role;
grant execute on function public.page_open_near_send(text, timestamptz) to service_role;
grant execute on function public.scan_open_context(bigint) to service_role;
grant execute on function public.page_open_context(text, text, timestamptz, bigint, text, text, text, text) to service_role;
grant execute on function public.scan_open_label(bigint, int, text, text, text) to service_role;
grant execute on function public.scan_open_finalize(bigint, int, text, text, text) to service_role;
grant execute on function public.reclassify_opens(timestamptz) to service_role;
grant execute on function public.open_release_grant() to service_role;

select cron.schedule('open-reclassify-nightly', '15 3 * * *', 'select public.reclassify_opens()');

-- BACKFILL (live apply only; tests stop at the line above). Seed = open_networks_seed.sql
-- (117 hashes from the gateway log, 9 Microsoft, 1 Railway, no raw IPs). Uses reclassify_opens, never scan_open_finalize,
-- then the one-time eligibility grant (P6b) for rows the live readers treat as evidence today.
insert into public.open_networks (ip_hash, asn, org, country_code, city, source) values
  ('06df1d443944f21028e56b575a0e931b2883030991c5b419513924dae7bc02b0', null, 'Mobile Broadband Service', 'GB', 'Morley', 'gateway_log_backfill'),
  ('07029e95dd59cf21cb3d6470f605a8174094e2c9f51472a30fcba84475661dd7', null, '02 Online (uk)', 'GB', 'London', 'gateway_log_backfill'),
  ('0a0f2aaa55d690731f8471d6be943271832dbac3c5248f47110aa8400150c851', null, 'AMREST COFFEE Sp z o.o.', 'PL', 'Warsaw', 'gateway_log_backfill'),
  ('0a217aa013e2b2aa736d9ab5c266fa942fe3ed30ec1689ad22c1beee56ea8f3e', null, 'Neos Networks Limited', 'GB', 'North Marston', 'gateway_log_backfill'),
  ('0a89ad596f3448fc38d3422a3e813fb19921670a098ffef96d9c970b90574e6f', null, 'Reliance Jio Infocomm Limited', 'IN', 'Delhi', 'gateway_log_backfill'),
  ('0adcc79f3096d4adbd8df2ef77918f45599fc2d0aaa3e49e8df94c4344c68661', null, 'OPTUS INTERNET - RETAIL', 'AU', 'Sydney', 'gateway_log_backfill'),
  ('0d7daabad4a73db7d11b0ad62ba6c98d4d73918e376e70ae89eb530ad6bbcd08', null, 'Pool for Cable customers', 'FR', 'Saint-Julien-en-Genevois', 'gateway_log_backfill'),
  ('0d81468f4f689146bb291090525cc9fd5a12f6796fdd48c003e36846ff1e9666', null, 'Evergy S.A.', 'GR', 'Thessaloníki', 'gateway_log_backfill'),
  ('13b6d108facf01d348d5b2cd130b466c582d28bd2811630732607eeb6a75c539', null, 'Shaw Communications', 'CA', 'Winnipeg', 'gateway_log_backfill'),
  ('141a9b69f31085212cfd1b9c1ee05d063fefa945f48b3c8bba702c1e60f15e0b', null, 'Deutsche Telekom AG', 'DE', 'Kempten (Allgäu)', 'gateway_log_backfill'),
  ('17016c70a8d4539e7a6e8b061e65888b337352d5883b36eefdd0b8a6778d8f98', 8075, 'Microsoft Limited', 'US', 'Dulles Town Center', 'gateway_log_backfill'),
  ('17db2d9046928fc78cab0d6207daf3ef80a6663aa3d7f01b684a0507a4298d27', null, 'Rogers Communications Canada Inc.', 'CA', 'Ottawa', 'gateway_log_backfill'),
  ('1946c8039386aa1818be5ea1d830d6c04560de5fcb81a7e392d2d42c6f52c778', null, 'POP DIJ', 'FR', 'Comblanchien', 'gateway_log_backfill'),
  ('20d456c9060867f8ca837dfab444dd0f53aa74ab304c83fcf99c63efc3490bea', null, 'Comcast Cable Communications', 'US', 'Laconia', 'gateway_log_backfill'),
  ('24a1f99338b8147f7904fe2681ff7ab5470cac5aeee489d72c212b9e4ea50b07', null, 'CenturyLink Communications, LLC', 'US', 'Portland', 'gateway_log_backfill'),
  ('2c177f46edc60178a6756d5434b13cb1fc651b5d9e2f5ea44072be055dad5031', null, 'OVH US LLC', 'US', 'Warrenton', 'gateway_log_backfill'),
  ('3355c55edfd18cd829c9ae1c0baf75ea0a91b818910f245e48b5fae72129695a', null, 'Chodkiewicza 7/93 street, Warsaw', 'PL', 'Warsaw', 'gateway_log_backfill'),
  ('375861b35f9e2f1b4a0ad0a381eb43aacb30a3dbe4561cc035cbd539c4d4fe2d', null, '02 Online (uk)', 'GB', 'London', 'gateway_log_backfill'),
  ('37cfeb1887df3442700654d500453a70dcb0590f6993ef0d6acc435ea79d67fc', null, 'Verizon Business', 'US', 'Cranford', 'gateway_log_backfill'),
  ('4232dbd8d33fb2b34aa929c650dd6d52ccc0f5b293ea6a2ab769379acceaddc7', null, '02 Online (uk)', 'GB', 'London', 'gateway_log_backfill'),
  ('436790ed5db5de75667c9c8876dfdae56d63ea8e63501f68d1956304c14607ac', 400940, 'Railway', 'US', 'Ashburn', 'gateway_log_backfill'),
  ('451dc0b0d12350288a2755803fc07edd4b4e2c45b29cbbd09da938345761a292', null, 'Packethub India', 'SG', 'Singapore', 'gateway_log_backfill'),
  ('456fcafc94d0b254f516c04c8369defd9e317d78892d50b3f2a0f7464deef680', null, 'Airtel UNOC, CP-05, Sector 8, IMT Manesar, Gurugram, Haryana 122051', 'IN', 'Ludhiana', 'gateway_log_backfill'),
  ('473bc2408fdedb55c729177c782d1f34a931979e2ebfff586d7c6adf2d0003c0', 8075, 'Microsoft Corporation', 'US', 'San Jose', 'gateway_log_backfill'),
  ('49b737d63c91d0737b3f93b62d982511deb53df6ba3fad6cc15de22c2b3cbd91', null, 'T-Mobile USA, Inc.', 'US', 'Miami', 'gateway_log_backfill'),
  ('4a82841d5e949eab0ac41cf3a3951da7136a6e810d7118950fc8e3f242e60935', null, 'PERRY BARR', 'GB', 'Birmingham', 'gateway_log_backfill'),
  ('4f6d0d392194a35fde5c0d47df3dc917213bea3987721f5220816e7f50cec894', null, 'AT&T Enterprises, LLC', 'US', 'Hidden Hills', 'gateway_log_backfill'),
  ('53c32b8ab37c292f493ca93c814801f886ee6e861545696d8dc8db9803c13b01', null, 'Digiweb Broadband', 'IE', 'Dundalk', 'gateway_log_backfill'),
  ('5518e7a5d0e36d49d4b43c53c2ea1eaaa66c4098f12bfb719602c49e981870fd', null, 'Atomic', 'ZA', 'Cape Town', 'gateway_log_backfill'),
  ('562ae1812549ec2c36a9afec65ca56939178c4dd6b4c259604fef4646b956770', null, 'DSL-ULL', 'PT', 'Almada', 'gateway_log_backfill'),
  ('56a69f457d47b6cfd2a2edf196ec1825f091f400e9b1771b59566fccc03b19f6', null, 'P4 Sp. z o.o.', 'PL', 'Warsaw', 'gateway_log_backfill'),
  ('574dab031cd8ff43fa1977756c41c2d4dc6664e9e5f4b7589b8e5ebe34a74eae', null, 'Rogers Communications Canada Inc.', 'CA', 'Vancouver', 'gateway_log_backfill'),
  ('581c48e12d1e91c2d0ab76d480e410c037e0baa60daf6ad5f1a28fdf56dfee27', null, 'Address pool for LTC-HOME customers', 'LV', 'Riga', 'gateway_log_backfill'),
  ('59b299c76ff89eb9752dd49a7677ff683ad03527c48dc57e9b30d3060119c7bf', null, 'Sky UK Limited', 'GB', 'Nottingham', 'gateway_log_backfill'),
  ('5a4a617ebfdbd968213f9dbfab5f7b3e8c7ed53f21bc7aa5ed7715f4ece2f406', null, 'Red de servicios IP', 'ES', 'Barcelona', 'gateway_log_backfill'),
  ('5b882a3e34197b5be4edf9e65e8627b85517fe5895421cd503a4f2f1d69ac0af', null, 'Reliance Jio Infocomm Limited', 'IN', 'Mathura', 'gateway_log_backfill'),
  ('5e528a85ab8046959dbadb0af64a2dd5b6dabb006e2c416872fca11501c5cd71', null, 'PACKETHUB-20211118-NYC', 'US', 'New York City', 'gateway_log_backfill'),
  ('61278ac973620c02124fb18ef83bb45f4a44a42d9ec830acfd47bbe58a9af1fc', null, 'Web sQuad Connect - CP1', 'ZA', 'Hermanus', 'gateway_log_backfill'),
  ('619546442f3abbd586ffc7d84bdd55bcd7bd76169e7467703222627e1b0ff4ef', null, '02 Online (uk)', 'GB', 'London', 'gateway_log_backfill'),
  ('6283c0b5b7651f9ea84a898f3db542ede58cd9cf7b87322674e27b49dc9ab212', null, 'AT&T Enterprises, LLC', 'US', 'San Ramon', 'gateway_log_backfill'),
  ('691b3879f437bd937d38d4f6ea1efe98c09f158702c4e522a868ef7cf66871a1', null, 'Pool for Broadband DSL customers', 'FR', 'Paris', 'gateway_log_backfill'),
  ('6b6df93ff29dc03794fb4c22448c4d48f719224153a5510a48064ccd708bf782', null, 'TPG Internet Pty Ltd.', 'AU', 'Brisbane', 'gateway_log_backfill'),
  ('6eb34c6d29901a3f03f68d718875eafa30f9444637d43fe9f12cb130d8bee180', null, 'Lyse Tele AS', 'NO', 'Oslo', 'gateway_log_backfill'),
  ('6f7e8e58ce3b1dcac5617db8773ebcaf8e96462ffc5af540a88904a1a67a3a5d', null, 'IP pools', 'GB', 'Westerleigh', 'gateway_log_backfill'),
  ('74a2c929575bc93d0f50f19ba7c916111649c24ae00eb0348bb0165dea82905a', null, 'STOKE', 'GB', 'Leeds', 'gateway_log_backfill'),
  ('74a6d5bed9c9a0312795c44d63c8c75382e0bc6fe969fded058a8b6bfd9b3bd4', null, 'Orange Mobile', 'PL', 'Warsaw', 'gateway_log_backfill'),
  ('783561cbfc2d9a457e9b2e3e0756e0cd01a126b1f14817d685dce5bca3e82541', null, 'IP pools', 'GB', 'Ditchling', 'gateway_log_backfill'),
  ('817c90a1486ffe858b51d306709831fe954f820f518466ecba26e86bc10aceda', null, 'British Telecommunications plc', 'GB', 'High Wycombe', 'gateway_log_backfill'),
  ('820e3ebf0ad538176eb5004d248b21f9139bd1e80cb018dd5acd1e9034bb87aa', null, 'Packethub Spain', 'ES', 'Barcelona', 'gateway_log_backfill'),
  ('82366861b54c9b8232a54ede5e6b5edc47d647c6bfca1efd703f1b6fa2f705a3', 8075, 'Microsoft Limited', 'US', 'Dulles Town Center', 'gateway_log_backfill'),
  ('82af668a7a18534d99c4544a3dbc052a997b71d3ae5ec44e5f5a2746595d17b9', null, 'AT&T Enterprises, LLC', 'US', 'Los Angeles', 'gateway_log_backfill'),
  ('82cbb5d563befea9c8f9e2c60254e3b04bf574e230047783382a20a7c82f2502', null, 'IP range assigned for VDF-IT customers', 'IT', 'Milan', 'gateway_log_backfill'),
  ('8970b1466949b9e8f55d3c29ae3dab1fbf1549ec99fdae711f22d003b42edb8f', null, 'UAB Bite Lietuva', 'DE', 'Berlin', 'gateway_log_backfill'),
  ('8986d2c3eba743d5123a17d386a441e5e9119f86cd8805918b629a6cf7dbfa19', null, 'Cyber Internet Services Pvt Ltd', 'PK', 'Lahore', 'gateway_log_backfill'),
  ('8b523e637a7a188b2c63b67888994fd8e233bd11c372203b4a5a7ba2f4297993', null, 'Infraestructura Red y Servicios IP', 'ES', 'Madrid', 'gateway_log_backfill'),
  ('8eeb2a7cad3e537ecd9fe9c92e2eff0a543df5e08bd68229c51ce7b077a1b831', null, 'Verizon Business', 'US', 'Charlotte', 'gateway_log_backfill'),
  ('94610fe2726eb2f993ae8c00b53e1737209deb959cae5ea8c81c2d8793f26bb4', null, 'DSL Service - Network', 'GB', 'Harmondsworth', 'gateway_log_backfill'),
  ('9505f018b04a3af724698107c7eafa29fde5587bfd88dbd88b718d90a932f957', null, 'One New Zealand Group Limited', 'NZ', 'Auckland', 'gateway_log_backfill'),
  ('96c3cdb7ee451fad465f3e010ae3c14c6c3eaa7ae0807127e5d2a851a52db906', null, 'GC customer P2P linknets', 'DK', 'Copenhagen', 'gateway_log_backfill'),
  ('97b3770fd8bf31c1b11228021940334346142d9f1a35e1ad6652e87045f97d94', null, 'TE Data', 'EG', 'Az-Zuhūr', 'gateway_log_backfill'),
  ('9822907b59c646fe039c8741c7e340f27695b70e1cfd619d9a4a85895d5d7560', null, 'Vodafone ISP', 'IE', 'Dublin', 'gateway_log_backfill'),
  ('98900a762c7db641819016d6b427a49048f2ff6b19ffc737f43ab869d4f0372a', 8075, 'Microsoft Corporation', 'US', 'Moses Lake', 'gateway_log_backfill'),
  ('9d9791454dc1f04609d4dcaed42276f18b5c25681f0a6b4df26584dc03d2af4b', null, 'Verizon Business', 'US', 'Lynbrook', 'gateway_log_backfill'),
  ('9da9e3eb9ffb59e6c4f95dc6b1f02306f64e868f344b9d379e846ec9a14c509c', null, 'HOTEL DEL CORONADO', 'US', 'Coronado', 'gateway_log_backfill'),
  ('9dfa4dd746c4ab5edac9e1d2c5269e4118810acec514b40ed1447c4bdf65b23e', 8075, 'Microsoft Corporation', 'US', 'Des Moines', 'gateway_log_backfill'),
  ('9f690ff5ab506b94b17da1ac5dcdbd4fb5cb98eea4741fce8c194ae633d4531f', null, 'Mobile Services', 'SE', 'Kista', 'gateway_log_backfill'),
  ('a0761a16ef017dceec2de71d99ecc3b8ef3e7dd46d85787f4573558b2498d8c3', null, 'Fixed IP (Static)', 'GB', 'London', 'gateway_log_backfill'),
  ('a2203e53e676ddeb69f3d2063c6a730444ccc3d474dd8d017e30f0c3baa7e954', null, 'Community Fibre Limited', 'GB', 'London', 'gateway_log_backfill'),
  ('a3cf00c4b9bf341a83e1c5bd0001de918e5beabf4b1127d10f150e28deb9d164', null, 'MobilePools', 'AT', 'Hirtenberg', 'gateway_log_backfill'),
  ('a3d4449c4b1ea8767f4779b0cf477efb205b95ac4f4ccaa817b06734a4eae433', null, 'Google LLC', 'US', 'Dallas', 'gateway_log_backfill'),
  ('ad53002a55fd8654abc373ad22f382527d459f79ea5027d860b58cf9751bc524', null, '2Connect Telecommunications Infrastructure & Network Services Ltd.', 'HU', 'Kartal', 'gateway_log_backfill'),
  ('adeec7d9693ece9eac75056a1a80afec930c27fb75d7cc20bd406b6f6ba588fc', null, 'SOUTH GYLE', 'GB', 'Adwick le Street', 'gateway_log_backfill'),
  ('ae33833bb2358cecfecbdebe36bb147a2da7a80687027018d4ea4e815867435c', null, 'ThePacific.net Ltd', 'NZ', 'Auckland', 'gateway_log_backfill'),
  ('ae4b219a3c0d21f0ce124789b15033b2dc9e3950908afcfbe0ceeed3ae1e4373', null, 'KPN B.V.', 'NL', 'Utrecht', 'gateway_log_backfill'),
  ('afd3611e622df7e078caa8664db68a39fa2d81921ef8ea76edf17b9ab0790f60', null, 'IP Pools', 'GB', 'Stockport', 'gateway_log_backfill'),
  ('b377e4c9c4197be88fedb83b013f583337b9643efb74d67132b77e81d1657b85', null, 'Comcast IP Services, L.L.C.', 'US', 'Santa Maria', 'gateway_log_backfill'),
  ('b898ec12496eaa942878694d1ed560e46e68108f5d995656d692ea259885b43c', null, 'DSL', 'FR', 'Paris', 'gateway_log_backfill'),
  ('b8bb1432b0acf5be22e44005b1b4dadecd7de65fc4c7e6b90d98d7967b4c59e5', null, 'SpaceX Services, Inc.', 'GB', 'London', 'gateway_log_backfill'),
  ('b8f3e39a6a79a86e6b1ba40e200c5854ba75047517a32e6da2fcd8771a83cd4a', null, 'DHCP 111 OD', 'IL', 'Kfar Saba', 'gateway_log_backfill'),
  ('b94a66eea57e06311b2bd658ad38277c13249330344be2342f653ea7f52df4f3', null, 'Converge ICT Network', 'PH', 'San Jose del Monte', 'gateway_log_backfill'),
  ('bbc2ea760c4abe58d826866c50b392207ee475f56ea565f2fc8a1a31180ba005', null, 'Telstra Limited', 'AU', 'Sydney', 'gateway_log_backfill'),
  ('bcea97b3bba508ef1d36318e6233d976ef769018c8b3e27c0e5bc6862ffe7f3e', null, 'Sky UK Limited', 'GB', 'London', 'gateway_log_backfill'),
  ('bf4c19f53b42fcd7baa63f405fd1bf89cfb4e60bbf4886fedaabb3de5afe6212', null, 'Dynamic allocations', 'NZ', 'Auckland', 'gateway_log_backfill'),
  ('bf99b765bc80ce243f925ca1526e8ff3eb3739fdb19bb0118985c6caeb46bcef', null, 'KDDI CORPORATION', 'JP', 'Obihiro', 'gateway_log_backfill'),
  ('c2e14d2a333fad833fcfde49bf70c43a6ac39ad4dbacd6c180f1d0307c41831e', null, 'Rogers Communications Canada Inc.', 'CA', 'Montréal', 'gateway_log_backfill'),
  ('c369525ebdbcb2fb339453faf0a86e7bef4c38569329dd55140ea8de88e5766a', null, 'INEA Sp. z o.o.', 'PL', 'Poznań', 'gateway_log_backfill'),
  ('c4d0056f032bf930dc95aa0f82de87f07d9bcf8c2093da547e802b2094e3a74f', null, 'Rogers Communications Canada Inc.', 'CA', 'Vancouver', 'gateway_log_backfill'),
  ('c944557fb578066f25fce867821274a89693ec4f885532ea052a3319c9313200', null, 'ORange FTTH User', 'ES', 'Barcelona', 'gateway_log_backfill'),
  ('c9ecad6a0999a6ed584ab1431df562750a5665e0fffea2cdfcbe83fd23553c94', null, 'Charter Communications Inc', 'US', 'Charlotte', 'gateway_log_backfill'),
  ('ca94f35eafe357d3851b4134c06745aa82b3a038eee8303ec8df2c2ce2f52778', null, 'AT&T Enterprises, LLC', 'US', 'Raleigh', 'gateway_log_backfill'),
  ('cd70f7e53bd8ac61607bae86e9138cd78e6d0a8eb175d6cde30d944ffd644e1c', null, 'SOUTH GYLE', 'GB', 'Adwick le Street', 'gateway_log_backfill'),
  ('d1f47e0e466b73f896bc78eb1729a52b4002183da56ac6cd5731b452c9a4a9ed', null, 'PPPoX Pool - rback4 milwwi.08012005-1822.532555', 'US', 'Miami', 'gateway_log_backfill'),
  ('d21daa2730a2a9e0bcd964a53620088d87c691a4d6a5300dd2224d3db390541d', 8075, 'Microsoft Corporation', 'US', 'Des Moines', 'gateway_log_backfill'),
  ('d23de68be63fed43da05e969472dd1ec00d5030e263068edc68b1ec73bab72d0', null, 'Verizon Business', 'US', 'New York City', 'gateway_log_backfill'),
  ('d5cc3d39874c9d7989ac5bb0fceb36b373607bec8291a7ea40bf136823cf9ca0', null, 'Viettel Group', 'VN', 'Hanoi', 'gateway_log_backfill'),
  ('d6ad2081ebd425c1001c260b294ec7a1d2963ef81b3f9c8f89cf80513e934dba', null, 'Lyse Tele AS', 'NO', 'Oslo', 'gateway_log_backfill'),
  ('d818fa3e301dff5a713525b29c3ca4074b15bb5bf76ef2b0e99063b53cd54e9c', 8075, 'Microsoft Corporation', 'US', 'Moses Lake', 'gateway_log_backfill'),
  ('db3e2192c52a969f91de06b6c1e75ef9e5f0267829e33f816c47fdb489edbc46', null, 'Emirates Integrated Telecommunications Company PJSC', 'AE', 'Dubai', 'gateway_log_backfill'),
  ('dc6aed7112b8733a2f8bece891d73f272fc9ce5c52cb92a86ed0f765a31ea627', null, 'EE Limited', 'GB', 'London', 'gateway_log_backfill'),
  ('df189e941980a4ca5a5716db66a11ef52bc0e5f1343587c9ea58e13b97a3e694', 8075, 'Microsoft Limited', 'US', 'Boydton', 'gateway_log_backfill'),
  ('e07a309dc09efbdb2af2971de6cf8d907892a2ed65ae1a7e81689e63b5ff57ae', null, 'IP pools', 'GB', 'London', 'gateway_log_backfill'),
  ('e1db18f23221057eb2ba0269d677f1b46b78ae6056fb50bcf576a573c8b74231', null, 'NET1C NETWORK', 'FR', 'Paris', 'gateway_log_backfill'),
  ('e22d46fb27d3e6c2ef9a5975c202dfc40d6095333a0059ec89df0029020e6485', null, 'Static Pool', 'AT', 'Sollenau', 'gateway_log_backfill'),
  ('e25f5ae4539b0ebdd56388d5a2d214b04d052d596954c61b99fc80740c83640f', null, 'Google Fiber Inc.', 'US', 'Kansas City', 'gateway_log_backfill'),
  ('e3cdad8dbb607e211b6989bbade28a6bfbd96ced254c6358395763e92fbd2802', null, 'PRIMETEL', 'CY', 'Larnaca', 'gateway_log_backfill'),
  ('e5c467b1872a91bf1f3b1eebf886344dc81ed845dcb9295a8bfa0766440504cf', null, 'Telstra Limited', 'AU', 'Brisbane', 'gateway_log_backfill'),
  ('ea41a358fa1a436d7712de24f2605b6c56dbb88d7572e00b8fb9ee822918db70', null, 'Telekom Deutschland GmbH', 'DE', 'Munich', 'gateway_log_backfill'),
  ('ec89d8c85548500ef7ec15b41cb6adc7796898a8e882469f8e3ec6f2b00e9821', null, 'Chiron Software LLC', 'US', 'Centreville', 'gateway_log_backfill'),
  ('f05ea25206223a65363db33af896429c24a96a0624d4d3d9ec56852a07576d30', null, 'Chiron Software LLC', 'US', 'Centreville', 'gateway_log_backfill'),
  ('f19faa531b784fd87fe6a95f87bd052a71e204c1ddbd04b4c8192128935845e7', null, 'SOUTH GYLE', 'GB', 'South Shields', 'gateway_log_backfill'),
  ('f225e05a1dc5916b524bbbee7354ce36bb0f6e6e4aa12be2ad6330358c2ca6a2', null, 'eircom Ltd', 'IE', 'Rathkeale', 'gateway_log_backfill'),
  ('f2977953774f53cc64bc4b11378c6cd6180a07c8b7c16e0ff4055fbc181ce8ca', null, 'AT&T Enterprises, LLC', 'US', 'Jackson', 'gateway_log_backfill'),
  ('f889f3ddd40543055d6369c40bef174ddaf036c3156181a520b017cb010b9bdf', null, 'Orange Moldova Network', 'MD', 'Chisinau', 'gateway_log_backfill'),
  ('f9282499859e10de4cca2c286b69626bbbfaebe713c6e1480d33b1f04545f18d', null, 'Origin Internet', 'AU', 'Sydney', 'gateway_log_backfill'),
  ('fdd40003d9cb8d5e90de0cee4bb0cab6f45bad614181204825e2c0d40105c7b5', 8075, 'Microsoft Limited', 'US', 'Boydton', 'gateway_log_backfill'),
  ('feb424ff3ba51f0532c5e3e6e4f71fceba9a10ea675e0828dccc4d8c58e2f9df', null, 'Pakistan Telecommuication company limited', 'PK', 'Lahore', 'gateway_log_backfill'),
  ('ffe9625a0b336b1e0a3c3b13b677b41c3a4c703200332a1c875ac6c63cdcdf3b', null, 'DSL', 'FR', 'Paris', 'gateway_log_backfill')
on conflict (ip_hash) do nothing;

update public.scan_opens so set net_asn = n.asn, net_org = n.org
  from public.open_networks n where n.ip_hash = so.ip_hash and (so.net_asn, so.net_org) is distinct from (n.asn, n.org);
select public.reclassify_opens('-infinity');
select public.open_release_grant();
