-- 20261102 one-touch own-post engagers, part 4 (Sol r3 #2): who is owed the lane's held DM1, with the "already has a DM /
-- wrote back" and "first-degree window closed" exclusions applied BEFORE the limit, so drafted or expired rows can never
-- hide an owed one. Reader: Own Post Engager Logger 'Promote Seat Engagers' (accept + recovery pass).
begin;

create or replace function public.own_engager_dm_owed(p_campaign uuid, p_max_age_days integer)
 returns table(id uuid, name text, company text, connection_sent_at timestamptz, enrichment_data jsonb)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $f$
  select p.id, p.name, p.company, p.connection_sent_at, p.enrichment_data
  from outreach_prospects p
  where p.campaign_id = p_campaign
    and p.enrichment_data->>'lane' = 'own_post_engager'
    and p.blacklisted = false and p.stage = 'connected' and p.connected_at is not null
    and p.last_dm_sent_at is null and p.last_reply_at is null and coalesce(p.reply_count, 0) = 0
    and (p.connection_sent_at is not null
         or (p.enrichment_data->'own_engager'->>'first_degree' = 'true'
             and p.enrichment_data->>'engaged_at' ~ '^\d{4}-\d{2}-\d{2}'
             and (p.enrichment_data->>'engaged_at')::timestamptz + make_interval(days => p_max_age_days) > clock_timestamp()))
    and not exists (select 1 from outreach_messages m
                     where m.prospect_id = p.id
                       and (m.direction = 'inbound' or m.message_type in ('dm', 'inmail', 'manual_reply')))
  order by p.connected_at, p.id
  limit 100
$f$;
revoke all on function public.own_engager_dm_owed(uuid, integer) from public, anon, authenticated;
grant execute on function public.own_engager_dm_owed(uuid, integer) to service_role;

commit;
