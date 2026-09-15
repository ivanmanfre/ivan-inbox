-- Ops-reviewed viewer takeover. Proposal is inert; approval atomically enrolls
-- the conversation in auto mode and queues the exact operator-reviewed opener.

alter table public.ops_drafts drop constraint if exists ops_drafts_kind_check;
alter table public.ops_drafts add constraint ops_drafts_kind_check
  check (kind in ('escalation','update','newsjack','weekly_report','comment_reply',
    'comment_outbound','booking','precall_email','manual_invite','task','leads_ballot',
    'audn_recommendation','conversation_takeover'));

alter table public.ops_drafts drop constraint if exists ops_drafts_slack_channel_required;
alter table public.ops_drafts add constraint ops_drafts_slack_channel_required
  check (kind in ('newsjack','weekly_report','comment_reply','comment_outbound',
    'precall_email','manual_invite','task','leads_ballot','audn_recommendation',
    'conversation_takeover') or slack_channel is not null);

create unique index if not exists ops_drafts_conversation_takeover_prospect_uq
  on public.ops_drafts ((context->>'prospect_id'))
  where kind='conversation_takeover';

-- The existing blanket authenticated policy predates authorization-bearing Ops
-- cards. Takeover rows are readable in Ops but mutable only through the RPCs.
drop policy if exists "authenticated all ops_drafts" on public.ops_drafts;
drop policy if exists ops_drafts_authenticated_select on public.ops_drafts;
create policy ops_drafts_authenticated_select on public.ops_drafts for select to authenticated using (true);
drop policy if exists ops_drafts_authenticated_insert on public.ops_drafts;
create policy ops_drafts_authenticated_insert on public.ops_drafts for insert to authenticated with check (kind<>'conversation_takeover');
drop policy if exists ops_drafts_authenticated_update on public.ops_drafts;
create policy ops_drafts_authenticated_update on public.ops_drafts for update to authenticated
  using (kind<>'conversation_takeover') with check (kind<>'conversation_takeover');
drop policy if exists ops_drafts_authenticated_delete on public.ops_drafts;
create policy ops_drafts_authenticated_delete on public.ops_drafts for delete to authenticated using (kind<>'conversation_takeover');
drop policy if exists ops_drafts_takeover_insert_guard on public.ops_drafts;
create policy ops_drafts_takeover_insert_guard on public.ops_drafts as restrictive for insert to authenticated
  with check (kind<>'conversation_takeover');
drop policy if exists ops_drafts_takeover_update_guard on public.ops_drafts;
create policy ops_drafts_takeover_update_guard on public.ops_drafts as restrictive for update to authenticated
  using (kind<>'conversation_takeover') with check (kind<>'conversation_takeover');
drop policy if exists ops_drafts_takeover_delete_guard on public.ops_drafts;
create policy ops_drafts_takeover_delete_guard on public.ops_drafts as restrictive for delete to authenticated
  using (kind<>'conversation_takeover');

