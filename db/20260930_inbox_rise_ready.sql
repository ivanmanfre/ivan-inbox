-- Home reads the replenisher's canonical, deduplicated RISE fresh-stock count.
-- No caller-supplied scope. Existing inbox operator membership is required.
create or replace function public.inbox_rise_ready()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare s jsonb;
begin
  if not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id = 'ivan' and auth.uid() = any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode = '42501'; end if;
  s := public.rise_supply_snapshot();
  return jsonb_build_object('as_of',s->'as_of','ready_count',s->'ready_count','ready_ids',s->'ready_ids');
end;
$$;
revoke all on function public.inbox_rise_ready() from public, anon;
grant execute on function public.inbox_rise_ready() to authenticated;
notify pgrst, 'reload schema';
