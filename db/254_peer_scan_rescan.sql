-- 254_peer_scan_rescan.sql: the free 30-day re-scan for LinkedIn Peer Scan, 2026-10-12.
-- The thank-you page and the report promise "your free re-scan comes 30 days from now, with your before and after numbers".
-- Design: no new columns. A re-scan is a child order (kind 'rescan', rescan_of = the purchase) that starts in status 'paid',
-- so the existing runner lane, dispatch and checkpoint logic pick it up like any other job. The lane re-reads only the buyer's
-- own posts and profile and writes the before/after into the parent report (same private link).
-- Everything stays behind integration_config.peer_scan_runner_armed = 'true'.
-- Rollback: db/254_peer_scan_rescan_rollback.sql

-- one re-scan per purchase, enforced by the database
create unique index if not exists peer_scan_orders_one_rescan on peer_scan_orders(rescan_of) where kind = 'rescan';

-- queue a re-scan for every delivered purchase whose date has come and that has none yet
create or replace function peer_scan_enqueue_rescans()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with ins as (
    insert into peer_scan_orders(kind, email, linkedin_url, status, is_test, paid_at, rescan_of, utm)
    select 'rescan', p.email, p.linkedin_url, 'paid', p.is_test, now(), p.id, '{}'::jsonb
    from peer_scan_orders p
    where p.kind = 'purchase' and p.status = 'delivered' and p.delivered_at is not null
      and p.rescan_due_at is not null and p.rescan_due_at <= now()
      and not exists (select 1 from peer_scan_orders c where c.rescan_of = p.id)
    on conflict do nothing
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function peer_scan_enqueue_rescans() from public, anon, authenticated;

-- the cron entry point: armed gate, queue due re-scans, then wake the runner when anything waits
create or replace function peer_scan_tick()
returns bigint language plpgsql security definer set search_path = public as $$
begin
  -- integration_config.value is text and holds a JSON string ("true" with the quotes), so trim the quotes
  if coalesce((select trim(both '"' from value) from integration_config where key = 'peer_scan_runner_armed'), 'false') <> 'true' then return null; end if;
  perform peer_scan_enqueue_rescans();
  if exists (select 1 from peer_scan_orders where status = 'paid' or (status = 'running' and stage is distinct from 'held' and locked_at < now() - interval '3 hours')) then
    return peer_scan_dispatch('tick');
  end if;
  return null;
end $$;
revoke all on function peer_scan_tick() from public, anon, authenticated;

-- NOTE: the cron command from 250 (select value #>> '{}' ...) failed on every run: value is text, not jsonb. This replaces it.
select cron.schedule('peer-scan-tick', '*/10 * * * *', 'select public.peer_scan_tick()');
