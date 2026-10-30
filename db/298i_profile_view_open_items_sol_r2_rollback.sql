-- db/298i rollback: pv_person_replied and outreach_reserve_dm_dispatch as in 298h.

create or replace function public.pv_person_replied(p_prospect uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from outreach_messages i where i.prospect_id = p_prospect and i.direction = 'inbound')
      or exists (select 1 from outreach_prospects p
                  where p.id = p_prospect
                    and (p.last_reply_at is not null or coalesce(p.reply_count, 0) > 0 or p.call_booked_at is not null));
$$;

-- Send Messages' provider-boundary reservation (live 2026-10-21 body) + 298h: a pv_* draft for a person who replied is
-- refused before anything else (the sender then releases its claim and holds 'dm_dispatch:pv_superseded_by_reply')
create or replace function public.outreach_reserve_dm_dispatch(p_message_id uuid, p_seat text, p_claimed_at timestamp with time zone, p_execution_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
DECLARE m outreach_messages%rowtype; seat text; receipt jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF p_seat IS NULL OR p_seat NOT IN ('ivan','risedtc','arch') OR nullif(p_execution_id,'') IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','invalid_dispatch_context');
  END IF;
  SELECT * INTO m FROM outreach_messages WHERE id=p_message_id FOR UPDATE;
  -- 298h (2026-10-30): a profile-view draft only goes to someone who never replied
  IF FOUND AND m.ai_model IN ('pv_cameback_followup_v1','pv_dm1_v1','swishdm_pv_dm1_v1','swishdm_reply_followup_pv_v1')
     AND m.unipile_message_id IS NULL AND public.pv_person_replied(m.prospect_id) THEN
    RETURN jsonb_build_object('allowed',false,'reason','pv_superseded_by_reply');
  END IF;
  IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' OR m.approved_at IS NULL OR
     m.sent_at IS DISTINCT FROM p_claimed_at OR p_claimed_at IS NULL OR
     m.send_blocked_at IS NOT NULL OR m.send_blocked_reason IS NOT NULL OR
     -- 2026-10-21: an inbox-approved InMail row is a reply inside its EXISTING InMail thread (ARCH referral follow-up,
     -- Alicia 06aaab91); template InMails without a chat stay with their own InMail senders.
     NOT (m.message_type IN ('dm','manual_reply') OR
          (m.message_type='inmail' AND m.channel='linkedin_inmail' AND nullif(m.unipile_chat_id,'') IS NOT NULL
           AND m.draft_evidence->'operator_copy_approval'->>'source'='inbox')) OR
     (m.channel IS NOT NULL AND m.channel NOT IN ('linkedin','linkedin_inmail')) THEN
    RETURN jsonb_build_object('allowed',false,'reason','claim_changed');
  END IF;
  SELECT coalesce(c.client_id,'ivan') INTO seat FROM outreach_prospects p
    JOIN outreach_campaigns c ON c.id=p.campaign_id WHERE p.id=m.prospect_id;
  IF seat IS DISTINCT FROM p_seat THEN RETURN jsonb_build_object('allowed',false,'reason','seat_mismatch'); END IF;
  IF public.arch_policy_send_reason(m.prospect_id) IS NOT NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason',public.arch_policy_send_reason(m.prospect_id));
  END IF;
  IF m.draft_evidence->'dm_dispatch'->>'reserved_at' IS NOT NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','prior_reservation_requires_reconciliation');
  END IF;
  IF public.linkedin_check_and_increment('dm',p_seat) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('allowed',false,'reason','daily_cap_reached');
  END IF;
  receipt:=jsonb_build_object('v',1,'seat',p_seat,'execution_id',p_execution_id,
    'reserved_at',clock_timestamp(),'capacity_day',current_date,'message_id',p_message_id);
  UPDATE outreach_messages SET draft_evidence=coalesce(draft_evidence,'{}'::jsonb)||jsonb_build_object('dm_dispatch',receipt)
    WHERE id=p_message_id;
  RETURN jsonb_build_object('allowed',true,'reason','reserved','receipt',receipt);
END;
$$;

