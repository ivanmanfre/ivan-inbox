-- 20261102 one-touch own-post engagers, part 3 (Sol r1 #2 and #5).
-- #2 An approved own-post DM (own_engager_dm1_v1) is re-checked at the last DB boundary before LinkedIn, the same
--    place and shape as the 298h/298i view-draft check: refused when the person wrote back / booked (pv_person_replied),
--    or, for a 1st-degree first touch, when the seat's engagement window has closed. Refused = claim released, row held,
--    slot given back. Every other message is untouched.
-- #5 rise_secondary_invite_room(): how many more 'secondary' invites rise_reserve_invite would accept right now, so the
--    Connection Request Sender's own-post pass never spends a slot on a guaranteed refusal. Read-only mirror of
--    rise_reserve_invite's primary-share rule; the atomic reservation stays the final authority.
begin;

create or replace function public.own_engager_dm_hold_reason(p_message_id uuid)
 returns text
 language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $f$
declare m outreach_messages%rowtype; p outreach_prospects%rowtype; v_age integer; v_at timestamptz;
begin
  select * into m from outreach_messages where id = p_message_id;
  if not found or m.ai_model is distinct from 'own_engager_dm1_v1' then return null; end if;
  if public.pv_person_replied(m.prospect_id) then return 'own_engager_superseded_by_reply'; end if;
  if m.draft_evidence->'own_engager'->>'kind' = 'dm1_first_degree' then
    select * into p from outreach_prospects where id = m.prospect_id;
    select o.max_age_days into v_age from outreach_seat_own_engager_cfg() o where o.campaign_id = p.campaign_id limit 1;
    v_at := case when p.enrichment_data->>'engaged_at' ~ '^\d{4}-\d{2}-\d{2}' then (p.enrichment_data->>'engaged_at')::timestamptz end;
    if v_age is null or v_at is null or v_at + make_interval(days => v_age) <= now() then return 'own_engager_window_expired'; end if;
  end if;
  return null;
end $f$;
revoke all on function public.own_engager_dm_hold_reason(uuid) from public, anon, authenticated;
grant execute on function public.own_engager_dm_hold_reason(uuid) to service_role;

create or replace function public.rise_secondary_invite_room()
 returns integer
 language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $f$
declare policy jsonb; v_day date; primary_sent integer; secondary_reserved integer;
begin
  policy := public.rise_invite_policy(clock_timestamp());
  v_day := (policy->>'day')::date;
  select count(distinct r.prospect_id) into primary_sent
    from public.rise_invite_source_reservations r
   where r.day = v_day and r.source_class in ('warm_engager', 'company_activity')
     and exists (select 1 from public.outreach_engagement_log l
                  where l.prospect_id = r.prospect_id and l.action_type = 'connection_request' and l.success
                    and l.created_at >= r.reserved_at and l.created_at < (policy->>'day_end')::timestamptz);
  select count(*) into secondary_reserved from public.rise_invite_source_reservations r
   where r.day = v_day and r.source_class = 'secondary';
  -- rise_reserve_invite allows a secondary reservation while primary_sent >= 4 * (secondary_reserved + 1)
  return greatest(0, floor(primary_sent / 4.0)::integer - secondary_reserved);
end $f$;
revoke all on function public.rise_secondary_invite_room() from public, anon, authenticated;
grant execute on function public.rise_secondary_invite_room() to service_role;

create or replace function public.outreach_reserve_dm_dispatch(p_message_id uuid, p_seat text, p_claimed_at timestamp with time zone, p_execution_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE m outreach_messages%rowtype; seat text; receipt jsonb; v_oe text;
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
  -- 20261102 (Sol r1 #2): an own-post engager DM only goes to someone who has not written back, and a 1st-degree
  -- first touch only inside the seat's engagement window. Same release + hold as the view-draft check above.
  IF FOUND AND m.ai_model = 'own_engager_dm1_v1' AND m.unipile_message_id IS NULL THEN
    v_oe := public.own_engager_dm_hold_reason(p_message_id);
    IF v_oe IS NOT NULL THEN
      UPDATE outreach_messages
         SET sent_at = NULL, approved_at = NULL, send_blocked_reason = v_oe, send_blocked_at = now()
       WHERE id = p_message_id AND sent_at = p_claimed_at AND unipile_message_id IS NULL;
      RETURN jsonb_build_object('allowed',false,'reason',v_oe);
    END IF;
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
  IF m.ai_model = 'own_engager_dm1_v1' THEN
    v_oe := public.own_engager_dm_hold_reason(p_message_id);
    IF v_oe IS NOT NULL THEN
      UPDATE linkedin_daily_actions lda SET count = greatest(lda.count - 1, 0), updated_at = now()
       WHERE lda.date = CURRENT_DATE AND lda.action_type = 'dm' AND lda.seat = p_seat;
      UPDATE outreach_messages
         SET sent_at = NULL, approved_at = NULL, send_blocked_reason = v_oe, send_blocked_at = now()
       WHERE id = p_message_id AND sent_at = p_claimed_at AND unipile_message_id IS NULL;
      RETURN jsonb_build_object('allowed',false,'reason',v_oe);
    END IF;
  END IF;
  receipt:=jsonb_build_object('v',1,'seat',p_seat,'execution_id',p_execution_id,
    'reserved_at',clock_timestamp(),'capacity_day',current_date,'message_id',p_message_id);
  UPDATE outreach_messages SET draft_evidence=coalesce(draft_evidence,'{}'::jsonb)||jsonb_build_object('dm_dispatch',receipt)
    WHERE id=p_message_id;
  RETURN jsonb_build_object('allowed',true,'reason','reserved','receipt',receipt);
END;
$function$
;

commit;
