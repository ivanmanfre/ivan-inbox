CREATE OR REPLACE FUNCTION public.warm_signal_decide(p_prospect_id uuid, p_action text, p_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row outreach_prospects%rowtype; v_client text; v_seat text; v_now timestamptz := now(); v_note text; v_stage text;
  v_discarded integer := 0; v_lane_row boolean; v_pv_draft uuid; v_pv_live boolean := false; v_pv outreach_messages%rowtype; v_first boolean; v_msg outreach_messages%rowtype; v_text text;
begin
  select p.* into v_row from outreach_prospects p where p.id = p_prospect_id for update;
  if v_row.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select c.client_id into v_client from outreach_campaigns c where c.id = v_row.campaign_id;
  select s.seat into v_seat from outreach_seat_clients() s where s.client_id is not distinct from v_client;
  if v_seat is null then return jsonb_build_object('ok', false, 'error', 'not_a_registry_seat'); end if;
  v_lane_row := coalesce(v_row.trigger_type = 'profile_view', false)
             or (v_seat = 'ivan' and coalesce(v_row.enrichment_data->>'lane' = 'own_post_engager', false));
  v_pv_draft := nullif(v_row.enrichment_data->'pv_signal'->>'draft_id', '')::uuid;
  if v_pv_draft is not null then
    select m.* into v_pv from outreach_messages m where m.id = v_pv_draft;
    v_pv_live := v_pv.id is not null and v_pv.sent_at is null and v_pv.approved_at is null
             and (v_pv.send_blocked_reason is null or v_pv.send_blocked_reason = 'awaiting_client_review');
  end if;
  if not v_lane_row and v_pv_draft is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_warm_signal_row');
  end if;
  v_first := coalesce(coalesce(v_row.enrichment_data->>'network_distance', v_row.enrichment_data->>'distance') = 'DISTANCE_1', false);

  if p_action = 'save_note' then
    if v_seat <> 'ivan' then return jsonb_build_object('ok', false, 'error', 'notes_are_ivan_seat_only'); end if;
    v_note := left(coalesce(p_text, ''), 200);
    update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_note_draft', v_note, 'signal_note_edited_at', v_now), updated_at = v_now where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'note', v_note);

  elsif p_action = 'approve_invite' then
    if not v_lane_row then return jsonb_build_object('ok', false, 'error', 'not_an_invite_row'); end if;
    if v_row.connection_sent_at is not null then return jsonb_build_object('ok', false, 'error', 'invite_already_sent'); end if;
    if coalesce(v_row.enrichment_data->>'signal_approved_at', '') <> '' and v_seat in ('arch', 'swishdm') then
      return jsonb_build_object('ok', false, 'error', 'already_approved');
    end if;
    if v_seat in ('ivan', 'risedtc') then
      v_note := left(coalesce(p_text, v_row.enrichment_data->>'signal_note_draft', ''), 200);
      if v_row.trigger_type <> 'profile_view' and length(trim(v_note)) = 0 then return jsonb_build_object('ok', false, 'error', 'note_required'); end if;
      v_stage := case when v_row.stage = 'ballot_hold' then 'enriched' else v_row.stage end;
      update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_note_final', v_note, 'signal_approved_at', v_now, 'signal_approved_by', 'inbox'), stage = v_stage, skip_reason = case when v_row.stage = 'ballot_hold' then null else skip_reason end, updated_at = v_now where id = p_prospect_id;
      return jsonb_build_object('ok', true, 'stage', v_stage, 'note', v_note, 'approved_at', v_now);
    elsif v_seat = 'arch' then
      -- 1st degree: no invite exists to send; the row becomes 'connected' and the ARCH DM Sequencer drafts its
      -- DM1 approval-held (lane profile_view gate). Otherwise the Ballot Promoter promotes it once research
      -- says eligible, and the ARCH sender sends the blank invite. Both read signal_approved_at.
      v_stage := case when v_first then 'connected' else v_row.stage end;
      update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_approved_at', v_now, 'signal_approved_by', 'inbox'),
             stage = v_stage, connected_at = case when v_first then coalesce(connected_at, v_now) else connected_at end, updated_at = v_now
       where id = p_prospect_id;
      return jsonb_build_object('ok', true, 'stage', v_stage, 'approved_at', v_now, 'qualification', v_row.enrichment_data->'qualification'->>'status');
    elsif v_seat = 'swishdm' then
      if v_first then
        update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_approved_at', v_now, 'signal_approved_by', 'inbox'),
               stage = 'swishdm_connected', connected_at = coalesce(connected_at, v_now), updated_at = v_now where id = p_prospect_id;
        return jsonb_build_object('ok', true, 'stage', 'swishdm_connected', 'approved_at', v_now);
      end if;
      -- the SwishDM Connection Sender sends an approved first-list connection_note row once the person carries a
      -- review approve; a note_arm outside its two named arms sends blank
      insert into outreach_messages (prospect_id, direction, message_type, channel, message_text, sent_at, approved_at, ai_model, draft_evidence)
      values (p_prospect_id, 'outbound', 'connection_note', 'linkedin', '', null, v_now, 'swishdm_pv_invite_blank_v1',
              jsonb_build_object('lane', 'swishdm_first_list', 'source', 'profile_view', 'note_arm', 'profile_view_blank', 'approved_in', 'inbox_warm_signals'));
      update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
               || jsonb_build_object('signal_approved_at', v_now, 'signal_approved_by', 'inbox',
                                     'swishdm_review', coalesce(enrichment_data->'swishdm_review', '{}'::jsonb)
                                        || jsonb_build_object('ivan', jsonb_build_object('decision', 'approve', 'by', 'inbox_warm_signals', 'at', v_now))),
             updated_at = v_now where id = p_prospect_id;
      return jsonb_build_object('ok', true, 'stage', v_row.stage, 'approved_at', v_now);
    end if;
    return jsonb_build_object('ok', false, 'error', 'seat_has_no_invite_path');

  elsif p_action = 'approve_dm1_stage' then
    if v_pv_live and exists (select 1 from outreach_messages o
                              where o.prospect_id = p_prospect_id and o.id <> v_pv.id and o.direction = 'outbound'
                                and o.message_type in ('dm', 'inmail')
                                and (o.created_at > v_pv.created_at or o.sent_at > v_pv.created_at
                                     or (o.sent_at is null and o.send_blocked_at is null))) then
      update outreach_messages set send_blocked_reason = 'pv_superseded_by_sequence', send_blocked_at = v_now where id = v_pv.id;
      return jsonb_build_object('ok', false, 'error', 'sequence_moved');
    end if;
    v_stage := v_row.stage;
    if v_row.stage = 'ballot_hold' and v_row.connection_sent_at is not null then
      v_stage := 'connection_sent';
      update outreach_prospects set stage = v_stage, skip_reason = null, updated_at = v_now where id = p_prospect_id;
    end if;
    return jsonb_build_object('ok', true, 'stage', v_stage);

  elsif p_action = 'approve_dm_swishdm' then
    -- SwishDM drafts are held with send_blocked_reason 'awaiting_client_review'; the generic approve does not
    -- reach them. Follow-ups go through approve_swishdm_reply_draft (its own checks); a viewer DM1 is a
    -- first-list DM1 queued now with the operator's copy approval.
    if v_seat <> 'swishdm' then return jsonb_build_object('ok', false, 'error', 'not_swishdm'); end if;
    if v_pv_live and exists (select 1 from outreach_messages o
                              where o.prospect_id = p_prospect_id and o.id <> v_pv.id and o.direction = 'outbound'
                                and o.message_type in ('dm', 'inmail')
                                and (o.created_at > v_pv.created_at or o.sent_at > v_pv.created_at
                                     or (o.sent_at is null and o.send_blocked_at is null))) then
      update outreach_messages set send_blocked_reason = 'pv_superseded_by_sequence', send_blocked_at = v_now where id = v_pv.id;
      return jsonb_build_object('ok', false, 'error', 'sequence_moved');
    end if;

    select m.* into v_msg from outreach_messages m
     where m.prospect_id = p_prospect_id and m.direction = 'outbound' and m.message_type = 'dm' and m.sent_at is null
       and m.approved_at is null and m.send_blocked_reason = 'awaiting_client_review'
       and m.ai_model in ('swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
     order by m.created_at desc limit 1 for update;
    if v_msg.id is null then return jsonb_build_object('ok', false, 'error', 'no_held_view_draft'); end if;
    v_text := btrim(coalesce(p_text, v_msg.message_text));
    if v_text = '' then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
    if v_msg.ai_model = 'swishdm_reply_followup_pv_v1' then
      update outreach_messages set message_text = v_text where id = v_msg.id;
      perform approve_swishdm_reply_draft(v_msg.id, v_text, v_msg.draft_evidence);
      return jsonb_build_object('ok', true, 'message_id', v_msg.id);
    end if;
    if v_row.connected_at is null then return jsonb_build_object('ok', false, 'error', 'not_connected_yet'); end if;
    update outreach_messages
       set message_text = v_text, approved_at = v_now, send_blocked_reason = null,
           draft_evidence = coalesce(draft_evidence, '{}'::jsonb)
             || jsonb_build_object('dm_queue', jsonb_build_object('state', 'queued', 'due_at', v_now, 'queued_by', 'inbox_warm_signals'),
                                   'operator_copy_approval', jsonb_build_object('source', 'inbox', 'text', v_text, 'approved_at', v_now))
     where id = v_msg.id;
    update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
             || jsonb_build_object('swishdm_review', coalesce(enrichment_data->'swishdm_review', '{}'::jsonb)
                  || jsonb_build_object('ivan', jsonb_build_object('decision', 'approve', 'by', 'inbox_warm_signals', 'at', v_now))),
           updated_at = v_now
     where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'message_id', v_msg.id, 'approved_at', v_now);

  elsif p_action = 'skip' then
    update outreach_messages set send_blocked_reason = 'discarded_in_inbox', send_blocked_at = v_now
     where prospect_id = p_prospect_id and direction = 'outbound' and sent_at is null and approved_at is null
       and (send_blocked_at is null or send_blocked_reason = 'awaiting_client_review')
       and (ai_model in ('warm_signal_dm1_v1', 'profile_view_dm_v2', 'profile_view_opener_v1', 'rise_view_opener_v1',
                         'pv_dm1_v1', 'pv_cameback_followup_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
            or (v_seat = 'arch' and v_lane_row and ai_model like 'arch\_dm1%' escape '\'));
    get diagnostics v_discarded = row_count;
    if not v_lane_row or v_pv_live or coalesce(v_row.enrichment_data->'pv_signal'->>'kind' in ('dm1_pull', 'next_touch'), false) then
      -- a person already in a sequence: drop the view draft only, never touch their stage
      update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
               || jsonb_build_object('pv_signal', coalesce(enrichment_data->'pv_signal', '{}'::jsonb) || jsonb_build_object('skipped_at', v_now)),
             updated_at = v_now where id = p_prospect_id;
      return jsonb_build_object('ok', true, 'stage', v_row.stage, 'drafts_discarded', v_discarded);
    end if;
    update outreach_prospects set stage = 'skipped', skip_state = 'manual_skip', skip_state_reason = 'warm_signal:operator_skip', skip_state_at = v_now, skip_reason = 'warm_signal:operator_skip', enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_skipped_at', v_now, 'signal_skipped_from_stage', v_row.stage), updated_at = v_now where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'stage', 'skipped', 'drafts_discarded', v_discarded);
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
end;
$function$
;

-- Sol r2 #3: one sendable message per person while a view draft is involved, enforced where the approval is written.
-- Every writer that makes an outbound DM/InMail sendable (insert already approved, or approved_at set later) takes the
-- same per-prospect lock, so a sequencer working from an earlier read and an inbox approval can never both end up
-- sendable:
--   a view draft (pv_*) becoming sendable while any other outbound was written or sent after it, or another sendable
--     one exists -> the approval fails with a message (the inbox shows it; the draft stays for the retire path).
--   any other draft becoming sendable while an approved, unsent view draft waits -> that scripted step is held
--     (send_blocked_reason pv_view_draft_approved): the approved view draft takes its place, never sits beside it.
create or replace function public.pv_view_draft_arbiter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pv_models constant text[] := array['pv_cameback_followup_v1', 'pv_dm1_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1'];
begin
  if NEW.direction is distinct from 'outbound' or NEW.message_type not in ('dm', 'inmail') or NEW.prospect_id is null
     or NEW.sent_at is not null or NEW.approved_at is null or NEW.send_blocked_at is not null or NEW.send_blocked_reason is not null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.approved_at is not null and OLD.send_blocked_at is null and OLD.send_blocked_reason is null then
    return NEW; -- was already sendable: not a new approval
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
  elsif exists (select 1 from outreach_messages o
                where o.prospect_id = NEW.prospect_id and o.id <> NEW.id and o.direction = 'outbound'
                  and o.ai_model = any(pv_models)
                  and o.sent_at is null and o.approved_at is not null and o.send_blocked_at is null and o.send_blocked_reason is null) then
    NEW.approved_at := null;
    NEW.send_blocked_reason := 'pv_view_draft_approved';
    NEW.send_blocked_at := now();
  end if;
  return NEW;
end $$;

revoke all on function public.pv_view_draft_arbiter() from public, anon, authenticated;

drop trigger if exists pv_view_draft_arbiter_ins on public.outreach_messages;
create trigger pv_view_draft_arbiter_ins before insert on public.outreach_messages
  for each row when (new.direction = 'outbound' and new.approved_at is not null and new.sent_at is null)
  execute function public.pv_view_draft_arbiter();
drop trigger if exists pv_view_draft_arbiter_upd on public.outreach_messages;
create trigger pv_view_draft_arbiter_upd before update of approved_at, send_blocked_reason, send_blocked_at on public.outreach_messages
  for each row when (new.direction = 'outbound' and new.approved_at is not null and new.sent_at is null)
  execute function public.pv_view_draft_arbiter();
