-- A new outreach restarts the rolling 30-day pause for post reactions on Ivan's seat.
begin;
set local lock_timeout = '3s';
create or replace function public.ivan_engager_last_outreach(p_prospect uuid, p_provider text, p_url text, p_now timestamptz)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select max(greatest(case when p.connection_sent_at <= p_now then p.connection_sent_at end,
    (select max(m.sent_at) from public.outreach_messages m where m.prospect_id = p.id
       and m.direction = 'outbound' and m.sent_at <= p_now and not coalesce(m.is_reaction, false))))
  from public.prospect_engaged_ivan_prospects(p_prospect, p_provider, p_url) x
  join public.outreach_prospects p on p.id = x.prospect_id
$$;
revoke all on function public.ivan_engager_last_outreach(uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.ivan_engager_last_outreach(uuid,text,text,timestamptz) to service_role;

create or replace function public.ivan_contacted_post_reactor(
  p_kind text, p_prospect uuid, p_provider text, p_url text, p_now timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(nullif(lower(p_kind), ''), 'reaction') <> 'reaction' then false
    else coalesce(public.ivan_engager_last_outreach(p_prospect, p_provider, p_url, p_now)
                  >= p_now - interval '30 days', false) end
$$;

do $patch$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    -- Calculate the pause once per contacted prospect with signals, not once for every post like.
    ('public.inbox_interest_cards()',
     $old$    -- This list already requires a sent DM/InMail and a signal later than that send.
    and (coalesce(nullif(lower(e.engagement_type), ''), 'reaction') <> 'reaction' or not exists (
      select 1 from public.outreach_prospects owner join public.outreach_campaigns camp on camp.id = owner.campaign_id
      where owner.id = e.prospect_id and coalesce(camp.client_id, 'ivan') = 'ivan'
    ))$old$, ''),
    ('public.inbox_interest_cards()',
     $old$after as (
  select s.prospect_id,$old$,
     $new$recent_ivan_contacts as materialized (
  select p.id from last_out o join public.outreach_prospects p on p.id = o.prospect_id
  join public.outreach_campaigns c on c.id = p.campaign_id
  where coalesce(c.client_id, 'ivan') = 'ivan'
    and (o.sent_at between now() - interval '30 days' and now()
         or public.ivan_contacted_post_reactor('reaction', p.id, p.linkedin_profile_id, p.linkedin_url, now()))
),
after as (
  select s.prospect_id,$new$),
    ('public.inbox_interest_cards()',
     $old$where s.kind <> 'view' or s.at >= o.sent_at + interval '72 hours' or v.profile_return$old$,
     $new$where (s.kind <> 'view' or s.at >= o.sent_at + interval '72 hours' or v.profile_return)
    and (s.kind <> 'reaction' or s.prospect_id not in (select id from recent_ivan_contacts))$new$),
    -- An old like notice that outreach has already dealt with must not add another 90 days to the pause.
    -- Exact engagements still deduplicate; the first fresh notice after the pause starts normal alert spacing again.
    ('public.prospect_engaged_candidates(timestamptz,timestamptz)',
     $old$a.person_key = ev.pkey and a.alerted_at > p_now - interval '90 days')$old$,
     $new$a.person_key = ev.pkey and a.alerted_at > p_now - interval '90 days'
                 and (ev.engagement_type is distinct from 'reaction' or a.payload #>> '{media,engagement}' is distinct from 'reaction'
                      or a.alerted_at > coalesce(public.ivan_engager_last_outreach(ev.prospect_id, ev.provider_id, ev.linkedin_url, p_now)
                                                  + interval '30 days', '-infinity'::timestamptz)))$new$)
  ) as changes(signature, before_text, after_text)
  loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if array_length(string_to_array(definition, change.before_text), 1) <> 2 then
      raise exception 'Review changed definition of %', change.signature;
    end if;
    execute replace(definition, change.before_text, change.after_text);
  end loop;
end
$patch$;
commit;
