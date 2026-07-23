-- 004: prospect context sheet + operator notes (2026-07-23)
--
-- operator_note is Ivan's own annotation on a prospect ("wants Q4 start"),
-- written from the inbox app. It is deliberately a NEW column: the existing
-- `notes` column is system provenance (lane markers like "lm-anchor:...",
-- "InMail content_system auto-send...") written by n8n — never overwrite it.
alter table outreach_prospects add column if not exists operator_note text;
alter table outreach_prospects add column if not exists operator_note_at timestamptz;

-- The inbox app logs in (authenticated role); the only scans read policy was
-- anon-scoped, so the context sheet's scan lookup would return zero rows.
-- Same predicate as "Anon read completed scans".
drop policy if exists "Authenticated read completed scans" on scans;
create policy "Authenticated read completed scans" on scans
  for select to authenticated using (status = 'complete');
