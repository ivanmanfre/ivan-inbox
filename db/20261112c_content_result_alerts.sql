-- content_result_alerts: two alerts that ring Ivan's phone and land in the inbox feed like a DM reply does
-- (Ivan 2026-11-12, approved). He never looks at his content results; a DM pulls him in because it rings with a
-- name and the text. These give a post the same pull. Both only notify: nothing is drafted, queued or sent, and no
-- prospect or post row is changed.
--
-- 1. A post took off (family content_result). Candidates: his organic posts published in the last 7 days. Baseline:
--    the median impressions of his organic posts published 3 to 63 days ago, the candidate left out, at least 10
--    posts. It fires at 5 times that median: the post with the most impressions, at most one a day, once per post ever.
--    "Organic, measured" (content_alert_posts): own_posts rows with impressions > 0 and metrics_updated_at set, not a
--    dead twin (linkedin_url 'unipile-...', removed by a job after 48 h), one row per post (the same post can sit
--    under two ids: the digits at the end of social_id, then the activity id in linkedin_url), and not boosted
--    (own_post_boost_current_v, keyed by the numeric id; checked against every row and id of the post).
-- 2. A good-fit person engaged (family prospect_engaged). Events: post_engagers rows on his own posts, icp_score >= 7
--    and scored, that became ready (first seen, or scored when the score came later) since the last run. The mark
--    starts at now minus 26 hours on the first run, so the first run never replays the backlog. At most one per
--    person per 90 days (person = provider_id, else linkedin_url) and 2 a day, highest score first, then the most
--    recent; retries count in the 2. A person whose thread is closed or stopped never rings (prospect_engaged_closed:
--    the Stalled Conversation Bump selector's holds plus the inbox's own stop and solved marks; when in doubt it
--    suppresses), matched to Ivan's seat's prospects only (prospect_engaged_ivan_prospects: prospect_id, member id,
--    profile slug). The tap opens their DM thread when one exists, else their LinkedIn profile.
--
-- Runs once a day at 15:10 UTC (pg_cron), after the own-post tracker (14:00 UTC) and the engager scrape (14:30 UTC).
-- Each alert's ledger row and its queued pg_net call to inbox-notify are written in one transaction. A call that never
-- became a feed row (inbox-notify unreachable) is sent once more on the next day's run, never again, and counts in that
-- day's limit; a people retry is checked again first and dropped when the thread closed meanwhile. A feed row that
-- exists for the dedupe key, read or dismissed, means it landed and it is never sent twice. The run gives up on a lock
-- after 5 s and writes nothing.
-- Kill switch: integration_config content_result_alerts = 'off' (no row = on). While off nothing is sent and the
-- engager mark still moves, so switching back on never replays the days it was off.
-- Rollback = 20261112c_content_result_alerts_rollback.sql.

select set_config('lock_timeout', '5s', true);

create table if not exists public.content_result_alerts (
  post_key text primary key,
  alert_day date not null unique,
  social_id text not null,
  impressions int not null,
  baseline_median numeric not null,
  baseline_posts int not null,
  alerted_at timestamptz not null,
  payload jsonb not null,
  notified_at timestamptz not null,
  request_id bigint,
  notify_attempts int not null default 1
);
alter table public.content_result_alerts enable row level security;
revoke all on table public.content_result_alerts from public, anon, authenticated;
grant all on table public.content_result_alerts to service_role;
comment on table public.content_result_alerts is 'One row per post that rang "your post took off" (20261112c_content_result_alerts). post_key = the post''s activity id; one alert per post ever, one per Warsaw day.';

create table if not exists public.prospect_engaged_alerts (
  engager_id uuid primary key,
  person_key text not null,
  alert_day date not null,
  post_key text,
  prospect_id uuid,
  icp_score numeric,
  alerted_at timestamptz not null,
  payload jsonb not null,
  notified_at timestamptz not null,
  request_id bigint,
  notify_attempts int not null default 1,
  dropped text
);
create index if not exists prospect_engaged_alerts_person on public.prospect_engaged_alerts (person_key, alerted_at desc);
create index if not exists prospect_engaged_alerts_day on public.prospect_engaged_alerts (alert_day);
alter table public.prospect_engaged_alerts enable row level security;
revoke all on table public.prospect_engaged_alerts from public, anon, authenticated;
grant all on table public.prospect_engaged_alerts to service_role;
comment on table public.prospect_engaged_alerts is 'One row per good-fit engagement that rang (20261112c_content_result_alerts). person_key = provider_id, else linkedin_url; 90 days between alerts for one person.';

