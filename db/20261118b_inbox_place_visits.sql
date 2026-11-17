-- 20261118b_inbox_place_visits: a log of which pages (places) of the inbox app the signed-in user opens.
--
-- The app has one user and no record of where he goes. inbox_place_visits holds one row per visit; the app calls
-- inbox_log_visit(place, sub, surface) when a page opens. surface is where he was: the daily brief, the phone app, or
-- the web app.
--
-- Public key: no grant. The table and its identity sequence are revoked from PUBLIC and anon; only authenticated may
-- read and insert, and the row policies limit both to the caller's own rows (user_id = auth.uid()). The RPC is
-- security invoker, so those policies are what allow the insert; execute goes to authenticated only (the default
-- privileges would otherwise hand a new function to PUBLIC and anon).
-- public_key_surface_check() (20261115w) counts: security definer functions anon can execute (this one is invoker and
-- closed to anon: not counted), views with an anon privilege (none), tables with RLS off and an anon privilege (RLS is
-- on, anon has nothing), policies reaching anon with no condition (both policies are to authenticated with
-- user_id = auth.uid()). It stays at its expected values; its list needs no change.
-- Readers (who-reads 11-17): none, the table and the function are new.
-- Rollback: 20261118b_inbox_place_visits_rollback.sql
begin;

create table public.inbox_place_visits (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  place text not null,
  sub text,
  surface text not null check (surface in ('brief', 'phone', 'web')),
  at timestamptz not null default now()
);
create index inbox_place_visits_at_idx on public.inbox_place_visits (at desc);

alter table public.inbox_place_visits enable row level security;
revoke all on public.inbox_place_visits from public, anon, authenticated;
revoke all on sequence public.inbox_place_visits_id_seq from public, anon, authenticated;
grant select, insert on public.inbox_place_visits to authenticated;
grant usage on sequence public.inbox_place_visits_id_seq to authenticated;

create policy inbox_place_visits_select_own on public.inbox_place_visits
  for select to authenticated using (user_id = auth.uid());
create policy inbox_place_visits_insert_own on public.inbox_place_visits
  for insert to authenticated with check (user_id = auth.uid());

create function public.inbox_log_visit(p_place text, p_sub text, p_surface text)
 returns void
 language sql
 security invoker
 set search_path to 'public'
as $function$
  insert into public.inbox_place_visits (place, sub, surface) values (p_place, p_sub, p_surface);
$function$;
revoke all on function public.inbox_log_visit(text, text, text) from public, anon;
grant execute on function public.inbox_log_visit(text, text, text) to authenticated;

commit;
