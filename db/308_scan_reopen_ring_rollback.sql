-- Rollback 308: restore the 304 scan_open_finalize (no ring), then drop the ring objects.
create or replace function public.scan_open_finalize(p_id bigint, p_asn int, p_org text, p_country text, p_city text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.scan_opens;
  v_asn int := p_asn;
  v_org text := p_org;
  v_fleet boolean;
  v_near boolean;
  v_class text;
  v_reason text;
begin
  select * into r from public.scan_opens where id = p_id;
  if not found then
    return jsonb_build_object('open_class', null, 'class_reason', 'no_row', 'ring', false);
  end if;
  if r.ip_hash is not null and (p_org is not null or p_asn is not null) then
    insert into public.open_networks (ip_hash, asn, org, country_code, city, source)
    values (r.ip_hash, p_asn, p_org, p_country, p_city, 'edge_lookup')
    on conflict (ip_hash) do update set
      asn = coalesce(excluded.asn, open_networks.asn), org = coalesce(excluded.org, open_networks.org),
      country_code = coalesce(excluded.country_code, open_networks.country_code),
      city = coalesce(excluded.city, open_networks.city), source = 'edge_lookup', last_seen = now();
  elsif r.ip_hash is not null then
    select n.asn, n.org into v_asn, v_org from public.open_networks n where n.ip_hash = r.ip_hash;
    update public.open_networks set last_seen = now() where ip_hash = r.ip_hash;
  end if;
  select c.fleet, c.near_li_send into v_fleet, v_near from public.scan_open_context(p_id) c;
  -- Rule 8 means "the lookup failed". A known org with no ASN (gateway-log seed rows) is a known network: pass the
  -- reserved AS0 to the classifier, which is never in open_known_networks. Only the real ASN is stored on the row.
  select k.open_class, k.class_reason into v_class, v_reason
    from public.scan_open_classify(r.is_owner, r.user_agent, r.referrer_host, r.device_type,
                                   coalesce(v_asn, case when v_org is not null then 0 end), v_fleet, v_near) k;
  update public.scan_opens
     set net_asn = v_asn, net_org = v_org, open_class = v_class, class_reason = v_reason, classified_at = now()
   where id = p_id;
  return jsonb_build_object('open_class', v_class, 'class_reason', v_reason, 'ring', false);
end $$;

revoke all on function public.scan_open_finalize(bigint, int, text, text, text) from public, anon, authenticated;
grant execute on function public.scan_open_finalize(bigint, int, text, text, text) to service_role;

drop function if exists public.scan_reopen_ring_step(bigint);
drop table if exists public.scan_reopen_rings;
delete from public.integration_config where key = 'scan_reopen_ring';
