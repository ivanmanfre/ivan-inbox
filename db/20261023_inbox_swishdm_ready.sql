-- Supply panel reads SwishDM's sender-ready count from the same snapshot the harvest lane steers by:
-- approved, unsent noted invites the invite sender (n8n liq2eF9e3mSC1am7) would pick now. Not the raw engager pool.
-- No caller-supplied scope. Existing inbox operator membership is required.
create or replace function public.inbox_swishdm_ready()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare s jsonb;
begin
  if not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id = 'ivan' and auth.uid() = any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode = '42501'; end if;
  s := public.swishdm_supply_snapshot();
  return jsonb_build_object('as_of', s->'at', 'ready_count', s->'sendable_invites', 'awaiting_release', s->'awaiting_release');
end;
$$;
revoke all on function public.inbox_swishdm_ready() from public, anon;
grant execute on function public.inbox_swishdm_ready() to authenticated;
notify pgrst, 'reload schema';
