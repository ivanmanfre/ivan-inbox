-- 2026-11-16 (speed review): a fingerprint per Operations row, so the app re-downloads only rows that changed.
--
-- Home and Ops read the newest 300 ops_drafts in full (body + context, ~230 KB gzip) on every open, focus and
-- realtime change. The app now keeps those rows on the device and first reads only id + digest for the same
-- 300 rows (same filters, same order); rows whose digest differs are read in full by id.
--
-- digest = md5 of the whole stored row as jsonb, so ANY column change (body, context, state, a column added
-- later) changes it. security_invoker: the view runs with the caller's rights, so ops_drafts RLS applies
-- unchanged. Authenticated only; anon and PUBLIC hold nothing (the daily public-key surface check expects
-- 0 views open to anon).
BEGIN;

CREATE VIEW public.ops_drafts_digest_v WITH (security_invoker = true) AS
  SELECT d.id, d.client_id, d.kind, d.slack_channel, d.body, d.context, d.created_at, d.approved_at, d.sent_at,
         d.send_blocked_reason, md5(to_jsonb(d)::text) AS digest
  FROM public.ops_drafts d;

REVOKE ALL ON public.ops_drafts_digest_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ops_drafts_digest_v TO authenticated, service_role;

COMMENT ON VIEW public.ops_drafts_digest_v IS
  'ops_drafts rows plus md5 of the whole stored row. The inbox app reads id,digest first and only changed rows in full (db/20261116a).';

COMMIT;
