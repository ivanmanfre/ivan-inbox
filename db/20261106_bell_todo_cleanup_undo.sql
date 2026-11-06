-- Undo for db/20261106_bell_todo_cleanup.sql: reopens exactly the rows the cleanup closed (its stamp).
-- Links (url, group_key, media.prospect_id) and lane incident keys are left: restore them from
-- ~/.claude/backups/bell-todo-2026-11-06/rows-before.json if ever needed.
update public.inbox_notifications
   set dismissed_at = null,
       read_at = case when read_at = '2026-11-06 14:00:00.000611+00' then null else read_at end
 where dismissed_at = '2026-11-06 14:00:00.000611+00';
