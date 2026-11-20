-- A dismissal also takes back an already-approved, unsent referral email for that handoff. Otherwise the sender's
-- claim guard refuses it on every poll and it keeps one of the seat's queue slots (review 2026-11-20).
create or replace function public.inbox_referral_dismiss(p_referrer uuid, p_input_message uuid)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
begin
  -- inbox_referral_dismissed keeps every dismissed handoff, so a later save of another handoff cannot revive it.
  update outreach_prospects
     set enrichment_data = enrichment_data || jsonb_build_object(
           'inbox_referral', (enrichment_data -> 'inbox_referral') || jsonb_build_object('dismissed_at', now()),
           'inbox_referral_dismissed', coalesce(enrichment_data -> 'inbox_referral_dismissed', '[]'::jsonb) || to_jsonb(p_input_message::text))
   where id = p_referrer
     and enrichment_data -> 'inbox_referral' ->> 'input_message_id' = p_input_message::text
     and nullif(enrichment_data -> 'inbox_referral' ->> 'lead_prospect_id', '') is null;
  if not found then return false; end if;
  update outreach_messages
     set approved_at = null, send_blocked_at = now(), send_blocked_reason = 'referral_paused: the referral was dismissed'
   where prospect_id = p_referrer and ai_model = 'inbox_referral_email_v1' and direction = 'outbound'
     and draft_evidence ->> 'referral_input_message_id' = p_input_message::text
     and sent_at is null and unipile_message_id is null and approved_at is not null;
  return true;
end $function$;
revoke all on function public.inbox_referral_dismiss(uuid, uuid) from public, anon, authenticated;
grant execute on function public.inbox_referral_dismiss(uuid, uuid) to service_role;
