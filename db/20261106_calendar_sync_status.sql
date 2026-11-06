-- Calendar sync status for the Sales line "Calendar checked HH:MM · last new booking <day>" (2026-11-06).
--
-- Why: an empty Sales week looked the same whether the calendar was empty or the sync was broken.
-- The sync (n8n 20egDa9ZOnMEpJ5V, Google Calendar → Dashboard Sync) now writes
-- integration_config.calendar_sync_heartbeat on every run in which Google answered, including
-- an answer with zero events: {"checked_at": ISO, "fetched": n, "window_days": 14}.
-- A failed Google read writes nothing, so the timestamp goes stale and the app says so.
--
-- integration_config holds secrets and is not readable by the app, so this definer function
-- exposes only the heartbeat row and one max() over calendar_events.
-- "New booking" = a Google calendar row first seen by the sync (created_at), ignoring the
-- calendly:* attribution rows, all-day blocks, "Canceled:" renames and "Out of office" blocks.

create or replace function public.calendar_sync_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'checked_at', (select case when value ~ '^\s*\{' then value::jsonb ->> 'checked_at' end
                   from integration_config where key = 'calendar_sync_heartbeat'),
    'fetched', (select case when value ~ '^\s*\{' then (value::jsonb ->> 'fetched')::int end
                from integration_config where key = 'calendar_sync_heartbeat'),
    'last_new_booking_at', (select max(created_at) from calendar_events
                            where google_event_id not like 'calendly:%'
                              and coalesce(is_all_day, false) = false
                              and coalesce(title, '') not ilike 'canceled:%'
                              and coalesce(title, '') not ilike 'out of office%')
  );
$$;

revoke all on function public.calendar_sync_status() from public, anon;
grant execute on function public.calendar_sync_status() to authenticated, service_role;
