CREATE OR REPLACE FUNCTION public.profile_view_signal_route(p_since timestamp with time zone DEFAULT (now() - '7 days'::interval), p_replay boolean DEFAULT false)
 RETURNS TABLE(seat text, viewer_public_id text, viewer_name text, viewer_headline text, distance text, viewed_at timestamp with time zone, prospect_id uuid, prospect_name text, stage text, campaign_id uuid, kind text, reason text, last_out_at timestamp with time zone, last_out_model text, dm_count integer, pending_draft_id uuid, pending_draft_model text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with seats as (
  select s.seat, s.client_id from outreach_seats s where s.active
),
v as (
  select distinct on (l.seat, l.viewer_public_id) l.*
  from profile_view_log l join seats s on s.seat = l.seat
  where coalesce(l.viewed_at, l.captured_at) >= p_since and l.viewer_public_id is not null
  order by l.seat, l.viewer_public_id, coalesce(l.viewed_at, l.captured_at) desc
),
m as (
  select v.*, s.client_id as seat_client,
         coalesce(v.prospect_id,
           (select p2.id from outreach_prospects p2
             where p2.linkedin_url = 'https://www.linkedin.com/in/' || v.viewer_public_id
                or (v.viewer_provider_id is not null and p2.linkedin_profile_id = v.viewer_provider_id)
             order by p2.created_at desc limit 1)) as pid,
         case when p_replay then coalesce(v.viewed_at, v.captured_at) else now() end as t
  from v join seats s on s.seat = v.seat
),
j as (
  select m.*, p.name as p_name, p.stage as p_stage, p.campaign_id as p_campaign, p.blacklisted, p.skip_state, p.trigger_type as p_trigger,
         p.call_booked_at, p.reply_count, p.last_reply_at, p.connection_sent_at, p.connected_at, coalesce(p.dm_count, 0)::integer as p_dm_count,
         c.client_id as p_client,
         (c.client_id is not distinct from m.seat_client) as same_seat,
         lo.sent_at as lo_at, lo.ai_model as lo_model,
         exists (select 1 from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound'
                   and coalesce(i.sent_at, i.created_at) <= m.t) as has_in,
         pd.id as pd_id, pd.ai_model as pd_model
  from m
  left join outreach_prospects p on p.id = m.pid
  left join outreach_campaigns c on c.id = p.campaign_id
  left join lateral (
    select o.sent_at, o.ai_model from outreach_messages o
    where o.prospect_id = p.id and o.direction = 'outbound' and o.message_type in ('dm', 'inmail')
      and o.sent_at is not null and o.sent_at <= m.t
    order by o.sent_at desc limit 1) lo on true
  left join lateral (
    select o.id, o.ai_model from outreach_messages o
    where not p_replay and o.prospect_id = p.id and o.direction = 'outbound' and o.sent_at is null
      and o.send_blocked_at is null and o.message_type in ('dm', 'inmail')
    order by o.created_at desc limit 1) pd on true
)
select j.seat, j.viewer_public_id, j.viewer_name, j.viewer_headline, j.distance, coalesce(j.viewed_at, j.captured_at),
       j.pid, j.p_name, j.p_stage, j.p_campaign,
       k.kind, k.reason, j.lo_at, j.lo_model, j.p_dm_count, j.pd_id, j.pd_model
from j
cross join lateral (
  select case
    when j.pid is null then
      case when j.icp_pass is true then 'new_unstaged' when j.icp_pass is false then 'not_icp' else 'unjudged' end
    when not j.same_seat then 'other_seat'
    when j.blacklisted or j.p_stage in ('disqualified', 'archived', 'skipped', 'dropped') then 'closed'
    when (j.call_booked_at is not null and j.call_booked_at <= j.t) or j.has_in
         or j.p_stage in ('replied', 'positive_reply', 'booked', 'call_booked', 'lm_delivered', 'swishdm_replied', 'inbound_request_dm')
         or (not p_replay and (coalesce(j.reply_count, 0) > 0 or j.last_reply_at is not null)) then 'in_conversation'
    when j.lo_at is not null and (j.connected_at is null or j.connected_at > j.t) then
      case when j.connection_sent_at is not null and j.connection_sent_at <= j.t then 'viewed_after_invite' else 'viewed_after_inmail' end
    when j.lo_at is not null and coalesce(j.viewed_at, j.captured_at) <= j.lo_at then 'viewed_before_last_dm'
    when j.lo_at is not null and j.t - j.lo_at >= interval '90 days' then 'cooldown'
    when j.lo_at is not null and (j.p_dm_count >= 6 or j.lo_model ~* '(dm7|breakup)') then 'cooldown'
    when j.lo_at is not null and j.t - j.lo_at < interval '3 days' then
      case when p_replay and j.lo_at + interval '3 days' < j.t + interval '7 days'
                and not exists (select 1 from outreach_messages x where x.prospect_id = j.pid
                                 and ((x.direction = 'inbound' and coalesce(x.sent_at, x.created_at) > j.lo_at
                                       and coalesce(x.sent_at, x.created_at) <= j.lo_at + interval '3 days')
                                   or (x.direction = 'outbound' and x.sent_at > j.lo_at and x.sent_at <= j.lo_at + interval '3 days')))
           then 'next_touch' else 'too_soon' end
    when j.lo_at is not null then 'next_touch'
    when (j.connected_at is not null and j.connected_at <= j.t)
         or j.p_stage in ('connected', 'inbound_accepted_no_dm', 'swishdm_connected') then 'dm1_pull'
    when j.connection_sent_at is not null and j.connection_sent_at <= j.t then 'viewed_after_invite'
    when j.p_trigger = 'profile_view' and j.p_stage = 'profile_view_dm' then 'new_dm1'
    when j.p_trigger = 'profile_view' then 'new_invite'
    else 'queued' end as kind,
  case
    when j.pid is null then coalesce(left(j.icp_reasoning, 200), '')
    when not j.same_seat then 'prospect is in ' || coalesce(j.p_client, 'ivan') || ' campaign'
    else coalesce(j.p_stage, '') || ' dm_count ' || j.p_dm_count || coalesce(' last ' || j.lo_model || ' ' || to_char(j.lo_at, 'MM-DD'), '')
  end as reason
) k;
$function$
;
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
    if not v_lane_row or v_pv_live then
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

-- 1. the routing function returns every seat's viewers: service_role only (the drafter); the inbox reads the tag RPC
revoke all on function public.profile_view_signal_route(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.profile_view_signal_route(timestamptz, boolean) to service_role;

-- 6. views that make no draft (invite pending, InMail out, conversation running): a tag on the person's thread
create or replace function public.profile_view_seen_tags()
returns table (prospect_id uuid, seat text, kind text, viewed_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select r.prospect_id, r.seat, r.kind, r.viewed_at
  from profile_view_signal_route(now() - interval '14 days', false) r
  where public.cb34_p2_operator_lane_allowed('ivan')
    and r.prospect_id is not null
    and r.kind in ('viewed_after_invite', 'viewed_after_inmail', 'in_conversation', 'too_soon', 'viewed_before_last_dm')
$$;
revoke all on function public.profile_view_seen_tags() from public, anon;
grant execute on function public.profile_view_seen_tags() to authenticated, service_role;
