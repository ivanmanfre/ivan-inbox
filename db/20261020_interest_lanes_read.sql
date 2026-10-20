-- Additive, read-only Lanes projection. A campaign is never an interest source:
-- ARCH's Cold campaign contains competitor engagers, while RISE's Warm campaign
-- contains hiring rows. Classify each person from provenance instead.
create view public.inbox_interest_prospects_v with (security_invoker=on) as
select p.*, coalesce(c.client_id, 'ivan') as client_id, s.source_lane,
  p.enrichment_data->>'copy_vertical' as copy_vertical
from public.outreach_prospects p
join public.outreach_campaigns c on c.id=p.campaign_id
cross join lateral (select case
  when coalesce(c.client_id,'ivan')='ivan' then case
    when p.trigger_type='profile_view' or p.enrichment_data->>'source'='profile_view' then 'profile_view'
    when p.trigger_type='content_signal' then 'content_signal'
    when p.trigger_type in ('engaged_post','content_engagement') then
      case when p.enrichment_data->>'lane'='own_post_engager'
        or p.enrichment_data->>'source_kind'='own_post_engager'
        or p.enrichment_data->>'source'='own_post_engager'
        then 'own_post_engager' else 'competitor_engager' end
    end
  when c.client_id='risedtc' then case
    when p.enrichment_data->>'source'='profile_view' then 'profile_view'
    when p.enrichment_data->>'source'='rise_warm_engager'
      and p.enrichment_data->>'engagement_kind' in ('reaction','comment')
      and nullif(p.enrichment_data->>'post_id','') is not null
      and nullif(p.enrichment_data->>'anchor','') is not null then 'competitor_engager'
    when p.enrichment_data->>'source' like 'competitor_engager_%' then 'competitor_engager'
    end
  when c.client_id='arch' then case
    when p.enrichment_data->>'source_kind'='profile_view_warm' then 'profile_view'
    when p.enrichment_data->>'source_kind'='own_post_engager' then 'own_post_engager'
    when p.enrichment_data->>'source_kind' in ('competitor_post_engager','pilot_anchor_post_engager') then 'competitor_engager'
    when p.enrichment_data->>'source_kind'='hand_raise' then 'content_signal'
    end
  when c.client_id='swishdm' and p.enrichment_data->>'source'='swishdm_anchor_engager' then 'competitor_engager'
  end as source_lane) s
where s.source_lane is not null;
grant select on public.inbox_interest_prospects_v to authenticated;
-- INTEREST_PROJECTION_END

-- The campaign cards are replaced with source cards. Counts are grouped by the
-- prospect's classified source, including mixed campaigns.
create view public.inbox_interest_perf_v with (security_invoker=on) as
with msg as (
  select distinct on (m.prospect_id,m.direction,m.message_text,coalesce(m.sent_at,m.created_at))
    p.client_id,p.source_lane,m.prospect_id,m.direction,m.message_type,m.reply_intent,
    coalesce(m.sent_at,m.created_at) at
  from public.outreach_messages m
  join public.inbox_interest_prospects_v p on p.id=m.prospect_id
  where coalesce(m.sent_at,m.created_at)>=now()-interval '7 days'
    and ((m.direction='outbound' and m.sent_at is not null) or m.direction='inbound')
    and coalesce(p.skip_reason,'')<>'inbound_vendor_pitch'
  order by m.prospect_id,m.direction,m.message_text,coalesce(m.sent_at,m.created_at),m.id
), m7 as (
  select client_id,source_lane,
    count(*) filter(where direction='outbound' and message_type<>'connection_note') dms_7d,
    count(distinct prospect_id) filter(where direction='inbound') replied_7d,
    count(distinct prospect_id) filter(where direction='inbound' and reply_intent in ('positive','soft_yes','info_ask','booking')) positive_7d,
    max(at) filter(where direction='outbound') last_send
  from msg group by client_id,source_lane
), p7 as (
  select client_id,source_lane,
    count(*) filter(where connection_sent_at>=now()-interval '7 days') invites_7d,
    count(*) filter(where connection_sent_at>=now()-interval '7 days' and connection_sent_at<=now()-interval '72 hours') accept_judged,
    count(*) filter(where connection_sent_at>=now()-interval '7 days' and connection_sent_at<=now()-interval '72 hours'
      and connected_at>=connection_sent_at and connected_at<=connection_sent_at+interval '72 hours') accept_72h,
    count(*) filter(where call_booked_at>=now()-interval '7 days') calls_7d,
    count(*) filter(where call_booked_at>=now()-interval '30 days') calls_30d,
    max(connection_sent_at) last_invite
  from public.inbox_interest_prospects_v
  where connection_sent_at>=now()-interval '7 days' or call_booked_at>=now()-interval '30 days'
  group by client_id,source_lane
), keys as (
  select client_id,source_lane from p7 union select client_id,source_lane from m7
)
select k.client_id,k.source_lane,coalesce(p7.invites_7d,0) invites_7d,
  coalesce(m7.dms_7d,0) dms_7d,coalesce(m7.replied_7d,0) replied_7d,
  coalesce(m7.positive_7d,0) positive_7d,coalesce(p7.calls_7d,0) calls_7d,
  coalesce(p7.calls_30d,0) calls_30d,coalesce(p7.accept_judged,0) accept_judged,
  coalesce(p7.accept_72h,0) accept_72h,greatest(m7.last_send,p7.last_invite) last_send
