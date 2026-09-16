-- db/072: operator_network_drift - who joined the seat's network through the
-- outreach engine, last 180 days, so the reach block can show the network the
-- posts will reach next to the network they reach now. Tenancy is
-- outreach_campaigns.client_id; Ivan's campaigns carry NULL, never 'ivan'.
-- Read-only, gated and authenticated-only exactly like operator_roster_posts
-- (db/071). No names or URLs leave the table: title, country, location,
-- company and the accept date are all the section needs.
create or replace function public.operator_network_drift(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_since timestamptz := now() - interval '180 days';
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
  return jsonb_build_object(
    'since', v_since,
    'joined', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'connected_at', p.connected_at,
          'title', p.title,
          'country', p.country,
          'location', p.location,
          'company', p.company)
        order by p.connected_at desc), '[]'::jsonb)
      from public.outreach_prospects p
      join public.outreach_campaigns c on c.id = p.campaign_id
      where p.connected_at >= v_since
        and ((p_client_id = 'ivan' and c.client_id is null) or c.client_id = p_client_id)
    )
  );
end $$;

revoke all on function public.operator_network_drift(text, text) from public, anon;
grant execute on function public.operator_network_drift(text, text) to authenticated, service_role;
