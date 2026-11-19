-- Content Desk core tables (2026-11-18).
--
-- The desk is a separate surface from the Claude chat (inbox_threads /
-- inbox_turns) and the ops bot. It owns its own tables so nothing that reads
-- the existing chat or the bot ever sees a desk row. One implicit desk per
-- operator (keyed by user_id), so there is no thread table.
--
-- Writes happen only through the content-desk edge function (service role).
-- The app reads its own rows through RLS (user_id = auth.uid()).
-- Every new flag in desk_config ships OFF.

create table if not exists public.desk_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  role        text not null check (role in ('user', 'assistant')),
  -- operator: Ivan typed/spoke it. desk: the desk answered him.
  -- proactive: a trigger wrote first. t3: a cloud job reported back.
  origin      text not null default 'operator'
              check (origin in ('operator', 'desk', 'proactive', 't3')),
  body        text not null default '',
  status      text not null default 'done' check (status in ('streaming', 'done', 'error')),
  -- chips, action echoes, attachments, model, timings, tool calls
  meta        jsonb not null default '{}'::jsonb,
  -- optimistic-send idempotency key from the client
  client_key  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists desk_messages_user_created on public.desk_messages (user_id, created_at desc);
create unique index if not exists desk_messages_client_key on public.desk_messages (user_id, client_key)
  where client_key is not null;

-- Every action the desk took, with what it needs to undo it.
create table if not exists public.desk_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  message_id  uuid references public.desk_messages(id) on delete set null,
  kind        text not null,
  target_id   text,
  args        jsonb not null default '{}'::jsonb,
  result      jsonb,
  undo        jsonb,
  undone_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists desk_actions_user_created on public.desk_actions (user_id, created_at desc);

-- Heavy jobs handed to a T3 Code cloud thread.
create table if not exists public.desk_t3_jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  message_id        uuid references public.desk_messages(id) on delete set null,
  title             text not null,
  brief             text not null,
  status            text not null default 'queued'
                    check (status in ('queued', 'sent', 'launched', 'running', 'done', 'failed', 'stalled')),
  t3_thread_id      text,
  t3_link           text,
  result_summary    text,
  report_token_hash text not null,
  events            jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists desk_t3_jobs_user_created on public.desk_t3_jobs (user_id, created_at desc);

-- Proactive trigger ledger: one row per fired (or suppressed) trigger, deduped.
create table if not exists public.desk_triggers (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  dedupe_key  text not null unique,
  fired_at    timestamptz not null default now(),
  message_id  uuid references public.desk_messages(id) on delete set null,
  suppressed  text,
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists desk_triggers_fired on public.desk_triggers (fired_at desc);

create table if not exists public.desk_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
insert into public.desk_config (key, value) values
  ('desk_enabled', 'false'::jsonb),
  ('triggers_enabled', 'false'::jsonb),
  ('t3_enabled', 'false'::jsonb),
  ('nav_visible', 'false'::jsonb),
  ('proactive_week_cap', '5'::jsonb)
on conflict (key) do nothing;

alter table public.desk_messages enable row level security;
alter table public.desk_actions  enable row level security;
alter table public.desk_t3_jobs  enable row level security;
alter table public.desk_triggers enable row level security;
alter table public.desk_config   enable row level security;

drop policy if exists desk_messages_owner_read on public.desk_messages;
create policy desk_messages_owner_read on public.desk_messages for select to authenticated using (user_id = auth.uid());
drop policy if exists desk_actions_owner_read on public.desk_actions;
create policy desk_actions_owner_read on public.desk_actions for select to authenticated using (user_id = auth.uid());
drop policy if exists desk_t3_jobs_owner_read on public.desk_t3_jobs;
create policy desk_t3_jobs_owner_read on public.desk_t3_jobs for select to authenticated using (user_id = auth.uid());
-- The flags are not secret; the app reads nav_visible / desk_enabled.
drop policy if exists desk_config_read on public.desk_config;
create policy desk_config_read on public.desk_config for select to authenticated using (true);

revoke all on public.desk_messages, public.desk_actions, public.desk_t3_jobs, public.desk_triggers, public.desk_config from anon;
grant select on public.desk_messages, public.desk_actions, public.desk_t3_jobs, public.desk_config to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'desk_messages') then
      execute 'alter publication supabase_realtime add table public.desk_messages';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'desk_t3_jobs') then
      execute 'alter publication supabase_realtime add table public.desk_t3_jobs';
    end if;
  end if;
end $$;
