-- db/268: client panel Audience section reads a saved payload.
-- Why: audn_board_payload takes ~4 s for risedtc (2.5 s arch) and the panel call runs under
-- the anon 3 s statement timeout -> HTTP 500, Audience section empty. It also re-sends ~300 KB
-- computed fresh on every open. Now a pg_cron job saves the payload every 15 min; both panel
-- functions read the saved copy (fallback: compute live when no copy exists yet).
-- Rollback: db/268_client_board_audience_cache_rollback.sql

create table if not exists public.audn_board_payload_cache (
  client_id text primary key,
  payload   jsonb,
  built_at  timestamptz not null default now(),
  build_ms  integer
);
alter table public.audn_board_payload_cache enable row level security;
revoke all on public.audn_board_payload_cache from anon, authenticated;

create or replace function public.audn_board_payload_cache_refresh()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; t0 timestamptz; n integer := 0;
begin
  for r in select distinct btrim(client_id) client_id from public.client_boards
            where coalesce(btrim(client_id), '') <> '' and (expires_at is null or expires_at > now()) loop
    begin
      t0 := clock_timestamp();
      insert into public.audn_board_payload_cache(client_id, payload, built_at, build_ms)
      values (r.client_id, public.audn_board_payload(r.client_id), now(),
              (extract(epoch from clock_timestamp() - t0) * 1000)::int)
      on conflict (client_id) do update set payload = excluded.payload, built_at = excluded.built_at, build_ms = excluded.build_ms;
      n := n + 1;
    exception when others then
      raise warning 'audn cache % failed: %', r.client_id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.audn_board_payload_cache_refresh() from public, anon, authenticated;

create or replace function public.audn_board_payload_saved(p_client_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select payload from public.audn_board_payload_cache where client_id = p_client_id),
                  public.audn_board_payload(p_client_id));
$$;
revoke all on function public.audn_board_payload_saved(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_board_audience(p_slug text, p_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
declare v_board public.client_boards%rowtype;
begin
  select * into v_board from public.client_boards
   where slug = p_slug and token = p_token and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if coalesce(btrim(v_board.client_id), '') = '' then
    return jsonb_build_object('ok', true, 'audience', null);
  end if;
  return jsonb_build_object('ok', true, 'audience', public.audn_board_payload_saved(btrim(v_board.client_id)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.client_board_audience_v2(p_slug text, p_session text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
declare v_hash text; v_board public.client_boards%rowtype;
begin
  if coalesce(p_session, '') = '' then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  v_hash := encode(digest(p_session, 'sha256'), 'hex');
  perform 1 from public.client_board_sessions
   where slug = p_slug and token_hash = v_hash and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select * into v_board from public.client_boards
   where slug = p_slug and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if coalesce(btrim(v_board.client_id), '') = '' then
    return jsonb_build_object('ok', true, 'audience', null);
  end if;
  return jsonb_build_object('ok', true, 'audience', public.audn_board_payload_saved(btrim(v_board.client_id)));
end;
$function$;

select public.audn_board_payload_cache_refresh();
select cron.schedule('audn-board-payload-cache', '*/15 * * * *', 'select public.audn_board_payload_cache_refresh()');
