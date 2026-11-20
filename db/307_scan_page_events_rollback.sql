-- Rollback 307. Keep scan-open deployed so it still labels opens. Event posts no-op after the table is dropped.
drop view if exists public.scan_booking_page_link;
drop table if exists public.scan_page_events;
