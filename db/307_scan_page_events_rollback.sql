-- Rollback 307. Redeploy the scan-open edge function without the event branch first (personal-site d11ff3a), or the
-- page's event posts get a 500 until then (they are fire-and-forget; nothing on the page waits on them).
drop view if exists public.scan_booking_page_link;
drop table if exists public.scan_page_events;
