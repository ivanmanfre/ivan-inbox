-- came_back_mark_skipped(): the Came back drafter (arm inside Outreach - Stalled Conversation Bump)
-- lets the model answer SKIP when another message would be pushy. Without a stamp it re-asked the
-- same question about the same person every 6 hours (Jake W., Vincent Thompson, 2026-09-18).
-- The stamp is compared with the card's last_signal_at, so a NEWER signal re-opens the question,
-- same rule as came_back_dismiss. Merged with ||, never touches updated_at. service_role only.
create or replace function public.came_back_mark_skipped(p_prospect_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  update outreach_prospects
     set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
       || jsonb_build_object('came_back_draft_skip_at', now(), 'came_back_draft_skip_why', left(coalesce(p_reason, ''), 200))
   where id = p_prospect_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end $$;
revoke all on function public.came_back_mark_skipped(uuid, text) from public, anon, authenticated;
grant execute on function public.came_back_mark_skipped(uuid, text) to service_role;
