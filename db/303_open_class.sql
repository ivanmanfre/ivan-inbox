-- 303 open tracking truth, part 1: class columns, network tables, pure classifiers.
-- Plan: ~/.claude/docs/superpowers/plans/2026-11-17-open-tracking-truth.md, Task 2.
-- Proven 2026-11-17 (read-only): 39% of non-owner scan opens since 10-01 come from a link checker on Microsoft's
-- network (AS8075) a median 56 s after a LinkedIn send; 35% are our own headless tools; 26% are people.
-- This file only adds columns, two tables and two pure functions. No reader changes, nothing rings.
--
-- Round 2 (cross-review 2026-11-17, rulings A-D): an open is suppressed only on POSITIVE evidence. A network alone,
-- a failed lookup alone or a shared address alone never is. Missing evidence = a person.
-- Round 3 (rulings P1-P7): three states. `human`; `suspect` (unresolved: kept, counted apart, never rings, alerts or
-- feeds a draft); and the confirmed classes link_scanner / own_tool / owner, each needing its own proof. Whether an
-- open may feed automation is a separate column (`eligible`), granted only at a fresh row's first label (or once by
-- the release backfill), never by a relabel.

create table if not exists public.open_known_networks (
  asn int primary key,
  open_class text not null check (open_class in ('link_scanner', 'own_tool')),
  label text not null
);
-- Reference list (daily check). The classifier reads only the link_scanner rows, and only together with behaviour.
insert into public.open_known_networks (asn, open_class, label) values
  (8075, 'link_scanner', 'Microsoft network, LinkedIn link checker'),
  (400940, 'own_tool', 'Railway, our builder')
on conflict (asn) do nothing;

-- ip_hash -> network. Never a raw IP.
create table if not exists public.open_networks (
  ip_hash text primary key,
  asn int,
  org text,
  country_code text,
  city text,
  source text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.open_known_networks enable row level security;
alter table public.open_networks enable row level security;
revoke all on public.open_networks, public.open_known_networks from anon, authenticated;

alter table public.scan_opens
  add column if not exists net_asn int,
  add column if not exists net_org text,
  add column if not exists view text not null default 'main',
  add column if not exists open_class text check (open_class in ('owner', 'own_tool', 'link_scanner', 'human', 'suspect')),
  add column if not exists class_reason text,
  add column if not exists classified_at timestamptz,
  -- an outbound message (any channel) carrying this link went out in the 15 minutes before the open (stored so an
  -- address can be confirmed as the scanner from its own rows)
  add column if not exists near_send boolean,
  -- may feed automation (evidence RPCs, cards, rings, SwishDM "opened"). Ruling P6: set true only at the FIRST label of a
  -- fresh row that is human, or once by open_release_grant(); a relabel may set it false and never true.
  add column if not exists eligible boolean not null default false;
create index if not exists scan_opens_ip_hash_opened_idx on public.scan_opens (ip_hash, opened_at);
create index if not exists scan_opens_human_slug_opened_idx on public.scan_opens (lower(company_slug), opened_at)
  where open_class = 'human';

-- ip_hash: the page tracker's address, hashed with its own salt before it reaches us (null when it has none).
alter table public.page_opens
  add column if not exists ip_hash text,
  add column if not exists open_class text check (open_class in ('owner', 'own_tool', 'link_scanner', 'human', 'suspect')),
  add column if not exists class_reason text,
  add column if not exists classified_at timestamptz,
  add column if not exists near_send boolean,
  add column if not exists eligible boolean not null default false;
create index if not exists page_opens_ip_hash_created_idx on public.page_opens (ip_hash, created_at) where ip_hash is not null;

-- Microsoft network: AS8075 (any link_scanner ASN on the reference list), or an organization naming Microsoft
-- when the ASN is unknown (gateway-log seed rows, page opens).
create or replace function public.open_is_microsoft(p_asn int, p_org text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    case when p_asn is not null
         then exists (select 1 from public.open_known_networks k where k.asn = p_asn and k.open_class = 'link_scanner')
         else coalesce(p_org, '') ~* 'microsoft' end, false)
$$;

-- Positive human evidence: the visitor arrived from linkedin.com or inside the LinkedIn app (ruling P4).
create or replace function public.open_from_linkedin(p_referrer text, p_user_agent text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_referrer, '') ilike '%linkedin%' or coalesce(p_user_agent, '') ilike '%LinkedInApp%'
$$;

-- May feed a draft (evidence RPCs, cards, SwishDM "opened"): a person AND granted eligibility (ruling P6).
drop function if exists public.open_is_signal(text, text);
create or replace function public.open_is_signal(p_class text, p_eligible boolean)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_class = 'human' and p_eligible, false)
$$;

-- May ring the owner or raise an alert: a signal whose network is known (ruling P5: an unknown network never rings or
-- alerts, whatever the reason).
drop function if exists public.open_may_ring(text, text);
create or replace function public.open_may_ring(p_class text, p_eligible boolean, p_net_known boolean)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_class = 'human' and p_eligible and p_net_known, false)
$$;

