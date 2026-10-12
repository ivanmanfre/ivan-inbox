-- Rollback for 254_peer_scan_rescan.sql: restores the original peer-scan-tick command from 250 and removes the re-scan queue.
-- (The command restored here is the 250 one with its text-vs-jsonb operator bug fixed, so it actually runs.)
-- Queued rescan child orders are left alone; delete them by hand if wanted (where kind = 'rescan').
select cron.schedule('peer-scan-tick', '*/10 * * * *', $c$select public.peer_scan_dispatch('tick') where (select trim(both '"' from value) from public.integration_config where key='peer_scan_runner_armed') = 'true' and exists (select 1 from public.peer_scan_orders where status='paid' or (status='running' and stage is distinct from 'held' and locked_at < now() - interval '3 hours'))$c$);
drop function if exists peer_scan_tick();
drop function if exists peer_scan_enqueue_rescans();
drop index if exists peer_scan_orders_one_rescan;
