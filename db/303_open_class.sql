-- 303 open tracking truth, part 1: class columns, network tables, pure classifiers.
-- Plan: ~/.claude/docs/superpowers/plans/2026-11-17-open-tracking-truth.md, Task 2.
-- Proven 2026-11-17 (read-only): 39% of non-owner scan opens since 10-01 come from a link checker on Microsoft's
-- network (AS8075) a median 56 s after a LinkedIn send; 35% are our own headless tools; 26% are people.
-- This file only adds columns, two tables and two pure functions. No reader changes, nothing rings.

create table if not exists public.open_known_networks (
  asn int primary key,
  open_class text not null check (open_class in ('link_scanner', 'own_tool')),
  label text not null
);
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
  add column if not exists open_class text check (open_class in ('owner', 'own_tool', 'link_scanner', 'human')),
  add column if not exists class_reason text,
  add column if not exists classified_at timestamptz;
create index if not exists scan_opens_ip_hash_opened_idx on public.scan_opens (ip_hash, opened_at);
create index if not exists scan_opens_human_slug_opened_idx on public.scan_opens (lower(company_slug), opened_at)
  where open_class = 'human';

alter table public.page_opens
  add column if not exists open_class text check (open_class in ('owner', 'own_tool', 'link_scanner', 'human')),
  add column if not exists class_reason text,
  add column if not exists classified_at timestamptz;

-- First match wins. The order is the algorithm (plan Task 2 table).
create or replace function public.scan_open_classify(
  p_is_owner boolean, p_user_agent text, p_referrer_host text, p_device_type text,
  p_net_asn int, p_fleet boolean, p_near_li_send boolean)
returns table (open_class text, class_reason text)
language sql stable set search_path = public, pg_temp as $$
  with x as (
    select coalesce(p_referrer_host, '') ilike '%linkedin%' or coalesce(p_user_agent, '') ilike '%LinkedInApp%' as from_li,
           coalesce(p_user_agent, '') ~* 'headless|bot|crawler|spider|preview|prerender|lighthouse' as tool_ua,
           (select k.open_class from public.open_known_networks k where k.asn = p_net_asn) as net_class
  ), r as (
    select case
      when coalesce(p_is_owner, false) then 'owner:owner_flag_or_ip'
      when x.tool_ua then 'own_tool:tool_user_agent'
      when x.net_class = 'own_tool' then 'own_tool:own_network'
      when coalesce(p_fleet, false) and x.from_li then 'owner:seat_owner_ip_on_3_plus_scans'
      when coalesce(p_fleet, false) then 'link_scanner:ip_on_3_plus_scans'
      when x.from_li then 'human:linkedin_referrer'
      when x.net_class = 'link_scanner' then 'link_scanner:scanner_network'
      when p_net_asn is null and p_device_type = 'desktop' and nullif(p_referrer_host, '') is null
           and coalesce(p_near_li_send, false) then 'link_scanner:unknown_network_after_send'
      else 'human:default' end as v
    from x)
  select split_part(r.v, ':', 1), split_part(r.v, ':', 2) from r
$$;

create or replace function public.page_open_classify(p_is_external boolean, p_org text, p_user_agent text, p_fleet boolean)
returns table (open_class text, class_reason text)
language sql stable set search_path = public, pg_temp as $$
  with r as (
    select case
      when not coalesce(p_is_external, false) then 'owner:own_country'
      when coalesce(p_user_agent, '') ~* 'headless|bot|crawler|spider|preview|prerender|lighthouse'
           or p_user_agent = 'Mozilla/5.0' then 'own_tool:tool_user_agent'
      when coalesce(p_org, '') ~* '^microsoft' then 'link_scanner:scanner_network'
      when coalesce(p_fleet, false) then 'owner:network_on_3_plus_pages'
      else 'human:default' end as v)
  select split_part(r.v, ':', 1), split_part(r.v, ':', 2) from r
$$;
