-- 015: Inbox Ops Lane — Slack-bound drafts awaiting approval (2026-07-24)
--
-- Two kinds of rows queue here for Ivan's approve/discard in the inbox app:
--   escalation — inbound reply needs client input (packet for the Rise channel)
--   update     — proactive client-visible win mined from session history
-- Approve in inbox stamps approved_at; the n8n dispatcher (q2min) is the ONLY
-- writer of sent_at and only processes approved_at NOT NULL AND sent_at NULL
-- AND send_blocked_reason NULL, gated by integration_config.ops_drafts_enabled.
-- Nothing in this lane auto-approves.

create table if not exists ops_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null default 'rise',
  kind text not null check (kind in ('escalation', 'update')),
  slack_channel text not null,
  body text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  send_blocked_reason text
);

alter table ops_drafts enable row level security;

-- Same posture as the rest of the inbox: Ivan is the sole authenticated login.
drop policy if exists "authenticated all ops_drafts" on ops_drafts;
create policy "authenticated all ops_drafts" on ops_drafts
  for all to authenticated using (true) with check (true);

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'ops_drafts'
  ) then
    alter publication supabase_realtime add table ops_drafts;
  end if;
end $$;

-- Kill-switch row (dispatcher refuses to post when != 'true').
insert into integration_config (key, value, is_secret)
select 'ops_drafts_enabled', 'true', false
where not exists (select 1 from integration_config where key = 'ops_drafts_enabled');