create or replace function public.conversation_agent_takeover_candidates(p_limit integer default 5)
returns setof jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'prospect_id',p.id,'client_id',a.client_id,'account_id',a.account_id,
    'provider_account_id',a.provider_account_id,'provider_recipient_id',p.linkedin_profile_id,
    'person_key','linkedin_profile_id:'||trim(p.linkedin_profile_id),
    'prospect_name',p.name,'headline',l.viewer_headline,
    'company',coalesce(p.enrichment_data->>'company',p.enrichment_data->>'company_name'),
    'linkedin_url',p.linkedin_url,'icp_score',p.icp_score,'icp_reasoning',p.icp_reasoning,
    'scorer_version',p.scorer_version,'scored_at',p.scored_at,'viewed_at',l.viewed_at,
    'updated_at',p.updated_at,'policy_version',a.provider_config->>'policy_version'
  )
  from public.outreach_prospects p
  join public.outreach_agent_accounts a on a.campaign_id=p.campaign_id
  join public.outreach_campaigns c on c.id=p.campaign_id
  join lateral (
    select v.viewed_at,v.viewer_headline from public.profile_view_log v
    where v.prospect_id=p.id and v.seat=a.shared_cap_seat
      and v.viewer_provider_id is not distinct from p.linkedin_profile_id and v.icp_pass is true
    order by v.viewed_at desc limit 1
  ) l on true
  where public.conversation_agent_is_service()
    and a.client_id='ivan'
    and a.provider_config->'takeover_review_required'='true'::jsonb
    and p.trigger_type='profile_view'
    and nullif(trim(p.linkedin_profile_id),'') is not null
    and ((c.client_id is null and a.client_id='ivan') or c.client_id=a.client_id)
    and not coalesce(p.blacklisted,false)
    and coalesce(p.skip_state,'') not in ('manual_skip','opted_out','stopped')
    and lower(coalesce(p.stage,'')) not in ('archived','client','customer','team','internal','skipped','blacklisted','do_not_contact','stopped')
    and a.required_scorer_version is not null
    and nullif(a.provider_config->>'policy_version','') is not null
    and p.icp_score>=a.icp_floor and nullif(trim(p.icp_reasoning),'') is not null
    and p.scorer_version=a.required_scorer_version
    and p.scored_at>=now()-make_interval(days=>a.score_max_age_days)
    and l.viewed_at>=now()-interval '7 days'
    and p.connection_sent_at is null
    and not exists(select 1 from public.outreach_messages m where m.prospect_id=p.id and (m.direction='inbound' or m.sent_at is not null))
    and not exists(select 1 from public.outreach_messages m where m.prospect_id=p.id and m.direction='outbound' and m.sent_at>=now()-interval '90 days' and m.agent_action_id is null)
    and not exists(select 1 from public.outreach_agent_threads t where t.prospect_id=p.id or (t.account_id=a.account_id and t.person_key='linkedin_profile_id:'||trim(p.linkedin_profile_id)))
    and not exists(select 1 from public.ops_drafts d where d.kind='conversation_takeover' and d.context->>'prospect_id'=p.id::text
      and (d.approved_at is not null or d.send_blocked_reason is not null or (
        (d.context->>'expires_at')::timestamptz>now()
        and (d.context->>'prospect_updated_at')::timestamptz=p.updated_at
        and (d.context->>'score_verified_at')::timestamptz=p.scored_at
        and (d.context->>'viewed_at')::timestamptz=l.viewed_at
        and d.context->>'account_id'=a.account_id
        and d.context->>'provider_account_id'=a.provider_account_id
        and d.context->>'campaign_id'=a.campaign_id::text
        and d.context->>'shared_cap_seat'=a.shared_cap_seat
        and d.context->>'policy_version'=a.provider_config->>'policy_version')))
  order by l.viewed_at desc,p.id
  limit least(greatest(coalesce(p_limit,5),1),25)
$$;

