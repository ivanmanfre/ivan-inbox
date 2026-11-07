-- Rollback for part 3: restores the live outreach_reserve_dm_dispatch captured 2026-11-02, drops the helpers.
begin;

CREATE OR REPLACE FUNCTION public.outreach_reserve_dm_dispatch(p_message_id uuid, p_seat text, p_claimed_at timestamp with time zone, p_execution_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE m outreach_messages%rowtype; seat text; receipt jsonb;
  pv_models constant text[] := array['pv_cameback_followup_v1','pv_dm1_v1','swishdm_pv_dm1_v1','swishdm_reply_followup_pv_v1'];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF p_seat IS NULL OR p_seat NOT IN ('ivan','risedtc','arch') OR nullif(p_execution_id,'') IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','invalid_dispatch_context');
  END IF;
  SELECT * INTO m FROM outreach_messages WHERE id=p_message_id FOR UPDATE;
  -- 298h/298i (2026-10-30): a profile-view draft only goes to someone who never replied. Refused here = the claim is
  -- released and the row held in this transaction (only while it is still this claim and nothing was sent).
  IF FOUND AND m.ai_model = ANY(pv_models) AND m.unipile_message_id IS NULL AND public.pv_person_replied(m.prospect_id) THEN
    UPDATE outreach_messages
       SET sent_at = NULL, approved_at = NULL, send_blocked_reason = 'pv_superseded_by_reply', send_blocked_at = now()
     WHERE id = p_message_id AND sent_at = p_claimed_at AND unipile_message_id IS NULL;
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
  -- 298i (Sol r2 #1): the counter can wait on another sender's lock; a reply that committed meanwhile is seen here
  -- (READ COMMITTED: this statement takes a fresh snapshot). Give the slot back, release, hold.
  IF m.ai_model = ANY(pv_models) AND public.pv_person_replied(m.prospect_id) THEN
    UPDATE linkedin_daily_actions lda SET count = greatest(lda.count - 1, 0), updated_at = now()
     WHERE lda.date = CURRENT_DATE AND lda.action_type = 'dm' AND lda.seat = p_seat;
    UPDATE outreach_messages
       SET sent_at = NULL, approved_at = NULL, send_blocked_reason = 'pv_superseded_by_reply', send_blocked_at = now()
     WHERE id = p_message_id AND sent_at = p_claimed_at AND unipile_message_id IS NULL;
    RETURN jsonb_build_object('allowed',false,'reason','pv_superseded_by_reply');
  END IF;
  receipt:=jsonb_build_object('v',1,'seat',p_seat,'execution_id',p_execution_id,
    'reserved_at',clock_timestamp(),'capacity_day',current_date,'message_id',p_message_id);
  UPDATE outreach_messages SET draft_evidence=coalesce(draft_evidence,'{}'::jsonb)||jsonb_build_object('dm_dispatch',receipt)
    WHERE id=p_message_id;
  RETURN jsonb_build_object('allowed',true,'reason','reserved','receipt',receipt);
END;
$function$
;

drop function if exists public.own_engager_dm_hold_reason(uuid);
drop function if exists public.rise_secondary_invite_room();

commit;
