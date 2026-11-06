-- The bell as a to-do list, and alarms as incidents (Ivan's inbox + systems review, 2026-11-06, items #5, #12, #7).
--
-- Measured before this ran (inbox_notifications):
--   * 2,552 open rows; 689 "reply drafted" (reply_draft_pending) open while 2 drafts actually waited. 668 of
--     the 670 that map to a person were already sent, approved or discarded. Nothing ever closed them.
--   * lane_supply_alarm pushed ~88 times in 7 days. Every run opened a NEW row: the relay's incident key hashes
--     the full text ("staged zero leads from 32 resolved people" vs "from 28 ..."), and a daily watchdog
--     fires 24h + a few seconds after its last row, just past the 24h fold. 11 of the "failed on the runner"
--     pushes were `rise_supply_busy` (another run held the lock; nothing failed).
--   * Loop Liveness Watchdog (n8n 90QRPEaXxcMmkJYK) writes one row per hourly run listing every failing check,
--     read-stamped and push-suppressed: 455 open rows, all the same two checks with the hours ticking up.
--   * post_generation_failed: one red row per draft, in bursts of 14-22 a day.
--
-- What this does:
--   1. claim_inbox_workflow_notification: a lane supply alarm's incident is the lane + the alarm's title with
--      its numbers taken out. A repeat while the incident is live (seen in the last 36h) bumps the count on the
--      existing row and never pushes. It rings again only when it gets worse (severity rises), at most once a
--      day. A runner exit ending in `_busy` is recorded as "skipped", already read and dismissed, never rung.
--   2. reply_draft_pending rows are linked to the person on insert (media.prospect_id, url = that thread,
--      group per person) when exactly one prospect matches. A 5-minute sweep closes them once that person has
--      nothing left waiting (sent, approved, discarded or deleted). No trigger on outreach_messages: a send
--      path never waits on the bell.
--   3. Loop Liveness Watchdog run rows fan out into ONE incident per failing check (key = check text with its
--      numbers taken out). A repeat bumps the count. The incident resolves (media.resolved_at) when a run no
--      longer lists it, or when the watchdog has not reported it for 3 hours; failing again after that opens
--      a new incident. The run row itself is kept as a dismissed log.
--   4. post_generation_failed rows fold into one group per Warsaw day.
--   5. inbound_reply_notice rows naming exactly one person link to that thread.
--
-- The one new trigger (on inbox_notifications) swallows its own errors (RAISE WARNING) and keeps the row.
-- Rollback: db/20261106_bell_todo_alarm_incidents_rollback.sql. One-time cleanup: db/20261106_bell_todo_cleanup.sql.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Lane supply alarms: one incident per lane alarm, rings on change only
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.inbox_lane_incident_key(p_tenant text, p_source text, p_title text)
returns text
language sql
immutable
as $$
  select 'lane:' || coalesce(nullif(btrim(p_tenant), ''), '_') || ':'
      || regexp_replace(coalesce(nullif(btrim(p_source), ''), '_'), '[^a-zA-Z0-9:_./-]', '_', 'g')
      || ':lane_supply_alarm:'
      || md5(btrim(regexp_replace(regexp_replace(lower(coalesce(p_title, '')), '[0-9]+', '#', 'g'), '\s+', ' ', 'g')))
$$;

create or replace function public.inbox_lane_alarm_key(p_tenant text, p_source text, p_title text, p_body text)
returns text
language sql
immutable
as $$
  -- For runner failures the HTTP error codes in the summary (a 4xx/5xx number not followed by a unit: 401 vs
  -- 503) stay part of the identity; every other number (run ids, durations, counts) is dropped by the key's
  -- normalization, so "503 after 120 seconds" and "503 after 121 seconds" fold.
  select public.inbox_lane_incident_key(p_tenant, p_source,
    coalesce(p_title, '') || case when coalesce(p_source, '') = 'runner'
      then ' | ' || coalesce(substring(coalesce(p_body, '') from '\): (.*)$'), p_body, '') else '' end)
    || case when coalesce(p_source, '') = 'runner'
      then ':' || left(md5(coalesce((select string_agg(c[1], ',' order by c[1])
                                       from regexp_matches(coalesce(substring(coalesce(p_body, '') from '\): (.*)$'), p_body, ''),
                                                           '\m([45][0-9]{2})\M(?!\s*(?:ms|s|secs?|seconds?|mins?|minutes?|h|hours?|days?|rows?|items?|leads?|people|%))', 'g') as c), '')), 8)
      else '' end
$$;

create or replace function public.inbox_severity_rank(p_severity text)
returns int
language sql
immutable
as $$ select case p_severity when 'error' then 2 when 'attention' then 1 else 0 end $$;

CREATE OR REPLACE FUNCTION public.claim_inbox_workflow_notification(p_alert jsonb)
 RETURNS TABLE(id uuid, created boolean, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_key text := nullif(p_alert->>'incident_key', '');
  v_family text := p_alert->>'family';
  v_now timestamptz := clock_timestamp();
  v_previous public.inbox_notifications%rowtype;
  v_id uuid;
  v_expires timestamptz;
  v_text text := coalesce(p_alert->>'title', '') || ' ' || coalesce(p_alert->>'body', '');
  v_title text := p_alert->>'title';
  v_name text;
  v_quiet boolean := false;
  v_lane boolean := false;
  v_severity text := coalesce(p_alert->>'severity', 'info');
begin
  if v_key is null or length(v_key) > 1000 then raise exception 'incident_key required'; end if;
  if v_family not in ('system_infra_alarm','send_failed_alert','lane_supply_alarm') then
    raise exception 'family is not a transient workflow alert';
  end if;

  -- A lane alarm's incident is the lane and what the alarm says, never the numbers in it (11-06).
  if v_family = 'lane_supply_alarm' then
    if coalesce(p_alert->>'source', '') = 'runner'
       and coalesce(p_alert->>'body', '') ~ '\(exit -?[0-9]+\): [a-z0-9_]+_busy\s*$' then
      -- Another run held the lock, so this one did nothing: a skipped run, kept for the record, never rung.
      v_quiet := true;
      v_title := regexp_replace(coalesce(v_title, ''), ' failed on the runner$', '') || ' skipped: another run held the lock';
      v_key := public.inbox_lane_incident_key(p_alert->>'tenant', p_alert->>'source', v_title);
    else
      v_lane := true;
      -- Every runner failure shares one title ("<lane> failed on the runner"), so its failure reason (the
      -- summary after "): ", numbers removed by the key) is part of the incident: a timeout and a revoked
      -- credential stay two incidents. Relay alarms name the problem in the title already.
      v_key := public.inbox_lane_alarm_key(p_alert->>'tenant', p_alert->>'source', v_title, p_alert->>'body');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- A recipient LinkedIn will not deliver to (blocked us, cannot receive messages) is not a failure (Ivan 10-21).
  if v_family = 'send_failed_alert' then
    v_name := nullif(btrim(substring(v_text from ' to (.+?)\. Row reset')), '');
    v_quiet := public.is_unreachable_recipient_reason(v_text)
      or (v_name is not null and v_text ~ '\m422\M' and exists (
        select 1
          from public.outreach_messages m
          join public.outreach_prospects p on p.id = m.prospect_id
         where m.direction = 'outbound' and m.sent_at is null
           and m.send_blocked_at > v_now - interval '30 minutes'
           and lower(btrim(p.name)) = lower(v_name)
           and (public.is_unreachable_recipient_reason(m.send_blocked_reason)
             or exists (select 1 from public.outreach_message_revisions r
                         where r.message_id = m.id and public.is_unreachable_recipient_reason(r.old_send_blocked_reason)))));
  end if;

  select * into v_previous from public.inbox_notifications n
   where n.incident_key = v_key order by n.last_seen_at desc, n.created_at desc limit 1 for update;

  if v_lane then
    -- Live incident: the lane is still bad. A daily watchdog repeats every 24h + seconds, so 36h.
    if found and v_previous.last_seen_at > v_now - interval '36 hours' then
      if public.inbox_severity_rank(v_severity) > public.inbox_severity_rank(v_previous.severity)
         and (v_previous.pushed_at is null or v_previous.pushed_at < v_now - interval '24 hours') then
        -- Worse than before, and it has not rung today: a fresh row for the same incident (new id and
        -- created_at, so the badge window and the open tab's arrival check both see it), rung once. The
        -- previous row is superseded; the count carries on.
        update public.inbox_notifications n set dismissed_at = coalesce(n.dismissed_at, v_now)
         where n.id = v_previous.id;
        insert into public.inbox_notifications
          (family, source, dedupe_key, incident_key, severity, title, body, url, media, group_key, tenant, count,
           first_seen_at, last_seen_at, created_at, expires_at)
        values
          (v_family, p_alert->>'source', p_alert->>'dedupe_key', v_key, v_severity, v_title, p_alert->>'body',
           p_alert->>'url', p_alert->'media', p_alert->>'group_key', p_alert->>'tenant', v_previous.count + 1,
           v_previous.first_seen_at, v_now, v_now, v_now + interval '4 hours')
        returning inbox_notifications.id, inbox_notifications.expires_at into v_id, v_expires;
        return query select v_id, true, v_expires;
        return;
      end if;
      -- Same or better, or already rang today: the count says it happened again. No push.
      update public.inbox_notifications n
         set last_seen_at = v_now, count = n.count + 1, body = p_alert->>'body',
             severity = case when public.inbox_severity_rank(v_severity) > public.inbox_severity_rank(n.severity)
                             then v_severity else n.severity end
       where n.id = v_previous.id;
      return query select v_previous.id, false, v_previous.expires_at;
      return;
    end if;
  elsif found and v_previous.last_seen_at > v_now - interval '24 hours' then
    update public.inbox_notifications n
       set last_seen_at = v_now, count = n.count + 1,
           dismissed_at = case when v_quiet then coalesce(n.dismissed_at, v_now) else n.dismissed_at end
     where n.id = v_previous.id;
    return query select v_previous.id, false, v_previous.expires_at;
    return;
  end if;

  insert into public.inbox_notifications
    (family, source, dedupe_key, incident_key, severity, title, body, url, media, group_key, tenant,
     first_seen_at, last_seen_at, created_at, expires_at, read_at, dismissed_at)
  values
    (v_family, p_alert->>'source', p_alert->>'dedupe_key', v_key,
     v_severity, v_title, p_alert->>'body',
     p_alert->>'url', p_alert->'media', p_alert->>'group_key', p_alert->>'tenant',
     v_now, v_now, v_now, v_now + interval '4 hours',
     case when v_quiet then v_now end, case when v_quiet then v_now end)
  returning inbox_notifications.id, inbox_notifications.expires_at into v_id, v_expires;
  -- Recorded, never rung: created=false keeps notify.ts from pushing it.
  return query select v_id, not v_quiet, v_expires;
end; $function$;

revoke all on function public.claim_inbox_workflow_notification(jsonb) from public, anon, authenticated;
grant execute on function public.claim_inbox_workflow_notification(jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 2. "Reply drafted" rows: linked to the person, closed when nothing waits on Ivan for them
-- ---------------------------------------------------------------------------------------------------------

-- Something of this person's still waits: not sent, not approved, and either not blocked or on a hold the
-- inbox still shows as a draft or an owner question. Deliberately a touch WIDER than the DMs list's isDraft
-- (src/lib/inbox.ts): race and lint holds, SwishDM's approval hold, owner questions and automatic retries all
-- count as waiting, so a notice can only close once the thread truly has nothing left for anyone to act on.
create or replace function public.inbox_prospect_has_waiting_draft(p_prospect uuid)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.outreach_messages m
     where m.prospect_id = p_prospect and m.direction = 'outbound'
       and m.sent_at is null and m.approved_at is null
       and (m.send_blocked_at is null
            or m.send_blocked_reason in ('awaiting_client_review', 'owner_confirmation', 'reply_retry_pending')
            or m.send_blocked_reason like 'post_approval_race:%'
            or m.send_blocked_reason like 'lint\_%'))
$$;

-- The person a "drafted for <name>" notice is about: the prospect named in the title that got an outbound
-- message within 90 minutes before (or 5 after) the notice. Longest name first, then nearest in time.
-- Producers (5 n8n drafters through wa-relay) do not carry a message id; the name in the title plus the
-- draft row written moments earlier is what ties them. No match = left alone, never guessed.
-- Two different prospects with that same longest name = ambiguous = no link (never guess the person).
create or replace function public.inbox_draft_notice_prospect(p_title text, p_at timestamptz)
returns uuid
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with c as (
    select distinct m.prospect_id, length(btrim(p.name)) as len
      from public.outreach_messages m
      join public.outreach_prospects p on p.id = m.prospect_id
     where m.direction = 'outbound'
       and m.created_at between p_at - interval '90 minutes' and p_at + interval '5 minutes'
       and length(btrim(p.name)) >= 4
       and strpos(coalesce(p_title, ''), btrim(p.name)) > 0),
  top as (select * from c where len = (select max(len) from c))
  select (array_agg(t.prospect_id))[1] from top t
  having count(*) = 1
     -- A name two prospects share anywhere (916 such names, across clients) is never linked.
     and (select count(*) from public.outreach_prospects p2
           where lower(btrim(p2.name)) = (select lower(btrim(p3.name)) from public.outreach_prospects p3
                                          where p3.id = (array_agg(t.prospect_id))[1])) = 1
$$;

-- The person a new-reply notice is about: exactly one prospect named in the text with an inbound message
-- in the same window. A digest naming two people links to nobody (it keeps its DMs-list link).
create or replace function public.inbox_inbound_notice_prospect(p_text text, p_at timestamptz)
returns uuid
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select (array_agg(distinct m.prospect_id))[1]
    from public.outreach_messages m
    join public.outreach_prospects p on p.id = m.prospect_id
   where m.direction = 'inbound'
     and m.created_at between p_at - interval '90 minutes' and p_at + interval '5 minutes'
     and length(btrim(p.name)) >= 4
     and strpos(coalesce(p_text, ''), btrim(p.name)) > 0
  having count(distinct m.prospect_id) = 1
     and (select count(*) from public.outreach_prospects p2
           where lower(btrim(p2.name)) = (select lower(btrim(p3.name)) from public.outreach_prospects p3
                                          where p3.id = (array_agg(distinct m.prospect_id))[1])) = 1
$$;

create index if not exists outreach_prospects_name_norm on public.outreach_prospects ((lower(btrim(name))));

create index if not exists inbox_notifications_draft_prospect
  on public.inbox_notifications ((media->>'prospect_id'))
  where family = 'reply_draft_pending' and dismissed_at is null;

-- Close every open draft notice for this person when nothing of theirs waits any more. Only notices older
-- than 10 minutes: a notice can land seconds before its draft row commits, and must not close in that gap.
-- Runs from the 5-minute sweep only: no trigger on outreach_messages, so a send, approve or discard never
-- waits on a notification row lock (cross-review r1 #1).
create or replace function public.inbox_close_draft_notices(p_prospect uuid)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_n int := 0;
begin
  if p_prospect is null or public.inbox_prospect_has_waiting_draft(p_prospect) then return 0; end if;
  update public.inbox_notifications n
     set dismissed_at = now(), read_at = coalesce(n.read_at, now())
   where n.family = 'reply_draft_pending' and n.dismissed_at is null
     and n.media->>'prospect_id' = p_prospect::text
     and n.created_at < now() - interval '10 minutes';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Every 5 minutes: link unlinked open notices from the last 3 days (one that landed before its draft row
-- committed), then close those whose person has nothing left waiting.
create or replace function public.inbox_sweep_draft_notices()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_linked int := 0; v_closed int := 0; r record;
begin
  with c as (
    select n.id, public.inbox_draft_notice_prospect(n.title, n.created_at) as pid
      from public.inbox_notifications n
     where n.family = 'reply_draft_pending' and n.dismissed_at is null and n.severity <> 'error'
       and n.created_at > now() - interval '3 days'
       and (n.media is null or n.media->>'prospect_id' is null))
  update public.inbox_notifications n
     set media = coalesce(n.media, '{}'::jsonb) || jsonb_build_object('prospect_id', c.pid),
         url = './#exp/d/dms?thread=' || c.pid,
         group_key = 'reply_draft_pending:' || c.pid
    from c where c.id = n.id and c.pid is not null;
  get diagnostics v_linked = row_count;
  for r in select distinct (n.media->>'prospect_id')::uuid as pid
             from public.inbox_notifications n
            where n.family = 'reply_draft_pending' and n.dismissed_at is null
              and n.media->>'prospect_id' ~ '^[0-9a-f-]{36}$' loop
    v_closed := v_closed + public.inbox_close_draft_notices(r.pid);
  end loop;
  return jsonb_build_object('linked', v_linked, 'closed', v_closed);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 3 + 4. Shape rows on the way in: draft links, watchdog incidents, post-failure batches
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.inbox_watchdog_check_key(p_source text, p_line text)
returns text
language sql
immutable
as $$
  select 'watchdog:' || regexp_replace(coalesce(nullif(btrim(p_source), ''), '_'), '[^a-zA-Z0-9_./-]', '_', 'g')
      || ':check:' || left(md5(btrim(regexp_replace(regexp_replace(lower(coalesce(p_line, '')), '[0-9]+', '#', 'g'), '\s+', ' ', 'g'))), 20)
$$;

create or replace function public.inbox_notifications_shape()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pid uuid;
  v_line text;
  v_check text;
  v_key text;
  v_keys text[] := '{}';
  v_hit uuid;
  v_now timestamptz := clock_timestamp();
begin
  begin
    if new.family = 'reply_draft_pending' and new.severity <> 'error' then
      v_pid := public.inbox_draft_notice_prospect(new.title, coalesce(new.created_at, v_now));
      if v_pid is not null then
        new.media := coalesce(new.media, '{}'::jsonb) || jsonb_build_object('prospect_id', v_pid);
        new.url := './#exp/d/dms?thread=' || v_pid;
        new.group_key := 'reply_draft_pending:' || v_pid;
        -- Never closed here: the sweep closes it once nothing waits (an auto-queued DM1 within ~15 min).
      end if;

    elsif new.family = 'inbound_reply_notice' then
      -- The tap opens that person's thread, not the DMs list. Feed-only family; nothing closes it here.
      v_pid := public.inbox_inbound_notice_prospect(new.title || ' ' || coalesce(new.body, ''), coalesce(new.created_at, v_now));
      if v_pid is not null then
        new.media := coalesce(new.media, '{}'::jsonb) || jsonb_build_object('prospect_id', v_pid);
        new.url := './#exp/d/dms?thread=' || v_pid;
      end if;

    elsif new.family = 'post_generation_failed' then
      -- One group per Warsaw day, across both generators: a burst reads as one batch.
      new.group_key := 'post_generation_failed:' || to_char(coalesce(new.created_at, v_now) at time zone 'Europe/Warsaw', 'YYYY-MM-DD');

    elsif new.family = 'useful_output_health' and new.incident_key is null then
      -- One run row lists every failing check ("- <check>" lines). Each check is its own incident.
      -- One lock for the whole fan-out + close per watchdog source: two overlapping runs serialize.
      perform pg_advisory_xact_lock(hashtextextended('watchdog-fanout:' || coalesce(new.source, '_'), 0));
      for v_line in select btrim(substr(l, 3)) from regexp_split_to_table(coalesce(new.body, ''), E'\n') as l
                     where l ~ '^- \S' loop
        v_key := public.inbox_watchdog_check_key(new.source, v_line);
        v_keys := v_keys || v_key;
        -- A check that passed (auto-resolved) and fails again is a new incident. One Ivan dismissed during
        -- an unbroken failure stays dismissed and just counts.
        select n.id into v_hit from public.inbox_notifications n
         where n.incident_key = v_key and n.family = 'useful_output_health'
           and n.last_seen_at > v_now - interval '3 hours'
           and not coalesce(n.media ? 'resolved_at', false)
         order by n.last_seen_at desc limit 1;
        if v_hit is not null then
          -- Still failing: count it, keep the newest numbers, stay quiet (dismissed stays dismissed).
          update public.inbox_notifications n
             set count = n.count + 1, last_seen_at = v_now, body = v_line, severity = new.severity
           where n.id = v_hit;
        else
          v_check := left(v_line, 160);
          insert into public.inbox_notifications
            (family, source, incident_key, severity, title, body, group_key, tenant,
             first_seen_at, last_seen_at, created_at, push_result)
          values
            ('useful_output_health', new.source, v_key, new.severity, 'Watchdog check failing: ' || v_check, v_line,
             'watchdog:' || v_key, new.tenant, v_now, v_now, v_now,
             jsonb_build_object('suppressed', true, 'reason', 'watchdog_incident_feed_only'));
        end if;
        v_hit := null;
      end loop;
      -- A body with no "- <check>" lines is a shape we do not know: leave the row exactly as written.
      if cardinality(v_keys) > 0 then
        -- A check this run no longer lists has passed: its incident closes.
        update public.inbox_notifications n
           set dismissed_at = coalesce(n.dismissed_at, v_now), read_at = coalesce(n.read_at, v_now),
               media = coalesce(n.media, '{}'::jsonb) || jsonb_build_object('resolved_at', v_now)
         where n.family = 'useful_output_health' and n.source is not distinct from new.source
           and n.incident_key like 'watchdog:%' and not coalesce(n.media ? 'resolved_at', false)
           and n.last_seen_at > v_now - interval '3 hours'
           and not (n.incident_key = any (v_keys));
        -- The run row itself is a log: kept, never in the bell.
        new.read_at := coalesce(new.read_at, v_now);
        new.dismissed_at := coalesce(new.dismissed_at, v_now);
      end if;
    end if;
  exception when others then
    raise warning 'inbox_notifications_shape (%): %', new.family, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists inbox_notifications_shape on public.inbox_notifications;
create trigger inbox_notifications_shape
  before insert on public.inbox_notifications
  for each row
  when (new.family in ('reply_draft_pending', 'inbound_reply_notice', 'post_generation_failed', 'useful_output_health'))
  execute function public.inbox_notifications_shape();

-- The watchdog writes nothing when every check passes, so a check it stopped reporting closes after 3 hours.
create or replace function public.inbox_close_quiet_watchdog_incidents()
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_n int;
begin
  update public.inbox_notifications n
     set dismissed_at = coalesce(n.dismissed_at, now()), read_at = coalesce(n.read_at, now()),
         media = coalesce(n.media, '{}'::jsonb) || jsonb_build_object('resolved_at', now())
   where n.family = 'useful_output_health' and n.incident_key like 'watchdog:%'
     and not coalesce(n.media ? 'resolved_at', false) and n.last_seen_at < now() - interval '3 hours'
     and n.last_seen_at > now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.inbox_close_draft_notices(uuid) from public, anon, authenticated;
revoke all on function public.inbox_sweep_draft_notices() from public, anon, authenticated;
revoke all on function public.inbox_close_quiet_watchdog_incidents() from public, anon, authenticated;
revoke all on function public.inbox_notifications_shape() from public, anon, authenticated;

-- Schedules (skipped where pg_cron is absent, e.g. the PGlite tests).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('inbox-draft-notice-sweep', 'inbox-watchdog-incident-close');
    perform cron.schedule('inbox-draft-notice-sweep', '1-59/5 * * * *', 'select public.inbox_sweep_draft_notices()');
    perform cron.schedule('inbox-watchdog-incident-close', '35 * * * *', 'select public.inbox_close_quiet_watchdog_incidents()');
  end if;
end $$;
