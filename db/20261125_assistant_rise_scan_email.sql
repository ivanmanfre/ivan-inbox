-- Fixed to Mattan's seat. This is evidence for an operator read, never a send queue.
begin;
create or replace function public.assistant_rise_scan_email(p_as_of timestamptz default now())
returns table (
  inbound_id uuid, prospect_id uuid, person text, company text, asked_at timestamptz,
  address text, address_count integer, sender text, request_signal text,
  disposition text, report_url text, email_at timestamptz, email_report_at timestamptz,
  linkedin_report_at timestamptz
)
language sql stable security invoker set search_path = public, pg_temp
as $fn$
with candidates as (
  select m.id as inbound_id, p.id as prospect_id, p.name, p.company, p.company_domain,
    coalesce(m.sent_at, m.created_at) as asked_at, a.address, a.address_count, m.message_text,
    case when p.blacklisted then 'blacklisted'
      when p.call_booked_at is not null then 'booked'
      when p.solved_at is not null then 'solved'
      when p.stage in ('disqualified','booked','closed','unsubscribed') then p.stage
      when p.skip_state is not null and p.skip_state not in ('', 'none') then p.skip_state
      else null end as disposition
  from public.outreach_campaigns c
  join public.outreach_prospects p on p.campaign_id = c.id
  join public.outreach_messages m on m.prospect_id = p.id
  cross join lateral (
    select min(lower(hit[1])) as address, count(distinct lower(hit[1]))::int as address_count
    from regexp_matches(m.message_text,'([A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,})','gi') hit
  ) a
  where c.client_id = 'risedtc' and m.direction = 'inbound' and not coalesce(m.is_reaction,false)
    and coalesce(m.sent_at,m.created_at) between p_as_of - interval '28 days' and p_as_of
    and a.address_count > 0 and exists (
      select 1 from public.outreach_messages o where o.prospect_id=p.id and o.direction='outbound'
        and o.sent_at between coalesce(m.sent_at,m.created_at)-interval '14 days' and coalesce(m.sent_at,m.created_at)
        and o.message_text ~* '(growth scan|scan (on|of|for|we)|send (over )?the scan)'
    )
), identity as (
  select value::jsonb->'risedtc'->>'from' as sender from public.integration_config
  where key='outreach_email_identities'
)
select i.inbound_id, i.prospect_id, i.name::text, i.company::text, i.asked_at, i.address, i.address_count,
  (select sender from identity),
  case when i.message_text ~* '(e-?mail|send).{0,40}(growth scan|scan report|the scan)' then 'mentions_sending_scan'
    when i.message_text ~* 'e-?mail.{0,20}(my |our |the )?team' then 'asks_to_email_team'
    when i.message_text ~* 'e-?mail.{0,25}details' then 'asks_to_email_details'
    when prior.direction='inbound' and prior.message_text ~* '(love to see|please send|send it|yes please|please do)' then 'address_after_acceptance_phrase'
    else 'address_after_scan_offer' end,
  i.disposition::text, r.report_url, sent.email_at, sent.email_report_at, sent.linkedin_report_at
from candidates i
left join lateral (
  select pm.direction, pm.message_text from public.outreach_messages pm where pm.prospect_id=i.prospect_id
    and coalesce(pm.sent_at,pm.created_at) < i.asked_at
    and coalesce(pm.sent_at,pm.created_at) >= i.asked_at - interval '15 minutes'
  order by coalesce(pm.sent_at,pm.created_at) desc, pm.id desc limit 1
) prior on true
left join lateral (
  -- Prefer a report tied to this person. Domain-only reports are eligible only when unassigned.
  -- Conflicting report slugs at equal specificity leave the intended artifact unknown.
  select case when count(distinct url)=1 then min(url) end report_url from (
    select rtrim(s.scan_url,'/') as url,dense_rank() over(order by (s.prospect_id is not null) desc) as specificity
    from public.rise_scan_requests s
    where s.board_slug in ('rise-reply','rise-inmail') and s.status='ready'
      and coalesce(s.finished_at,s.updated_at) <= p_as_of
      and s.scan_url ~ '^https://resources[.]risedtc[.]com/scan/[a-zA-Z0-9_-]+/?$'
      and (s.prospect_id=i.prospect_id or (s.prospect_id is null and lower(s.domain)=lower(i.company_domain)))
  ) ranked where specificity=1
) r on true
left join lateral (
  select max(d.sent_at) filter (where d.channel='email') as email_at,
    max(d.sent_at) filter (where d.channel='email' and matches.correct) as email_report_at,
    max(d.sent_at) filter (where coalesce(d.channel,'linkedin')='linkedin' and matches.correct) as linkedin_report_at
  from public.outreach_messages d
  cross join lateral (select exists (
    select 1 from regexp_matches(d.message_text,
      $re$(^|[[:space:]<("'])(https://resources[.]risedtc[.]com/scan/[a-zA-Z0-9_-]+)/?(?=$|[[:space:]?#<>"(),]|[.]([[:space:]]|$))$re$,'g') hit
    where hit[2]=r.report_url
  ) as correct) matches
  where d.prospect_id=i.prospect_id and d.direction='outbound' and d.sent_at between i.asked_at and p_as_of
    and (coalesce(d.channel,'linkedin')='linkedin' or
      (d.channel='email' and i.address_count=1 and lower(trim(d.recipient_email))=i.address))
) sent on true
order by i.asked_at desc,i.inbound_id;
$fn$;
revoke all on function public.assistant_rise_scan_email(timestamptz) from public, anon, authenticated;
grant execute on function public.assistant_rise_scan_email(timestamptz) to service_role;
commit;
