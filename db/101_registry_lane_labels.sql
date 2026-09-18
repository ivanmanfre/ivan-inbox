-- 101: the name the operator calls a lane, and the order the lanes sit in, both in the registry.
--
-- 100 made the inbox's lane switch read client_registry through operator_lanes() instead of the
-- literal ['ivan','risedtc','arch'] at src/lib/content.ts:14. That read was correct and the labels
-- were wrong: the switch started reading
--     "ARCH. Influencer Agency (Davorin Smit)"   "Ivan Content System"   "RISE DTC (Mattan Danino)"
-- where the inbox has always read
--     "Ivan"   "Mattan Danino"   "Davorin Smit"
-- because `display_name` is the registry's long name for the tenant and nothing held the short one.
--
-- The existing platform.client object does not answer it either. It carries `display_name` (the
-- COMPANY: "RISE DTC", "ARCH. Influencer Agency") and `founder_name` (the person, spelled with the
-- diacritic: "Davorin Šmit"), and Ivan's own lane is neither a company nor a founder to the
-- operator, it is just "Ivan". So the label the operator reads gets its own slot.
--
--   platform.client.name  what the operator calls this lane in the inbox
--   platform.client.rank  where it sits in the switch, smallest first
--
-- `rank` exists because the order was information too. The typed-in constant ran Ivan, Mattan,
-- Davorin: Ivan's own lane first, then the clients in the order they signed. No column of the
-- registry reproduces that, and sorting by name would reorder a switch the operator has used for
-- months. An unranked client sorts after all three by name, which is the honest place for a lane
-- nobody has placed yet.
--
-- Nothing else reads platform.client.name: db/091's overview reads `tier` and `company`, and the
-- static readout already reads exactly this key with display_name as its fallback. Both are
-- unaffected. This is a jsonb_set on one key at a time, so every other key of platform, including
-- measurement.roster, which lane_allowed() rests on, is carried through untouched.

update public.client_registry
   set platform = jsonb_set(jsonb_set(platform, '{client,name}', to_jsonb(v.name), true),
                            '{client,rank}', to_jsonb(v.rank), true)
  from (values
          ('ivan',    'Ivan',           1),
          ('risedtc', 'Mattan Danino',  2),
          ('arch',    'Davorin Smit',   3)
       ) as v(client_id, name, rank)
 where public.client_registry.client_id = v.client_id
   and jsonb_typeof(public.client_registry.platform->'client') = 'object';

-- The lane list now orders by that rank. Body identical to 100 apart from the order by.
create or replace function public.operator_lanes(p_gate text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('client_id', r.client_id, 'display_name', r.display_name)
                     order by r.rank, r.display_name, r.client_id)
    from (
      select c.client_id,
             coalesce(nullif(btrim(c.platform->'client'->>'name'), ''), c.display_name) as display_name,
             coalesce((c.platform->'client'->>'rank')::int, 1000) as rank
      from public.client_registry c
      where coalesce(c.is_active, false)
        and public.lane_allowed(c.client_id)
    ) r
  ), '[]'::jsonb);
end $function$;

revoke all on function public.operator_lanes(text) from public;
revoke all on function public.operator_lanes(text) from anon;
grant execute on function public.operator_lanes(text) to authenticated;
grant execute on function public.operator_lanes(text) to service_role;
