-- 033 — put the PUBLISH QUEUE on realtime.
--
-- APPLIED LIVE 2026-08-10 via the Management API. This file is the record, not
-- a pending change; re-running it is safe (the guard below makes it a no-op).
--
-- WHY. The content calendar started drawing `scheduled_posts` on 2026-08-10 —
-- it is the table the publisher actually fires from, and 45 posted + 9 pending
-- posts had no carousel_drafts row to be drawn from. But `carousel_drafts` was
-- in the `supabase_realtime` publication and `scheduled_posts` was NOT, so the
-- half of the calendar that changes on a schedule was the half nothing could
-- hear change: a post firing at 12:00 flipped pending → posted in the database
-- and the open tab kept drawing it as pending until someone reloaded.
--
-- The app only uses the event as a "re-read now" trigger (it re-fetches the
-- page rather than patching a row from the payload), so REPLICA IDENTITY stays
-- DEFAULT — the same setting carousel_drafts has run on all along. Nothing here
-- needs the old tuple.
--
-- Reversible in one line:  alter publication supabase_realtime drop table public.scheduled_posts;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scheduled_posts'
  ) then
    alter publication supabase_realtime add table public.scheduled_posts;
  end if;
end $$;
