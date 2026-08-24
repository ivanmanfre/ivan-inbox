-- 043: the live ICP filter spec, published BY the engine that enforces it.
-- Ivan, 2026-08-24: "I want these filters to be live on my Inbox section on
-- strategy, and whenever we change them, I want this to show."
--
-- WHY THE ENGINE PUBLISHES INSTEAD OF THE APP KEEPING A COPY: every gate lives
-- in n8n jsCode. A hand-maintained copy in the app is a second source of truth
-- and drifts the first time someone edits a regex, which is the failure mode
-- this is meant to prevent. The node writes what it ACTUALLY ran with, on every
-- run, so the surface can never be newer or older than the engine.
--
-- `spec` is deliberately schema-free: a list of {group, label, rule, note}.
-- The UI renders whatever arrives, so adding a gate in n8n needs NO app change
-- and no migration. Adding a column here would rebuild that coupling.
create table if not exists outreach_filter_spec (
  client_id   text not null,
  run_tag     text not null,
  captured_at timestamptz not null default now(),
  spec        jsonb not null,
  primary key (client_id, run_tag)
);

alter table outreach_filter_spec enable row level security;

drop policy if exists filter_spec_read on outreach_filter_spec;
create policy filter_spec_read on outreach_filter_spec for select to anon, authenticated using (true);

-- Latest spec per client. One row per lane engine (run_tag), newest first.
create or replace view inbox_filter_spec_v with (security_invoker = on) as
select client_id, run_tag, captured_at, spec
from outreach_filter_spec;

grant select on outreach_filter_spec to anon, authenticated;
grant select on inbox_filter_spec_v to anon, authenticated;
