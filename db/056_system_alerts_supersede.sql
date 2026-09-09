-- system_alerts: a daily writer supersedes its own older row.
--
-- Measured 2026-09-09: 79 open rows back to 2026-08-07. outreach_output_rate
-- stamps output:warn:<date> every day and never resolves yesterday's row, so
-- Today's alert strip carried a month of "Outreach output down" nobody could
-- act on. From here, an insert resolves the open rows with the same source and
-- title that landed before it. The reader (lib/systemAlerts.ts) also windows
-- to 14 days and carries a Clear all, so nothing depends on this alone.
create or replace function public.system_alerts_supersede() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.system_alerts
     set resolved_at = now(), resolved_by = 'superseded:' || new.dedupe_key
   where resolved_at is null
     and source = new.source
     and title = new.title
     and id <> new.id
     and created_at < coalesce(new.created_at, now());
  return new;
end $$;
revoke execute on function public.system_alerts_supersede() from public, anon, authenticated;

drop trigger if exists system_alerts_supersede on public.system_alerts;
create trigger system_alerts_supersede
  after insert on public.system_alerts
  for each row execute function public.system_alerts_supersede();

-- One-time, applied 2026-09-09 10:40Z via the management API (restorable by
-- resolved_by = 'superseded:2026-09-09'): resolve every open row older than
-- seven days, and every open row a newer row of the same source outranks.
-- update public.system_alerts a
--    set resolved_at = now(), resolved_by = 'superseded:2026-09-09'
--  where resolved_at is null
--    and (created_at < now() - interval '7 days'
--      or exists (select 1 from public.system_alerts b
--                  where b.source = a.source and b.resolved_at is null and b.created_at > a.created_at));