create table if not exists public.content_alert_state (
  k text primary key,
  hwm timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.content_alert_state enable row level security;
revoke all on table public.content_alert_state from public, anon, authenticated;
grant all on table public.content_alert_state to service_role;
comment on table public.content_alert_state is 'High-water marks for 20261112c_content_result_alerts (k = prospect_engaged: engager events ready up to here were read).';

create or replace function public.content_alert_off()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select coalesce((select lower(btrim(value)) from public.integration_config where key = 'content_result_alerts'), 'on') in ('off', 'false', '0', 'no') $$;

-- Whitespace collapsed, an em dash written as a comma, cut to p_max characters with an ellipsis.
create or replace function public.content_alert_cut(p text, p_max int)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case when length(s) > p_max then rtrim(left(s, greatest(p_max - 1, 1))) || '…' else s end
    from (select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '\s*—\s*', ', ', 'g'), '\s+', ' ', 'g')) as s) x
$$;

-- The first line of a post that has any text on it.
create or replace function public.content_alert_first_line(p text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select btrim(x.l) from unnest(regexp_split_to_array(coalesce(p, ''), '\r?\n')) with ordinality as x(l, n)
   where x.l ~ '\S' order by x.n limit 1
$$;

-- A person's name without the emoji or symbols some people put around it ("🔎 Bob Pieterse").
create or replace function public.content_alert_name(p text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(regexp_replace(coalesce(p, ''),
    '^[\s  -⯿　-〿️‍\U0001f000-\U0001faff]+|[\s  -⯿　-〿️‍\U0001f000-\U0001faff]+$', '', 'g'),
    '\s+', ' ', 'g')), '')
$$;

-- A clean figure, rounded down, with a thousands separator: 836 -> 830, 1,654 -> 1,650, 18,279 -> 18,000.
create or replace function public.content_alert_figure(p bigint)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select to_char(case when p < 100 then p when p < 1000 then p - p % 10 when p < 10000 then p - p % 50
                      when p < 100000 then p - p % 500 else p - p % 5000 end, 'FM999,999,999,990')
$$;

