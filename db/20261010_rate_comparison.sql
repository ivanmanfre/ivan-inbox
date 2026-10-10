-- Read-only first-invite / first-DM cohorts for picked Warsaw calendar dates.
-- The preceding period contains the same number of calendar days. Only first
-- touches with a complete 72h observation window enter either rate.
begin;
create or replace function public.inbox_rate_comparison(p_from date, p_to date)
returns table(client_id text, period text, period_from date, period_to date,
  lane text, channel text, people bigint, mature bigint, pending bigint,
  outcomes bigint, rate_pct numeric)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  as_of timestamptz := statement_timestamp();
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id='ivan' and auth.uid()=any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from>p_to
    or p_to>(as_of at time zone 'Europe/Warsaw')::date then
    raise exception 'invalid_dates' using errcode='22023';
  end if;
  return query
  with periods(period, d0, d1) as (
    values ('current'::text,p_from,p_to),
      ('previous'::text,p_from-(p_to-p_from+1),p_from-1)
  ), bounds as (
    select w.*, w.d0::timestamp at time zone 'Europe/Warsaw' t0,
      (w.d1+1)::timestamp at time zone 'Europe/Warsaw' t1 from periods w
  ), first_touches as materialized (
    -- Read first touches from all history before filtering dates, so follow-ups
    -- and retries cannot turn an old recipient into a new period's denominator.
    select distinct on (coalesce(c.client_id,'ivan'),m.prospect_id,m.message_type)
      coalesce(c.client_id,'ivan') cid, m.prospect_id,
      coalesce(nullif(c.name,''),'No lane recorded') source_lane,
      case when m.message_type='connection_note' then 'invitation' else 'dm' end ch,
      m.sent_at, p.connected_at
    from public.outreach_messages m
    join public.outreach_prospects p on p.id=m.prospect_id
    join public.outreach_campaigns c on c.id=p.campaign_id
    where coalesce(c.client_id,'ivan') in ('ivan','arch','risedtc')
      and m.direction='outbound' and not coalesce(m.is_reaction,false)
      and m.message_type in ('connection_note','dm')
      and coalesce(m.channel,'linkedin') in ('linkedin','linkedin_dm')
      and m.sent_at is not null and m.sent_at<=as_of
      and ((m.message_type='dm' and nullif(btrim(m.unipile_message_id),'') is not null)
        or (m.message_type='connection_note' and exists (
          -- Invitation confirmation uses the monitor's reconciled success log,
          -- within +/-10 minutes. Invitations do not have DM receipt IDs.
          select 1 from public.outreach_engagement_log e
          where e.prospect_id=m.prospect_id and e.action_type='connection_request'
            and e.success is true and e.created_at between
              m.sent_at-interval '10 minutes' and m.sent_at+interval '10 minutes'
        )))
      and m.send_blocked_at is null and nullif(btrim(m.send_blocked_reason),'') is null
    order by coalesce(c.client_id,'ivan'),m.prospect_id,m.message_type,m.sent_at,m.id
  ), scored as materialized (
    select f.*, b.period,
      f.sent_at<=as_of-interval '72 hours' eligible,
      case when f.ch='invitation' then
        f.connected_at>=f.sent_at and f.connected_at<=f.sent_at+interval '72 hours'
      else exists (
        select 1 from public.outreach_messages r
        where r.prospect_id=f.prospect_id and r.direction='inbound'
          and coalesce(r.message_type,'dm') not in ('email','email_reply','inmail','connection_note')
          and not coalesce(r.is_reaction,false) and nullif(btrim(r.message_text),'') is not null
          and coalesce(r.channel,'linkedin') in ('linkedin','linkedin_dm')
          and coalesce(r.sent_at,r.created_at)>f.sent_at
          and coalesce(r.sent_at,r.created_at)<=f.sent_at+interval '72 hours'
          and coalesce(r.sent_at,r.created_at)<=as_of
      ) end hit
    from first_touches f join bounds b on f.sent_at>=b.t0 and f.sent_at<b.t1
  ), groups as (
    select s.cid,s.source_lane,s.ch,s.period,count(*) n,
      count(*) filter(where s.eligible) mature_n,
      count(*) filter(where s.eligible and s.hit) hits
    from scored s group by s.cid,s.source_lane,s.ch,s.period
    union all
    select s.cid,'__all__',s.ch,s.period,count(*),
      count(*) filter(where s.eligible),count(*) filter(where s.eligible and s.hit)
    from scored s group by s.cid,s.ch,s.period
  ), keys as (
    select c.cid,'__all__'::text source_lane,ch.ch
    from (values ('ivan'::text),('arch'),('risedtc')) c(cid)
    cross join (values ('invitation'::text),('dm')) ch(ch)
    union select g.cid,g.source_lane,g.ch from groups g
  )
  select k.cid,b.period,b.d0,b.d1,k.source_lane,k.ch,
    coalesce(g.n,0),coalesce(g.mature_n,0),coalesce(g.n-g.mature_n,0),coalesce(g.hits,0),
    round(100.0*g.hits/nullif(g.mature_n,0),1)
  from keys k cross join bounds b left join groups g
    on g.cid=k.cid and g.source_lane=k.source_lane and g.ch=k.ch and g.period=b.period
  order by k.cid,k.ch,k.source_lane,b.period;
end;
$$;
revoke all on function public.inbox_rate_comparison(date,date) from public,anon;
grant execute on function public.inbox_rate_comparison(date,date) to authenticated,service_role;
commit;
