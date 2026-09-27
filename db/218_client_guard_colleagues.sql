-- 218: COLLEAGUES of a booked person are never cold-messaged (Ivan ruling 2026-09-28 on the 217 report).
-- When anyone at a company books a call with the seat owner (any booking_attributions row of that client, any
-- verdict, or any prospect of that client with call_booked_at), every OTHER prospect of that client at the same
-- company is blocked from cold sends. Company match, in order: exact company domain (company_domain / email domain /
-- booker email domain / booker website, never a free-mail domain), then exact normalized company name (>= 4 chars,
-- and only when the two rows' domains do not disagree), or exact company LinkedIn URL. Never fuzzy.
-- Reason text: "colleague of <name>, who booked a call". Live conversations are never parked (sweep + trigger skip
-- them; cold_send_guard passes them) - client_guard_colleague_warm() lists them for a human instead.

create or replace function public._bk_company_li(u text) returns text
language sql immutable as $$
  select nullif(lower((regexp_match(coalesce(u, ''), 'linkedin\.com/company/([^/?#]+)', 'i'))[1]), '')
$$;
create or replace function public._bk_company_slug(s text) returns text
language sql immutable as $$
  select case when length(regexp_replace(lower(coalesce(s, '')), '[^a-z0-9]', '', 'g')) >= 4
              then regexp_replace(lower(s), '[^a-z0-9]', '', 'g') end
$$;

-- booked people of a client, one row per company key, kept in a small table so the per-prospect check is an
-- indexed lookup (computing it per row timed out). Refreshed by the booking triggers and at the start of every sweep.
create table if not exists public.client_guard_booked_keys (
  client_id text not null, booked_prospect_id uuid, who text, kind text not null, key text not null
);
create index if not exists client_guard_booked_keys_idx on public.client_guard_booked_keys (client_id, kind, key);

create or replace function public.client_guard_booked_refresh(p_tenant text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from client_guard_booked_keys where p_tenant is null or client_id = p_tenant;
  insert into client_guard_booked_keys (client_id, booked_prospect_id, who, kind, key)
  with free as (select array['gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','live.com','msn.com','icloud.com',
                             'me.com','aol.com','proton.me','protonmail.com','gmx.com','ymail.com','mail.com'] a),
  src as (
    select b.client_id, b.prospect_id, coalesce(bp.name, b.booker_name, b.booker_email) as who,
           array[_bk_host(bp.company_domain), _bk_email_domain(bp.email), _bk_email_domain(b.booker_email), _bk_host(b.booker_website)] as d,
           _bk_company_slug(bp.company) as cslug, _bk_company_li(bp.company_linkedin_url) as cli
      from booking_attributions b left join outreach_prospects bp on bp.id = b.prospect_id
     where b.client_id in ('arch','risedtc') and (p_tenant is null or b.client_id = p_tenant)
    union all
    select c.client_id, p.id, p.name, array[_bk_host(p.company_domain), _bk_email_domain(p.email)], _bk_company_slug(p.company), _bk_company_li(p.company_linkedin_url)
      from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
     where c.client_id in ('arch','risedtc') and (p_tenant is null or c.client_id = p_tenant) and p.call_booked_at is not null
  )
  select distinct s.client_id, s.prospect_id, s.who, 'dom', x from src s, free, unnest(s.d) x where x is not null and not (x = any(free.a))
  union select distinct s.client_id, s.prospect_id, s.who, 'slug', s.cslug from src s where s.cslug is not null
  union select distinct s.client_id, s.prospect_id, s.who, 'li', s.cli from src s where s.cli is not null;
  get diagnostics n = row_count;
  return n;
end $$;

-- the domains of a booked prospect (for the "names only match when the domains do not disagree" rule)
create or replace function public._client_guard_booked_doms(p_tenant text, p_booked uuid, p_who text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(key), '{}') from client_guard_booked_keys
   where client_id = p_tenant and kind = 'dom' and booked_prospect_id is not distinct from p_booked and who is not distinct from p_who
$$;

create or replace function public._client_guard_colleague(p_tenant text, p_id uuid, p_email text, p_company_domain text,
  p_company text, p_company_linkedin_url text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  free text[] := array['gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','live.com','msn.com','icloud.com',
                       'me.com','aol.com','proton.me','protonmail.com','gmx.com','ymail.com','mail.com'];
  mydoms text[]; myslug text := _bk_company_slug(p_company); myli text := _bk_company_li(p_company_linkedin_url); v text;
begin
  if p_tenant is null or p_tenant not in ('arch','risedtc') then return null; end if;
  mydoms := array(select x from unnest(array[_bk_host(p_company_domain), _bk_email_domain(p_email)]) x where x is not null and not (x = any(free)));
  -- 1. exact company domain
  select k.who into v from client_guard_booked_keys k
   where k.client_id = p_tenant and k.kind = 'dom' and k.key = any(mydoms) and k.booked_prospect_id is distinct from p_id limit 1;
  -- 2. exact company LinkedIn URL
  if v is null and myli is not null then
    select k.who into v from client_guard_booked_keys k
     where k.client_id = p_tenant and k.kind = 'li' and k.key = myli and k.booked_prospect_id is distinct from p_id limit 1;
  end if;
  -- 3. exact normalized company name, only when the two rows' domains do not disagree
  if v is null and myslug is not null then
    select k.who into v from client_guard_booked_keys k
     where k.client_id = p_tenant and k.kind = 'slug' and k.key = myslug and k.booked_prospect_id is distinct from p_id
       and (coalesce(array_length(mydoms, 1), 0) = 0
            or coalesce(array_length(_client_guard_booked_doms(p_tenant, k.booked_prospect_id, k.who), 1), 0) = 0
            or _client_guard_booked_doms(p_tenant, k.booked_prospect_id, k.who) && mydoms)
     limit 1;
  end if;
  if v is not null then return 'colleague of ' || v || ', who booked a call'; end if;
  return null;
end $$;

-- the shared check now carries the company LinkedIn URL too
create or replace function public._client_guard_core8(p_tenant text, p_id uuid, p_email text, p_company_domain text,
  p_company text, p_linkedin_url text, p_linkedin_profile_id text, p_company_linkedin_url text) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  r := _client_guard_core(p_tenant, p_id, p_email, p_company_domain, p_company, p_linkedin_url, p_linkedin_profile_id);
  if r is not null then return r; end if;
  return _client_guard_colleague(p_tenant, p_id, p_email, p_company_domain, p_company, p_company_linkedin_url);
end $$;

create or replace function public.client_guard_reason(p_prospect_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p.id is null then 'prospect_not_found'
              else _client_guard_core8(c.client_id, p.id, p.email, p.company_domain, p.company, p.linkedin_url, p.linkedin_profile_id, p.company_linkedin_url) end
    from (select 1) one
    left join outreach_prospects p on p.id = p_prospect_id
    left join outreach_campaigns c on c.id = p.campaign_id
$$;

create or replace function public.trg_client_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text; r text;
begin
  if coalesce(new.blacklisted, false) or coalesce(new.reply_count, 0) > 0 or new.call_booked_at is not null then return new; end if;
  select client_id into t from outreach_campaigns where id = new.campaign_id;
  if t is null or t not in ('arch','risedtc') then return new; end if;
  r := _client_guard_core8(t, new.id, new.email, new.company_domain, new.company, new.linkedin_url, new.linkedin_profile_id, new.company_linkedin_url);
  if r is not null then
    new.blacklisted := true; new.skip_state := 'manual_skip';
    new.skip_state_reason := left('client_guard: ' || r, 300); new.skip_state_at := now(); new.send_priority := 0;
  end if;
  return new;
end $$;
drop trigger if exists trg_client_guard on public.outreach_prospects;
create trigger trg_client_guard before insert or update of email, company_domain, company, company_linkedin_url, linkedin_url, linkedin_profile_id, campaign_id
  on public.outreach_prospects for each row execute function public.trg_client_guard();

-- sweep: optional narrowing to one company (domain / slug / company LinkedIn) for the booking triggers
drop function if exists public.client_guard_sweep(text, text, text, boolean);
create or replace function public.client_guard_sweep(p_client text default null, p_email text default null, p_domain text default null,
  p_dry_run boolean default false, p_company_slug text default null, p_company_li text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rec record; out jsonb := '[]'::jsonb; n int := 0;
begin
  if p_email is null and p_domain is null and p_company_slug is null and p_company_li is null then perform client_guard_booked_refresh(p_client); end if;
  for rec in
    select p.id, p.name, p.company, c.client_id,
           _client_guard_core8(c.client_id, p.id, p.email, p.company_domain, p.company, p.linkedin_url, p.linkedin_profile_id, p.company_linkedin_url) as r
      from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
     where c.client_id in ('arch','risedtc') and (p_client is null or c.client_id = p_client)
       and coalesce(p.blacklisted, false) = false and coalesce(p.reply_count, 0) = 0 and p.call_booked_at is null
       and not exists (select 1 from outreach_messages m where m.prospect_id = p.id and m.direction = 'inbound')
       and (p_email is null or lower(btrim(p.email)) = lower(p_email))
       and (p_domain is null or _bk_host(p.company_domain) = lower(p_domain) or _bk_email_domain(p.email) = lower(p_domain))
       and (p_company_slug is null or _bk_company_slug(p.company) = p_company_slug)
       and (p_company_li is null or _bk_company_li(p.company_linkedin_url) = p_company_li)
  loop
    if rec.r is null then continue; end if;
    n := n + 1;
    out := out || jsonb_build_object('id', rec.id, 'name', rec.name, 'company', rec.company, 'client', rec.client_id, 'reason', rec.r);
    if not p_dry_run then
      update outreach_prospects set blacklisted = true, skip_state = 'manual_skip',
             skip_state_reason = left('client_guard: ' || rec.r, 300), skip_state_at = now(), send_priority = 0
       where id = rec.id and coalesce(blacklisted, false) = false;
    end if;
  end loop;
  return jsonb_build_object('parked', n, 'dry_run', p_dry_run, 'rows', out);
end $$;
revoke all on function public.client_guard_sweep(text, text, text, boolean, text, text) from public, anon, authenticated;

-- colleagues swept the moment a booking lands (only that company's rows, so a tracker upsert stays fast)
create or replace function public._client_guard_sweep_company(p_client text, p_prospect_id uuid, p_booker_email text, p_booker_website text)
returns void language plpgsql security definer set search_path = public as $$
declare bp record; d text;
begin
  if p_client is null or p_client not in ('arch','risedtc') then return; end if;
  perform client_guard_booked_refresh(p_client);
  if p_booker_email is not null then perform client_guard_sweep(p_client, p_booker_email, null, false); end if;
  select company_domain, email, company, company_linkedin_url into bp from outreach_prospects where id = p_prospect_id;
  for d in select distinct x from unnest(array[_bk_email_domain(p_booker_email), _bk_host(p_booker_website), _bk_host(bp.company_domain), _bk_email_domain(bp.email)]) x
            where x is not null and x not in ('gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','live.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','gmx.com') loop
    perform client_guard_sweep(p_client, null, d, false);
  end loop;
  if _bk_company_slug(bp.company) is not null then perform client_guard_sweep(p_client, null, null, false, _bk_company_slug(bp.company)); end if;
  if _bk_company_li(bp.company_linkedin_url) is not null then perform client_guard_sweep(p_client, null, null, false, null, _bk_company_li(bp.company_linkedin_url)); end if;
end $$;

create or replace function public.trg_client_guard_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _client_guard_sweep_company(new.client_id, new.prospect_id, new.booker_email, new.booker_website);
  return null;
end $$;
drop trigger if exists trg_client_guard_booking on public.booking_attributions;
create trigger trg_client_guard_booking after insert or update of booker_email, verdict, prospect_id on public.booking_attributions
  for each row execute function public.trg_client_guard_booking();

create or replace function public.trg_client_guard_booked_prospect() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select client_id into c from outreach_campaigns where id = new.campaign_id;
  perform _client_guard_sweep_company(c, new.id, null, null);
  return null;
end $$;
drop trigger if exists trg_client_guard_booked_prospect on public.outreach_prospects;
create trigger trg_client_guard_booked_prospect after update of call_booked_at on public.outreach_prospects
  for each row when (old.call_booked_at is null and new.call_booked_at is not null)
  execute function public.trg_client_guard_booked_prospect();

-- warm colleagues: already in a conversation, so never parked; listed for a human
create or replace function public.client_guard_colleague_warm(p_client text default null)
returns table (client_id text, prospect_id uuid, name text, company text, reason text, last_reply_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.client_id, p.id, p.name, p.company,
         _client_guard_colleague(c.client_id, p.id, p.email, p.company_domain, p.company, p.company_linkedin_url), p.last_reply_at
    from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
   where c.client_id in ('arch','risedtc') and (p_client is null or c.client_id = p_client)
     and coalesce(p.blacklisted, false) = false and p.call_booked_at is null
     and (coalesce(p.reply_count, 0) > 0 or exists (select 1 from outreach_messages m where m.prospect_id = p.id and m.direction = 'inbound'))
     and _client_guard_colleague(c.client_id, p.id, p.email, p.company_domain, p.company, p.company_linkedin_url) is not null
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'client-guard-sweep';
select cron.schedule('client-guard-sweep', '40 * * * *', 'select public.client_guard_sweep(null, null, null, false)');
