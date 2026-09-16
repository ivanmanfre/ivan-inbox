create table outreach_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null, client_id text,
  is_active boolean default true, archived boolean default false);
create table outreach_prospects (
  id uuid primary key default gen_random_uuid(), campaign_id uuid references outreach_campaigns(id),
  country text, enrichment_data jsonb default '{}'::jsonb, last_reply_at timestamptz);
create table outreach_messages (
  id uuid primary key default gen_random_uuid(), prospect_id uuid references outreach_prospects(id),
  direction text not null, message_type text default 'dm', channel text, sequence_step int,
  sent_at timestamptz, ai_model text, replies_to_message_id uuid, is_reaction boolean default false,
  reply_intent text);

insert into outreach_campaigns (id, name, client_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'RiseDTC — Cold (DTC Sales Nav)', 'risedtc'),
  ('00000000-0000-0000-0000-0000000000c2', 'RiseDTC — Network Activation (ICP connections)', 'risedtc'),
  ('00000000-0000-0000-0000-0000000000c3', 'Poland — Agencies (Cold)', null),
  ('00000000-0000-0000-0000-0000000000c4', 'ARCH. Influencer Agency — Cold', 'arch');
update outreach_campaigns set archived = true where id = '00000000-0000-0000-0000-0000000000c4';

-- helper: n prospects in a campaign with a source, k of them replied to their DM
create or replace function fx_seed(p_camp uuid, p_source text, p_variant text, p_step int,
  p_n int, p_replied int, p_days_ago int, p_threaded boolean default true, p_intent text default null)
returns void language plpgsql as $$
declare i int; pid uuid; mid uuid;
begin
  for i in 1..p_n loop
    insert into outreach_prospects (campaign_id, country, enrichment_data)
      values (p_camp, 'US', jsonb_build_object('source', p_source)) returning id into pid;
    insert into outreach_messages (prospect_id, direction, message_type, channel, sequence_step, sent_at, ai_model)
      values (pid, 'outbound', 'dm', 'linkedin', p_step, now() - make_interval(days => p_days_ago), p_variant)
      returning id into mid;
    if i <= p_replied then
      if p_threaded then
        insert into outreach_messages (prospect_id, direction, sent_at, replies_to_message_id, reply_intent)
          values (pid, 'inbound', now() - make_interval(days => p_days_ago) + interval '1 day', mid, p_intent);
      else
        update outreach_prospects set last_reply_at = now() - make_interval(days => p_days_ago) + interval '1 day' where id = pid;
      end if;
    end if;
  end loop;
end $$;

-- RISE cold DM1, current window (sent 10-12 days ago): tanks on source competitor_engagers
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'competitor_engagers', 'rise_dm1_a', 1, 71, 2, 10, true, 'positive');
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'own_engagers',        'rise_dm1_a', 1, 40, 6, 12, true, 'positive');
-- RISE cold DM1 baseline (sent 40 days ago): 16.0% over 250
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'own_engagers',        'rise_dm1_a', 1, 250, 40, 40, false);
-- RISE warm DM1 current: healthy 30% on variant B
select fx_seed('00000000-0000-0000-0000-0000000000c2', 'warm_engager_harvester', 'rise_dm1_b', 1, 40, 12, 9);
-- RISE warm DM1 sibling loser: variant C at 1/35 vs B
select fx_seed('00000000-0000-0000-0000-0000000000c2', 'warm_engager_harvester', 'rise_dm1_c', 1, 35, 1, 9);
-- under-floor cell: RISE warm nudge, 12 sends
select fx_seed('00000000-0000-0000-0000-0000000000c2', 'warm_engager_harvester', 'rise_dm2_nudge_v1', 2, 12, 3, 9);
-- immature sends (3 days ago) must be ignored everywhere
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'own_engagers', 'rise_dm1_a', 1, 50, 0, 3);
-- manual mirrors must be ignored
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'own_engagers', 'manual_mirror', 1, 20, 20, 10);
-- archived ARCH campaign must not appear
select fx_seed('00000000-0000-0000-0000-0000000000c4', 'cold', 'arch_dm1_a', 1, 40, 4, 10);
-- Ivan lane: 40 sends, 4 replies via stamp only (no threaded row), no baseline
select fx_seed('00000000-0000-0000-0000-0000000000c3', 'apify_search', 'template/agency_dm_v3_owned', 1, 40, 4, 10, false);
-- a reaction-only inbound must not count as a reply (RISE cold, one extra prospect)
do $$ declare pid uuid; mid uuid; begin
  insert into outreach_prospects (campaign_id, country, enrichment_data) values ('00000000-0000-0000-0000-0000000000c1','US','{"source":"own_engagers"}') returning id into pid;
  insert into outreach_messages (prospect_id, direction, message_type, channel, sequence_step, sent_at, ai_model) values (pid,'outbound','dm','linkedin',1, now() - interval '10 days','rise_dm1_a') returning id into mid;
  insert into outreach_messages (prospect_id, direction, sent_at, replies_to_message_id, is_reaction) values (pid,'inbound', now() - interval '9 days', mid, true);
end $$;
