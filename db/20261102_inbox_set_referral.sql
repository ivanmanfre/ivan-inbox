-- Referral research save for the inbox-dm-draft edge function.
-- Replaces a PostgREST whole-JSON equality filter that overflowed the URL on rows over ~16 KB
-- (Irina Rogachova/BP Mobile, 28 KB enrichment: "Drafting could not finish").
create or replace function public.inbox_set_referral(p_prospect uuid, p_referral jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update outreach_prospects
     set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('inbox_referral', p_referral)
   where id = p_prospect;
  return found;
end $$;
revoke all on function public.inbox_set_referral(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.inbox_set_referral(uuid, jsonb) to service_role;
