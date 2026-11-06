-- One-time cleanup after db/20261106_bell_todo_alarm_incidents.sql (run once, after the migration).
-- Every row this closes takes the stamp 2026-11-06 14:00:00.000611+00, so db/20261106_bell_todo_cleanup_undo.sql
-- reopens exactly these rows. The rows as they were (url, group_key, media, incident_key, read/dismissed) are in
-- ~/.claude/backups/bell-todo-2026-11-06/rows-before.json.

-- 1. "Reply drafted" rows: link each open one to its person, then close the ones with nothing left waiting.
with c as (
  select n.id, public.inbox_draft_notice_prospect(n.title, n.created_at) as pid
    from public.inbox_notifications n
   where n.family = 'reply_draft_pending' and n.dismissed_at is null and n.severity <> 'error'
     and (n.media is null or n.media->>'prospect_id' is null))
update public.inbox_notifications n
   set media = coalesce(n.media, '{}'::jsonb) || jsonb_build_object('prospect_id', c.pid),
       url = './#exp/d/dms?thread=' || c.pid,
       group_key = 'reply_draft_pending:' || c.pid
  from c where c.id = n.id and c.pid is not null;

update public.inbox_notifications n
   set dismissed_at = '2026-11-06 14:00:00.000611+00', read_at = coalesce(n.read_at, '2026-11-06 14:00:00.000611+00')
 where n.family = 'reply_draft_pending' and n.dismissed_at is null
   and n.media->>'prospect_id' ~ '^[0-9a-f-]{36}$' and n.created_at < now() - interval '10 minutes'
   and not public.inbox_prospect_has_waiting_draft((n.media->>'prospect_id')::uuid);

-- 2. New-reply rows naming one person open that thread.
with c as (
  select n.id, public.inbox_inbound_notice_prospect(n.title || ' ' || coalesce(n.body, ''), n.created_at) as pid
    from public.inbox_notifications n
   where n.family = 'inbound_reply_notice' and n.dismissed_at is null
     and (n.media is null or n.media->>'prospect_id' is null))
update public.inbox_notifications n
   set media = coalesce(n.media, '{}'::jsonb) || jsonb_build_object('prospect_id', c.pid),
       url = './#exp/d/dms?thread=' || c.pid
  from c where c.id = n.id and c.pid is not null;

-- 3. The 455 hourly watchdog run rows: logs now. The next run opens one incident per failing check.
update public.inbox_notifications n
   set dismissed_at = '2026-11-06 14:00:00.000611+00', read_at = coalesce(n.read_at, '2026-11-06 14:00:00.000611+00')
 where n.family = 'useful_output_health' and n.incident_key is null and n.dismissed_at is null;

-- 4. Post generation failures: one group per Warsaw day.
update public.inbox_notifications n
   set group_key = 'post_generation_failed:' || to_char(n.created_at at time zone 'Europe/Warsaw', 'YYYY-MM-DD')
 where n.family = 'post_generation_failed' and n.dismissed_at is null;

-- 5. Lane supply alarms seen in the last 36h take their stable incident key, so tonight's repeat of each
--    folds into it instead of ringing once more. Open runner `_busy` rows close (they were never failures).
update public.inbox_notifications n
   set dismissed_at = '2026-11-06 14:00:00.000611+00', read_at = coalesce(n.read_at, '2026-11-06 14:00:00.000611+00')
 where n.family = 'lane_supply_alarm' and n.source = 'runner' and n.dismissed_at is null
   and coalesce(n.body, '') ~ '\(exit -?[0-9]+\): [a-z0-9_]+_busy\s*$';

update public.inbox_notifications n
   set incident_key = public.inbox_lane_alarm_key(n.tenant, n.source, n.title, n.body)
 where n.family = 'lane_supply_alarm' and n.last_seen_at > now() - interval '36 hours'
   and not (n.source = 'runner' and coalesce(n.body, '') ~ '\(exit -?[0-9]+\): [a-z0-9_]+_busy\s*$');
