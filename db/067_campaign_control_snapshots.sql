-- db/067_campaign_control_snapshots.sql
-- Goal run campaign-control-03-operator-view-2026-09-13.
-- UNAPPLIED. Nothing in this run executed it; Run 04 applies it.
--
-- The operator payload (`cc03.v1`) has to reach the inbox without a laptop in
-- the loop, so it lands as a row a signed-in reader can SELECT. Two rules the
-- table enforces rather than documents:
--   * the anon role gets NOTHING. The browser payload carries no memory bodies
--     and no locators, but it does carry the operating shape of three seats,
--     and the inbox is an authenticated surface.
--   * only the service role writes. The monitor is the single writer; a reader
--     can never author a snapshot that another reader would then trust.
--
-- The private `evidence` kind lives in the SAME table under its own kind so the
-- drill-down is one policy, not two tables with two policies to keep in step.

create table if not exists public.campaign_control_snapshots (
  id            bigint generated always as identity primary key,
  kind          text        not null check (kind in ('operator', 'evidence')),
  payload_version text      not null,
  generated_at  timestamptz not null,
  as_of         timestamptz,
  source_mode   text,
  host          text,
  inputs_sha256 text,
  payload       jsonb       not null,
  created_at    timestamptz not null default now()
);

comment on table public.campaign_control_snapshots is
  'Operator control payloads (cc03.v1). kind=operator is the browser-safe payload; kind=evidence is the private drill-down. Written by the service role only; read by authenticated readers only.';

-- Newest-first reads by kind are the only access pattern.
create index if not exists campaign_control_snapshots_kind_generated_idx
  on public.campaign_control_snapshots (kind, generated_at desc);

alter table public.campaign_control_snapshots enable row level security;
-- Belt and braces: policies apply to the table owner too.
alter table public.campaign_control_snapshots force row level security;

-- SELECT for signed-in readers. No INSERT / UPDATE / DELETE policy exists for
-- any role, so under RLS the service role (which bypasses RLS) is the only
-- writer. There is deliberately NO policy naming `anon`.
drop policy if exists campaign_control_snapshots_select_authenticated on public.campaign_control_snapshots;
create policy campaign_control_snapshots_select_authenticated
  on public.campaign_control_snapshots
  for select
  to authenticated
  using (true);

revoke all on public.campaign_control_snapshots from anon;
revoke all on public.campaign_control_snapshots from public;
grant select on public.campaign_control_snapshots to authenticated;

-- The view the app reads first. `security_invoker` makes it run as the caller,
-- so the policy above is the only thing deciding who sees a row: a view that
-- ran as its definer would hand anon a way around RLS.
drop view if exists public.campaign_control_latest_v;
create view public.campaign_control_latest_v
  with (security_invoker = true)
  as
  select s.*
  from public.campaign_control_snapshots s
  where s.kind = 'operator'
  order by s.generated_at desc
  limit 1;

revoke all on public.campaign_control_latest_v from anon;
revoke all on public.campaign_control_latest_v from public;
grant select on public.campaign_control_latest_v to authenticated;
