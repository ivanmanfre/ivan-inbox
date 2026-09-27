-- 217: never cold-message an existing client or someone who already met the seat owner (2026-09-27).
-- Michelle Kim (m'Chel Haircare, mchel.co) had three RISE onboarding meetings with Mattan (23 Jul, 7 Aug, 16 Sep)
-- and the warm engager engine still sent her a cold invite on 23 Sep.
--
-- One reason function, three enforcement points:
--   * client_guard_reason(prospect)  -> text reason or null (tenant = outreach_campaigns.client_id; arch/risedtc only)
--       1. existing-client roster = the EXISTING keys (never a parallel list, per the 09-21 ruling):
--          RISE rise_do_not_target (domain entries exact on company/email domain; name entries exact on the
--          normalized company, >=4 chars, never a substring), ARCH arch_company_exclusions CLIENT entries (reason
--          arch_client*/arch_own_company, slug exact) and arch_person_exclusions own-team entries (LinkedIn slug exact)
--       2. meeting history (booking_attributions of that client): the same person (email / LinkedIn slug / LinkedIn id
--          of another booked row), or ANY person at the domain of a meeting the engine did not source (the seat owner's
--          own relationship: Michelle's onboarding calls are 'unattributed' bookings on michelle@mchel.co).
--          Free-mail domains never domain-match. The booking's own prospect row is never blocked by its own booking.
--   * trigger on outreach_prospects: a pre-conversation row (no reply, no booking) that hits a reason is parked the
--     same way the ARCH insert guard parks a ledger hit (blacklisted, skip_state manual_skip, reason stamped); every
--     sender already filters blacklisted and the ARCH dispatch gate re-reads it right before each send
--   * cold_send_guard(prospect) for the RISE send nodes to call right before a cold send (fail closed on any error)
--   * sweeps: when a booking lands (that booker's email/domain) and when the roster key changes; daily backstop

create or replace function public._client_guard_core(p_tenant text, p_id uuid, p_email text, p_company_domain text,
  p_company text, p_linkedin_url text, p_linkedin_profile_id text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v text; dom text := _bk_host(p_company_domain); edom text := _bk_email_domain(p_email);
  cslug text := nullif(regexp_replace(lower(coalesce(p_company, '')), '[^a-z0-9]', '', 'g'), '');
  lslug text := li_slug(p_linkedin_url);
  lid text := nullif(btrim(coalesce(p_linkedin_profile_id, '')), '');
  free text[] := array['gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','live.com','msn.com','icloud.com',
                       'me.com','aol.com','proton.me','protonmail.com','gmx.com','ymail.com','mail.com'];
begin
  if p_tenant is null or p_tenant not in ('arch','risedtc') then return null; end if;
  if dom = any(free) then dom := null; end if;
  if edom = any(free) then edom := null; end if;
  -- 1. existing-client roster (existing keys)
  if p_tenant = 'risedtc' then
    select x into v
      from jsonb_array_elements_text(coalesce((select value::jsonb from integration_config where key = 'rise_do_not_target'), '[]'::jsonb)) x
     where (position('.' in x) > 0 and lower(btrim(x)) in (dom, edom))
        or (position('.' in x) = 0 and length(regexp_replace(lower(x), '[^a-z0-9]', '', 'g')) >= 4
            and regexp_replace(lower(x), '[^a-z0-9]', '', 'g') = cslug)
     limit 1;
    if v is not null then return 'existing_client (rise_do_not_target: ' || v || ')'; end if;
  else
    select e->>'name' into v
      from jsonb_array_elements(coalesce((select value::jsonb->'companies' from integration_config where key = 'arch_company_exclusions'), '[]'::jsonb)) e
     where cslug is not null and e->>'slug' = cslug
       and (coalesce(e->>'reason', '') ilike 'arch_client%' or e->>'reason' = 'arch_own_company') limit 1;   -- CLIENTS only; the rest of the ledger is already enforced by the ARCH senders' own gate
    if v is not null then return 'existing_client (arch_company_exclusions: ' || v || ')'; end if;
    select e->>'name' into v
      from jsonb_array_elements(coalesce((select value::jsonb->'people' from integration_config where key = 'arch_person_exclusions'), '[]'::jsonb)) e
     where lslug is not null and lower(e->>'slug') = lslug and e->>'reason' = 'arch_own_employee' limit 1;
    if v is not null then return 'arch_own_team (' || v || ')'; end if;
  end if;
  -- 2. meeting history with the seat owner
  select coalesce(b.booker_name, b.booker_email) || ' ' || to_char(b.meeting_start at time zone 'UTC', 'DD Mon YYYY') into v
    from booking_attributions b
   where b.client_id = p_tenant
     and b.prospect_id is distinct from p_id
     and (
       (p_email is not null and b.booker_email is not null and lower(btrim(b.booker_email)) = lower(btrim(p_email)))
       or (b.prospect_id is not null and exists (select 1 from outreach_prospects bp where bp.id = b.prospect_id
             and ((lslug is not null and li_slug(bp.linkedin_url) = lslug) or (lid is not null and bp.linkedin_profile_id = lid))))
       or (b.verdict = 'unattributed' and _bk_email_domain(b.booker_email) is not null
           and not (_bk_email_domain(b.booker_email) = any(free))
           and _bk_email_domain(b.booker_email) in (dom, edom))
     )
   order by b.meeting_start desc nulls last limit 1;
  if v is not null then return 'met_seat_owner (' || v || ')'; end if;
  return null;
end $$;

create or replace function public.client_guard_reason(p_prospect_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p.id is null then 'prospect_not_found'
              else _client_guard_core(c.client_id, p.id, p.email, p.company_domain, p.company, p.linkedin_url, p.linkedin_profile_id) end
    from (select 1) one
    left join outreach_prospects p on p.id = p_prospect_id
    left join outreach_campaigns c on c.id = p.campaign_id
$$;

-- The send-time gate. "Cold" = the prospect has never written to us; a live conversation is never blocked here.
-- Callers FAIL CLOSED: an error, a missing row or ok<>true means do not send.
create or replace function public.cold_send_guard(p_prospect_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record; tenant text; r text;
begin
  select pr.id, pr.blacklisted, pr.call_booked_at, oc.client_id into p
    from outreach_prospects pr left join outreach_campaigns oc on oc.id = pr.campaign_id where pr.id = p_prospect_id;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'prospect_not_found'); end if;
  tenant := p.client_id;
  -- only the two client seats are in scope; Ivan's own lane keeps its existing gates unchanged
  if tenant is null or tenant not in ('arch','risedtc') then return jsonb_build_object('ok', true, 'cold', null, 'client', tenant, 'scope', 'out_of_scope'); end if;
  -- a conversation (they wrote to us) is never blocked here, not even on a parked row: a hand reply must still go out
  if exists (select 1 from outreach_messages m where m.prospect_id = p.id and m.direction = 'inbound' and coalesce(m.is_reaction, false) = false) then
    return jsonb_build_object('ok', true, 'cold', false, 'client', tenant);
  end if;
  if coalesce(p.blacklisted, false) then return jsonb_build_object('ok', false, 'cold', true, 'reason', 'blacklisted', 'client', tenant); end if;
  if p.call_booked_at is not null then return jsonb_build_object('ok', false, 'reason', 'call_booked', 'client', tenant); end if;
  r := client_guard_reason(p.id);
  return jsonb_build_object('ok', r is null, 'cold', true, 'client', tenant, 'reason', r);
end $$;

-- ---- enforcement 1: park pre-conversation rows at write time ----
create or replace function public.trg_client_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text; r text;
begin
  if coalesce(new.blacklisted, false) or coalesce(new.reply_count, 0) > 0 or new.call_booked_at is not null then return new; end if;
  select client_id into t from outreach_campaigns where id = new.campaign_id;
  if t is null or t not in ('arch','risedtc') then return new; end if;
  r := _client_guard_core(t, new.id, new.email, new.company_domain, new.company, new.linkedin_url, new.linkedin_profile_id);
  if r is not null then
    new.blacklisted := true;
    new.skip_state := 'manual_skip';
    new.skip_state_reason := left('client_guard: ' || r, 300);
    new.skip_state_at := now();
    new.send_priority := 0;
  end if;
  return new;
end $$;

drop trigger if exists trg_client_guard on public.outreach_prospects;
create trigger trg_client_guard before insert or update of email, company_domain, company, linkedin_url, linkedin_profile_id, campaign_id
  on public.outreach_prospects for each row execute function public.trg_client_guard();

-- ---- enforcement 2: sweeps ----
-- p_dry_run = true lists what would be parked and writes nothing.
create or replace function public.client_guard_sweep(p_client text default null, p_email text default null, p_domain text default null,
  p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rec record; out jsonb := '[]'::jsonb; n int := 0;
begin
  for rec in
    select p.id, p.name, p.company, c.client_id,
           _client_guard_core(c.client_id, p.id, p.email, p.company_domain, p.company, p.linkedin_url, p.linkedin_profile_id) as r
      from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
     where c.client_id in ('arch','risedtc') and (p_client is null or c.client_id = p_client)
       and coalesce(p.blacklisted, false) = false and coalesce(p.reply_count, 0) = 0 and p.call_booked_at is null
       and not exists (select 1 from outreach_messages m where m.prospect_id = p.id and m.direction = 'inbound')
       and (p_email is null or lower(btrim(p.email)) = lower(p_email))
       and (p_domain is null or _bk_host(p.company_domain) = lower(p_domain) or _bk_email_domain(p.email) = lower(p_domain))
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

create or replace function public.trg_client_guard_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_id in ('arch','risedtc') and new.booker_email is not null then
    perform client_guard_sweep(new.client_id, new.booker_email, null, false);
    if new.verdict = 'unattributed' then perform client_guard_sweep(new.client_id, null, _bk_email_domain(new.booker_email), false); end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_client_guard_booking on public.booking_attributions;
create trigger trg_client_guard_booking after insert or update of booker_email, verdict on public.booking_attributions
  for each row execute function public.trg_client_guard_booking();

create or replace function public.trg_client_guard_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'rise_do_not_target' then perform client_guard_sweep('risedtc', null, null, false);
  elsif new.key in ('arch_company_exclusions','arch_person_exclusions') then perform client_guard_sweep('arch', null, null, false);
  end if;
  return null;
end $$;
drop trigger if exists trg_client_guard_roster on public.integration_config;
create trigger trg_client_guard_roster after insert or update of value on public.integration_config
  for each row when (new.key in ('rise_do_not_target','arch_company_exclusions','arch_person_exclusions'))
  execute function public.trg_client_guard_roster();

revoke all on function public.client_guard_sweep(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.cold_send_guard(uuid) to service_role;
grant execute on function public.client_guard_reason(uuid) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'client-guard-sweep';
select cron.schedule('client-guard-sweep', '40 5 * * *', 'select public.client_guard_sweep(null, null, null, false)');
