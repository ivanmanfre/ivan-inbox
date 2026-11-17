-- Rollback 308: restore the 304 scan_open_finalize (no ring), then drop the ring objects.
create or replace function public.scan_open_finalize(p_id bigint, p_asn int, p_org text, p_country text, p_city text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l record;
begin
  select * into l from public.scan_open_label(p_id, p_asn, p_org, p_country, p_city);
  if l.open_class is null then
    return jsonb_build_object('open_class', null, 'class_reason', 'no_row', 'ring', false);
  end if;
  return jsonb_build_object('open_class', l.open_class, 'class_reason', l.class_reason, 'ring', false);
end $$;

revoke all on function public.scan_open_finalize(bigint, int, text, text, text) from public, anon, authenticated;
grant execute on function public.scan_open_finalize(bigint, int, text, text, text) to service_role;

drop function if exists public.scan_reopen_ring_step(bigint);
drop table if exists public.scan_reopen_rings;
delete from public.integration_config where key = 'scan_reopen_ring';
