-- 102: client_research_outliers + operator_market_outliers. The reach outlier study, stored once.
--
-- A reach outlier study reads a market's authors over a long window, keeps the posts that beat
-- their author's OWN baseline, and then reads who reacted to them. It is a reasoned pass over a
-- frozen corpus (the post types and the reactor classes are judged by reading, never by keyword),
-- so it is stored whole and read back, the way 099 stores insights.
--
-- Why a table of its own and not rows in client_research_insights: operator_market_readout takes
-- exactly ONE insights run, the newest. A study written there under its own run_id would replace
-- the insight cards on the Markets screen. One row per (client_id, run_id) here, one jsonb
-- `reading` that carries the answer line, the three cards, the three lines, the bands, the
-- winners and the method. The view renders what is there.
--
-- The market only. The study's control rows (the lane's own posts) are never written here: a
-- market read that carries own performance was rejected on 2026-09-19.
--
-- Tenancy: client_id leads the key, the reader is lane-scoped by construction. RLS on, service
-- role only; the one reader is security definer behind operator_gate_ok + lane_allowed.

create table if not exists public.client_research_outliers (
  client_id   text        not null,
  run_id      text        not null,
  reading     jsonb       not null,
  created_at  timestamptz not null default now(),
  constraint client_research_outliers_pkey primary key (client_id, run_id),
  constraint client_research_outliers_run_nonempty check (btrim(run_id) <> ''),
  constraint client_research_outliers_reading_object check (jsonb_typeof(reading) = 'object')
);

create index if not exists client_research_outliers_client_created_idx
  on public.client_research_outliers (client_id, created_at desc);

alter table public.client_research_outliers enable row level security;
revoke all on public.client_research_outliers from public, anon, authenticated;
grant select, insert, update, delete on public.client_research_outliers to service_role;

-- The newest study for one lane, or null when the lane has none. Null hides the block.
create or replace function public.operator_market_outliers(p_gate text, p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if not public.lane_allowed(p_client_id) then raise exception 'unknown seat'; end if;

  return (
    select o.reading || jsonb_build_object('run_id', o.run_id, 'created_at', o.created_at)
    from public.client_research_outliers o
    where o.client_id = p_client_id
    order by o.created_at desc, o.run_id desc
    limit 1
  );
end;
$function$;

-- anon is revoked by name: a default-privileges rule grants it on every new function (see 100).
revoke all on function public.operator_market_outliers(text, text) from public;
revoke all on function public.operator_market_outliers(text, text) from anon;
grant execute on function public.operator_market_outliers(text, text) to authenticated;
grant execute on function public.operator_market_outliers(text, text) to service_role;
