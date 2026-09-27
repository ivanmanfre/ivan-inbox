-- db/217 — Came back "Dismiss" gets an Undo (DMs rebuild, blueprint v3). Removes exactly the stamp
-- came_back_dismiss() (db/087) writes, nothing else. One jsonb key, never a send.
create or replace function public.came_back_undismiss(p_prospect_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_n integer;
begin
  update outreach_prospects
     set enrichment_data = enrichment_data - 'came_back_dismissed_at'
   where id = p_prospect_id and enrichment_data ? 'came_back_dismissed_at';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end $$;

-- Same grant shape as 087: authenticated + service_role, never anon.
revoke all on function public.came_back_undismiss(uuid) from public, anon;
grant execute on function public.came_back_undismiss(uuid) to authenticated, service_role;
