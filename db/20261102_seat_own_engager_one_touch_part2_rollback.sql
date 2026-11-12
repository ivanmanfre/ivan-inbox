-- Rollback for part 2: restores the live definitions captured 2026-11-02 before this change.
begin;

CREATE OR REPLACE FUNCTION public.warm_signal_cards()
 RETURNS TABLE(prospect_id uuid, name text, headline text, company text, title text, country text, city text, icp_score integer, stage text, trigger_type text, campaign_id uuid, linkedin_url text, connection_sent_at timestamp with time zone, connected_at timestamp with time zone, note_variant text, skip_reason text, created_at timestamp with time zone, signal_source text, signal_evidence jsonb, signal_note_draft text, signal_note_final text, signal_approved_at text, signal_invite_state text, signal_lint jsonb, view_window_ends timestamp with time zone, draft_id uuid, draft_text text, draft_model text, draft_created_at timestamp with time zone, draft_approved_at timestamp with time zone, draft_sent_at timestamp with time zone, dm_sent_count integer, tenant text, signal_kind text, qualification text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with seats as (
  select s.seat, s.client_id from outreach_seat_clients() s
),
camps as (
  select c.id, s.seat from outreach_campaigns c join seats s on c.client_id is not distinct from s.client_id
),
rows as (
  select p.*, cs.seat as tenant,
         case when p.enrichment_data->>'lane' = 'own_post_engager' then 'own_post'
              when p.enrichment_data->'pv_signal'->>'kind' in ('dm1_pull', 'next_touch')
                   and exists (select 1 from outreach_messages m0
                                where m0.id::text = p.enrichment_data->'pv_signal'->>'draft_id'
                                  and m0.sent_at is null and m0.approved_at is null
                                  and (m0.send_blocked_reason is null or m0.send_blocked_reason = 'awaiting_client_review'))
                then p.enrichment_data->'pv_signal'->>'kind'
              when p.trigger_type = 'profile_view' then
                case when p.stage = 'profile_view_dm' or coalesce(p.enrichment_data->>'network_distance', p.enrichment_data->>'distance') = 'DISTANCE_1'
                     then 'new_dm1' else 'new_invite' end
              else coalesce(p.enrichment_data->'pv_signal'->>'kind', 'view') end as kind
  from outreach_prospects p
  join camps cs on cs.id = p.campaign_id
  where p.blacklisted = false
    and (
      (cs.seat = 'ivan' and p.enrichment_data->>'lane' = 'own_post_engager' and p.stage not in ('archived', 'skipped'))
      or
      (p.trigger_type = 'profile_view'
         and p.stage in ('enriched', 'ballot_hold', 'queued', 'connection_sent', 'connected', 'profile_view_dm',
                         'swishdm_staged_hold', 'swishdm_connected')
         and p.created_at >= now() - interval '21 days'
         -- ARCH research already excluded the person: no card
         and coalesce(p.enrichment_data->'qualification'->>'status', '') <> 'excluded')
      or
      -- already in a campaign, viewed, and the Warm Signal Drafter wrote ONE view draft: shown while it waits
      (p.enrichment_data->'pv_signal'->>'draft_id' is not null
         and exists (select 1 from outreach_messages m
                      where m.id::text = p.enrichment_data->'pv_signal'->>'draft_id'
                        and m.sent_at is null and m.approved_at is null
                        and (m.send_blocked_reason is null or m.send_blocked_reason = 'awaiting_client_review'
                             or m.send_blocked_reason like 'lint_%')))
    )
),
drafts as (
  select distinct on (m.prospect_id)
         m.prospect_id, m.id, m.message_text, m.ai_model, m.created_at, m.approved_at, m.sent_at
  from outreach_messages m
  join rows r on r.id = m.prospect_id
  where m.direction = 'outbound'
    and m.message_type = 'dm'
    and m.sent_at is null
    and (m.send_blocked_reason is null or m.send_blocked_reason like 'post_approval_race:%' or m.send_blocked_reason like 'lint_%'
         or m.send_blocked_reason = 'awaiting_client_review')
    and (m.ai_model in ('warm_signal_dm1_v1', 'profile_view_dm_v2', 'profile_view_opener_v1', 'rise_view_opener_v1',
                        'pv_dm1_v1', 'pv_cameback_followup_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
         -- ARCH's own DM1 for a viewer lands approval-held (DM Sequencer 2026-10-30 gate)
         or (r.tenant = 'arch' and r.trigger_type = 'profile_view' and m.ai_model like 'arch\_dm1%' escape '\' and m.approved_at is null))
  order by m.prospect_id, m.created_at desc
),
sent as (
  select m.prospect_id, count(*)::integer as n
  from outreach_messages m
  join rows r on r.id = m.prospect_id
  where m.direction = 'outbound' and m.message_type = 'dm' and m.sent_at is not null
  group by m.prospect_id
)
select
  r.id, r.name, r.headline, r.company, r.title, r.country, r.city, r.icp_score, r.stage,
  r.trigger_type, r.campaign_id, r.linkedin_url, r.connection_sent_at, r.connected_at,
  r.note_variant, r.skip_reason, r.created_at,
  coalesce(r.enrichment_data->>'signal_source',
           case when r.trigger_type = 'profile_view' or r.kind in ('dm1_pull', 'next_touch', 'view') then 'profile_view'
                when (r.enrichment_data->>'commented')::boolean then 'commented_own_post'
                when coalesce((r.enrichment_data->>'n_posts')::integer, 0) >= 2 then 'reacted_two_posts'
                else 'engaged_own_post' end) as signal_source,
  coalesce(r.enrichment_data->'signal_evidence',
           case when r.kind in ('dm1_pull', 'next_touch')
                then jsonb_build_object('viewed_at', r.enrichment_data->'pv_signal'->>'view_at',
                                        'distance', r.enrichment_data->'pv_signal'->>'distance',
                                        'last_out_at', r.enrichment_data->'pv_signal'->>'last_out_at',
                                        'last_out_model', r.enrichment_data->'pv_signal'->>'last_out_model',
                                        'trigger_detail', r.trigger_detail)
                else jsonb_build_object('touches', r.enrichment_data->'touches',
                                        'viewed_at', r.enrichment_data->>'viewed_at',
                                        'distance', coalesce(r.enrichment_data->>'network_distance', r.enrichment_data->>'distance'),
                                        'trigger_detail', r.trigger_detail) end) as signal_evidence,
  r.enrichment_data->>'signal_note_draft',
  r.enrichment_data->>'signal_note_final',
  r.enrichment_data->>'signal_approved_at',
  case
    when r.kind in ('dm1_pull', 'next_touch') then 'in_campaign'
    when r.enrichment_data->>'signal_invite_state' is not null and r.tenant = 'ivan' then r.enrichment_data->>'signal_invite_state'
    when r.connection_sent_at is not null then 'sent:' || coalesce(r.note_variant, '?') || '@' || r.connection_sent_at::text
    when r.stage in ('profile_view_dm', 'connected', 'swishdm_connected') then 'first_degree'
    when r.kind = 'new_dm1' and r.enrichment_data->>'signal_approved_at' is null then 'first_degree_pending'
    when r.kind = 'new_dm1' then 'first_degree'
    else 'pending' end as signal_invite_state,
  r.enrichment_data->'signal_lint',
  case when r.trigger_type = 'profile_view' then r.created_at + interval '7 days' else null end as view_window_ends,
  d.id, d.message_text, d.ai_model, d.created_at, d.approved_at, d.sent_at,
  coalesce(s.n, 0),
  r.tenant, r.kind,
  r.enrichment_data->'qualification'->>'status'
from rows r
left join drafts d on d.prospect_id = r.id
left join sent s on s.prospect_id = r.id
order by r.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.warm_signal_decide(p_prospect_id uuid, p_action text, p_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row outreach_prospects%rowtype; v_client text; v_seat text; v_now timestamptz := now(); v_note text; v_stage text;
  v_discarded integer := 0; v_lane_row boolean; v_pv_draft uuid; v_pv_live boolean := false; v_pv outreach_messages%rowtype; v_first boolean; v_msg outreach_messages%rowtype; v_text text;
begin
  select p.* into v_row from outreach_prospects p where p.id = p_prospect_id for no key update;
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

commit;