-- Ivan's organic, measured posts: one row per post. post_key = the activity id (linkedin_url), else the digits at the
-- end of social_id, so a post stored under its ugcPost id and again under its activity id is one post.
create or replace function public.content_alert_posts()
returns table(post_key text, social_id text, posted_at timestamptz, impressions int, post_text text, linkedin_url text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with r as (
    select o.id, o.social_id, o.posted_at, o.num_impressions, o.post_text, o.linkedin_url, o.metrics_updated_at,
           substring(o.social_id from '([0-9]+)$') as sid_key,
           case when coalesce(o.linkedin_url, '') not like 'unipile-%' then substring(o.linkedin_url from 'activity-([0-9]+)') end as url_key
      from public.own_posts o
  ), boosted as (
    select regexp_replace(b.post_ref, '^urn:li:[A-Za-z]+:', '') as k
      from public.own_post_boost_current_v b where b.client_id = 'ivan' and b.boosted
  ), one_sid as (
    select distinct on (r.sid_key) r.*
      from r
     where r.sid_key is not null and r.posted_at is not null
       and coalesce(r.num_impressions, 0) > 0 and r.metrics_updated_at is not null
       and coalesce(r.linkedin_url, '') not like 'unipile-%'
     order by r.sid_key, r.metrics_updated_at desc, r.num_impressions desc, r.id
  ), one_post as (
    select distinct on (coalesce(s.url_key, s.sid_key)) coalesce(s.url_key, s.sid_key) as post_key, s.*
      from one_sid s
     order by coalesce(s.url_key, s.sid_key), s.metrics_updated_at desc, s.num_impressions desc, s.id
  )
  select p.post_key, p.social_id, p.posted_at, p.num_impressions, p.post_text, p.linkedin_url
    from one_post p
   -- boosted: any row of this post (measured or not, either id) carries a paid mark
   where not exists (select 1 from r x join boosted b on b.k in (x.sid_key, x.url_key)
                      where x.sid_key in (p.sid_key, p.post_key) or x.url_key in (p.sid_key, p.post_key))
$$;

-- Posts that took off as of p_now: published in the last 7 days, at least 5 times the median of the posts published 3 to
-- 63 days before (the candidate left out), with at least 10 of those. Whether it already rang is the run's business.
create or replace function public.content_result_candidates(p_now timestamptz default now())
returns table(post_key text, social_id text, posted_at timestamptz, impressions int, baseline_median numeric, baseline_posts int, post_text text, linkedin_url text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with p as (select * from public.content_alert_posts() where posted_at <= p_now)
  select c.post_key, c.social_id, c.posted_at, c.impressions, b.med, b.n::int, c.post_text, c.linkedin_url
    from p c
    cross join lateral (
      select (percentile_cont(0.5) within group (order by x.impressions))::numeric as med, count(*) as n
        from p x
       where x.posted_at >= p_now - interval '63 days' and x.posted_at <= p_now - interval '3 days' and x.post_key <> c.post_key) b
   where c.posted_at > p_now - interval '7 days'
     and b.n >= 10
     and c.impressions >= 5 * b.med
$$;

-- Why this prospect's thread is closed or stopped, or null. Mirrors the Stalled Conversation Bump selector (its query:
-- blacklisted, call_booked_at, skip_state; cadence.cjs prospect_held / future_date / structured_hold; the closed
-- follow-up review states) and the inbox's own marks (discard mode 'stop', Mark as solved, a 'negative' or vendor
-- pitch last reply, the conversation agent stopped). Two automatic states are not a stop and do not suppress: an
-- unaccepted invite the system withdrew as re-eligible (skip_reason invite_withdrawn_recyclable...), and the blanket
-- one-email policy (email_sequence_stopped_reason single_touch_policy...).
create or replace function public.prospect_engaged_closed(p_prospect uuid, p_now timestamptz default now())
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when p.id is null then null
    when p.blacklisted is not false then 'blacklisted'
    when p.call_booked_at is not null then 'call booked'
    when p.skip_state is not null then 'skipped (' || p.skip_state || ')'
    when p.skip_reason is not null and p.skip_reason not like 'invite_withdrawn_recyclable%' then 'skipped (' || left(p.skip_reason, 60) || ')'
    when lower(coalesce(p.stage, '')) in ('archived', 'skipped', 'disqualified', 'call_booked', 'booked', 'customer', 'client', 'won',
                                          'do_not_contact', 'blacklisted', 'stopped', 'team', 'internal') then 'stage ' || p.stage
    when p.next_touch_after > p_now then 'held until ' || to_char(p.next_touch_after at time zone 'Europe/Warsaw', 'YYYY-MM-DD')
    when exists (select 1 from unnest(array['copy_hold', 'lang_hold', 'qualification_hold', 'ledger_hold', 'person_hold', 'reply_hold',
                                            'ops_hold', 'scan_delivery_hold', 'customer', 'is_customer']) k
                  where jsonb_typeof(p.enrichment_data) = 'object'
                    and coalesce(p.enrichment_data -> k, 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb))
      then 'held'
    when jsonb_typeof(p.enrichment_data) = 'object'
         and p.enrichment_data #>> '{followup_review,verdict,state}' in ('declined', 'covered', 'wrong_person', 'closed_loop')
      then 'thread closed (' || (p.enrichment_data #>> '{followup_review,verdict,state}') || ')'
    when exists (select 1 from public.outreach_messages m where m.prospect_id = p.id and m.discard_mode = 'stop') then 'stopped in DMs'
    when exists (select 1 from public.outreach_messages m where m.prospect_id = p.id and m.email_sequence_stopped_at is not null
                    and coalesce(m.email_sequence_stopped_reason, '') not like 'single_touch_policy%') then 'email sequence stopped'
    when exists (select 1 from public.outreach_agent_threads t where t.prospect_id = p.id
                    and (t.state in ('stopped', 'closed') or t.closed_at is not null)) then 'contact stopped'
    when li.reply_intent in ('negative', 'vendor_pitch') then 'last reply ' || li.reply_intent
    when p.solved_at is not null and p.solved_at >= coalesce(li.at, '-infinity'::timestamptz) then 'marked solved'
    else null end
    from (select 1) one
    left join public.outreach_prospects p on p.id = p_prospect
    left join lateral (
      select m.reply_intent, coalesce(m.sent_at, m.created_at) as at
        from public.outreach_messages m
       where m.prospect_id = p.id and m.direction = 'inbound' and not coalesce(m.is_reaction, false)
       order by coalesce(m.sent_at, m.created_at) desc, m.id desc limit 1) li on true
$$;

-- Ivan's own prospects (campaign client_id null or 'ivan') that are this person: the row's own prospect_id, the member
-- id (li_member_key of the provider id or of the profile url, against the prospect's profile id and url) or the profile
-- slug (li_slug, db/057 + db/059). A prospect of another seat neither suppresses nor is linked.
create or replace function public.prospect_engaged_ivan_prospects(p_prospect uuid, p_provider text, p_url text)
returns table(prospect_id uuid, has_thread boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with k as (select public.li_member_key(p_provider) as mk_provider, public.li_member_key(p_url) as mk_url, public.li_slug(p_url) as slug),
  hit as (
    select p.id from public.outreach_prospects p where p.id = p_prospect
    union select p.id from public.outreach_prospects p, k where k.mk_provider is not null and public.li_member_key(p.linkedin_profile_id) = k.mk_provider
    union select p.id from public.outreach_prospects p, k where k.mk_provider is not null and public.li_member_key(p.linkedin_url) = k.mk_provider
    union select p.id from public.outreach_prospects p, k where k.mk_url is not null and public.li_member_key(p.linkedin_profile_id) = k.mk_url
    union select p.id from public.outreach_prospects p, k where k.mk_url is not null and public.li_member_key(p.linkedin_url) = k.mk_url
    union select p.id from public.outreach_prospects p, k where k.slug is not null and public.li_slug(p.linkedin_url) = k.slug
  )
  select p.id, exists (select 1 from public.outreach_messages m where m.prospect_id = p.id)
    from hit join public.outreach_prospects p on p.id = hit.id
    join public.outreach_campaigns c on c.id = p.campaign_id and coalesce(c.client_id, 'ivan') = 'ivan'
$$;

-- Why this person may not ring right now, or null: one of his own seats, or any of his matched prospects closed.
-- Read again before a retry is sent.
create or replace function public.prospect_engaged_block(p_prospect uuid, p_provider text, p_url text, p_now timestamptz default now())
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from public.integration_config ic
                  where ic.key in ('unipile_linkedin_id', 'risedtc_linkedin_id', 'arch_linkedin_id', 'swishdm_linkedin_id')
                    and nullif(btrim(ic.value), '') is not null
                    and (p_provider = ic.value or coalesce(p_url, '') ilike '%' || ic.value || '%'))
      then 'own seat'
    else (select r.why from (select public.prospect_engaged_closed(x.prospect_id, p_now) as why
                               from public.prospect_engaged_ivan_prospects(p_prospect, p_provider, p_url) x) r
           where r.why is not null order by r.why limit 1)
  end
$$;

-- Good-fit engagements on Ivan's own posts that became ready in (p_since, p_now], each with the reason it may not ring
-- (null = it may). Ready = first seen, or scored if the score came later; never older than 72 h. prospect_id is the
-- matched prospect of Ivan's seat (one with a thread first), never another seat's.
create or replace function public.prospect_engaged_candidates(p_since timestamptz, p_now timestamptz default now())
returns table(engager_id uuid, person_key text, name text, headline text, linkedin_url text, engagement_type text, reaction_type text,
              icp_score numeric, first_seen_at timestamptz, ready_at timestamptz, post_key text, post_text text, prospect_id uuid,
              has_thread boolean, suppressed text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with ev as (
    select e.*, coalesce(nullif(btrim(e.provider_id), ''), nullif(btrim(e.linkedin_url), '')) as pkey,
           greatest(e.first_seen_at, coalesce(e.scored_at, e.first_seen_at)) as ready,
           substring(e.post_social_id from '([0-9]+)$') as ekey
      from public.post_engagers e
     where e.icp_score >= 7 and e.scored_at is not null
       and e.first_seen_at > p_now - interval '72 hours'
       and greatest(e.first_seen_at, coalesce(e.scored_at, e.first_seen_at)) > p_since
       and greatest(e.first_seen_at, coalesce(e.scored_at, e.first_seen_at)) <= p_now
  )
  select ev.id, ev.pkey, ev.name, ev.headline, ev.linkedin_url, ev.engagement_type, ev.reaction_type, ev.icp_score,
         ev.first_seen_at, ev.ready, op.post_key, op.post_text, ip.prospect_id, coalesce(ip.has_thread, false),
         case
           when ev.pkey is null then 'no person id'
           when exists (select 1 from public.prospect_engaged_alerts a where a.person_key = ev.pkey and a.alerted_at > p_now - interval '90 days')
             then 'alerted in the last 90 days'
           else public.prospect_engaged_block(ev.prospect_id, ev.provider_id, ev.linkedin_url, p_now)
         end
    from ev
    left join lateral (
      select x.prospect_id, x.has_thread from public.prospect_engaged_ivan_prospects(ev.prospect_id, ev.provider_id, ev.linkedin_url) x
       order by x.has_thread desc, (x.prospect_id = ev.prospect_id) desc, x.prospect_id limit 1) ip on true
    join lateral (
      select coalesce(case when coalesce(o.linkedin_url, '') not like 'unipile-%' then substring(o.linkedin_url from 'activity-([0-9]+)') end,
                      substring(o.social_id from '([0-9]+)$')) as post_key, o.post_text
        from public.own_posts o
       where ev.ekey is not null
         and (substring(o.social_id from '([0-9]+)$') = ev.ekey or substring(o.linkedin_url from 'activity-([0-9]+)') = ev.ekey)
       order by (coalesce(o.linkedin_url, '') like 'unipile-%'), o.metrics_updated_at desc nulls last, o.id
       limit 1) op on true
$$;

create or replace function public.content_result_payload(p_key text, p_impressions int, p_median numeric, p_posts int, p_social text,
                                                         p_posted timestamptz, p_text text, p_url text)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare v_mult int := floor(p_impressions / p_median)::int; v_tail text; v_line text;
begin
  v_tail := v_mult || ' times your usual ' || to_char(round(p_median), 'FM999,999,999,990') || '.';
  v_line := public.content_alert_cut(public.content_alert_first_line(p_text), 140 - length(v_tail) - 2);
  if coalesce(v_line, '') <> '' and v_line !~ '[.!?…:;)"”’'']$' then v_line := v_line || '.'; end if;
  return jsonb_build_object('family', 'content_result', 'source', 'content-result-alerts', 'dedupe_key', 'content-result:' || p_key,
    'group_key', 'content-result:' || p_key, 'severity', 'info',
    'title', 'Your post passed ' || public.content_alert_figure(p_impressions) || ' views',
    'body', btrim(coalesce(v_line, '') || ' ' || v_tail),
    'url', './#exp/d/content/results?lane=ivan',
    'media', jsonb_build_object('kind', 'content_result', 'post_key', p_key, 'social_id', p_social, 'impressions', p_impressions,
      'median', round(p_median, 1), 'baseline_posts', p_posts, 'multiple', v_mult, 'posted_at', p_posted,
      'linkedin_url', case when p_url ~* '^https://' then p_url end),
    'push', true);
end $$;

create or replace function public.prospect_engaged_payload(p_engager uuid, p_name text, p_headline text, p_type text, p_reaction text,
                                                           p_score numeric, p_post_key text, p_post_text text, p_prospect uuid,
                                                           p_has_thread boolean, p_linkedin text)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare v_name text; v_head text; v_line text; v_body text; v_url text; v_comment boolean := lower(coalesce(p_type, '')) = 'comment';
begin
  v_name := coalesce(public.content_alert_cut(public.content_alert_name(p_name), 120), 'Someone');
  v_head := nullif(public.content_alert_cut(p_headline, 90), '');
  v_line := nullif(public.content_alert_cut(public.content_alert_first_line(p_post_text), greatest(140 - coalesce(length(v_head), 0) - 3, 24)), '');
  v_body := nullif(concat_ws(E'\n', v_head, case when v_line is not null then '“' || v_line || '”' end), '');
  v_url := case
    when p_prospect is not null and p_has_thread then './#exp/d/dms?thread=' || p_prospect
    when btrim(coalesce(p_linkedin, '')) ~* '^https://' then btrim(p_linkedin)
    when btrim(coalesce(p_linkedin, '')) ~* '^http://' then regexp_replace(btrim(p_linkedin), '^http://', 'https://', 'i')
    when btrim(coalesce(p_linkedin, '')) ~* '^(www\.)?linkedin\.com/' then 'https://' || btrim(p_linkedin)
    end;
  return jsonb_build_object('family', 'prospect_engaged', 'source', 'content-result-alerts', 'dedupe_key', 'prospect-engaged:' || p_engager,
    'severity', 'info',
    'title', v_name || case when v_comment then ' commented on your post' else ' reacted to your post' end,
    'body', v_body, 'url', v_url,
    'media', jsonb_build_object('kind', 'prospect_engaged', 'engager_id', p_engager, 'prospect_id', p_prospect,
      'engagement', case when v_comment then 'comment' else 'reaction' end, 'reaction_type', p_reaction, 'icp_score', p_score,
      'post_key', p_post_key),
    'push', true);
end $$;

-- One queued call to inbox-notify (pg_net). The url and secret are checked before anything is written.
create or replace function public.content_alert_post(p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_url text; v_secret text; v_req bigint;
begin
  select value into v_url from public.integration_config where key = 'inbox_notify_url';
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  if nullif(btrim(coalesce(v_url, '')), '') is null or nullif(btrim(coalesce(v_secret, '')), '') is null then
    raise exception 'inbox_notify_url or inbox_push_secret missing';
  end if;
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
           body := p_payload, timeout_milliseconds := 30000) into v_req;
  return v_req;
end $$;

create or replace function public.content_result_alerts_run(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set statement_timeout to '60s'
set lock_timeout to '5s'
as $function$
declare
  v_day date := (p_now at time zone 'Europe/Warsaw')::date;
  v_since timestamptz; v_posts jsonb; v_people jsonb; v_payload jsonb; v_req bigint; v_left int;
  v_retried int; v_dropped int; v_sent jsonb; v_why text; r record;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  -- A run waiting behind a lock (DDL on a table it reads) gives up after lock_timeout (5 s) and writes nothing; the next
  -- day's run reads the same window again. A busy lock inside one alert's block rolls back that block only.
  begin
  perform pg_advisory_xact_lock(hashtextextended('content-result-alerts', 0));
  -- The first mark (26 h back) is kept outside the engager block: a first run that fails keeps its window.
  insert into public.content_alert_state (k, hwm, updated_at) values ('prospect_engaged', p_now - interval '26 hours', p_now)
  on conflict (k) do nothing;
  select s.hwm into v_since from public.content_alert_state s where s.k = 'prospect_engaged';

  if public.content_alert_off() then
    insert into public.content_alert_state (k, hwm, updated_at) values ('prospect_engaged', p_now, p_now)
    on conflict (k) do update set hwm = greatest(public.content_alert_state.hwm, excluded.hwm), updated_at = excluded.updated_at;
    return jsonb_build_object('off', true, 'day', v_day);
  end if;

  -- 1. A post took off. Its own block: a failure here rolls back only this part, and never the engager part.
  begin
    v_retried := 0;
    -- One post alert sent per Warsaw day, a retry included: what was sent today counts first.
    v_left := 1 - (select count(*)::int from public.content_result_alerts a where (a.notified_at at time zone 'Europe/Warsaw')::date = v_day);
    -- Yesterday's call that never became a feed row (any row for its key, read or dismissed, means it landed).
    for r in select a.post_key, a.payload from public.content_result_alerts a
              where a.notify_attempts < 2 and a.alerted_at <= p_now - interval '12 hours' and a.alerted_at > p_now - interval '48 hours'
                and not exists (select 1 from public.inbox_notifications n where n.dedupe_key = a.payload ->> 'dedupe_key')
              order by a.alerted_at for update of a loop
      exit when v_left <= 0;
      v_req := public.content_alert_post(r.payload);
      update public.content_result_alerts set notified_at = p_now, request_id = v_req, notify_attempts = notify_attempts + 1
       where post_key = r.post_key;
      v_retried := v_retried + 1;
      v_left := v_left - 1;
    end loop;
    if v_left <= 0 then
      v_posts := jsonb_build_object('fired', false, 'why', 'one already today', 'retried', v_retried);
    else
      select c.* into r from public.content_result_candidates(p_now) c
       where not exists (select 1 from public.content_result_alerts a where a.post_key = c.post_key)
       order by c.impressions desc, c.post_key limit 1;
      if not found then
        v_posts := jsonb_build_object('fired', false, 'why', 'none took off', 'retried', v_retried);
      else
        v_payload := public.content_result_payload(r.post_key, r.impressions, r.baseline_median, r.baseline_posts, r.social_id,
                                                   r.posted_at, r.post_text, r.linkedin_url);
        insert into public.content_result_alerts (post_key, alert_day, social_id, impressions, baseline_median, baseline_posts,
                                                  alerted_at, payload, notified_at)
        values (r.post_key, v_day, r.social_id, r.impressions, r.baseline_median, r.baseline_posts, p_now, v_payload, p_now);
        v_req := public.content_alert_post(v_payload);
        update public.content_result_alerts set request_id = v_req where post_key = r.post_key;
        v_posts := jsonb_build_object('fired', true, 'post_key', r.post_key, 'impressions', r.impressions,
                                      'median', r.baseline_median, 'retried', v_retried, 'payload', v_payload);
      end if;
    end if;
  exception when others then
    v_posts := jsonb_build_object('fired', false, 'error', sqlerrm);
  end;

  -- 2. Good-fit people who engaged. The mark moves only when this block commits, so a failed run is read again tomorrow.
  begin
    v_retried := 0; v_dropped := 0;
    -- Two people sent per Warsaw day, retries included: what was sent today counts first.
    v_left := 2 - (select count(*)::int from public.prospect_engaged_alerts a where (a.notified_at at time zone 'Europe/Warsaw')::date = v_day);
    -- A retry is read again first: a thread closed or stopped since yesterday drops it (recorded in dropped), never sent.
    for r in select a.engager_id, a.payload, e.id as e_id, e.prospect_id, e.provider_id, e.linkedin_url
               from public.prospect_engaged_alerts a
               left join public.post_engagers e on e.id = a.engager_id
              where a.notify_attempts < 2 and a.dropped is null
                and a.alerted_at <= p_now - interval '12 hours' and a.alerted_at > p_now - interval '48 hours'
                and not exists (select 1 from public.inbox_notifications n where n.dedupe_key = a.payload ->> 'dedupe_key')
              order by a.alerted_at for update of a loop
      v_why := case when r.e_id is null then 'engagement row gone'
                    else public.prospect_engaged_block(r.prospect_id, r.provider_id, r.linkedin_url, p_now) end;
      if v_why is not null then
        update public.prospect_engaged_alerts set dropped = v_why where engager_id = r.engager_id;
        v_dropped := v_dropped + 1;
        continue;
      end if;
      exit when v_left <= 0;
      v_req := public.content_alert_post(r.payload);
      update public.prospect_engaged_alerts set notified_at = p_now, request_id = v_req, notify_attempts = notify_attempts + 1
       where engager_id = r.engager_id;
      v_retried := v_retried + 1;
      v_left := v_left - 1;
    end loop;
    v_sent := '[]'::jsonb;
    for r in select x.* from (
               select distinct on (c.person_key) c.*
                 from public.prospect_engaged_candidates(v_since, p_now) c
                where c.suppressed is null
                order by c.person_key, (lower(coalesce(c.engagement_type, '')) = 'comment') desc, c.icp_score desc, c.first_seen_at desc, c.engager_id) x
              order by x.icp_score desc, x.first_seen_at desc, x.engager_id
              limit greatest(v_left, 0) loop
      v_payload := public.prospect_engaged_payload(r.engager_id, r.name, r.headline, r.engagement_type, r.reaction_type, r.icp_score,
                                                   r.post_key, r.post_text, r.prospect_id, r.has_thread, r.linkedin_url);
      insert into public.prospect_engaged_alerts (engager_id, person_key, alert_day, post_key, prospect_id, icp_score, alerted_at,
                                                  payload, notified_at)
      values (r.engager_id, r.person_key, v_day, r.post_key, r.prospect_id, r.icp_score, p_now, v_payload, p_now);
      v_req := public.content_alert_post(v_payload);
      update public.prospect_engaged_alerts set request_id = v_req where engager_id = r.engager_id;
      v_sent := v_sent || jsonb_build_array(jsonb_build_object('engager_id', r.engager_id, 'title', v_payload ->> 'title'));
    end loop;
    insert into public.content_alert_state (k, hwm, updated_at) values ('prospect_engaged', p_now, p_now)
    on conflict (k) do update set hwm = greatest(public.content_alert_state.hwm, excluded.hwm), updated_at = excluded.updated_at;
    v_people := jsonb_build_object('sent', v_sent, 'retried', v_retried, 'dropped', v_dropped, 'since', v_since);
  exception when others then
    v_people := jsonb_build_object('sent', '[]'::jsonb, 'error', sqlerrm);
  end;

  if v_posts ? 'error' or v_people ? 'error' then
    raise warning 'content_result_alerts_run: posts %, people %', v_posts ->> 'error', v_people ->> 'error';
  end if;
  return jsonb_build_object('day', v_day, 'posts', v_posts, 'people', v_people);
  exception when lock_not_available then
    return jsonb_build_object('busy', true, 'day', v_day, 'error', sqlerrm);
  end;
end $function$;

revoke all on function public.content_alert_off() from public, anon, authenticated;
revoke all on function public.content_alert_cut(text, int) from public, anon, authenticated;
revoke all on function public.content_alert_first_line(text) from public, anon, authenticated;
revoke all on function public.content_alert_name(text) from public, anon, authenticated;
revoke all on function public.content_alert_figure(bigint) from public, anon, authenticated;
revoke all on function public.content_alert_posts() from public, anon, authenticated;
revoke all on function public.content_result_candidates(timestamptz) from public, anon, authenticated;
revoke all on function public.prospect_engaged_closed(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.prospect_engaged_ivan_prospects(uuid, text, text) from public, anon, authenticated;
revoke all on function public.prospect_engaged_block(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.prospect_engaged_candidates(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.content_result_payload(text, int, numeric, int, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.prospect_engaged_payload(uuid, text, text, text, text, numeric, text, text, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.content_alert_post(jsonb) from public, anon, authenticated;
revoke all on function public.content_result_alerts_run(timestamptz) from public, anon, authenticated;
grant execute on function public.content_result_alerts_run(timestamptz) to service_role;
grant execute on function public.content_result_candidates(timestamptz) to service_role;
grant execute on function public.prospect_engaged_candidates(timestamptz, timestamptz) to service_role;

select cron.schedule('content-result-alerts', '10 15 * * *', 'select public.content_result_alerts_run()')
 where not exists (select 1 from cron.job where jobname = 'content-result-alerts');
