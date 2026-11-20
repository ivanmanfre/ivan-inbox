-- The sender re-checks a claimed referral draft right before the provider call (2026-11-20, Ivan approved).
-- The claim trigger already checks at claim time; a "hold off" can land in the seconds after it.

-- One place for the referral checks, used by the approval/claim trigger and by the sender's re-check.
-- Returns null when the draft may go out, else why it may not.
create or replace function public.inbox_referral_hold_reason(p_ai_model text, p_prospect uuid, p_evidence jsonb, p_recipient text)
returns text
language plpgsql stable
security definer
set search_path to 'public'
as $function$
declare
  ref jsonb;
  referrer uuid;
  handoff text := p_evidence ->> 'referral_input_message_id';
begin
  if p_ai_model = 'inbox_referral_lead_v1' then
    referrer := nullif(p_evidence ->> 'referrer_prospect_id', '')::uuid;
  elsif p_ai_model = 'inbox_referral_email_v1' then
    referrer := p_prospect;
  else
    return null;
  end if;
  select enrichment_data -> 'inbox_referral' into ref from outreach_prospects where id = referrer;
  if ref is null or handoff is null or ref ->> 'input_message_id' is distinct from handoff then
    return 'the referral changed since this draft was made';
  end if;
  if ref ->> 'dismissed_at' is not null then
    return 'the referral was dismissed';
  end if;
  if p_ai_model = 'inbox_referral_email_v1'
     and ref -> 'later' ->> 'envelope' is distinct from inbox_referral_envelope(p_recipient, p_evidence -> 'email_cc') then
    return 'the email recipients changed since the referrer''s replies were read';
  end if;
  if not inbox_referral_later_ok(referrer, ref) then
    return 'a reply from the referrer is not read yet, or it pauses the referral';
  end if;
  return null;
end $function$;
revoke all on function public.inbox_referral_hold_reason(text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.inbox_referral_hold_reason(text, uuid, jsonb, text) to service_role;

-- Same trigger behavior as 20261120 (claim refused, approval turned into a hold), checks moved to the helper.
create or replace function public.inbox_referral_send_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  why text;
  claim boolean := old.sent_at is null and new.sent_at is not null;
begin
  if new.direction is distinct from 'outbound' or new.ai_model not in ('inbox_referral_lead_v1', 'inbox_referral_email_v1') then return new; end if;
  if claim and (old.approved_at is null or old.send_blocked_at is not null or old.send_blocked_reason is not null) then
    why := 'the draft is not approved any more';
  else
    why := inbox_referral_hold_reason(new.ai_model, new.prospect_id, new.draft_evidence, new.recipient_email);
  end if;
  if why is null then return new; end if;
  -- The sender's claim is a single-row PATCH whose error it skips: refuse it. An approval (the inbox Send, or the
  -- shared scheduled release that approves many rows at once) is turned into a hold on this row only.
  if claim then raise exception 'Referral draft not sent: %.', why; end if;
  new.approved_at := null;
  new.send_blocked_at := now();
  new.send_blocked_reason := left('referral_paused: ' || why, 300);
  return new;
end $function$;

-- Called by the sender (kFYlfnWd98YaiErH, REFERRAL_SEND_RECHECK_V1) on its claimed row right before the provider
-- call. ok=true: send. ok=false: the row was released unsent and held (only while it is still this claim).
-- Any other row passes untouched.
create or replace function public.inbox_referral_send_recheck(p_message_id uuid, p_claimed_at timestamptz)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  m record;
  why text;
begin
  select id, ai_model, prospect_id, draft_evidence, recipient_email, sent_at, approved_at, send_blocked_at, send_blocked_reason, unipile_message_id
    into m from outreach_messages where id = p_message_id for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'the draft is gone', 'released', false); end if;
  if m.ai_model is distinct from 'inbox_referral_lead_v1' and m.ai_model is distinct from 'inbox_referral_email_v1' then
    return jsonb_build_object('ok', true);
  end if;
  if m.sent_at is distinct from p_claimed_at or m.unipile_message_id is not null then
    -- Not this run's claim any more: never send it from here, and never touch it.
    return jsonb_build_object('ok', false, 'why', 'the claim changed', 'released', false);
  end if;
  if m.approved_at is null or m.send_blocked_at is not null or m.send_blocked_reason is not null then
    why := 'the draft is not approved any more';
  else
    why := inbox_referral_hold_reason(m.ai_model, m.prospect_id, m.draft_evidence, m.recipient_email);
  end if;
  if why is null then return jsonb_build_object('ok', true); end if;
  update outreach_messages
     set sent_at = null, approved_at = null, send_blocked_at = now(), send_blocked_reason = left('referral_paused: ' || why, 300)
   where id = p_message_id and sent_at = p_claimed_at and unipile_message_id is null;
  return jsonb_build_object('ok', false, 'why', why, 'released', found);
end $function$;
revoke all on function public.inbox_referral_send_recheck(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.inbox_referral_send_recheck(uuid, timestamptz) to service_role;
