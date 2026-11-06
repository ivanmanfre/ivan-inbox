-- Rollback for 20261106_booking_card_offered_slot.sql. Run only when no swishdm row exists in inbox_calendar_bookings.
drop function if exists public.inbox_booking_card_commit(uuid,uuid,text,text,timestamptz);
create or replace function public.inbox_calendar_claim(p_prospect uuid,p_client text,p_request uuid,p_start timestamptz,p_email text,p_timezone text)
returns boolean language plpgsql set search_path=public as $$
declare p public.outreach_prospects; cid text; n integer;
begin
  select * into p from outreach_prospects where id=p_prospect for update;
  if not found or p.call_booked_at is not null or coalesce(p.blacklisted,false)
    or p.stage in ('archived','skipped','disqualified','unsubscribed','blacklisted') or p.skip_reason is not null then return false; end if;
  select client_id into cid from outreach_campaigns where id=p.campaign_id;
  if cid is distinct from p_client or cid not in ('risedtc','arch') then return false; end if;
  if p_start <= now()+interval '1 hour' or p_start > now()+interval '31 days'
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or not exists(select 1 from pg_timezone_names where name=p_timezone) then return false; end if;
  insert into inbox_calendar_bookings(request_id,prospect_id,campaign_id,client_id,start_at,end_at,email,timezone)
  values(p_request,p_prospect,p.campaign_id,p_client,p_start,p_start+interval '30 minutes',p_email,p_timezone)
  on conflict do nothing;
  get diagnostics n=row_count;
  return n=1;
end $$;
revoke all on function public.inbox_calendar_claim(uuid,text,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.inbox_calendar_claim(uuid,text,uuid,timestamptz,text,text) to service_role;
alter table public.inbox_calendar_bookings drop constraint if exists inbox_calendar_bookings_client_id_check;
alter table public.inbox_calendar_bookings add constraint inbox_calendar_bookings_client_id_check check (client_id in ('risedtc','arch'));