-- First match wins. The order is the algorithm (rulings P2-P5).
--   p_burst:        this address opened 3+ distinct scans inside 10 minutes (this row included).
--   p_near_send:    an outbound message (any channel) carrying this link went out in the 15 minutes before.
--   p_addr_scanner: this address, on the Microsoft network, opened 3+ DIFFERENT scans with no LinkedIn referrer, each
--                   within 15 minutes after a message carrying that scan's link (one recipient is never 3 prospects).
--   p_addr_egress:  5+ owner-flagged rows on this address within 7 days either side of this row (our dedicated egress).
--   p_addr_owner:   this address carried an owner flag on some other row, at any time.
--   p_many_scans:   this address appears on 8+ different scans, any period.
-- Confirmed classes first (owner flag, tool, egress, confirmed scanner), then the suspect reasons in P3 order, then
-- human. A LinkedIn referrer is never burst / microsoft_after_send / microsoft_uncorroborated (P4).
drop function if exists public.scan_open_classify(boolean, text, text, text, int, text, boolean, boolean, boolean, boolean);
create or replace function public.scan_open_classify(
  p_is_owner boolean, p_user_agent text, p_referrer_host text, p_device_type text, p_net_asn int, p_net_org text,
  p_burst boolean, p_near_send boolean, p_addr_scanner boolean, p_addr_egress boolean, p_addr_owner boolean,
  p_many_scans boolean)
returns table (open_class text, class_reason text)
language sql stable set search_path = public, pg_temp as $$
  with x as (
    select public.open_from_linkedin(p_referrer_host, p_user_agent) as li,
           coalesce(p_user_agent, '') ~* 'headless|bot|crawler|spider|preview|prerender|lighthouse' as tool_ua,
           public.open_is_microsoft(p_net_asn, p_net_org) as ms
  ), r as (
    select case
      when coalesce(p_is_owner, false) then 'owner:owner_flag_or_ip'
      when x.tool_ua then 'own_tool:tool_user_agent'
      when coalesce(p_addr_egress, false) then 'owner:dedicated_egress'
      when x.ms and not x.li and coalesce(p_addr_scanner, false) then 'link_scanner:confirmed_scanner_address'
      when coalesce(p_many_scans, false) then 'suspect:many_scans'
      when coalesce(p_addr_owner, false) then 'suspect:owner_address'
      when x.ms and not x.li and coalesce(p_near_send, false) then 'suspect:microsoft_after_send'
      when not x.li and coalesce(p_burst, false) then 'suspect:burst'
      when x.ms and not x.li then 'suspect:microsoft_uncorroborated'
      when x.li then 'human:linkedin_referrer'
      when p_net_asn is null and nullif(p_net_org, '') is null then 'human:network_unknown'
      else 'human:default' end as v
    from x)
  select split_part(r.v, ':', 1), split_part(r.v, ':', 2) from r
$$;

-- Page opens (shared pages, SwishDM reports). Own-country is the page tracker's long-standing owner flag (Ivan in
-- Poland). Pages carry an organization but no ASN. A row with no address hash cannot use the address rules; for it
-- only, p_burst_no_address = same organization + city + user agent on 3+ different pages inside 10 minutes.
drop function if exists public.page_open_classify(boolean, text, text, text, boolean, boolean, boolean, boolean);
create or replace function public.page_open_classify(
  p_is_external boolean, p_org text, p_user_agent text, p_referrer text,
  p_burst boolean, p_burst_no_address boolean, p_near_send boolean, p_addr_scanner boolean, p_addr_egress boolean,
  p_addr_owner boolean, p_many_pages boolean)
returns table (open_class text, class_reason text)
language sql stable set search_path = public, pg_temp as $$
  with x as (
    select public.open_from_linkedin(p_referrer, p_user_agent) as li,
           public.open_is_microsoft(null, p_org) as ms
  ), r as (
    select case
      when not coalesce(p_is_external, false) then 'owner:own_country'
      when coalesce(p_user_agent, '') ~* 'headless|bot|crawler|spider|preview|prerender|lighthouse'
           or p_user_agent = 'Mozilla/5.0' then 'own_tool:tool_user_agent'
      when coalesce(p_addr_egress, false) then 'owner:dedicated_egress'
      when x.ms and not x.li and coalesce(p_addr_scanner, false) then 'link_scanner:confirmed_scanner_address'
      when coalesce(p_many_pages, false) then 'suspect:many_scans'
      when coalesce(p_addr_owner, false) then 'suspect:owner_address'
      when x.ms and not x.li and coalesce(p_near_send, false) then 'suspect:microsoft_after_send'
      when not x.li and coalesce(p_burst, false) then 'suspect:burst'
      when x.ms and not x.li then 'suspect:microsoft_uncorroborated'
      when not x.li and coalesce(p_burst_no_address, false) then 'suspect:burst_no_address'
      when x.li then 'human:linkedin_referrer'
      when nullif(p_org, '') is null then 'human:network_unknown'
      else 'human:default' end as v
    from x)
  select split_part(r.v, ':', 1), split_part(r.v, ':', 2) from r
$$;

-- Pure helpers, but not for the public key (finding 6): only the definer functions and the service role call them.
revoke all on function public.open_is_microsoft(int, text) from public, anon, authenticated;
revoke all on function public.open_from_linkedin(text, text) from public, anon, authenticated;
revoke all on function public.open_may_ring(text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.open_is_signal(text, boolean) from public, anon, authenticated;
revoke all on function public.scan_open_classify(boolean, text, text, text, int, text, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.page_open_classify(boolean, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.open_is_microsoft(int, text) to service_role;
grant execute on function public.open_from_linkedin(text, text) to service_role;
grant execute on function public.open_may_ring(text, boolean, boolean) to service_role;
grant execute on function public.open_is_signal(text, boolean) to service_role;
grant execute on function public.scan_open_classify(boolean, text, text, text, int, text, boolean, boolean, boolean, boolean, boolean, boolean) to service_role;
grant execute on function public.page_open_classify(boolean, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to service_role;
