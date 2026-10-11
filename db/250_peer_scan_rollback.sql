-- Rollback for 250_peer_scan.sql (thread C, 2026-10-11). Unschedules the peer-scan cron jobs first.
select cron.unschedule(jobname) from cron.job where jobname like 'peer-scan%';
drop view if exists peer_scan_daily_v;
drop function if exists peer_scan_track(text, text, jsonb, jsonb);
drop function if exists peer_scan_dispatch(text, uuid);
drop table if exists peer_scan_events, peer_scan_spend, peer_scan_posts, peer_scan_creators, peer_scan_reports, peer_scan_niches, peer_scan_orders;
