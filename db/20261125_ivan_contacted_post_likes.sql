-- A post like is a prospecting signal until Ivan has actually reached out.
begin;
set local lock_timeout = '3s';

create or replace function public.ivan_contacted_post_reactor(
  p_kind text, p_prospect uuid, p_provider text, p_url text, p_now timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(nullif(lower(p_kind), ''), 'reaction') <> 'reaction' then false else exists (
    select 1
    from public.prospect_engaged_ivan_prospects(p_prospect, p_provider, p_url) x
    join public.outreach_prospects p on p.id = x.prospect_id
    where p.connection_sent_at <= p_now or exists (
      select 1 from public.outreach_messages m where m.prospect_id = p.id
        and m.direction = 'outbound' and m.sent_at <= p_now and not coalesce(m.is_reaction, false)
    )
  ) end
$$;
revoke all on function public.ivan_contacted_post_reactor(text,uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.ivan_contacted_post_reactor(text,uuid,text,text,timestamptz) to service_role;

-- Patch the current readers in place so unrelated signal, seat and delivery rules stay intact.
do $patch$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('public.inbox_interest_cards()',
     $old$where e.prospect_id is not null and coalesce(e.first_seen_at, e.last_seen_at) >= now() - interval '21 days'$old$,
     $new$where e.prospect_id is not null and coalesce(e.first_seen_at, e.last_seen_at) >= now() - interval '21 days'
    -- This list already requires a sent DM/InMail and a signal later than that send.
    and (coalesce(nullif(lower(e.engagement_type), ''), 'reaction') <> 'reaction' or not exists (
      select 1 from public.outreach_prospects owner join public.outreach_campaigns camp on camp.id = owner.campaign_id
      where owner.id = e.prospect_id and coalesce(camp.client_id, 'ivan') = 'ivan'
    ))$new$),
    ('public.prospect_engaged_candidates(timestamptz,timestamptz)',
     'else public.prospect_engaged_block(ev.prospect_id, ev.provider_id, ev.linkedin_url, p_now)',
     $new$when public.ivan_contacted_post_reactor(ev.engagement_type, ev.prospect_id, ev.provider_id, ev.linkedin_url, p_now)
             then 'already contacted'
           else public.prospect_engaged_block(ev.prospect_id, ev.provider_id, ev.linkedin_url, p_now)$new$),
    ('public.content_result_alerts_run(timestamptz)',
     'else public.prospect_engaged_block(r.prospect_id, r.provider_id, r.linkedin_url, p_now) end;',
     $new$when public.ivan_contacted_post_reactor(r.payload #>> '{media,engagement}', r.prospect_id, r.provider_id, r.linkedin_url, p_now)
                      then 'already contacted'
                    else public.prospect_engaged_block(r.prospect_id, r.provider_id, r.linkedin_url, p_now) end;$new$)
  ) as changes(signature, before_text, after_text)
  loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if strpos(definition, change.after_text) > 0 then continue; end if;
    if array_length(string_to_array(definition, change.before_text), 1) <> 2 then
      raise exception 'Review changed definition of %', change.signature;
    end if;
    execute replace(definition, change.before_text, change.after_text);
  end loop;
end
$patch$;

-- Retire unread reaction notices this rule would suppress now, using the original engagement identity.
update public.inbox_notifications n set dismissed_at = now()
from public.post_engagers e
where n.family = 'prospect_engaged' and n.source = 'content-result-alerts'
  and n.read_at is null and n.dismissed_at is null
  and n.media->>'engagement' = 'reaction' and n.media->>'engager_id' = e.id::text
  and public.ivan_contacted_post_reactor(e.engagement_type, e.prospect_id, e.provider_id, e.linkedin_url, now());
commit;