create or replace function public.conversation_agent_propose_takeover(p_prospect_id uuid,p_proposal jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.outreach_prospects%rowtype; v_a public.outreach_agent_accounts%rowtype;
  v_client text; v_viewed timestamptz; v_opener text; v_policy text; v_exp timestamptz;
  v_expected_updated timestamptz; v_expected_scored timestamptz; v_expected_viewed timestamptz;
  v_history jsonb; v_context jsonb; v_hash text; v_id uuid; v_existing public.ops_drafts%rowtype;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'reason','service_denied','draft_id',null); end if;
  if p_proposal->>'kind' is distinct from 'reply' or jsonb_typeof(p_proposal->'bubbles') is distinct from 'array'
     or jsonb_array_length(p_proposal->'bubbles')<>1 or (p_proposal->'bubbles'->0->>'quoteId') is not null then
    return jsonb_build_object('ok',false,'reason','invalid_proposal','draft_id',null);
  end if;
  v_opener:=trim(p_proposal->'bubbles'->0->>'text'); v_policy:=nullif(trim(p_proposal->>'policyVersion'),'');
  begin
    v_exp:=(p_proposal->>'expiresAt')::timestamptz;
    v_expected_updated:=(p_proposal->>'expectedProspectUpdatedAt')::timestamptz;
    v_expected_scored:=(p_proposal->>'scoreVerifiedAt')::timestamptz;
    v_expected_viewed:=(p_proposal->>'viewedAt')::timestamptz;
  exception when others then v_exp:=null; v_expected_updated:=null; v_expected_scored:=null; v_expected_viewed:=null; end;
  if v_opener is null or length(v_opener)=0 or length(v_opener)>400 or v_policy is null or v_exp is null or v_exp<=now()
     or v_expected_updated is null or v_expected_updated>now() or v_expected_scored is null or v_expected_scored>now()
     or v_expected_viewed is null or v_expected_viewed>now() then
    return jsonb_build_object('ok',false,'reason','invalid_proposal','draft_id',null);
  end if;
  select * into v_p from public.outreach_prospects where id=p_prospect_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found','draft_id',null); end if;
  select a.* into v_a from public.outreach_agent_accounts a where a.campaign_id=v_p.campaign_id;
  if not found then return jsonb_build_object('ok',false,'reason','account_unmapped','draft_id',null); end if;
  if v_a.client_id<>'ivan' then return jsonb_build_object('ok',false,'reason','client_out_of_scope','draft_id',null); end if;
  if v_a.provider_config->'takeover_review_required' is distinct from 'true'::jsonb then
    return jsonb_build_object('ok',false,'reason','takeover_review_disabled','draft_id',null);
  end if;
  select client_id into v_client from public.outreach_campaigns where id=v_p.campaign_id;
  if (v_client is null and v_a.client_id<>'ivan') or (v_client is not null and v_client is distinct from v_a.client_id) then
    return jsonb_build_object('ok',false,'reason','account_mapping_mismatch','draft_id',null);
  end if;
  if v_policy is distinct from v_a.provider_config->>'policy_version'
     or v_expected_updated is distinct from v_p.updated_at
     or v_expected_scored is distinct from v_p.scored_at then
    return jsonb_build_object('ok',false,'reason','stale_candidate','draft_id',null);
  end if;
  select max(l.viewed_at) into v_viewed from public.profile_view_log l where l.prospect_id=v_p.id and l.seat=v_a.shared_cap_seat
    and l.viewer_provider_id is not distinct from v_p.linkedin_profile_id and l.icp_pass is true;
  if v_expected_viewed is distinct from v_viewed then return jsonb_build_object('ok',false,'reason','stale_candidate','draft_id',null); end if;
  if v_p.trigger_type is distinct from 'profile_view' or nullif(trim(v_p.linkedin_profile_id),'') is null
     or coalesce(v_p.blacklisted,false) or coalesce(v_p.skip_state,'') in ('manual_skip','opted_out','stopped')
     or lower(coalesce(v_p.stage,'')) in ('archived','client','customer','team','internal','skipped','blacklisted','do_not_contact','stopped')
     or v_a.required_scorer_version is null or v_p.icp_score<v_a.icp_floor or nullif(trim(v_p.icp_reasoning),'') is null
     or v_p.scorer_version is distinct from v_a.required_scorer_version or v_p.scored_at<now()-make_interval(days=>v_a.score_max_age_days)
     or v_viewed is null or v_viewed<now()-interval '7 days' or v_p.connection_sent_at is not null
     or exists(select 1 from public.outreach_messages m where m.prospect_id=v_p.id and (m.direction='inbound' or m.sent_at is not null))
     or exists(select 1 from public.outreach_messages m where m.prospect_id=v_p.id and m.direction='outbound' and m.sent_at>=now()-interval '90 days' and m.agent_action_id is null)
     or exists(select 1 from public.outreach_agent_threads t where t.prospect_id=v_p.id or (t.account_id=v_a.account_id and t.person_key='linkedin_profile_id:'||trim(v_p.linkedin_profile_id))) then
    return jsonb_build_object('ok',false,'reason','ineligible','draft_id',null);
  end if;
  select jsonb_build_object('count',count(*),'max_created_at',max(m.created_at),'last_inbound_id',(array_agg(m.unipile_message_id order by m.created_at desc) filter(where m.direction='inbound'))[1],
    'last_outbound_id',(array_agg(m.unipile_message_id order by m.created_at desc) filter(where m.direction='outbound'))[1]) into v_history
    from public.outreach_messages m where m.prospect_id=v_p.id;
  v_context:=jsonb_build_object('prospect_id',v_p.id,'prospect_name',v_p.name,
    'company',coalesce(v_p.enrichment_data->>'company',v_p.enrichment_data->>'company_name'),'linkedin_url',v_p.linkedin_url,
    'icp_score',v_p.icp_score,'viewed_at',v_viewed,'expires_at',v_exp,'account_id',v_a.account_id,
    'provider_account_id',v_a.provider_account_id,'campaign_id',v_a.campaign_id,'shared_cap_seat',v_a.shared_cap_seat,
    'policy_version',v_policy,'prospect_updated_at',v_p.updated_at,'score_verified_at',v_p.scored_at,
    'person_key','linkedin_profile_id:'||trim(v_p.linkedin_profile_id),'history_checkpoint',v_history,
    'proposal_evidence',coalesce(p_proposal->'validationEvidence','{}'::jsonb),
    'evidence_ids',coalesce(p_proposal->'evidenceIds','[]'::jsonb),'proposal_reason',p_proposal->>'reason');
  v_hash:=public.conversation_agent_payload_hash(v_context||jsonb_build_object('body',v_opener));
  v_context:=v_context||jsonb_build_object('proposal_hash',v_hash);
  begin
    insert into public.ops_drafts(client_id,kind,slack_channel,body,context)
    values(v_a.client_id,'conversation_takeover',null,v_opener,v_context) returning id into v_id;
  exception when unique_violation then
    select * into v_existing from public.ops_drafts where kind='conversation_takeover' and context->>'prospect_id'=v_p.id::text for update;
    if v_existing.approved_at is null and v_existing.send_blocked_reason is null
       and ((v_existing.context->>'expires_at')::timestamptz<=now()
         or (v_existing.context-'proposal_hash'-'proposal_evidence'-'evidence_ids'-'proposal_reason'-'expires_at')
            is distinct from (v_context-'proposal_hash'-'proposal_evidence'-'evidence_ids'-'proposal_reason'-'expires_at')) then
      update public.ops_drafts set body=v_opener,context=v_context,created_at=now()
      where id=v_existing.id;
      return jsonb_build_object('ok',true,'reason','refreshed','draft_id',v_existing.id,'proposal_hash',v_hash);
    end if;
    return jsonb_build_object('ok',true,'reason',case when v_existing.send_blocked_reason is not null then 'discarded_candidate' when v_existing.approved_at is not null then 'already_approved' else 'already_proposed' end,
      'draft_id',v_existing.id,'proposal_hash',v_existing.context->>'proposal_hash');
  end;
  return jsonb_build_object('ok',true,'reason','proposed','draft_id',v_id,'proposal_hash',v_hash);
