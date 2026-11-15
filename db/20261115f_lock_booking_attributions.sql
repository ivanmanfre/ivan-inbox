BEGIN;

-- 20261115f_lock_booking_attributions Batch 6 of 6: booking_attributions (names and emails of people who booked calls).
--
-- Part of the 2026-11-15 lock of objects the public (anon) key could read or change. Found 2026-11-14: 26 tables in
-- public had row level security OFF and ALL privileges for anon and authenticated (Supabase default grants on tables
-- made by SQL), and the cb37 views run with owner rights with the same grants.
-- Roles checked before writing this (7 days of API gateway logs, 2026-11-08 to 2026-11-15, plus who-reads --no-indirect
-- on every object): every request to these objects used a service key (57,000+ calls: n8n, the Railway runner, edge
-- functions); 0 came from the public key or a signed-in user, directly or embedded. Sign-up is disabled on the project.
-- service_role and postgres bypass row level security and keep their grants, so no policy is added (same as the
-- content_outcome_* tables locked on 2026-11-14). Nothing is dropped or deleted.
--
-- Readers (all with a service key): n8n AwLraR9lQkmMTJq1, helJXFCyt2phq5V3, lclDI4YbKxDqJn7r, ljScU93VL0qg50OW,
-- xBtsJQdd0T7lSeL6, 1PJye5BP8o8BzwJ4, IHOpAedk4gJFNQo4, NG9LxNPh5FtYZsg3, lj89AJ09mNPAt0EZ, mWzrQVgttbHDRq1o,
-- uee9FUFHxdRrhjMB; edge functions risedtc-hubspot-deal-stages and inbox-calendar (its service client).
-- Writers (service key): n8n IBEhtM47QOlroNdo, X8woPv26UrC4Mnhz, siEM4bDSfevuVCII, wyJZ9TcGul7QvDEz; in the database
-- booking_ingest_event and the cron jobs (owner rights). The inbox app never reads the table from the browser; it goes
-- through owner-rights functions. Client lanes stay scoped by the client_id filter each reader already sends.
-- Rollback: 20261115f_lock_booking_attributions_rollback.sql

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.booking_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_attributions FROM anon, authenticated;

COMMIT;
