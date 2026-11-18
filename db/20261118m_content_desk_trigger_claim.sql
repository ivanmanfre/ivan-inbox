-- Content Desk: claim a proactive trigger under the weekly cap, atomically (Sol desk-backend r1).
-- One transaction-scoped advisory lock serialises claimers, so two ticks can never both take the
-- last slot of a Warsaw week. Dedupe stays on desk_triggers.dedupe_key (unique).
--
-- t3_done is COUNTED but never blocked: Ivan asked for that job himself, so its result always
-- reaches him; it still uses up the week's room for unprompted messages.
-- Returns the new desk_triggers.id, or null when the key already fired or the week is full.
create or replace function public.desk_claim_trigger(p_kind text, p_dedupe_key text, p_payload jsonb, p_cap integer)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_week_start timestamptz := (date_trunc('week', now() at time zone 'Europe/Warsaw')) at time zone 'Europe/Warsaw';
  v_count integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('desk_claim_trigger'));
  if exists (select 1 from public.desk_triggers where dedupe_key = p_dedupe_key) then
    return null;
  end if;
  select count(*) into v_count from public.desk_triggers
   where fired_at >= v_week_start and suppressed is null;
  if p_kind <> 't3_done' and v_count >= greatest(coalesce(p_cap, 5), 0) then
    return null;
  end if;
  insert into public.desk_triggers (kind, dedupe_key, payload)
  values (p_kind, p_dedupe_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.desk_claim_trigger(text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.desk_claim_trigger(text, text, jsonb, integer) to service_role;