end;
$$;

-- Operator-visible readiness and the approval transaction share this fail-closed gate.
-- Only the reason is returned; integration_config may contain private release configuration.
create or replace function public.conversation_agent_takeover_readiness(p_draft_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_d public.ops_drafts%rowtype; v_a public.outreach_agent_accounts%rowtype; v_release jsonb; v_release_text text;
begin
  if public.conversation_agent_is_service() then return jsonb_build_object('ready',false,'reason','operator_denied'); end if;
  select * into v_d from public.ops_drafts where id=p_draft_id and kind='conversation_takeover';
  if not found then return jsonb_build_object('ready',false,'reason','not_found'); end if;
  select * into v_a from public.outreach_agent_accounts where account_id=v_d.context->>'account_id' for share;
  if not found or not public.conversation_agent_is_operator(v_a.account_id) then
    return jsonb_build_object('ready',false,'reason','operator_denied');
  end if;
  if v_a.client_id is distinct from 'ivan' or v_d.client_id is distinct from 'ivan'
     or v_a.provider_account_id is distinct from v_d.context->>'provider_account_id'
     or v_a.campaign_id::text is distinct from v_d.context->>'campaign_id'
     or v_a.shared_cap_seat is distinct from v_d.context->>'shared_cap_seat' then
    return jsonb_build_object('ready',false,'reason','stale_account_mapping');
  end if;
  if v_a.provider_config->'takeover_review_required' is distinct from 'true'::jsonb then
    return jsonb_build_object('ready',false,'reason','takeover_review_disabled');
  end if;
  if not (v_a.enrollment_enabled and v_a.auto_enabled and v_a.dispatch_enabled) then
    return jsonb_build_object('ready',false,'reason','account_not_ready');
  end if;
  select value into v_release_text from public.integration_config where key='conversation_agent_release_ivan' for share;
  begin
    v_release:=v_release_text::jsonb;
  exception when invalid_text_representation then
    return jsonb_build_object('ready',false,'reason','release_not_ready');
  end;
  if v_release->>'clientId' is distinct from 'ivan'
     or v_release->'globalEnabled' is distinct from 'true'::jsonb
     or v_release->'dispatchEnabled' is distinct from 'true'::jsonb
     or v_release->'planningEnabled' is distinct from 'true'::jsonb
     or v_release->'eventsEnabled' is distinct from 'true'::jsonb
     or v_release->'autoEnabled' is distinct from 'true'::jsonb
     or v_release->>'reviewedPolicyVersion' is distinct from v_d.context->>'policy_version' then
    return jsonb_build_object('ready',false,'reason','release_not_ready');
  end if;
  if v_a.capabilities->'new_chat' is distinct from 'true'::jsonb
     or v_release#>'{capabilities,new_chat}' is distinct from 'true'::jsonb then
    return jsonb_build_object('ready',false,'reason','new_chat_unverified');
  end if;
  return jsonb_build_object('ready',true,'reason','ready');
end;
$$;

create or replace function public.conversation_agent_approve_takeover(p_draft_id uuid,p_expected_hash text,p_body text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_d public.ops_drafts%rowtype; v_p public.outreach_prospects%rowtype; v_a public.outreach_agent_accounts%rowtype;
  v_enroll jsonb; v_thread uuid; v_revision bigint; v_history jsonb; v_action uuid; v_message uuid; v_payload jsonb;
  v_validation jsonb; v_readiness jsonb; v_text text:=trim(p_body);
begin
  select * into v_d from public.ops_drafts where id=p_draft_id and kind='conversation_takeover' for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found','thread_id',null,'draft_id',p_draft_id); end if;
  if public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'reason','operator_denied','thread_id',null,'draft_id',v_d.id); end if;
  select * into v_a from public.outreach_agent_accounts where account_id=v_d.context->>'account_id' for update;
  if not found or not public.conversation_agent_is_operator(v_a.account_id) then return jsonb_build_object('ok',false,'reason','operator_denied','thread_id',null,'draft_id',v_d.id); end if;
  if v_d.approved_at is not null then return jsonb_build_object('ok',true,'reason','already_approved','thread_id',nullif(v_d.context->>'thread_id','')::uuid,'draft_id',v_d.id); end if;
  if v_a.provider_account_id is distinct from v_d.context->>'provider_account_id'
     or v_a.campaign_id::text is distinct from v_d.context->>'campaign_id'
     or v_a.shared_cap_seat is distinct from v_d.context->>'shared_cap_seat' then
    return jsonb_build_object('ok',false,'reason','stale_account_mapping','thread_id',null,'draft_id',v_d.id);
  end if;
  if v_a.provider_config->'takeover_review_required' is distinct from 'true'::jsonb then
    return jsonb_build_object('ok',false,'reason','takeover_review_disabled','thread_id',null,'draft_id',v_d.id);
  end if;
  select * into v_p from public.outreach_prospects where id=(v_d.context->>'prospect_id')::uuid for update;
  if not found then return jsonb_build_object('ok',false,'reason','stale_identity','thread_id',null,'draft_id',v_d.id); end if;
  if v_d.send_blocked_reason is not null then return jsonb_build_object('ok',false,'reason','proposal_discarded','thread_id',null,'draft_id',v_d.id); end if;
  if p_expected_hash is distinct from v_d.context->>'proposal_hash' then return jsonb_build_object('ok',false,'reason','proposal_hash_mismatch','thread_id',null,'draft_id',v_d.id); end if;
  if public.conversation_agent_payload_hash((v_d.context-'proposal_hash')||jsonb_build_object('body',v_d.body)) is distinct from p_expected_hash then
    return jsonb_build_object('ok',false,'reason','proposal_tampered','thread_id',null,'draft_id',v_d.id);
  end if;
  if v_text is null or length(v_text)=0 or length(v_text)>400 then return jsonb_build_object('ok',false,'reason','invalid_body','thread_id',null,'draft_id',v_d.id); end if;
  if (v_d.context->>'expires_at')::timestamptz<=now() then return jsonb_build_object('ok',false,'reason','proposal_expired','thread_id',null,'draft_id',v_d.id); end if;
  if v_p.updated_at is distinct from (v_d.context->>'prospect_updated_at')::timestamptz
     or v_p.scored_at is distinct from (v_d.context->>'score_verified_at')::timestamptz
     or ('linkedin_profile_id:'||trim(v_p.linkedin_profile_id)) is distinct from v_d.context->>'person_key' then
    return jsonb_build_object('ok',false,'reason','stale_identity','thread_id',null,'draft_id',v_d.id);
  end if;
  if v_a.provider_config->>'policy_version' is distinct from v_d.context->>'policy_version' then return jsonb_build_object('ok',false,'reason','stale_policy','thread_id',null,'draft_id',v_d.id); end if;
  select jsonb_build_object('count',count(*),'max_created_at',max(m.created_at),'last_inbound_id',(array_agg(m.unipile_message_id order by m.created_at desc) filter(where m.direction='inbound'))[1],
    'last_outbound_id',(array_agg(m.unipile_message_id order by m.created_at desc) filter(where m.direction='outbound'))[1]) into v_history
    from public.outreach_messages m where m.prospect_id=v_p.id;
  if v_history is distinct from v_d.context->'history_checkpoint' then return jsonb_build_object('ok',false,'reason','stale_history','thread_id',null,'draft_id',v_d.id); end if;
  v_readiness:=public.conversation_agent_takeover_readiness(v_d.id);
  if v_readiness->'ready' is distinct from 'true'::jsonb then
    return jsonb_build_object('ok',false,'reason',v_readiness->>'reason','thread_id',null,'draft_id',v_d.id);
  end if;
  v_enroll:=public.conversation_agent_enroll(v_p.id,'auto',v_d.context->>'policy_version');
  if not coalesce((v_enroll->>'ok')::boolean,false) or v_enroll->>'reason' not in ('enrolled','promoted') then
    return jsonb_build_object('ok',false,'reason','stale_eligibility','thread_id',null,'draft_id',v_d.id);
  end if;
  v_thread:=(v_enroll->>'thread_id')::uuid; v_revision:=(v_enroll->>'revision')::bigint;
  v_payload:=jsonb_build_object('text',v_text,'quoteId',null);
  v_validation:=coalesce(v_d.context->'proposal_evidence','{}'::jsonb)||jsonb_build_object(
    'historyCheckpoint',coalesce(v_d.context#>'{proposal_evidence,historyCheckpoint}','[]'::jsonb),
    'takeoverProof',jsonb_build_object('draftId',v_d.id,'proposalHash',p_expected_hash,'approvedBy',auth.uid()));
  insert into public.outreach_agent_actions(thread_id,turn_id,sequence_no,kind,payload,payload_hash,evidence_ids,source_snippets,validation_evidence,
    expected_revision,policy_version,opener,due_at,expires_at,status,approval_source,approved_by,approved_at,approved_revision,approved_policy_version)
  values(v_thread,v_thread::text||':'||v_revision::text||':'||(v_d.context->>'policy_version'),1,'reply',v_payload,public.conversation_agent_payload_hash(v_payload),'{}'::text[],
    coalesce(v_d.context#>'{proposal_evidence,sourceSnippets}','[]'::jsonb),v_validation,v_revision,v_d.context->>'policy_version',true,now(),
    (v_d.context->>'expires_at')::timestamptz,'approved','operator',auth.uid(),now(),v_revision,v_d.context->>'policy_version') returning id into v_action;
  insert into public.outreach_messages(prospect_id,direction,message_text,message_type,unipile_chat_id,approved_at,sent_at,channel,agent_action_id,draft_evidence)
  select v_p.id,'outbound',v_text,'ai_draft',t.provider_chat_id,null,null,'linkedin',v_action,
    jsonb_build_object('takeover_draft_id',v_d.id,'proposal_hash',p_expected_hash) from public.outreach_agent_threads t where t.id=v_thread returning id into v_message;
  update public.outreach_agent_actions set message_id=v_message where id=v_action;
  update public.ops_drafts set body=v_text,approved_at=now(),sent_at=now(),context=context||jsonb_build_object('thread_id',v_thread,'action_id',v_action) where id=v_d.id;
  return jsonb_build_object('ok',true,'reason','approved','thread_id',v_thread,'draft_id',v_d.id);
end;
$$;

create or replace function public.conversation_agent_discard_takeover(p_draft_id uuid,p_expected_hash text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_d public.ops_drafts%rowtype; v_a public.outreach_agent_accounts%rowtype;
begin
  select * into v_d from public.ops_drafts where id=p_draft_id and kind='conversation_takeover' for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found','draft_id',p_draft_id); end if;
  if public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'reason','operator_denied','draft_id',v_d.id); end if;
  select * into v_a from public.outreach_agent_accounts where account_id=v_d.context->>'account_id';
  if not found or not public.conversation_agent_is_operator(v_a.account_id) then return jsonb_build_object('ok',false,'reason','operator_denied','draft_id',v_d.id); end if;
  if v_d.approved_at is not null then return jsonb_build_object('ok',false,'reason','already_approved','draft_id',v_d.id); end if;
  if v_d.send_blocked_reason is not null then return jsonb_build_object('ok',true,'reason','already_discarded','draft_id',v_d.id); end if;
  if p_expected_hash is distinct from v_d.context->>'proposal_hash'
     or public.conversation_agent_payload_hash((v_d.context-'proposal_hash')||jsonb_build_object('body',v_d.body)) is distinct from p_expected_hash then
    return jsonb_build_object('ok',false,'reason','proposal_hash_mismatch','draft_id',v_d.id);
  end if;
  update public.ops_drafts set send_blocked_reason='operator_discarded' where id=v_d.id;
  return jsonb_build_object('ok',true,'reason','discarded','draft_id',v_d.id);
end;
$$;

revoke execute on function public.conversation_agent_takeover_candidates(integer),public.conversation_agent_propose_takeover(uuid,jsonb),
  public.conversation_agent_approve_takeover(uuid,text,text),public.conversation_agent_discard_takeover(uuid,text),public.conversation_agent_takeover_readiness(uuid) from public,anon,authenticated,service_role;
grant execute on function public.conversation_agent_takeover_candidates(integer),public.conversation_agent_propose_takeover(uuid,jsonb) to service_role;
grant execute on function public.conversation_agent_approve_takeover(uuid,text,text),public.conversation_agent_discard_takeover(uuid,text),public.conversation_agent_takeover_readiness(uuid) to authenticated;