from keys k left join p7 using(client_id,source_lane) left join m7 using(client_id,source_lane);
grant select on public.inbox_interest_perf_v to authenticated;

-- Refill and outgoing pace use exactly the same classified people as stock.
create view public.inbox_interest_replacement_v with (security_invoker=on) as
with qualified as (
  select p.client_id,p.source_lane,
    case when p.client_id='arch' then
      coalesce(p.enrichment_data->>'promoted_at',case when p.enrichment_data->>'reviewed_ok'='true' then p.enrichment_data->>'reviewed_at' end)::timestamptz
    else p.scored_at end as qualified_at
  from public.inbox_interest_prospects_v p
  where coalesce(p.blacklisted,false)=false and case
    when p.client_id='ivan' then p.scored_at>=now()-interval '30 days' and p.icp_score>=6
    when p.client_id='arch' then p.skip_state is null and
      coalesce(p.enrichment_data->>'promoted_at',case when p.enrichment_data->>'reviewed_ok'='true' then p.enrichment_data->>'reviewed_at' end) is not null
    when p.client_id='risedtc' then p.scored_at>=now()-interval '30 days'
      and p.enrichment_data->>'rise_note_final' is not null
      and (coalesce(p.enrichment_data#>>'{name_gate,status}','') in ('auto_armed','armed_by_ivan')
        or coalesce(p.enrichment_data#>>'{name_gate,prior,status}','') in ('auto_armed','armed_by_ivan')
        or p.stage in ('connection_sent','connected','dm_sent','replied'))
    else false end
  union all
  select p.client_id,p.source_lane,min(m.approved_at) qualified_at
  from public.inbox_interest_prospects_v p join public.outreach_messages m on m.prospect_id=p.id
  where p.client_id='swishdm' and coalesce(p.blacklisted,false)=false
    and m.direction='outbound' and m.message_type='connection_note' and m.approved_at is not null
  group by p.id,p.client_id,p.source_lane
), inflow as (
  select client_id,source_lane as lane,qualified_at::date as day,count(*) as qualified_in
  from qualified where qualified_at>=now()-interval '30 days' group by client_id,source_lane,qualified_at::date
), sent as (
  select distinct on (m.prospect_id,m.message_text,m.sent_at) m.prospect_id,m.sent_at
  from public.outreach_messages m
  where m.direction='outbound' and m.message_type='connection_note'
    and m.sent_at>=now()-interval '30 days'
  order by m.prospect_id,m.message_text,m.sent_at,m.id
), outflow as (
  select p.client_id,p.source_lane as lane,s.sent_at::date as day,count(*) as sent_out
  from sent s join public.inbox_interest_prospects_v p on p.id=s.prospect_id
  group by p.client_id,p.source_lane,s.sent_at::date
)
select coalesce(i.client_id,o.client_id) as client_id,coalesce(i.lane,o.lane) as lane,
  coalesce(i.day,o.day) as day,coalesce(i.qualified_in,0) as qualified_in,coalesce(o.sent_out,0) as sent_out
from inflow i full join outflow o using(client_id,lane,day);
grant select on public.inbox_interest_replacement_v to authenticated;

-- Source-scoped first-touch cohorts. Historical messages remain intact.
create or replace function public.inbox_interest_rate_comparison(p_from date, p_to date)
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
    select distinct on (p.client_id,m.prospect_id,m.message_type)
      p.client_id cid, m.prospect_id,
      p.source_lane,
      case when m.message_type='connection_note' then 'invitation' else 'dm' end ch,
      m.sent_at, p.connected_at
    from public.outreach_messages m
    join public.inbox_interest_prospects_v p on p.id=m.prospect_id
    where p.client_id in ('ivan','arch','risedtc','swishdm')
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
    order by p.client_id,m.prospect_id,m.message_type,m.sent_at,m.id
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
    from (values ('ivan'::text),('arch'),('risedtc'),('swishdm')) c(cid)
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
revoke all on function public.inbox_interest_rate_comparison(date,date) from public,anon;
grant execute on function public.inbox_interest_rate_comparison(date,date) to authenticated,service_role;
