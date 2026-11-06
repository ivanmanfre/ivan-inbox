-- Rollback for 20261106_calendar_sync_status.sql.
-- The app reads this function inside a try: with it gone the Sales line says the status could not be read.
drop function if exists public.calendar_sync_status();
-- The heartbeat row is harmless; remove it only if the sync's heartbeat node is also removed.
-- delete from integration_config where key = 'calendar_sync_heartbeat';
