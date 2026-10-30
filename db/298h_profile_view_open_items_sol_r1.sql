-- db/298h (2026-10-30): Sol round 1 on 298g.
--   #1 the send check moves to the last read before LinkedIn: outreach_reserve_dm_dispatch (Send Messages, called at the
--      provider boundary for every ivan/risedtc/arch DM) refuses a pv_* draft whose person replied; the SwishDM DM Sender
--      calls pv_swishdm_dispatch_check right before its LinkedIn send. Send Messages' post-claim n8n block is removed
--      (reverted to the pre-298g code), so pv_draft_send_check is dropped (also closes #5: no extra claim/unclaim path).
--   #2 retirement never waits on a locked message row (SKIP LOCKED): a claim in flight is left to the boundary check, so
--      a reply stamp and a claim can no longer deadlock.
--   #3 the arbiter treats a view draft retired by a reply (any pv_superseded_by_reply reason) or a reply / booked stamp
--      as the conversation branch: a real reply draft goes through, scripted steps stay held.
--   #4 one rule everywhere: a view draft only exists for a person who never replied (drafter guard + route), so ANY reply
--      or booking, whenever recorded, ends it. pv_person_replied() replaces pv_reply_after_draft().

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

create or replace function public.pv_retire_view_drafts(p_prospect uuid, p_before timestamptz, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  -- SKIP LOCKED: a row locked by a claim or an approval in flight is left to the send boundary check
  update outreach_messages d
     set approved_at = null, send_blocked_reason = p_reason, send_blocked_at = now()
   where d.id in (
     select x.id from outreach_messages x
      where x.prospect_id = p_prospect and x.direction = 'outbound'
        and x.ai_model in ('pv_cameback_followup_v1', 'pv_dm1_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
        and x.sent_at is null and x.unipile_message_id is null
        and x.created_at <= p_before
        and (x.send_blocked_reason is null or x.send_blocked_reason = 'awaiting_client_review'
             or x.send_blocked_reason like 'lint\_%' escape '\' or x.send_blocked_reason like 'post\_approval\_race:%' escape '\')
      for update skip locked);
  get diagnostics n = row_count;
  return n;
end $$;

-- the arbiter: 298g + pv_person_replied + #3
create or replace function public.pv_view_draft_arbiter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pv_models constant text[] := array['pv_cameback_followup_v1', 'pv_dm1_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1'];
  v_pv outreach_messages%rowtype;
  -- scripted sequence steps and automated first touches (measured 30-day outbound models, 2026-10-30); anything else
  -- (replies, manual, hand, operator, null) is a person answering a person
  scripted constant text := '^(content_system_|rise_dm[0-9]|arch_dm[0-9]|arch_nudge|ivan_eh_sequence|recycle_|template/|swishdm_search_|swishdm_auto_|swishdm_inmail|swishdm_first_list|swishdm_reply_followup_v1|pre_dm1_|lm_gate_|stall_bump|[a-z]+_stall_bump|[a-z]+_cameback_followup)';
begin
  if NEW.direction is distinct from 'outbound' or NEW.message_type not in ('dm', 'inmail') or NEW.prospect_id is null
     or NEW.sent_at is not null or NEW.approved_at is null or NEW.send_blocked_at is not null or NEW.send_blocked_reason is not null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.approved_at is not null and OLD.send_blocked_at is null and OLD.send_blocked_reason is null then
    return NEW;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pv_view_draft_arbiter:' || NEW.prospect_id::text, 0));
  if NEW.ai_model = any(pv_models) then
    if exists (select 1 from outreach_messages o
               where o.prospect_id = NEW.prospect_id and o.id <> NEW.id and o.direction = 'outbound'
                 and o.message_type in ('dm', 'inmail')
                 and (o.created_at > NEW.created_at or o.sent_at > NEW.created_at
                      or (o.sent_at is null and o.approved_at is not null and o.send_blocked_at is null and o.send_blocked_reason is null))) then
      raise exception 'The sequence wrote to them after this draft. Refresh: the draft will be retired.' using errcode = 'P0001';
    end if;
    -- 298g/298h: they wrote back (or booked); a view draft is only for someone who never replied
    if pv_person_replied(NEW.prospect_id) then
      raise exception 'They wrote back after this draft. Refresh: the draft is retired.' using errcode = 'P0001';
    end if;
    return NEW;
  end if;
  -- the latest view draft that is either waiting approved, or a sent came-back touch inside 45 days
  select o.* into v_pv from outreach_messages o
   where o.prospect_id = NEW.prospect_id and o.id <> NEW.id and o.direction = 'outbound' and o.ai_model = any(pv_models)
     and ((o.sent_at is null and o.approved_at is not null and o.send_blocked_at is null and o.send_blocked_reason is null)
          or (o.ai_model = 'pv_cameback_followup_v1' and o.sent_at > now() - interval '45 days')
          -- Sol r5: a view draft retired by their reply keeps guarding, so every later stale step still meets the
          -- reply check (a second stale writer, or a reply approved first). 298h: also the sender's
          -- 'dm_dispatch:pv_superseded_by_reply' hold.
          or (o.sent_at is null and o.send_blocked_reason like '%pv\_superseded\_by\_reply' escape '\'
              and o.created_at > now() - interval '45 days'))
   order by o.created_at desc limit 1;
  if v_pv.id is null then return NEW; end if;
  -- 298h (Sol r1 #3): the conversation branch also on a reply / booked stamp with no inbound row, and on a view draft
  -- already retired by their reply
  if v_pv.send_blocked_reason like '%pv\_superseded\_by\_reply' escape '\'
     or pv_person_replied(NEW.prospect_id) then
    -- Sol r4: they wrote after the view draft (or after the view touch went out). The unsent view draft is retired; a
    -- reply goes through; a scripted step drafted from an earlier read is held (the reply owns the thread now).
    if v_pv.sent_at is null and v_pv.send_blocked_reason is null then
      update outreach_messages set approved_at = null, send_blocked_reason = 'pv_superseded_by_reply', send_blocked_at = now()
       where id = v_pv.id and sent_at is null;
    end if;
    if coalesce(NEW.ai_model, '') ~ scripted then
      NEW.approved_at := null;
      NEW.send_blocked_reason := 'pv_stale_step_after_reply';
      NEW.send_blocked_at := now();
    end if;
    return NEW;
  end if;
  NEW.approved_at := null;
  NEW.send_blocked_reason := case when v_pv.sent_at is null then 'pv_view_draft_approved' else 'pv_view_touch_sent' end;
  NEW.send_blocked_at := now();
  return NEW;
end $$;

-- swishdm_claim_send: 298g with pv_person_replied
create or replace function public.swishdm_claim_send(p_msg uuid, p_by text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare m outreach_messages%rowtype; c jsonb; p outreach_prospects%rowtype; hold_reason text; pid uuid;
begin
  -- 2026-10-28 (Sol r2): the prospect is locked FIRST (FOR SHARE: waits for an in-flight niche / skip write, then reads it),
  -- the same lock order as swishdm_carry_approve_dm1 and swishdm_release_stamp; the message's prospect is re-checked
  select prospect_id into pid from outreach_messages where id = p_msg;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into p from outreach_prospects where id = pid for share;
  select * into m from outreach_messages where id = p_msg for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if m.prospect_id is distinct from pid then return jsonb_build_object('ok', false, 'reason', 'prospect_changed'); end if;
  if coalesce(m.draft_evidence->>'lane', '') not like 'swishdm\_%' then return jsonb_build_object('ok', false, 'reason', 'not_swishdm'); end if;
  if m.direction is distinct from 'outbound' then return jsonb_build_object('ok', false, 'reason', 'not_outbound'); end if;
  hold_reason := swishdm_pitch_hold_reason(p.name,p.enrichment_data,p.connection_sent_at);
  if hold_reason is not null and (hold_reason='manual_do_not_pitch_person'
    or coalesce(m.draft_evidence->>'lane','') <> 'swishdm_reply') then
    return jsonb_build_object('ok',false,'reason',hold_reason);
  end if;
  if m.sent_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_sent'); end if;
  if m.send_blocked_reason is not null then return jsonb_build_object('ok', false, 'reason', 'held'); end if;
  if m.approved_at is null then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if jsonb_typeof(m.draft_evidence->'send_claim') = 'object' then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed', 'claim', m.draft_evidence->'send_claim');
  end if;
  -- 298g (2026-10-30): a profile-view draft for a person who replied (or booked) is retired here, never sent
  if m.ai_model in ('swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1', 'pv_dm1_v1', 'pv_cameback_followup_v1')
     and pv_person_replied(m.prospect_id) then
    update outreach_messages set approved_at = null, send_blocked_reason = 'pv_superseded_by_reply', send_blocked_at = now() where id = p_msg;
    return jsonb_build_object('ok', false, 'reason', 'pv_superseded_by_reply');
  end if;
  -- 2026-10-28: a first touch (invite note, DM1, InMail) to a prospect niche-held or skipped in review is held here, at the
  -- last read before LinkedIn; held (not just refused) so it leaves the sender's queue
  if coalesce(m.draft_evidence->>'lane', '') in ('swishdm_first_list', 'swishdm_inmail') then
    hold_reason := case
      when p.enrichment_data->'swishdm_auto' ? 'niche_hold' or p.enrichment_data->'swishdm_auto'->'score'->>'niche' = 'out' then 'client_niche_excluded'
      when p.enrichment_data->'swishdm_review'->'jonathan'->>'decision' = 'skip' or p.enrichment_data->'swishdm_review'->'ivan'->>'decision' = 'skip' then 'skipped_in_review'
      else null end;
    if hold_reason is not null then
      update outreach_messages set approved_at = null, send_blocked_reason = hold_reason || ': at send claim', send_blocked_at = now() where id = p_msg;
      return jsonb_build_object('ok', false, 'reason', hold_reason);
    end if;
  end if;
  c := jsonb_build_object('at', clock_timestamp(), 'by', coalesce(nullif(p_by, ''), 'unknown'));
  update outreach_messages set draft_evidence = coalesce(draft_evidence, '{}'::jsonb) || jsonb_build_object('send_claim', c) where id = p_msg;
  return jsonb_build_object('ok', true, 'claim', c);
end $$;

-- SwishDM DM Sender, right before its LinkedIn send: the claimed row is re-read. ok=false = do not send. A row they
-- answered is retired and its claim cleared; a row held since the claim only loses the claim (its hold stays).
create or replace function public.pv_swishdm_dispatch_check(p_msg uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare m outreach_messages%rowtype; pid uuid;
begin
  select prospect_id into pid from outreach_messages where id = p_msg;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from outreach_prospects where id = pid for share;
  select * into m from outreach_messages where id = p_msg for update;
  if not found or m.prospect_id is distinct from pid then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if m.ai_model is null or m.ai_model not in ('pv_cameback_followup_v1', 'pv_dm1_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1') then
    return jsonb_build_object('ok', true);
  end if;
  if m.sent_at is not null or m.unipile_message_id is not null then return jsonb_build_object('ok', false, 'reason', 'already_sent'); end if;
  if m.approved_at is null or m.send_blocked_reason is not null or m.send_blocked_at is not null then
    update outreach_messages set draft_evidence = coalesce(draft_evidence, '{}'::jsonb) - 'send_claim' where id = p_msg;
    return jsonb_build_object('ok', false, 'reason', 'pv_not_sendable');
  end if;
  if pv_person_replied(m.prospect_id) then
    update outreach_messages
       set approved_at = null, send_blocked_reason = 'pv_superseded_by_reply', send_blocked_at = now(),
           draft_evidence = coalesce(draft_evidence, '{}'::jsonb) - 'send_claim'
     where id = p_msg;
    return jsonb_build_object('ok', false, 'reason', 'pv_superseded_by_reply');
  end if;
  return jsonb_build_object('ok', true);
end $$;

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

drop function if exists public.pv_draft_send_check(uuid, timestamptz);
drop function if exists public.pv_reply_after_draft(uuid, timestamptz);

revoke all on function public.pv_person_replied(uuid) from public, anon, authenticated;
revoke all on function public.pv_retire_view_drafts(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.pv_view_draft_arbiter() from public, anon, authenticated;
revoke all on function public.swishdm_claim_send(uuid, text) from public, anon, authenticated;
grant execute on function public.swishdm_claim_send(uuid, text) to service_role;
revoke all on function public.pv_swishdm_dispatch_check(uuid) from public, anon, authenticated;
grant execute on function public.pv_swishdm_dispatch_check(uuid) to service_role;
