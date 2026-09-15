-- Durable conversation ownership, revision-bound approvals, and provider action claims.
-- Additive only. Intentionally seeds zero account/campaign/operator mappings and every gate is false.

create extension if not exists pgcrypto;

create table if not exists public.outreach_agent_accounts (
  account_id text primary key,
  client_id text not null,
  campaign_id uuid not null unique references public.outreach_campaigns(id),
  provider_account_id text not null unique,
  provider_owner_id text,
  operator_ids uuid[] not null default '{}'::uuid[],
  capabilities jsonb not null default '{}'::jsonb,
  provider_config jsonb not null default '{}'::jsonb,
  shadow_enabled boolean not null default false,
  enrollment_enabled boolean not null default false,
  dispatch_enabled boolean not null default false,
  auto_enabled boolean not null default false,
  cold_enabled boolean not null default false,
  viewer_daily_cap integer not null default 5 check (viewer_daily_cap >= 0),
  cold_daily_cap integer not null default 0 check (cold_daily_cap >= 0),
  active_thread_cap integer not null default 25 check (active_thread_cap >= 0),
  dm_bubble_daily_cap integer not null default 40 check (dm_bubble_daily_cap >= 0),
  post_reaction_daily_cap integer not null default 5 check (post_reaction_daily_cap >= 0),
  model_call_daily_cap integer not null default 60 check (model_call_daily_cap >= 0),
  icp_floor integer not null default 7 check (icp_floor between 0 and 10),
  required_scorer_version text,
  score_max_age_days integer not null default 30 check (score_max_age_days between 1 and 365),
  shared_cap_seat text,
  shared_dm_action_type text,
  shared_reaction_action_type text,
  operating_timezone text not null default 'Europe/Warsaw',
  operating_start time not null default '09:00',
  operating_end time not null default '19:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(capabilities) = 'object'),
  check (jsonb_typeof(provider_config) = 'object')
);

create table if not exists public.outreach_agent_threads (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.outreach_agent_accounts(account_id),
  client_id text not null,
  prospect_id uuid not null unique references public.outreach_prospects(id),
  person_key text not null,
  provider_chat_id text,
  provider_recipient_id text,
  cohort text not null default 'viewer' check (cohort in ('viewer','cold','existing')),
  owner text not null check (owner in ('agent','human','booking','legacy')),
  mode text not null check (mode in ('shadow','review','auto')),
  state text not null check (state in ('shadow','active','paused','stopped','closed','released')),
  revision bigint not null default 1 check (revision > 0),
  checkpoint_message_id text,
  pending_burst_deadline timestamptz,
  last_inbound_id text,
  last_outbound_id text,
  reviewed_policy_version text not null,
  pause_reason text,
  enrolled_at timestamptz not null default now(),
  closed_at timestamptz,
  last_event_at timestamptz,
  last_planner_scan_at timestamptz,
  last_poll_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, person_key)
);

alter table public.outreach_agent_threads add column if not exists last_planner_scan_at timestamptz;
alter table public.outreach_agent_threads add column if not exists last_poll_at timestamptz;

create index if not exists outreach_agent_threads_planner_fair_idx
  on public.outreach_agent_threads(client_id,last_planner_scan_at nulls first,updated_at)
  where state in ('active','shadow');
create index if not exists outreach_agent_threads_poll_fair_idx
  on public.outreach_agent_threads(client_id,last_poll_at nulls first,updated_at)
  where state in ('active','shadow','paused','stopped','closed');

create unique index if not exists outreach_agent_threads_account_chat_uq
  on public.outreach_agent_threads(account_id, provider_chat_id)
  where provider_chat_id is not null;

create table if not exists public.outreach_agent_actions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.outreach_agent_threads(id),
  turn_id text not null,
  sequence_no integer not null check (sequence_no between 1 and 2),
  kind text not null check (kind in ('reply','react_message','react_post','wait','handoff','close')),
  target_id text,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  evidence_ids text[] not null default '{}'::text[],
  source_snippets jsonb not null default '[]'::jsonb,
  validation_evidence jsonb not null default '{}'::jsonb,
  expected_revision bigint not null,
  policy_version text not null,
  opener boolean not null default false,
  due_at timestamptz not null,
  expires_at timestamptz not null,
  approval_source text check (approval_source in ('operator','policy')),
  approved_by uuid,
  approved_at timestamptz,
  approved_revision bigint,
  approved_policy_version text,
  status text not null default 'draft' check (status in ('draft','approved','claimed','sending','sent','held','cancelled','delivery_unknown')),
  claim_token text,
  claim_worker_id text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  capacity_day date,
  capacity_metric text,
  capacity_metrics text[] not null default '{}'::text[],
  capacity_reserved boolean not null default false,
  dispatch_attempt_id uuid,
  provider_message_id text,
  provider_result jsonb,
  delivery_evidence jsonb,
  provider_receipt_at timestamptz,
  echo_received_at timestamptz,
  sent_at timestamptz,
  blocked_reason text,
  message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (thread_id, turn_id, sequence_no),
  check (expires_at > due_at),
  check (jsonb_typeof(payload) = 'object'),
  check (jsonb_typeof(source_snippets) = 'array'),
  check (jsonb_typeof(validation_evidence) = 'object')
);

create index if not exists outreach_agent_actions_claim_idx
  on public.outreach_agent_actions(thread_id, due_at, sequence_no)
  where status = 'approved';

create table if not exists public.outreach_agent_events (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.outreach_agent_accounts(account_id),
  thread_id uuid references public.outreach_agent_threads(id),
  event_key text not null,
  event_type text not null,
  direction text not null,
  provider_message_id text,
  provider_chat_id text,
  provider_version text,
  matched_action_id uuid references public.outreach_agent_actions(id),
  event_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (account_id, event_key)
);

create table if not exists public.outreach_agent_daily_capacity (
  account_id text not null references public.outreach_agent_accounts(account_id),
  capacity_day date not null,
  metric text not null,
  used integer not null default 0 check (used >= 0),
  ceiling integer not null check (ceiling >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, capacity_day, metric),
  check (used <= ceiling)
);

create table if not exists public.outreach_agent_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references public.outreach_agent_actions(id),
  claim_token text not null,
  worker_id text not null,
  status text not null check (status in ('sending','confirmed','delivery_unknown','failed','held')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  provider_message_id text,
  outcome jsonb,
  baseline_ids jsonb not null default '[]'::jsonb,
  delivery_evidence jsonb,
  echo_received_at timestamptz,
  reconciliation_count integer not null default 0 check (reconciliation_count between 0 and 3),
  next_reconcile_at timestamptz,
  reconciliation_claim_token text,
  reconciliation_worker_id text,
  reconciliation_lease_expires_at timestamptz
);

alter table public.outreach_agent_dispatch_attempts
  add column if not exists baseline_ids jsonb not null default '[]'::jsonb;

alter table public.outreach_messages
  add column if not exists agent_action_id uuid references public.outreach_agent_actions(id);

create unique index if not exists outreach_messages_agent_action_uq
  on public.outreach_messages(agent_action_id)
  where agent_action_id is not null;

create or replace function public.conversation_agent_is_service()
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_role text; v_claims jsonb;
begin
  begin v_role:=auth.role(); exception when others then v_role:=null; end;
  if v_role='service_role' then return true; end if;
  v_role:=nullif(current_setting('request.jwt.claim.role',true),'');
  if v_role='service_role' then return true; end if;
  begin v_claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb; exception when others then v_claims:=null; end;
  return coalesce(v_claims->>'role','')='service_role';
end;
$$;

create or replace function public.conversation_agent_is_operator(p_account_id text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.conversation_agent_is_service()
      or exists (
        select 1 from public.outreach_agent_accounts a
        where a.account_id = p_account_id and auth.uid() = any(a.operator_ids)
      )
$$;

create or replace function public.conversation_agent_payload_hash(p_payload jsonb)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select encode(digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.conversation_agent_cancel_future(
  p_thread_id uuid,
  p_reason text,
  p_at timestamptz default now()
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  update public.outreach_agent_actions
     set status = case when status = 'sending' then 'held' else 'cancelled' end,
         blocked_reason = p_reason,
         lease_expires_at = null,
         updated_at = p_at
   where thread_id = p_thread_id
     and status in ('draft','approved','claimed','sending');
  get diagnostics v_count = row_count;

  update public.outreach_messages m
     set send_blocked_reason = p_reason,
         send_blocked_at = p_at
   where m.agent_action_id in (
     select a.id from public.outreach_agent_actions a
     where a.thread_id = p_thread_id and a.status in ('held','cancelled')
   ) and m.sent_at is null;
  return v_count;
end;
$$;

create or replace function public.conversation_agent_guard_result(p_thread public.outreach_agent_threads)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_allow boolean := false; v_reason text;
begin
  if p_thread.mode = 'shadow' then v_allow := true; v_reason := 'shadow';
  elsif p_thread.state = 'stopped' then v_reason := 'stopped';
  elsif p_thread.state = 'closed' then v_reason := 'closed';
  elsif p_thread.state = 'paused' then v_reason := 'paused';
  elsif p_thread.owner = 'agent' then v_reason := 'agent_owned';
  elsif p_thread.owner = 'human' then v_reason := 'human_owned';
  elsif p_thread.owner = 'booking' then v_reason := 'booking_owned';
  elsif p_thread.owner = 'legacy' and p_thread.state = 'released' then v_allow := true; v_reason := 'released';
  else v_reason := 'ownership_hold'; end if;
  return jsonb_build_object('allow_legacy',v_allow,'reason',v_reason,'thread_id',p_thread.id,
    'account_id',p_thread.account_id,'owner',p_thread.owner,'state',p_thread.state,'revision',p_thread.revision);
end;
$$;

create or replace function public.conversation_agent_enroll(
  p_prospect_id uuid,
  p_mode text,
  p_policy_version text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.outreach_prospects%rowtype;
  v_a public.outreach_agent_accounts%rowtype;
  v_existing public.outreach_agent_threads%rowtype;
  v_person_key text;
  v_thread_id uuid;
  v_owner text;
  v_state text;
  v_active integer;
  v_campaign_client text;
  v_viewed_at timestamptz;
  v_chat_count integer;
  v_chat_id text;
  v_last_inbound text;
  v_last_outbound text;
begin
  if p_mode not in ('shadow','review','auto') or nullif(trim(p_policy_version),'') is null then
    return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','invalid_request');
  end if;
  select p.* into v_p from public.outreach_prospects p where p.id=p_prospect_id for update;
  if not found then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','not_found'); end if;
  if v_p.campaign_id is null then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','campaign_missing'); end if;
  select a.* into v_a from public.outreach_agent_accounts a where a.campaign_id=v_p.campaign_id for update;
  if not found then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','account_unmapped'); end if;
  select c.client_id into v_campaign_client from public.outreach_campaigns c where c.id=v_p.campaign_id;
  if (v_campaign_client is null and v_a.client_id<>'ivan') or (v_campaign_client is not null and v_campaign_client is distinct from v_a.client_id) then
    return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','account_mapping_mismatch');
  end if;
  if not public.conversation_agent_is_operator(v_a.account_id) then
    return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','operator_denied');
  end if;
  if p_mode='shadow' and not v_a.shadow_enabled then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','shadow_disabled'); end if;
  if p_mode<>'shadow' and not v_a.enrollment_enabled then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','enrollment_disabled'); end if;
  if p_mode='auto' and not v_a.auto_enabled then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','auto_disabled'); end if;
  if coalesce(v_p.blacklisted,false) or coalesce(v_p.skip_state,'') in ('manual_skip','opted_out','stopped') then
    return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','suppressed');
  end if;
  if lower(coalesce(v_p.stage,'')) in ('archived','client','customer','team','internal','skipped','blacklisted','do_not_contact','stopped') then
    return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','ineligible_contact_state');
  end if;
  if v_p.trigger_type='profile_view' then
    if v_a.required_scorer_version is null then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','score_policy_unconfigured'); end if;
    if v_p.icp_score is null or v_p.icp_score<v_a.icp_floor then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','icp_below_floor'); end if;
    if nullif(trim(v_p.icp_reasoning),'') is null then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','score_evidence_missing'); end if;
    if v_p.scorer_version is distinct from v_a.required_scorer_version or v_p.scored_at is null or v_p.scored_at<now()-make_interval(days=>v_a.score_max_age_days) then
      return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','score_not_current');
    end if;
    select max(l.viewed_at) into v_viewed_at from public.profile_view_log l
      where l.prospect_id=v_p.id and l.seat=v_a.shared_cap_seat
        and l.viewer_provider_id is not distinct from v_p.linkedin_profile_id;
    if v_viewed_at is null then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','viewer_evidence_missing'); end if;
    if v_viewed_at<now()-interval '7 days' then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','viewer_evidence_stale'); end if;
    if not exists(select 1 from public.profile_view_log l where l.prospect_id=v_p.id and l.seat=v_a.shared_cap_seat
      and l.viewer_provider_id is not distinct from v_p.linkedin_profile_id and l.viewed_at=v_viewed_at and l.icp_pass is true) then
      return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','viewer_evidence_unverified');
    end if;
    if v_p.connection_sent_at is not null or exists(select 1 from public.outreach_messages m where m.prospect_id=v_p.id and m.direction='outbound'
      and m.sent_at>=now()-interval '90 days' and m.agent_action_id is null) then
      return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','prior_outreach_touch');
    end if;
  elsif coalesce(v_p.enrichment_data->>'conversation_agent_cohort','')='cold' then
    if not v_a.cold_enabled then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','cold_disabled'); end if;
  else
    return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','unsupported_cohort');
  end if;

  if nullif(trim(v_p.linkedin_profile_id),'') is not null then
    v_person_key := 'linkedin_profile_id:' || trim(v_p.linkedin_profile_id);
  elsif nullif(trim(v_p.linkedin_url),'') is not null and lower(v_p.linkedin_url) ~ '^https://(www\.)?linkedin\.com/in/' then
    v_person_key := 'linkedin_url:' || regexp_replace(split_part(lower(trim(v_p.linkedin_url)),'?',1), '/+$', '');
  else
    return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','identity_unverified');
  end if;

  select count(distinct m.unipile_chat_id),min(m.unipile_chat_id),
    (array_agg(m.unipile_message_id order by coalesce(m.sent_at,m.created_at) desc) filter(where m.direction='inbound' and m.unipile_message_id is not null))[1],
    (array_agg(m.unipile_message_id order by coalesce(m.sent_at,m.created_at) desc) filter(where m.direction='outbound' and m.unipile_message_id is not null))[1]
  into v_chat_count,v_chat_id,v_last_inbound,v_last_outbound
  from public.outreach_messages m where m.prospect_id=v_p.id and m.unipile_chat_id is not null;
  if v_chat_count>1 then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','chat_identity_ambiguous'); end if;

  select t.* into v_existing from public.outreach_agent_threads t where t.prospect_id=p_prospect_id for update;
  if found then
    if v_existing.mode='shadow' and p_mode<>'shadow' then
      select count(*) into v_active from public.outreach_agent_threads t where t.account_id=v_a.account_id and t.owner='agent' and t.state='active';
      if v_active>=v_a.active_thread_cap then return jsonb_build_object('ok',false,'thread_id',v_existing.id,'revision',v_existing.revision,'reason','active_thread_cap'); end if;
      update public.outreach_agent_actions set status='cancelled',blocked_reason='shadow_promotion',updated_at=now()
        where thread_id=v_existing.id and status in ('draft','approved','claimed','held');
      update public.outreach_messages set send_blocked_reason='shadow_promotion',send_blocked_at=now()
        where agent_action_id in (select id from public.outreach_agent_actions where thread_id=v_existing.id) and sent_at is null;
      update public.outreach_agent_threads set owner='agent',mode=p_mode,state='active',reviewed_policy_version=p_policy_version,
        provider_chat_id=coalesce(v_chat_id,provider_chat_id),provider_recipient_id=v_p.linkedin_profile_id,
        last_inbound_id=coalesce(v_last_inbound,last_inbound_id),last_outbound_id=coalesce(v_last_outbound,last_outbound_id),
        revision=revision+1,pause_reason=null,updated_at=now() where id=v_existing.id returning * into v_existing;
      update public.outreach_messages set send_blocked_reason='conversation_agent_owner:'||v_existing.id::text,send_blocked_at=now()
        where prospect_id=v_p.id and direction='outbound' and sent_at is null and agent_action_id is null and send_blocked_at is null;
      return jsonb_build_object('ok',true,'thread_id',v_existing.id,'revision',v_existing.revision,'reason','promoted');
    end if;
    return jsonb_build_object('ok',true,'thread_id',v_existing.id,'revision',v_existing.revision,'reason','already_enrolled');
  end if;
  select t.* into v_existing from public.outreach_agent_threads t where t.account_id=v_a.account_id and t.person_key=v_person_key;
  if found then return jsonb_build_object('ok',false,'thread_id',v_existing.id,'revision',v_existing.revision,'reason','identity_conflict'); end if;

  if p_mode <> 'shadow' then
    select count(*) into v_active from public.outreach_agent_threads t where t.account_id=v_a.account_id and t.owner='agent' and t.state='active';
    if v_active >= v_a.active_thread_cap then return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','active_thread_cap'); end if;
  end if;
  v_owner := case when p_mode='shadow' then 'legacy' else 'agent' end;
  v_state := case when p_mode='shadow' then 'shadow' else 'active' end;
  insert into public.outreach_agent_threads(account_id,client_id,prospect_id,person_key,provider_chat_id,provider_recipient_id,cohort,owner,mode,state,
    last_inbound_id,last_outbound_id,reviewed_policy_version)
  values(v_a.account_id,v_a.client_id,v_p.id,v_person_key,v_chat_id,v_p.linkedin_profile_id,
    case when v_p.trigger_type='profile_view' then 'viewer' else 'existing' end,v_owner,p_mode,v_state,v_last_inbound,v_last_outbound,p_policy_version)
  returning id into v_thread_id;

  if p_mode <> 'shadow' then
    update public.outreach_messages
       set send_blocked_reason='conversation_agent_owner:'||v_thread_id::text,
           send_blocked_at=now()
     where prospect_id=v_p.id and direction='outbound' and sent_at is null and agent_action_id is null
       and send_blocked_at is null;
  end if;
  return jsonb_build_object('ok',true,'thread_id',v_thread_id,'revision',1,'reason','enrolled');
exception when unique_violation then
  return jsonb_build_object('ok',false,'thread_id',null,'revision',null,'reason','identity_conflict');
end;
$$;

create or replace function public.conversation_agent_control(
  p_thread_id uuid,
  p_command text,
  p_expected_revision bigint
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_t public.outreach_agent_threads%rowtype; v_in_flight boolean; v_now timestamptz:=now();
begin
  select * into v_t from public.outreach_agent_threads where id=p_thread_id for update;
  if not found then return jsonb_build_object('ok',false,'revision',null,'reason','not_found','in_flight',false); end if;
  if not public.conversation_agent_is_operator(v_t.account_id) then return jsonb_build_object('ok',false,'revision',v_t.revision,'reason','operator_denied','in_flight',false); end if;
  if v_t.revision <> p_expected_revision then return jsonb_build_object('ok',false,'revision',v_t.revision,'reason','stale_revision','in_flight',false); end if;
  if p_command not in ('pause','resume','takeover','handback','stop','close','handoff_booking','policy_changed','release_legacy') then
    return jsonb_build_object('ok',false,'revision',v_t.revision,'reason','bad_command','in_flight',false);
  end if;
  select exists(select 1 from public.outreach_agent_actions x join public.outreach_agent_dispatch_attempts d on d.id=x.dispatch_attempt_id
    where x.thread_id=p_thread_id and d.status in ('sending','delivery_unknown')) into v_in_flight;
  if p_command in ('pause','takeover','stop','close','handoff_booking','policy_changed','release_legacy') then
    perform public.conversation_agent_cancel_future(p_thread_id,'control:'||p_command,v_now);
  end if;
  update public.outreach_agent_threads set
    owner=case p_command when 'takeover' then 'human' when 'handback' then 'agent' when 'stop' then 'human'
      when 'handoff_booking' then 'booking' when 'release_legacy' then 'legacy' else owner end,
    state=case p_command when 'pause' then 'paused' when 'resume' then 'active' when 'takeover' then 'paused'
      when 'handback' then 'active' when 'stop' then 'stopped' when 'close' then 'closed'
      when 'handoff_booking' then 'paused' when 'policy_changed' then 'paused' when 'release_legacy' then 'released' else state end,
    pause_reason=case when p_command in ('resume','handback','release_legacy') then null else 'control:'||p_command end,
    closed_at=case when p_command='close' then v_now else closed_at end,
    revision=revision+1, updated_at=v_now
  where id=p_thread_id returning * into v_t;
  if p_command='release_legacy' then
    update public.outreach_messages set send_blocked_reason=null,send_blocked_at=null
    where prospect_id=v_t.prospect_id and sent_at is null and agent_action_id is null
      and send_blocked_reason like 'conversation_agent_owner:%';
  end if;
  return jsonb_build_object('ok',true,'revision',v_t.revision,'reason',p_command,'in_flight',v_in_flight);
end;
$$;

create or replace function public.conversation_agent_ingest(p_event jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_account text:=nullif(p_event->>'accountId',''); v_key text:=nullif(p_event->>'eventKey','');
  v_type text:=nullif(p_event->>'type',''); v_direction text:=nullif(p_event->>'direction','');
  v_at timestamptz; v_t public.outreach_agent_threads%rowtype; v_action public.outreach_agent_actions%rowtype;
  v_person text:=nullif(p_event->>'personKey',''); v_mid text:=nullif(p_event->>'messageId','');
  v_chat text:=nullif(p_event->>'chatId',''); v_inserted uuid; v_match uuid; v_reason text; v_candidate_count integer; v_candidate_id uuid;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'duplicate',false,'reason','service_denied'); end if;
  if v_account is null or v_key is null or v_type is null or v_direction not in ('inbound','outbound') or not (p_event ? 'timestamp') then
    return jsonb_build_object('ok',false,'duplicate',false,'reason','invalid_event');
  end if;
  begin v_at := (p_event->>'timestamp')::timestamptz; exception when others then return jsonb_build_object('ok',false,'duplicate',false,'reason','invalid_timestamp'); end;
  if not exists(select 1 from public.outreach_agent_accounts where account_id=v_account) then return jsonb_build_object('ok',false,'duplicate',false,'reason','account_unmapped'); end if;
  if coalesce((p_event->>'groupChat')::boolean,false) then return jsonb_build_object('ok',false,'duplicate',false,'reason','group_chat'); end if;

  if v_person is not null then select * into v_t from public.outreach_agent_threads where account_id=v_account and person_key=v_person for update; end if;
  if v_t.id is null and v_chat is not null then select * into v_t from public.outreach_agent_threads where account_id=v_account and provider_chat_id=v_chat for update; end if;

  insert into public.outreach_agent_events(account_id,thread_id,event_key,event_type,direction,provider_message_id,provider_chat_id,provider_version,event_at,payload)
  values(v_account,v_t.id,v_key,v_type,v_direction,v_mid,v_chat,p_event->>'providerVersion',v_at,p_event)
  on conflict (account_id,event_key) do nothing returning id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('ok',true,'duplicate',true,'thread_id',v_t.id,'revision',v_t.revision,'owner',coalesce(v_t.owner,'legacy'),'matched_action_id',null,'reason','duplicate_event');
  end if;
  if v_t.id is null then return jsonb_build_object('ok',true,'duplicate',false,'thread_id',null,'revision',null,'owner','legacy','matched_action_id',null,'reason','unenrolled'); end if;

  if nullif(p_event->>'matchedActionId','') is not null then
    begin v_match := (p_event->>'matchedActionId')::uuid; exception when others then v_match:=null; end;
  end if;
  if v_match is not null then select * into v_action from public.outreach_agent_actions where id=v_match and thread_id=v_t.id for update; end if;
  if v_action.id is null and v_mid is not null then select * into v_action from public.outreach_agent_actions where thread_id=v_t.id and provider_message_id=v_mid order by created_at desc limit 1 for update; end if;
  if v_action.id is not null and (v_action.dispatch_attempt_id is null or v_action.status not in ('sending','sent','delivery_unknown','held')
    or (v_action.provider_message_id is not null and v_action.provider_message_id is distinct from v_mid)
    or (v_action.kind='reply' and v_action.payload->>'text' is distinct from p_event->>'text')) then
    v_action:=null;
  end if;
  if v_direction='outbound' and v_action.id is null and v_mid is not null then
    select count(*),(array_agg(x.id order by x.created_at))[1] into v_candidate_count,v_candidate_id
    from public.outreach_agent_actions x join public.outreach_agent_dispatch_attempts d on d.id=x.dispatch_attempt_id
    where x.thread_id=v_t.id and x.status in ('sending','delivery_unknown')
      and x.kind='reply' and x.payload->>'text' is not distinct from p_event->>'text'
      and (x.provider_message_id is null or x.provider_message_id=v_mid)
      and v_at between d.started_at-interval '15 seconds' and d.started_at+interval '3 minutes';
    if v_candidate_count=1 then select * into v_action from public.outreach_agent_actions where id=v_candidate_id for update; end if;
  end if;

  if v_direction='outbound' and v_action.id is not null then
    update public.outreach_agent_events set matched_action_id=v_action.id where id=v_inserted;
    update public.outreach_agent_actions set provider_message_id=coalesce(provider_message_id,v_mid),echo_received_at=v_at,updated_at=now() where id=v_action.id;
    update public.outreach_agent_dispatch_attempts set provider_message_id=coalesce(provider_message_id,v_mid),echo_received_at=v_at where action_id=v_action.id;
    return jsonb_build_object('ok',true,'duplicate',true,'thread_id',v_t.id,'revision',v_t.revision,'owner',v_t.owner,'matched_action_id',v_action.id,'reason','sender_echo');
  end if;

  if v_mid is not null and v_type='message_edit' then
    update public.outreach_messages set message_text=coalesce(p_event->>'text',''),unipile_chat_id=coalesce(v_chat,unipile_chat_id),
      draft_evidence=coalesce(draft_evidence,'{}'::jsonb)||jsonb_build_object('provider_edited_at',v_at)
      where prospect_id=v_t.prospect_id and unipile_message_id=v_mid;
  elsif v_mid is not null and v_type='message_delete' then
    update public.outreach_messages set message_text='',message_type='deleted',unipile_chat_id=coalesce(v_chat,unipile_chat_id),
      draft_evidence=coalesce(draft_evidence,'{}'::jsonb)||jsonb_build_object('provider_deleted_at',v_at)
      where prospect_id=v_t.prospect_id and unipile_message_id=v_mid;
  end if;

  if v_mid is not null and v_type not in ('message_delete','message_reaction','post_reaction')
    and not exists(select 1 from public.outreach_messages where prospect_id=v_t.prospect_id and unipile_message_id=v_mid) then
    insert into public.outreach_messages(prospect_id,direction,message_text,message_type,unipile_message_id,unipile_chat_id,sent_at,approved_at,channel)
    values(v_t.prospect_id,v_direction,coalesce(p_event->>'text',''),case when v_direction='inbound' then 'reply' else 'manual_reply' end,v_mid,v_chat,v_at,case when v_direction='outbound' then v_at else null end,'linkedin');
  end if;

  if v_t.mode='shadow' then
    v_reason:='shadow_observed';
    perform public.conversation_agent_cancel_future(v_t.id,'shadow_context_changed',now());
    update public.outreach_agent_threads set revision=revision+1,provider_chat_id=coalesce(provider_chat_id,v_chat),
      last_inbound_id=case when v_direction='inbound' then v_mid else last_inbound_id end,
      last_outbound_id=case when v_direction='outbound' then v_mid else last_outbound_id end,
      last_event_at=v_at,updated_at=now() where id=v_t.id returning * into v_t;
  elsif v_direction='outbound' then
    v_reason:='manual_takeover';
    perform public.conversation_agent_cancel_future(v_t.id,'manual_takeover',now());
    update public.outreach_agent_threads set owner='human',state='paused',pause_reason='manual_takeover',revision=revision+1,
      provider_chat_id=coalesce(provider_chat_id,v_chat),last_outbound_id=v_mid,last_event_at=v_at,updated_at=now() where id=v_t.id returning * into v_t;
  else
    v_reason:=case when v_type='stop_request' then 'stop_request' else 'inbound' end;
    perform public.conversation_agent_cancel_future(v_t.id,v_reason,now());
    update public.outreach_agent_threads set
      owner=case when v_type='stop_request' then 'human' else owner end,
      state=case when v_type='stop_request' then 'stopped'
        when v_type='message_received' and state='closed' and coalesce(pause_reason,'')<>'opt_out'
          and length(trim(coalesce(p_event->>'text','')))>=2
          and lower(trim(coalesce(p_event->>'text',''))) not in ('ok','okay','thanks','thank you','thx','got it') then 'active' else state end,
      pause_reason=case when v_type='stop_request' then 'stop_request' else pause_reason end,
      revision=revision+1,provider_chat_id=coalesce(provider_chat_id,v_chat),last_inbound_id=v_mid,last_event_at=v_at,updated_at=now()
      where id=v_t.id returning * into v_t;
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'thread_id',v_t.id,'revision',v_t.revision,'owner',v_t.owner,'matched_action_id',null,'reason',v_reason);
end;
$$;

create or replace function public.conversation_agent_set_policy(
  p_thread_id uuid,
  p_expected_revision bigint,
  p_policy_version text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_t public.outreach_agent_threads%rowtype;
begin
  if nullif(trim(p_policy_version),'') is null then return jsonb_build_object('ok',false,'revision',null,'reason','invalid_policy_version'); end if;
  select * into v_t from public.outreach_agent_threads where id=p_thread_id for update;
  if not found then return jsonb_build_object('ok',false,'revision',null,'reason','not_found'); end if;
  if not public.conversation_agent_is_operator(v_t.account_id) then return jsonb_build_object('ok',false,'revision',v_t.revision,'reason','operator_denied'); end if;
  if v_t.revision<>p_expected_revision then return jsonb_build_object('ok',false,'revision',v_t.revision,'reason','stale_revision'); end if;
  perform public.conversation_agent_cancel_future(v_t.id,'policy_changed',now());
  update public.outreach_agent_threads set reviewed_policy_version=p_policy_version,state='paused',pause_reason='policy_changed',revision=revision+1,updated_at=now()
    where id=v_t.id returning * into v_t;
  return jsonb_build_object('ok',true,'revision',v_t.revision,'reason','policy_changed');
end;
$$;

create or replace function public.conversation_agent_enqueue(
  p_thread_id uuid,
  p_expected_revision bigint,
  p_proposal jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.outreach_agent_threads%rowtype; v_a public.outreach_agent_accounts%rowtype;
  v_kind text:=p_proposal->>'kind'; v_turn text:=nullif(p_proposal->>'turnId','');
  v_policy text:=nullif(p_proposal->>'policyVersion',''); v_due timestamptz; v_exp timestamptz;
  v_bubbles jsonb:=p_proposal->'bubbles'; v_count int; v_i int; v_b jsonb; v_payload jsonb; v_id uuid; v_message uuid;
  v_ids jsonb:='[]'::jsonb; v_status text; v_auto boolean; v_evidence text[]; v_snippets jsonb;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','service_denied'); end if;
  select * into v_t from public.outreach_agent_threads where id=p_thread_id for update;
  if not found then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','not_found'); end if;
  if v_t.revision<>p_expected_revision then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','stale_revision'); end if;
  if v_policy is distinct from v_t.reviewed_policy_version then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','stale_policy'); end if;
  if v_kind not in ('reply','react_message','react_post','wait','handoff','close') or v_turn is null or nullif(p_proposal->>'reason','') is null then
    return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','invalid_proposal');
  end if;
  if exists(select 1 from public.outreach_agent_actions where thread_id=p_thread_id and turn_id=v_turn) then
    select jsonb_agg(id order by sequence_no) into v_ids from public.outreach_agent_actions where thread_id=p_thread_id and turn_id=v_turn;
    return jsonb_build_object('ok',true,'action_ids',coalesce(v_ids,'[]'::jsonb),'reason','duplicate_turn');
  end if;
  begin v_due:=(p_proposal->>'dueAt')::timestamptz; v_exp:=(p_proposal->>'expiresAt')::timestamptz;
  exception when others then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','invalid_schedule'); end;
  if v_exp<=v_due then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','invalid_schedule'); end if;
  select * into v_a from public.outreach_agent_accounts where account_id=v_t.account_id;
  select coalesce(array_agg(value), '{}'::text[]) into v_evidence from jsonb_array_elements_text(coalesce(p_proposal->'evidenceIds','[]'::jsonb));
  select coalesce(jsonb_agg(jsonb_build_object('id',left(coalesce(x->>'id',''),120),'label',left(coalesce(x->>'label','Source'),80),'snippet',left(coalesce(x->>'snippet',''),240))), '[]'::jsonb)
    into v_snippets from (select value as x from jsonb_array_elements(coalesce(p_proposal#>'{validationEvidence,sourceSnippets}','[]'::jsonb)) limit 5) s;
  v_auto := v_t.mode='auto' and v_a.auto_enabled and coalesce((p_proposal#>>'{validationEvidence,autoApproved}')::boolean,false);
  v_status := case when v_auto then 'approved' else 'draft' end;

  if v_kind='reply' then
    if jsonb_typeof(v_bubbles)<>'array' then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','invalid_bubbles'); end if;
    v_count:=jsonb_array_length(v_bubbles);
    if v_count not between 1 and 2 then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','invalid_bubbles'); end if;
    if (select count(*) from jsonb_array_elements(v_bubbles) b where length(coalesce(b->>'text',''))-length(replace(coalesce(b->>'text',''),'?','')) > 0) > 1 then
      return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','too_many_questions');
    end if;
    for v_i in 0..v_count-1 loop
      v_b:=v_bubbles->v_i;
      if length(trim(coalesce(v_b->>'text',''))) not between 1 and 400 then return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','invalid_text'); end if;
      v_payload:=jsonb_build_object('kind','reply','text',v_b->>'text','quote_id',case when v_b->'quoteId'='null'::jsonb then null else v_b->>'quoteId' end);
      insert into public.outreach_agent_actions(thread_id,turn_id,sequence_no,kind,target_id,payload,payload_hash,evidence_ids,source_snippets,validation_evidence,
        expected_revision,policy_version,opener,due_at,expires_at,status,approval_source,approved_at,approved_revision,approved_policy_version)
      values(v_t.id,v_turn,v_i+1,v_kind,v_b->>'quoteId',v_payload,public.conversation_agent_payload_hash(v_payload),v_evidence,v_snippets,coalesce(p_proposal->'validationEvidence','{}'::jsonb),
        v_t.revision,v_policy,coalesce((p_proposal->>'opener')::boolean,false) and v_i=0,v_due,v_exp,v_status,case when v_auto then 'policy' end,case when v_auto then now() end,case when v_auto then v_t.revision end,case when v_auto then v_policy end)
      returning id into v_id;
      insert into public.outreach_messages(prospect_id,direction,message_text,message_type,sequence_step,sent_at,approved_at,ai_model,channel,agent_action_id,draft_evidence)
      values(v_t.prospect_id,'outbound',v_b->>'text','conversation_agent_reply',v_i+1,null,null,'conversation_agent','linkedin',v_id,
        jsonb_build_object('thread_id',v_t.id,'turn_id',v_turn,'policy_version',v_policy,'evidence_ids',to_jsonb(v_evidence),'source_snippets',v_snippets)) returning id into v_message;
      update public.outreach_agent_actions set message_id=v_message where id=v_id;
      v_ids:=v_ids||jsonb_build_array(v_id);
    end loop;
  else
    if v_kind in ('react_message','react_post') and (nullif(p_proposal->>'targetId','') is null or nullif(p_proposal->>'reaction','') is null) then
      return jsonb_build_object('ok',false,'action_ids','[]'::jsonb,'reason','invalid_target');
    end if;
    v_payload:=case when v_kind in ('react_message','react_post') then jsonb_build_object('kind',v_kind,'target_id',p_proposal->>'targetId','reaction',p_proposal->>'reaction')
      else jsonb_build_object('kind',v_kind,'reason',p_proposal->>'reason') end;
    insert into public.outreach_agent_actions(thread_id,turn_id,sequence_no,kind,target_id,payload,payload_hash,evidence_ids,source_snippets,validation_evidence,
      expected_revision,policy_version,opener,due_at,expires_at,status,approval_source,approved_at,approved_revision,approved_policy_version)
    values(v_t.id,v_turn,1,v_kind,p_proposal->>'targetId',v_payload,public.conversation_agent_payload_hash(v_payload),v_evidence,v_snippets,coalesce(p_proposal->'validationEvidence','{}'::jsonb),
      v_t.revision,v_policy,coalesce((p_proposal->>'opener')::boolean,false),v_due,v_exp,case when v_kind in ('wait','handoff','close') then 'held' else v_status end,
      case when v_auto and v_kind not in ('wait','handoff','close') then 'policy' end,case when v_auto and v_kind not in ('wait','handoff','close') then now() end,
      case when v_auto and v_kind not in ('wait','handoff','close') then v_t.revision end,case when v_auto and v_kind not in ('wait','handoff','close') then v_policy end)
    returning id into v_id;
    v_ids:=jsonb_build_array(v_id);
    if v_t.mode<>'shadow' and v_kind='handoff' then
      update public.outreach_agent_threads set owner='human',state='paused',pause_reason='planner_handoff',revision=revision+1,updated_at=now() where id=v_t.id;
    elsif v_t.mode<>'shadow' and v_kind='close' then
      update public.outreach_agent_threads set
        owner=case when lower(p_proposal->>'reason') in ('opt_out','opt-out','do_not_contact','stop_request') then 'human' else owner end,
        state=case when lower(p_proposal->>'reason') in ('opt_out','opt-out','do_not_contact','stop_request') then 'stopped' else 'closed' end,
        pause_reason=case when lower(p_proposal->>'reason') in ('opt_out','opt-out','do_not_contact','stop_request') then 'opt_out' else pause_reason end,
        closed_at=now(),revision=revision+1,updated_at=now() where id=v_t.id;
    end if;
  end if;
  return jsonb_build_object('ok',true,'action_ids',v_ids,'reason','enqueued');
end;
$$;

create or replace function public.conversation_agent_edit(
  p_action_id uuid,
  p_expected_revision bigint,
  p_text text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_x public.outreach_agent_actions%rowtype; v_t public.outreach_agent_threads%rowtype; v_payload jsonb; v_hash text;
begin
  select * into v_x from public.outreach_agent_actions where id=p_action_id for update;
  if not found then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',null,'payload_hash',null,'revision',null,'reason','not_found'); end if;
  select * into v_t from public.outreach_agent_threads where id=v_x.thread_id for update;
  if not public.conversation_agent_is_operator(v_t.account_id) then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','operator_denied'); end if;
  if v_t.revision<>p_expected_revision or v_x.expected_revision<>p_expected_revision then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','stale_revision'); end if;
  if v_x.kind<>'reply' then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','not_reply'); end if;
  if v_x.status not in ('draft','approved') then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','not_editable'); end if;
  if length(trim(coalesce(p_text,''))) not between 1 and 400 then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','invalid_text'); end if;
  v_payload:=jsonb_set(v_x.payload,'{text}',to_jsonb(p_text),true); v_hash:=public.conversation_agent_payload_hash(v_payload);
  update public.outreach_agent_actions set payload=v_payload,payload_hash=v_hash,status='draft',approval_source=null,approved_by=null,approved_at=null,
    approved_revision=null,approved_policy_version=null,blocked_reason=null,updated_at=now() where id=p_action_id;
  update public.outreach_messages set message_text=p_text,approved_at=null,send_blocked_reason=null,send_blocked_at=null where agent_action_id=p_action_id and sent_at is null;
  return jsonb_build_object('ok',true,'action_id',p_action_id,'status','draft','payload_hash',v_hash,'revision',v_t.revision,'reason','edited');
end;
$$;

create or replace function public.conversation_agent_approve(
  p_action_id uuid,
  p_expected_revision bigint,
  p_payload_hash text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_x public.outreach_agent_actions%rowtype; v_t public.outreach_agent_threads%rowtype; v_message text;
begin
  select * into v_x from public.outreach_agent_actions where id=p_action_id for update;
  if not found then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',null,'payload_hash',null,'revision',null,'reason','not_found'); end if;
  select * into v_t from public.outreach_agent_threads where id=v_x.thread_id for update;
  if not public.conversation_agent_is_operator(v_t.account_id) then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','operator_denied'); end if;
  if v_t.revision<>p_expected_revision or v_x.expected_revision<>p_expected_revision then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','stale_revision'); end if;
  if v_x.policy_version is distinct from v_t.reviewed_policy_version then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','stale_policy'); end if;
  if lower(coalesce(p_payload_hash,'')) is distinct from v_x.payload_hash then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','payload_hash_mismatch'); end if;
  if v_x.status not in ('draft','approved') then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','not_approvable'); end if;
  if v_x.kind='reply' then
    select message_text into v_message from public.outreach_messages where agent_action_id=p_action_id and sent_at is null;
    if v_message is distinct from v_x.payload->>'text' then return jsonb_build_object('ok',false,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','draft_text_changed'); end if;
  end if;
  update public.outreach_agent_actions set status='approved',approval_source='operator',approved_by=auth.uid(),approved_at=now(),approved_revision=v_t.revision,
    approved_policy_version=v_t.reviewed_policy_version,blocked_reason=null,updated_at=now() where id=p_action_id returning * into v_x;
  return jsonb_build_object('ok',true,'action_id',p_action_id,'status',v_x.status,'payload_hash',v_x.payload_hash,'revision',v_t.revision,'reason','approved');
end;
$$;

create or replace function public.conversation_agent_claim(
  p_account_id text,
  p_now_at timestamptz,
  p_worker_id text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_a public.outreach_agent_accounts%rowtype; v_x public.outreach_agent_actions%rowtype; v_t public.outreach_agent_threads%rowtype;
  v_expired public.outreach_agent_actions%rowtype; v_day date; v_local timestamp; v_metric text; v_cap int; v_used int;
  v_metric2 text; v_cap2 int; v_used2 int; v_metrics text[]; v_m text; v_shared_type text; v_shared_ok boolean;
  v_token text; v_payload jsonb;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','service_denied'); end if;
  if nullif(trim(p_worker_id),'') is null or p_now_at is null then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','invalid_request'); end if;
  select * into v_a from public.outreach_agent_accounts where account_id=p_account_id for update;
  if not found then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','account_unmapped'); end if;
  if not v_a.dispatch_enabled then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','dispatch_disabled'); end if;
  begin v_local:=p_now_at at time zone v_a.operating_timezone; exception when others then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','invalid_timezone'); end;
  if extract(isodow from v_local) > 5 or v_local::time < v_a.operating_start or v_local::time >= v_a.operating_end then
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','outside_operating_hours');
  end if;
  v_day:=v_local::date;
  for v_expired in
    select x.* from public.outreach_agent_actions x join public.outreach_agent_threads t on t.id=x.thread_id
    where t.account_id=p_account_id and x.status='claimed' and x.dispatch_attempt_id is null and x.lease_expires_at<=p_now_at
    for update of x skip locked
  loop
    if v_expired.capacity_reserved then
      foreach v_m in array v_expired.capacity_metrics loop
        update public.outreach_agent_daily_capacity set used=greatest(0,used-1),updated_at=p_now_at
          where account_id=p_account_id and capacity_day=v_expired.capacity_day and metric=v_m;
      end loop;
    end if;
    update public.outreach_agent_actions set status='held',blocked_reason='claim_lease_expired',capacity_reserved=false,
      claim_token=null,claim_worker_id=null,lease_expires_at=null,updated_at=p_now_at where id=v_expired.id;
  end loop;
  update public.outreach_agent_actions x set status='held',blocked_reason='expired',updated_at=p_now_at
  from public.outreach_agent_threads t where x.thread_id=t.id and t.account_id=p_account_id and x.status='approved' and x.expires_at<=p_now_at;
  update public.outreach_agent_actions x set status='held',blocked_reason='stale_revision',updated_at=p_now_at
  from public.outreach_agent_threads t where x.thread_id=t.id and t.account_id=p_account_id and x.status='approved' and x.expected_revision<>t.revision;
  update public.outreach_agent_actions x set status='held',blocked_reason='stale_policy',updated_at=p_now_at
  from public.outreach_agent_threads t where x.thread_id=t.id and t.account_id=p_account_id and x.status='approved' and x.policy_version is distinct from t.reviewed_policy_version;

  select x.* into v_x from public.outreach_agent_actions x join public.outreach_agent_threads t on t.id=x.thread_id
  where t.account_id=p_account_id and t.owner='agent' and t.state='active' and x.status='approved'
    and x.due_at<=p_now_at and x.expires_at>p_now_at and x.expected_revision=t.revision and x.policy_version=t.reviewed_policy_version
    and ((t.mode='review' and x.approval_source='operator') or (t.mode='auto' and x.approval_source in ('operator','policy')))
    and not exists(select 1 from public.outreach_agent_actions prior where prior.thread_id=x.thread_id and prior.turn_id=x.turn_id and prior.sequence_no<x.sequence_no and prior.status<>'sent')
  order by x.due_at,x.created_at,x.sequence_no for update of x skip locked limit 1;
  if not found then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','no_due_action'); end if;
  select * into v_t from public.outreach_agent_threads where id=v_x.thread_id for update;
  if v_t.mode='auto' and not v_a.auto_enabled then
    update public.outreach_agent_actions set status='held',blocked_reason='auto_disabled',updated_at=p_now_at where id=v_x.id;
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','auto_disabled');
  end if;
  if v_t.cohort='cold' and not v_a.cold_enabled then
    update public.outreach_agent_actions set status='held',blocked_reason='cold_disabled',updated_at=p_now_at where id=v_x.id;
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','cold_disabled');
  end if;
  if v_t.provider_recipient_id is null or (v_x.kind='react_message' and v_t.provider_chat_id is null)
    or (v_x.kind='reply' and v_t.provider_chat_id is null
      and not (v_x.opener and coalesce(v_a.capabilities->'new_chat','false'::jsonb)='true'::jsonb)) then
    update public.outreach_agent_actions set status='held',blocked_reason='chat_identity_unverified',updated_at=p_now_at where id=v_x.id;
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','chat_identity_unverified');
  end if;
  if v_x.kind='reply' and v_x.payload->>'quote_id' is not null and coalesce(v_a.capabilities->'quote_reply','false'::jsonb)<>'true'::jsonb then
    update public.outreach_agent_actions set status='held',blocked_reason='quote_unsupported',updated_at=p_now_at where id=v_x.id;
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','quote_unsupported');
  end if;
  if v_x.kind='react_message' and coalesce(v_a.capabilities->'message_reaction','false'::jsonb)<>'true'::jsonb then
    update public.outreach_agent_actions set status='held',blocked_reason='reaction_unsupported',updated_at=p_now_at where id=v_x.id;
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','reaction_unsupported');
  end if;
  if v_x.kind='react_post' and coalesce(v_a.capabilities->'post_reaction','false'::jsonb)<>'true'::jsonb then
    update public.outreach_agent_actions set status='held',blocked_reason='reaction_unsupported',updated_at=p_now_at where id=v_x.id;
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','reaction_unsupported');
  end if;
  if v_x.kind='reply' then v_metric:='dm_bubbles';v_cap:=v_a.dm_bubble_daily_cap;v_shared_type:=v_a.shared_dm_action_type;
  elsif v_x.kind='react_post' then v_metric:='post_reactions';v_cap:=v_a.post_reaction_daily_cap;v_shared_type:=v_a.shared_reaction_action_type;
  elsif v_x.kind='react_message' then v_metric:='message_reactions';v_cap:=v_a.dm_bubble_daily_cap;v_shared_type:=v_a.shared_reaction_action_type;
  else update public.outreach_agent_actions set status='held',blocked_reason='non_dispatch_action',updated_at=p_now_at where id=v_x.id;
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','non_dispatch_action'); end if;
  if v_x.opener then
    if v_t.cohort='cold' then v_metric2:='cold_openers';v_cap2:=v_a.cold_daily_cap;
    else v_metric2:='viewer_openers';v_cap2:=v_a.viewer_daily_cap; end if;
  end if;
  select used into v_used from public.outreach_agent_daily_capacity where account_id=p_account_id and capacity_day=v_day and metric=v_metric for update;
  if coalesce(v_used,0)>=v_cap then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','lane_cap_reached'); end if;
  if v_metric2 is not null then
    select used into v_used2 from public.outreach_agent_daily_capacity where account_id=p_account_id and capacity_day=v_day and metric=v_metric2 for update;
    if coalesce(v_used2,0)>=v_cap2 then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','lane_cap_reached'); end if;
  end if;
  if v_x.kind='react_post' and exists(select 1 from public.outreach_agent_actions y where y.thread_id=v_t.id and y.kind='react_post' and y.status='sent' and y.sent_at>p_now_at-interval '7 days') then
    update public.outreach_agent_actions set status='held',blocked_reason='person_reaction_7d',updated_at=p_now_at where id=v_x.id;
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','person_reaction_7d');
  end if;
  if nullif(v_a.shared_cap_seat,'') is null or nullif(v_shared_type,'') is null then
    return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','capacity_unconfigured');
  end if;
  begin v_shared_ok:=public.linkedin_check_and_increment(v_shared_type,v_a.shared_cap_seat);
  exception when others then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','capacity_unavailable'); end;
  if v_shared_ok is null then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','capacity_unconfigured'); end if;
  if not v_shared_ok then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'reason','shared_cap_reached'); end if;
  insert into public.outreach_agent_daily_capacity(account_id,capacity_day,metric,used,ceiling,updated_at)
  values(p_account_id,v_day,v_metric,1,v_cap,p_now_at)
  on conflict(account_id,capacity_day,metric) do update set used=public.outreach_agent_daily_capacity.used+1,ceiling=excluded.ceiling,updated_at=excluded.updated_at;
  if v_metric2 is not null then
    insert into public.outreach_agent_daily_capacity(account_id,capacity_day,metric,used,ceiling,updated_at)
    values(p_account_id,v_day,v_metric2,1,v_cap2,p_now_at)
    on conflict(account_id,capacity_day,metric) do update set used=public.outreach_agent_daily_capacity.used+1,ceiling=excluded.ceiling,updated_at=excluded.updated_at;
  end if;
  v_metrics:=case when v_metric2 is null then array[v_metric] else array[v_metric,v_metric2] end;
  v_token:=encode(gen_random_bytes(24),'hex');
  update public.outreach_agent_actions set status='claimed',claim_token=v_token,claim_worker_id=p_worker_id,claimed_at=p_now_at,lease_expires_at=p_now_at+interval '120 seconds',
    capacity_day=v_day,capacity_metric=v_metric,capacity_metrics=v_metrics,capacity_reserved=true,updated_at=p_now_at where id=v_x.id returning * into v_x;
  v_payload:=jsonb_build_object('id',v_x.id,'thread_id',v_t.id,'account_id',v_a.account_id,'provider_account_id',v_a.provider_account_id,
    'provider_owner_id',v_a.provider_owner_id,'provider_chat_id',v_t.provider_chat_id,'provider_recipient_id',v_t.provider_recipient_id,
    'capabilities',v_a.capabilities,'provider_config',v_a.provider_config,'prospect_id',v_t.prospect_id,'kind',v_x.kind,'target_id',v_x.target_id,'payload',v_x.payload,
    'payload_hash',v_x.payload_hash,'expected_revision',v_x.expected_revision,'policy_version',v_x.policy_version,'turn_id',v_x.turn_id,'sequence_no',v_x.sequence_no,'opener',v_x.opener,
    'due_at',v_x.due_at,'expires_at',v_x.expires_at);
  return jsonb_build_object('ok',true,'action',v_payload,'claim_token',v_token,'reason','claimed');
end;
$$;

create or replace function public.conversation_agent_prepare_send(
  p_action_id uuid,
  p_claim_token text,
  p_expected_revision bigint
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_x public.outreach_agent_actions%rowtype; v_t public.outreach_agent_threads%rowtype;
  v_a public.outreach_agent_accounts%rowtype; v_p public.outreach_prospects%rowtype;
  v_attempt uuid; v_text text; v_reason text; v_payload jsonb; v_baseline jsonb; v_local timestamp;
  v_check_at timestamptz; v_viewed_at timestamptz; v_m text;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'action',null,'dispatch_attempt_id',null,'reason','service_denied'); end if;
  select * into v_x from public.outreach_agent_actions where id=p_action_id for update;
  if not found then return jsonb_build_object('ok',false,'action',null,'dispatch_attempt_id',null,'reason','not_found'); end if;
  select * into v_t from public.outreach_agent_threads where id=v_x.thread_id for update;
  select * into v_a from public.outreach_agent_accounts where account_id=v_t.account_id for update;
  select * into v_p from public.outreach_prospects where id=v_t.prospect_id for update;
  v_check_at:=greatest(now(),coalesce(v_x.claimed_at,now()));
  if v_x.status<>'claimed' or v_x.claim_token is distinct from p_claim_token then v_reason:='claim_mismatch';
  elsif v_x.lease_expires_at<=v_check_at then v_reason:='lease_expired';
  elsif v_x.due_at>v_check_at then v_reason:='not_due';
  elsif v_x.expires_at<=v_check_at then v_reason:='expired';
  elsif not v_x.capacity_reserved then v_reason:='capacity_unreserved';
  elsif not v_a.dispatch_enabled then v_reason:='dispatch_disabled';
  elsif v_t.mode='auto' and not v_a.auto_enabled then v_reason:='auto_disabled';
  elsif v_t.cohort='cold' and not v_a.cold_enabled then v_reason:='cold_disabled';
  elsif v_t.owner<>'agent' then v_reason:='owner_changed';
  elsif v_t.state<>'active' then v_reason:='state_changed';
  elsif v_t.revision<>p_expected_revision or v_x.expected_revision<>p_expected_revision then v_reason:='stale_revision';
  elsif v_t.reviewed_policy_version is distinct from v_x.policy_version or v_x.approved_policy_version is distinct from v_x.policy_version then v_reason:='stale_policy';
  elsif v_x.approved_revision<>v_x.expected_revision or v_x.approval_source is null then v_reason:='approval_invalid';
  elsif (v_t.mode='review' and v_x.approval_source<>'operator')
     or (v_t.mode='auto' and v_x.approval_source not in ('operator','policy')) then v_reason:='approval_invalid';
  elsif coalesce(v_p.blacklisted,false) or coalesce(v_p.skip_state,'') in ('manual_skip','opted_out','stopped') then v_reason:='suppressed';
  elsif lower(coalesce(v_p.stage,'')) in ('archived','client','customer','team','internal','skipped','blacklisted','do_not_contact','stopped') then v_reason:='ineligible_contact_state';
  elsif v_t.provider_recipient_id is null or (v_x.kind='react_message' and v_t.provider_chat_id is null)
    or (v_x.kind='reply' and v_t.provider_chat_id is null
      and not (v_x.opener and coalesce(v_a.capabilities->'new_chat','false'::jsonb)='true'::jsonb)) then v_reason:='chat_identity_unverified';
  elsif v_x.kind='reply' and v_x.payload->>'quote_id' is not null and coalesce(v_a.capabilities->'quote_reply','false'::jsonb)<>'true'::jsonb then v_reason:='quote_unsupported';
  elsif v_x.kind='react_message' and coalesce(v_a.capabilities->'message_reaction','false'::jsonb)<>'true'::jsonb then v_reason:='reaction_unsupported';
  elsif v_x.kind='react_post' and coalesce(v_a.capabilities->'post_reaction','false'::jsonb)<>'true'::jsonb then v_reason:='reaction_unsupported';
  elsif public.conversation_agent_payload_hash(v_x.payload)<>v_x.payload_hash then v_reason:='payload_hash_mismatch';
  end if;
  if v_reason is null then
    begin v_local:=v_check_at at time zone v_a.operating_timezone;
    exception when others then v_reason:='invalid_timezone'; end;
    if v_reason is null and (extract(isodow from v_local)>5 or v_local::time<v_a.operating_start or v_local::time>=v_a.operating_end) then
      v_reason:='outside_operating_hours';
    end if;
  end if;
  if v_reason is null and v_x.opener and v_t.cohort='viewer' then
    if v_a.required_scorer_version is null then v_reason:='score_policy_unconfigured';
    elsif v_p.icp_score is null or v_p.icp_score<v_a.icp_floor then v_reason:='icp_below_floor';
    elsif nullif(trim(v_p.icp_reasoning),'') is null then v_reason:='score_evidence_missing';
    elsif v_p.scorer_version is distinct from v_a.required_scorer_version or v_p.scored_at is null
      or v_p.scored_at<v_check_at-make_interval(days=>v_a.score_max_age_days) then v_reason:='score_not_current';
    else
      select max(l.viewed_at) into v_viewed_at from public.profile_view_log l
        where l.prospect_id=v_p.id and l.seat=v_a.shared_cap_seat
          and l.viewer_provider_id is not distinct from v_p.linkedin_profile_id and l.icp_pass is true;
      if v_viewed_at is null then v_reason:='viewer_evidence_missing';
      elsif v_viewed_at<v_check_at-interval '7 days' then v_reason:='viewer_evidence_stale'; end if;
    end if;
    if v_reason is null and (v_p.connection_sent_at is not null or exists(
      select 1 from public.outreach_messages m where m.prospect_id=v_p.id and m.direction='outbound'
        and m.agent_action_id is null and m.sent_at is not null and m.sent_at>=v_check_at-interval '90 days'
    )) then v_reason:='prior_outreach_touch'; end if;
  end if;
  if v_reason is null and v_x.kind='reply' then
    select message_text into v_text from public.outreach_messages where agent_action_id=v_x.id and sent_at is null;
    if v_text is distinct from v_x.payload->>'text' then v_reason:='draft_text_changed'; end if;
  end if;
  if v_reason is not null then
    if v_x.capacity_reserved then
      foreach v_m in array v_x.capacity_metrics loop
        update public.outreach_agent_daily_capacity set used=greatest(0,used-1),updated_at=v_check_at
          where account_id=v_t.account_id and capacity_day=v_x.capacity_day and metric=v_m;
      end loop;
    end if;
    update public.outreach_agent_actions set status='held',blocked_reason=v_reason,capacity_reserved=false,lease_expires_at=null,updated_at=v_check_at where id=v_x.id;
    update public.outreach_messages set send_blocked_reason=v_reason,send_blocked_at=v_check_at where agent_action_id=v_x.id and sent_at is null;
    return jsonb_build_object('ok',false,'action',null,'dispatch_attempt_id',null,'reason',v_reason);
  end if;
  v_attempt:=gen_random_uuid();
  select coalesce(jsonb_agg(s.unipile_message_id order by s.at), '[]'::jsonb) into v_baseline from (
    select m.unipile_message_id,coalesce(m.sent_at,m.created_at) at from public.outreach_messages m
    where m.prospect_id=v_t.prospect_id and m.unipile_message_id is not null order by coalesce(m.sent_at,m.created_at) desc limit 200
  ) s;
  insert into public.outreach_agent_dispatch_attempts(id,action_id,claim_token,worker_id,status,started_at,baseline_ids,next_reconcile_at)
  values(v_attempt,v_x.id,p_claim_token,v_x.claim_worker_id,'sending',v_check_at,v_baseline,v_check_at+interval '15 seconds');
  update public.outreach_agent_actions set status='sending',dispatch_attempt_id=v_attempt,blocked_reason=null,updated_at=v_check_at where id=v_x.id returning * into v_x;
  v_payload:=jsonb_build_object('id',v_x.id,'thread_id',v_t.id,'account_id',v_a.account_id,'provider_account_id',v_a.provider_account_id,
    'provider_owner_id',v_a.provider_owner_id,'provider_chat_id',v_t.provider_chat_id,'provider_recipient_id',v_t.provider_recipient_id,
    'capabilities',v_a.capabilities,'provider_config',v_a.provider_config,'prospect_id',v_t.prospect_id,'kind',v_x.kind,'target_id',v_x.target_id,'payload',v_x.payload,
    'payload_hash',v_x.payload_hash,'expected_revision',v_x.expected_revision,'policy_version',v_x.policy_version,'turn_id',v_x.turn_id,'sequence_no',v_x.sequence_no,'opener',v_x.opener);
  return jsonb_build_object('ok',true,'action',v_payload,'dispatch_attempt_id',v_attempt,'reason','sending');
end;
$$;

create or replace function public.conversation_agent_reserve_model(p_account_id text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_a public.outreach_agent_accounts%rowtype; v_day date; v_used integer; v_now timestamptz:=now();
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'reason','service_denied','used',null,'ceiling',null,'capacity_day',null); end if;
  select * into v_a from public.outreach_agent_accounts where account_id=p_account_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','account_unmapped','used',null,'ceiling',null,'capacity_day',null); end if;
  begin v_day:=(v_now at time zone v_a.operating_timezone)::date;
  exception when others then return jsonb_build_object('ok',false,'reason','invalid_timezone','used',null,'ceiling',v_a.model_call_daily_cap,'capacity_day',null); end;
  select used into v_used from public.outreach_agent_daily_capacity
    where account_id=p_account_id and capacity_day=v_day and metric='model_calls' for update;
  v_used:=coalesce(v_used,0);
  if v_used>=v_a.model_call_daily_cap then
    return jsonb_build_object('ok',false,'reason','model_cap_reached','used',v_used,'ceiling',v_a.model_call_daily_cap,'capacity_day',v_day);
  end if;
  insert into public.outreach_agent_daily_capacity(account_id,capacity_day,metric,used,ceiling,updated_at)
  values(p_account_id,v_day,'model_calls',1,v_a.model_call_daily_cap,v_now)
  on conflict(account_id,capacity_day,metric) do update
    set used=public.outreach_agent_daily_capacity.used+1,ceiling=excluded.ceiling,updated_at=excluded.updated_at
  returning used into v_used;
  return jsonb_build_object('ok',true,'reason','reserved','used',v_used,'ceiling',v_a.model_call_daily_cap,'capacity_day',v_day);
end;
$$;

create or replace function public.conversation_agent_finish(
  p_action_id uuid,
  p_claim_token text,
  p_outcome jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_x public.outreach_agent_actions%rowtype; v_t public.outreach_agent_threads%rowtype; v_a public.outreach_agent_accounts%rowtype;
  v_d public.outreach_agent_dispatch_attempts%rowtype;
  v_status text:=p_outcome->>'status'; v_receipt timestamptz; v_mid text; v_chat text; v_same boolean; v_was_unknown boolean;
  v_sibling_due timestamptz; v_m text; v_route_reason text; v_token_ok boolean;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'status',null,'revision',null,'reason','service_denied'); end if;
  select * into v_x from public.outreach_agent_actions where id=p_action_id for update;
  if not found then return jsonb_build_object('ok',false,'status',null,'revision',null,'reason','not_found'); end if;
  select * into v_t from public.outreach_agent_threads where id=v_x.thread_id for update;
  select * into v_a from public.outreach_agent_accounts where account_id=v_t.account_id;
  if v_x.status='sent' and v_status='confirmed' and (
    (v_x.kind='reply' and v_x.provider_message_id=p_outcome->>'providerMessageId')
    or (v_x.kind='react_message' and v_x.target_id=p_outcome->>'providerTargetId'
      and v_x.payload->>'reaction'=p_outcome->>'providerReaction')) then
    return jsonb_build_object('ok',true,'status','sent','revision',v_t.revision,'reason','already_confirmed');
  end if;
  if v_x.status in ('claimed','held') and v_x.dispatch_attempt_id is null and v_x.claim_token is not distinct from p_claim_token then
    if v_status not in ('held','failed') then return jsonb_build_object('ok',false,'status',v_x.status,'revision',v_t.revision,'reason','attempt_required'); end if;
    if v_x.capacity_reserved then
      foreach v_m in array v_x.capacity_metrics loop
        update public.outreach_agent_daily_capacity set used=greatest(0,used-1),updated_at=now()
          where account_id=v_t.account_id and capacity_day=v_x.capacity_day and metric=v_m;
      end loop;
    end if;
    update public.outreach_agent_actions set status='held',provider_result=p_outcome,capacity_reserved=false,claim_token=null,claim_worker_id=null,
      lease_expires_at=null,blocked_reason=coalesce(p_outcome->>'reason','held_before_attempt'),updated_at=now() where id=v_x.id;
    update public.outreach_messages set send_blocked_reason=coalesce(p_outcome->>'reason','held_before_attempt'),send_blocked_at=now()
      where agent_action_id=v_x.id and sent_at is null;
    return jsonb_build_object('ok',true,'status','held','revision',v_t.revision,'reason',coalesce(p_outcome->>'reason','held_before_attempt'));
  end if;
  if v_x.dispatch_attempt_id is null or v_x.status not in ('sending','held','delivery_unknown') then
    return jsonb_build_object('ok',false,'status',v_x.status,'revision',v_t.revision,'reason','attempt_mismatch');
  end if;
  select * into v_d from public.outreach_agent_dispatch_attempts where id=v_x.dispatch_attempt_id for update;
  v_token_ok:=v_x.claim_token is not distinct from p_claim_token or v_d.reconciliation_claim_token is not distinct from p_claim_token;
  if not v_token_ok then return jsonb_build_object('ok',false,'status',v_x.status,'revision',v_t.revision,'reason','attempt_mismatch'); end if;
  if v_status not in ('confirmed','delivery_unknown','failed','held') then return jsonb_build_object('ok',false,'status',v_x.status,'revision',v_t.revision,'reason','invalid_outcome'); end if;
  if v_status='confirmed' then
    v_mid:=nullif(p_outcome->>'providerMessageId','');
    v_chat:=nullif(p_outcome->>'providerChatId','');
    begin v_receipt:=(p_outcome->>'providerReceiptAt')::timestamptz; exception when others then v_receipt:=null; end;
    if v_receipt is null or jsonb_typeof(p_outcome->'deliveryEvidence')<>'object' then
      return jsonb_build_object('ok',false,'status',v_x.status,'revision',v_t.revision,'reason','delivery_evidence_required');
    end if;
    if v_x.kind='reply' and v_mid is null then
      return jsonb_build_object('ok',false,'status',v_x.status,'revision',v_t.revision,'reason','delivery_evidence_required');
    elsif v_x.kind='react_message' then
      if p_outcome->>'providerTargetId' is distinct from v_x.target_id
        or p_outcome->>'providerReaction' is distinct from v_x.payload->>'reaction'
        or p_outcome#>>'{deliveryEvidence,source}' is distinct from 'reaction_readback'
        or p_outcome#>>'{deliveryEvidence,accountId}' is distinct from v_a.provider_account_id
        or p_outcome#>>'{deliveryEvidence,targetId}' is distinct from v_x.target_id
        or p_outcome#>>'{deliveryEvidence,ownerProviderId}' is distinct from v_a.provider_owner_id
        or coalesce(p_outcome#>>'{deliveryEvidence,reaction}',p_outcome#>>'{deliveryEvidence,value}') is distinct from v_x.payload->>'reaction'
        or (v_t.provider_chat_id is not null and p_outcome#>>'{deliveryEvidence,chatId}' is distinct from v_t.provider_chat_id) then
        return jsonb_build_object('ok',false,'status',v_x.status,'revision',v_t.revision,'reason','reaction_evidence_mismatch');
      end if;
    elsif v_x.kind<>'reply' then
      return jsonb_build_object('ok',false,'status',v_x.status,'revision',v_t.revision,'reason','confirmation_unsupported');
    end if;
    if v_t.provider_chat_id is null and v_x.kind='reply' and v_chat is null then v_route_reason:='provider_chat_required';
    elsif v_t.provider_chat_id is not null and v_chat is not null and v_t.provider_chat_id is distinct from v_chat then v_route_reason:='provider_chat_mismatch';
    elsif v_chat is not null and exists(select 1 from public.outreach_agent_threads t2 where t2.provider_chat_id=v_chat and t2.id<>v_t.id) then v_route_reason:='provider_chat_conflict';
    end if;
    if v_route_reason is not null then
      update public.outreach_agent_actions set status='held',provider_result=p_outcome,delivery_evidence=p_outcome->'deliveryEvidence',
        lease_expires_at=null,blocked_reason=v_route_reason,updated_at=now() where id=v_x.id;
      update public.outreach_agent_dispatch_attempts set status='held',finished_at=now(),outcome=p_outcome,
        delivery_evidence=p_outcome->'deliveryEvidence' where id=v_x.dispatch_attempt_id;
      update public.outreach_messages set send_blocked_reason=v_route_reason,send_blocked_at=now()
        where agent_action_id=v_x.id and sent_at is null;
      return jsonb_build_object('ok',false,'status','held','revision',v_t.revision,'reason',v_route_reason);
    end if;
    v_was_unknown:=v_x.status='delivery_unknown';
    v_same:=not v_was_unknown and v_t.revision=v_x.expected_revision;
    update public.outreach_agent_actions set status='sent',provider_message_id=v_mid,provider_result=p_outcome,delivery_evidence=p_outcome->'deliveryEvidence',
      provider_receipt_at=v_receipt,sent_at=v_receipt,lease_expires_at=null,blocked_reason=null,updated_at=now() where id=v_x.id;
    update public.outreach_agent_dispatch_attempts set status='confirmed',finished_at=now(),provider_message_id=v_mid,outcome=p_outcome,
      delivery_evidence=p_outcome->'deliveryEvidence',next_reconcile_at=null,reconciliation_claim_token=null,
      reconciliation_worker_id=null,reconciliation_lease_expires_at=null where id=v_x.dispatch_attempt_id;
    if v_x.kind='reply' then
      update public.outreach_messages set sent_at=v_receipt,unipile_message_id=v_mid,unipile_chat_id=coalesce(unipile_chat_id,v_chat),
        send_blocked_reason=null,send_blocked_at=null where agent_action_id=v_x.id and sent_at is null;
    end if;
    update public.outreach_agent_threads set provider_chat_id=coalesce(provider_chat_id,v_chat),revision=revision+1,
      last_outbound_id=case when v_x.kind='reply' then v_mid else last_outbound_id end,
      last_event_at=v_receipt,updated_at=now() where id=v_t.id returning * into v_t;
    if v_same then
      v_sibling_due:=v_receipt+make_interval(secs=>(15+floor(random()*31))::int);
      update public.outreach_agent_actions set expected_revision=v_t.revision,
        approved_revision=case when approved_revision=v_x.expected_revision then v_t.revision else approved_revision end,
        due_at=v_sibling_due,
        status=case when expires_at<=v_sibling_due then 'held' else status end,
        blocked_reason=case when expires_at<=v_sibling_due then 'sibling_expired' else blocked_reason end,
        updated_at=now()
      where thread_id=v_x.thread_id and turn_id=v_x.turn_id and sequence_no>v_x.sequence_no and status in ('draft','approved') and expected_revision=v_x.expected_revision;
    else
      perform public.conversation_agent_cancel_future(v_t.id,'external_event_before_delivery_confirmation',now());
    end if;
    return jsonb_build_object('ok',true,'status','sent','revision',v_t.revision,'reason','confirmed');
  elsif v_status='delivery_unknown' then
    update public.outreach_agent_actions set status=case when v_d.reconciliation_count>=3 then 'held' else 'delivery_unknown' end,
      provider_result=p_outcome,delivery_evidence=coalesce(p_outcome->'deliveryEvidence','{}'::jsonb),
      lease_expires_at=null,blocked_reason=case when v_d.reconciliation_count>=3 then 'delivery_unknown_human_review' else 'delivery_unknown' end,updated_at=now() where id=v_x.id;
    update public.outreach_agent_dispatch_attempts set
      status=case when reconciliation_count>=3 then 'held' else 'delivery_unknown' end,
      finished_at=now(),outcome=p_outcome,delivery_evidence=coalesce(p_outcome->'deliveryEvidence','{}'::jsonb),
      baseline_ids=case when jsonb_typeof(p_outcome->'baselineIds')='array' then p_outcome->'baselineIds' else baseline_ids end,
      next_reconcile_at=case when v_x.status='sending' then started_at+interval '15 seconds' when reconciliation_count>=3 then null else next_reconcile_at end,
      reconciliation_claim_token=null,reconciliation_worker_id=null,reconciliation_lease_expires_at=null
      where id=v_x.dispatch_attempt_id;
    update public.outreach_messages set send_blocked_reason='delivery_unknown',send_blocked_at=now() where agent_action_id=v_x.id and sent_at is null;
    perform public.conversation_agent_cancel_future(v_t.id,'prior_delivery_unknown',now());
    return jsonb_build_object('ok',true,'status',case when v_d.reconciliation_count>=3 then 'held' else 'delivery_unknown' end,'revision',v_t.revision,
      'reason',case when v_d.reconciliation_count>=3 then 'delivery_unknown_human_review' else 'delivery_unknown' end);
  else
    update public.outreach_agent_actions set status='held',provider_result=p_outcome,delivery_evidence=coalesce(p_outcome->'deliveryEvidence','{}'::jsonb),
      lease_expires_at=null,blocked_reason=case when v_status='failed' then 'provider_failed' else coalesce(p_outcome->>'reason','held') end,updated_at=now() where id=v_x.id;
    update public.outreach_agent_dispatch_attempts set status=v_status,finished_at=now(),outcome=p_outcome,
      delivery_evidence=coalesce(p_outcome->'deliveryEvidence','{}'::jsonb),next_reconcile_at=null,
      reconciliation_claim_token=null,reconciliation_worker_id=null,reconciliation_lease_expires_at=null where id=v_x.dispatch_attempt_id;
    update public.outreach_messages set send_blocked_reason=case when v_status='failed' then 'provider_failed' else coalesce(p_outcome->>'reason','held') end,send_blocked_at=now() where agent_action_id=v_x.id and sent_at is null;
    return jsonb_build_object('ok',true,'status','held','revision',v_t.revision,'reason',case when v_status='failed' then 'provider_failed' else 'held' end);
  end if;
end;
$$;

create or replace function public.conversation_agent_reconciliation_claim(
  p_now_at timestamptz,
  p_worker_id text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_d public.outreach_agent_dispatch_attempts%rowtype; v_x public.outreach_agent_actions%rowtype;
  v_t public.outreach_agent_threads%rowtype; v_a public.outreach_agent_accounts%rowtype;
  v_token text; v_next timestamptz; v_action jsonb; v_attempt jsonb;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'attempt',null,'reason','service_denied'); end if;
  if p_now_at is null or nullif(trim(p_worker_id),'') is null then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'attempt',null,'reason','invalid_request'); end if;
  update public.outreach_agent_actions x set status='held',blocked_reason='delivery_unknown_human_review',lease_expires_at=null,updated_at=p_now_at
  from public.outreach_agent_dispatch_attempts d where d.action_id=x.id and d.reconciliation_count>=3
    and d.status in ('sending','delivery_unknown') and coalesce(d.reconciliation_lease_expires_at,d.next_reconcile_at)<=p_now_at;
  update public.outreach_agent_dispatch_attempts set status='held',next_reconcile_at=null,
    reconciliation_claim_token=null,reconciliation_worker_id=null,reconciliation_lease_expires_at=null
    where reconciliation_count>=3 and status in ('sending','delivery_unknown')
      and coalesce(reconciliation_lease_expires_at,next_reconcile_at)<=p_now_at;
  select d.* into v_d from public.outreach_agent_dispatch_attempts d
  join public.outreach_agent_actions x on x.id=d.action_id
  where d.status in ('sending','delivery_unknown') and x.status in ('sending','held','delivery_unknown') and d.reconciliation_count<3
    and d.next_reconcile_at<=p_now_at and (d.reconciliation_lease_expires_at is null or d.reconciliation_lease_expires_at<=p_now_at)
  order by d.next_reconcile_at,d.started_at for update of d skip locked limit 1;
  if not found then return jsonb_build_object('ok',false,'action',null,'claim_token',null,'attempt',null,'reason','no_reconciliation_due'); end if;
  select * into v_x from public.outreach_agent_actions where id=v_d.action_id for update;
  select * into v_t from public.outreach_agent_threads where id=v_x.thread_id;
  select * into v_a from public.outreach_agent_accounts where account_id=v_t.account_id;
  v_token:=encode(gen_random_bytes(24),'hex');
  v_next:=case v_d.reconciliation_count+1 when 1 then v_d.started_at+interval '60 seconds'
    when 2 then v_d.started_at+interval '180 seconds' else null end;
  update public.outreach_agent_dispatch_attempts set reconciliation_count=reconciliation_count+1,
    reconciliation_claim_token=v_token,reconciliation_worker_id=p_worker_id,reconciliation_lease_expires_at=p_now_at+interval '120 seconds',
    next_reconcile_at=v_next where id=v_d.id returning * into v_d;
  update public.outreach_agent_actions set status='delivery_unknown',blocked_reason='delivery_unknown',updated_at=p_now_at where id=v_x.id;
  v_action:=jsonb_build_object('id',v_x.id,'thread_id',v_t.id,'account_id',v_a.account_id,'provider_account_id',v_a.provider_account_id,
    'provider_owner_id',v_a.provider_owner_id,'provider_chat_id',v_t.provider_chat_id,'provider_recipient_id',v_t.provider_recipient_id,
    'capabilities',v_a.capabilities,'provider_config',v_a.provider_config,'prospect_id',v_t.prospect_id,'kind',v_x.kind,'target_id',v_x.target_id,
    'payload',v_x.payload,'payload_hash',v_x.payload_hash,'expected_revision',v_x.expected_revision,'policy_version',v_x.policy_version,
    'turn_id',v_x.turn_id,'sequence_no',v_x.sequence_no,'opener',v_x.opener);
  v_attempt:=jsonb_build_object('id',v_d.id,'started_at',v_d.started_at,
    'baseline_ids',v_d.baseline_ids,'reconciliation_count',v_d.reconciliation_count);
  return jsonb_build_object('ok',true,'action',v_action,'claim_token',v_token,'attempt',v_attempt,'reason','reconciliation_claimed');
end;
$$;

create or replace function public.conversation_agent_before_manual_send(p_prospect_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_p public.outreach_prospects%rowtype; v_a public.outreach_agent_accounts%rowtype; v_t public.outreach_agent_threads%rowtype;
  v_flight boolean; v_person_key text; v_count integer; v_thread_id uuid;
begin
  select * into v_p from public.outreach_prospects where id=p_prospect_id for update;
  if not found then return jsonb_build_object('ok',false,'allow_send',false,'reason','not_found','revision',null,'in_flight',false); end if;
  select * into v_t from public.outreach_agent_threads where prospect_id=p_prospect_id for update;
  if found then
    select * into v_a from public.outreach_agent_accounts where account_id=v_t.account_id;
    if not public.conversation_agent_is_operator(v_a.account_id) then return jsonb_build_object('ok',false,'allow_send',false,'reason','operator_denied','revision',v_t.revision,'in_flight',false); end if;
    select exists(select 1 from public.outreach_agent_actions x join public.outreach_agent_dispatch_attempts d on d.id=x.dispatch_attempt_id
      where x.thread_id=v_t.id and d.status in ('sending','delivery_unknown')) into v_flight;
    perform public.conversation_agent_cancel_future(v_t.id,'manual_takeover',now());
    update public.outreach_agent_threads set owner='human',state='paused',pause_reason='manual_takeover',revision=revision+1,updated_at=now() where id=v_t.id returning * into v_t;
    return jsonb_build_object('ok',true,'allow_send',not v_flight,'reason',case when v_flight then 'delivery_in_flight' else 'manual_takeover' end,
      'revision',v_t.revision,'in_flight',v_flight);
  end if;
  v_person_key:=case when nullif(trim(v_p.linkedin_profile_id),'') is not null then 'linkedin_profile_id:'||trim(v_p.linkedin_profile_id)
    when lower(v_p.linkedin_url)~'^https://(www\.)?linkedin\.com/in/' then 'linkedin_url:'||regexp_replace(split_part(lower(trim(v_p.linkedin_url)),'?',1),'/+$','') end;
  if v_person_key is null then return jsonb_build_object('ok',true,'allow_send',true,'reason','unenrolled','revision',null,'in_flight',false); end if;
  select count(*),(array_agg(id order by created_at))[1] into v_count,v_thread_id from public.outreach_agent_threads where person_key=v_person_key;
  if v_count>1 then return jsonb_build_object('ok',false,'allow_send',false,'reason','identity_ambiguous','revision',null,'in_flight',false); end if;
  if v_count=0 then return jsonb_build_object('ok',true,'allow_send',true,'reason','unenrolled','revision',null,'in_flight',false); end if;
  select * into v_t from public.outreach_agent_threads where id=v_thread_id for update;
  select * into v_a from public.outreach_agent_accounts where account_id=v_t.account_id;
  if not public.conversation_agent_is_operator(v_a.account_id) then return jsonb_build_object('ok',false,'allow_send',false,'reason','operator_denied','revision',v_t.revision,'in_flight',false); end if;
  select exists(select 1 from public.outreach_agent_actions x join public.outreach_agent_dispatch_attempts d on d.id=x.dispatch_attempt_id
    where x.thread_id=v_t.id and d.status in ('sending','delivery_unknown')) into v_flight;
  perform public.conversation_agent_cancel_future(v_t.id,'manual_takeover',now());
  update public.outreach_agent_threads set owner='human',state='paused',pause_reason='manual_takeover',revision=revision+1,updated_at=now() where id=v_t.id returning * into v_t;
  return jsonb_build_object('ok',true,'allow_send',not v_flight,'reason',case when v_flight then 'delivery_in_flight' else 'manual_takeover' end,
    'revision',v_t.revision,'in_flight',v_flight);
end;
$$;

create or replace function public.conversation_agent_guard(p_prospect_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_p public.outreach_prospects%rowtype; v_a public.outreach_agent_accounts%rowtype; v_t public.outreach_agent_threads%rowtype;
  v_person_key text; v_count integer; v_thread_id uuid;
begin
  if not public.conversation_agent_is_service() and auth.uid() is null then
    return jsonb_build_object('allow_legacy',false,'reason','operator_denied','thread_id',null,'owner',null,'state',null,'revision',null);
  end if;
  select * into v_p from public.outreach_prospects where id=p_prospect_id;
  if not found then return jsonb_build_object('allow_legacy',false,'reason','not_found','thread_id',null,'owner',null,'state',null,'revision',null); end if;
  v_person_key:=case when nullif(trim(v_p.linkedin_profile_id),'') is not null then 'linkedin_profile_id:'||trim(v_p.linkedin_profile_id)
    when lower(v_p.linkedin_url)~'^https://(www\.)?linkedin\.com/in/' then 'linkedin_url:'||regexp_replace(split_part(lower(trim(v_p.linkedin_url)),'?',1),'/+$','') end;
  if v_person_key is null then return jsonb_build_object('allow_legacy',false,'reason','identity_unverified','thread_id',null,'owner',null,'state',null,'revision',null); end if;
  select * into v_t from public.outreach_agent_threads where prospect_id=p_prospect_id;
  if not found then
    select count(*),(array_agg(id order by created_at))[1] into v_count,v_thread_id from public.outreach_agent_threads where person_key=v_person_key;
    if v_count>1 then return jsonb_build_object('allow_legacy',false,'reason','identity_ambiguous','thread_id',null,'owner',null,'state',null,'revision',null); end if;
    if v_count=1 then select * into v_t from public.outreach_agent_threads where id=v_thread_id; end if;
  end if;
  if v_t.id is null then
    if not public.conversation_agent_is_service() then
      select * into v_a from public.outreach_agent_accounts where campaign_id=v_p.campaign_id;
      if not found or not public.conversation_agent_is_operator(v_a.account_id) then
        return jsonb_build_object('allow_legacy',false,'reason','operator_denied','thread_id',null,'owner',null,'state',null,'revision',null);
      end if;
    end if;
    return jsonb_build_object('allow_legacy',true,'reason','unenrolled','thread_id',null,'owner','legacy','state',null,'revision',null);
  end if;
  if not public.conversation_agent_is_operator(v_t.account_id) then return jsonb_build_object('allow_legacy',false,'reason','operator_denied','thread_id',v_t.id,'owner',v_t.owner,'state',v_t.state,'revision',v_t.revision); end if;
  return public.conversation_agent_guard_result(v_t);
end;
$$;

create or replace function public.conversation_agent_manual_guard(p_message_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_m public.outreach_messages%rowtype; v_t public.outreach_agent_threads%rowtype; v_a public.outreach_agent_accounts%rowtype; v_revision bigint; v_chat text;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('allow_manual',false,'reason','service_denied'); end if;
  select * into v_m from public.outreach_messages where id=p_message_id;
  if not found then return jsonb_build_object('allow_manual',false,'reason','not_found'); end if;
  if v_m.direction<>'outbound' or v_m.message_type<>'manual_reply' or v_m.approved_at is null or v_m.unipile_message_id is not null
    or v_m.agent_action_id is not null or (v_m.sent_at is not null and v_m.sent_at<now()-interval '2 minutes') then
    return jsonb_build_object('allow_manual',false,'reason','not_pending_manual');
  end if;
  select * into v_t from public.outreach_agent_threads where prospect_id=v_m.prospect_id;
  if not found then return jsonb_build_object('allow_manual',true,'reason','unenrolled','message_id',v_m.id,'message_text',v_m.message_text,
    'provider_account_id',null,'provider_chat_id',v_m.unipile_chat_id,'provider_recipient_id',null,'revision',null); end if;
  select * into v_a from public.outreach_agent_accounts where account_id=v_t.account_id;
  if v_t.owner<>'human' or v_t.state<>'paused' or v_t.pause_reason<>'manual_takeover' then return jsonb_build_object('allow_manual',false,'reason','manual_owner_required'); end if;
  begin v_revision:=(v_m.draft_evidence->>'conversation_agent_manual_revision')::bigint;
  exception when others then v_revision:=null; end;
  if v_revision is distinct from v_t.revision then return jsonb_build_object('allow_manual',false,'reason','stale_manual_revision','revision',v_t.revision); end if;
  v_chat:=coalesce(v_m.unipile_chat_id,v_t.provider_chat_id);
  if v_chat is null or (v_t.provider_chat_id is not null and v_chat is distinct from v_t.provider_chat_id) or v_t.provider_recipient_id is null then
    return jsonb_build_object('allow_manual',false,'reason','manual_route_unverified','revision',v_t.revision);
  end if;
  return jsonb_build_object('allow_manual',true,'reason','manual_authorized','message_id',v_m.id,'revision',v_t.revision,
    'provider_account_id',v_a.provider_account_id,'provider_chat_id',v_chat,'provider_recipient_id',v_t.provider_recipient_id,'message_text',v_m.message_text);
end;
$$;

create or replace function public.conversation_agent_provider_guard(
  p_provider_account_id text,
  p_provider_chat_id text,
  p_provider_recipient_id text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_a public.outreach_agent_accounts%rowtype; v_t public.outreach_agent_threads%rowtype; v_p public.outreach_prospects%rowtype;
  v_count int; v_thread_count int; v_prospect_id uuid; v_person_key text; v_campaign_client text;
begin
  if not public.conversation_agent_is_service() then return jsonb_build_object('allow_legacy',false,'reason','service_denied'); end if;
  if nullif(trim(p_provider_account_id),'') is not null then
    select * into v_a from public.outreach_agent_accounts where provider_account_id=trim(p_provider_account_id);
  end if;
  if nullif(trim(p_provider_chat_id),'') is null and v_a.account_id is null and nullif(trim(p_provider_recipient_id),'') is not null then
    select count(*),(array_agg(id order by created_at))[1] into v_thread_count,v_prospect_id
      from public.outreach_agent_threads where provider_recipient_id=trim(p_provider_recipient_id)
        or person_key='linkedin_profile_id:'||trim(p_provider_recipient_id);
    if v_thread_count>1 then return jsonb_build_object('allow_legacy',false,'reason','routing_ambiguous','thread_id',null,'account_id',null,'owner',null,'state',null,'revision',null); end if;
    if v_thread_count=1 then
      select * into v_t from public.outreach_agent_threads where id=v_prospect_id;
      return public.conversation_agent_guard_result(v_t);
    end if;
    if exists(select 1 from public.outreach_prospects where linkedin_profile_id=trim(p_provider_recipient_id)) then
      return jsonb_build_object('allow_legacy',true,'reason','unenrolled','thread_id',null,'account_id',null,'owner','legacy','state',null,'revision',null);
    end if;
  end if;
  if nullif(trim(p_provider_chat_id),'') is null and (v_a.account_id is null or nullif(trim(p_provider_recipient_id),'') is null) then
    return jsonb_build_object('allow_legacy',false,'reason','routing_missing','thread_id',null,'account_id',v_a.account_id,'owner',null,'state',null,'revision',null);
  end if;

  if nullif(trim(p_provider_chat_id),'') is not null then
    select count(*) into v_thread_count from public.outreach_agent_threads where provider_chat_id=trim(p_provider_chat_id);
    if v_thread_count>1 then return jsonb_build_object('allow_legacy',false,'reason','routing_ambiguous','thread_id',null,'account_id',v_a.account_id,'owner',null,'state',null,'revision',null); end if;
    if v_thread_count=1 then select * into v_t from public.outreach_agent_threads where provider_chat_id=trim(p_provider_chat_id); end if;
    select count(distinct m.prospect_id),(array_agg(distinct m.prospect_id))[1] into v_count,v_prospect_id
      from public.outreach_messages m where m.unipile_chat_id=trim(p_provider_chat_id);
    if v_count>1 then return jsonb_build_object('allow_legacy',false,'reason','routing_ambiguous','thread_id',null,'account_id',v_a.account_id,'owner',null,'state',null,'revision',null); end if;
    if v_t.id is null and v_count=1 then
      select * into v_p from public.outreach_prospects where id=v_prospect_id;
      if v_a.account_id is not null then
        select c.client_id into v_campaign_client from public.outreach_campaigns c where c.id=v_p.campaign_id;
        if (v_campaign_client is null and v_a.client_id<>'ivan') or (v_campaign_client is not null and v_campaign_client is distinct from v_a.client_id) then
          return jsonb_build_object('allow_legacy',false,'reason','account_route_mismatch','thread_id',null,'account_id',v_a.account_id,'owner',null,'state',null,'revision',null);
        end if;
      end if;
      v_person_key:=case when nullif(trim(v_p.linkedin_profile_id),'') is not null then 'linkedin_profile_id:'||trim(v_p.linkedin_profile_id)
        when lower(v_p.linkedin_url)~'^https://(www\.)?linkedin\.com/in/' then 'linkedin_url:'||regexp_replace(split_part(lower(trim(v_p.linkedin_url)),'?',1),'/+$','') end;
      if nullif(p_provider_recipient_id,'') is not null and nullif(v_p.linkedin_profile_id,'') is not null and v_p.linkedin_profile_id is distinct from p_provider_recipient_id then
        return jsonb_build_object('allow_legacy',false,'reason','recipient_mismatch','thread_id',null,'account_id',v_a.account_id,'owner',null,'state',null,'revision',null);
      end if;
      select * into v_t from public.outreach_agent_threads where prospect_id=v_p.id or (v_person_key is not null and person_key=v_person_key)
        order by (prospect_id=v_p.id) desc limit 1;
    elsif v_t.id is null and v_count=0 and v_a.account_id is null then
      return jsonb_build_object('allow_legacy',false,'reason','chat_unmapped','thread_id',null,'account_id',null,'owner',null,'state',null,'revision',null);
    elsif v_t.id is null and v_count=0 then
      select * into v_t from public.outreach_agent_threads where account_id=v_a.account_id and provider_recipient_id=p_provider_recipient_id;
    end if;
  else
    select * into v_t from public.outreach_agent_threads where account_id=v_a.account_id and provider_recipient_id=p_provider_recipient_id;
  end if;

  if v_t.id is not null and nullif(trim(p_provider_account_id),'') is not null and (v_a.account_id is null or v_t.account_id<>v_a.account_id) then
    return jsonb_build_object('allow_legacy',false,'reason','account_route_mismatch','thread_id',v_t.id,'account_id',v_a.account_id,'owner',v_t.owner,'state',v_t.state,'revision',v_t.revision);
  end if;
  if v_t.id is not null and nullif(p_provider_recipient_id,'') is not null and v_t.provider_recipient_id is distinct from p_provider_recipient_id then
    return jsonb_build_object('allow_legacy',false,'reason','recipient_mismatch','thread_id',v_t.id,'account_id',v_t.account_id,'owner',v_t.owner,'state',v_t.state,'revision',v_t.revision);
  end if;
  if v_t.id is null then
    return jsonb_build_object('allow_legacy',true,'reason','unenrolled','thread_id',null,'account_id',v_a.account_id,'owner','legacy','state',null,'revision',null);
  end if;
  return public.conversation_agent_guard_result(v_t);
end;
$$;

create or replace function public.conversation_agent_owner(p_account_id text,p_person_key text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_t public.outreach_agent_threads%rowtype;
begin
  if not exists(select 1 from public.outreach_agent_accounts where account_id=p_account_id) then return jsonb_build_object('enrolled',false,'reason','account_unmapped'); end if;
  if not public.conversation_agent_is_operator(p_account_id) then return jsonb_build_object('enrolled',false,'reason','operator_denied'); end if;
  select * into v_t from public.outreach_agent_threads where account_id=p_account_id and person_key=p_person_key;
  if not found then return jsonb_build_object('enrolled',false,'owner','legacy','state',null,'revision',null,'thread_id',null,'mode',null,'reason','unenrolled'); end if;
  return jsonb_build_object('enrolled',true,'owner',v_t.owner,'state',v_t.state,'revision',v_t.revision,'thread_id',v_t.id,'mode',v_t.mode,'reason','enrolled');
end;
$$;

create or replace function public.conversation_agent_cards()
returns setof jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'thread_id',t.id,'prospect_id',t.prospect_id,'account_id',t.account_id,'client_id',t.client_id,'person_key',t.person_key,
    'prospect_name',p.name,'linkedin_url',p.linkedin_url,'owner',t.owner,'mode',t.mode,'state',t.state,'revision',t.revision,
    'policy_version',t.reviewed_policy_version,'pause_reason',t.pause_reason,'enrolled_at',t.enrolled_at,
    'last_inbound_id',t.last_inbound_id,'last_outbound_id',t.last_outbound_id,
    'latest_inbound',li.item,'next_action',na.item,'actions',coalesce(ax.items,'[]'::jsonb)
  )
  from public.outreach_agent_threads t
  join public.outreach_agent_accounts ac on ac.account_id=t.account_id
  join public.outreach_prospects p on p.id=t.prospect_id
  left join lateral (
    select jsonb_build_object('id',m.unipile_message_id,'text',m.message_text,'at',m.sent_at) item
    from public.outreach_messages m where m.prospect_id=t.prospect_id and m.direction='inbound'
    order by m.sent_at desc nulls last,m.created_at desc limit 1
  ) li on true
  left join lateral (
    select jsonb_build_object('id',x.id,'kind',x.kind,'status',x.status,'due_at',x.due_at,'expires_at',x.expires_at,
      'payload_hash',x.payload_hash,'expected_revision',x.expected_revision,'blocked_reason',x.blocked_reason) item
    from public.outreach_agent_actions x where x.thread_id=t.id and x.expected_revision=t.revision
      and x.policy_version=t.reviewed_policy_version and x.status in ('draft','approved','claimed','sending','delivery_unknown','held')
    order by case when x.status='held' then 1 else 0 end,
      case x.status when 'delivery_unknown' then 0 when 'sending' then 1 when 'claimed' then 2 when 'approved' then 3 else 4 end,
      x.created_at desc,x.sequence_no desc limit 1
  ) na on true
  left join lateral (
    select jsonb_agg(z.item order by z.created_at desc,z.sequence_no desc) items from (
      select x.created_at,x.sequence_no,jsonb_build_object('id',x.id,'turn_id',x.turn_id,'sequence_no',x.sequence_no,'kind',x.kind,'status',x.status,
        'payload',x.payload,'payload_hash',x.payload_hash,'expected_revision',x.expected_revision,'policy_version',x.policy_version,'due_at',x.due_at,
        'expires_at',x.expires_at,'approval_source',x.approval_source,'approved_at',x.approved_at,'blocked_reason',x.blocked_reason,
        'evidence_ids',to_jsonb(x.evidence_ids),'source_snippets',x.source_snippets) item
      from public.outreach_agent_actions x where x.thread_id=t.id order by x.created_at desc,x.sequence_no desc limit 20
    ) z
  ) ax on true
  where public.conversation_agent_is_service() or auth.uid()=any(ac.operator_ids)
  order by t.updated_at desc
$$;

alter table public.outreach_agent_accounts enable row level security;
alter table public.outreach_agent_threads enable row level security;
alter table public.outreach_agent_actions enable row level security;
alter table public.outreach_agent_events enable row level security;
alter table public.outreach_agent_daily_capacity enable row level security;
alter table public.outreach_agent_dispatch_attempts enable row level security;

drop policy if exists outreach_agent_accounts_service on public.outreach_agent_accounts;
create policy outreach_agent_accounts_service on public.outreach_agent_accounts for all to service_role using (true) with check (true);
drop policy if exists outreach_agent_accounts_operator_select on public.outreach_agent_accounts;
create policy outreach_agent_accounts_operator_select on public.outreach_agent_accounts for select to authenticated using (auth.uid()=any(operator_ids));
drop policy if exists outreach_agent_threads_service on public.outreach_agent_threads;
create policy outreach_agent_threads_service on public.outreach_agent_threads for all to service_role using (true) with check (true);
drop policy if exists outreach_agent_threads_operator_select on public.outreach_agent_threads;
create policy outreach_agent_threads_operator_select on public.outreach_agent_threads for select to authenticated using (public.conversation_agent_is_operator(account_id));
drop policy if exists outreach_agent_actions_service on public.outreach_agent_actions;
create policy outreach_agent_actions_service on public.outreach_agent_actions for all to service_role using (true) with check (true);
drop policy if exists outreach_agent_actions_operator_select on public.outreach_agent_actions;
create policy outreach_agent_actions_operator_select on public.outreach_agent_actions for select to authenticated using (exists(select 1 from public.outreach_agent_threads t where t.id=thread_id and public.conversation_agent_is_operator(t.account_id)));
drop policy if exists outreach_agent_events_service on public.outreach_agent_events;
create policy outreach_agent_events_service on public.outreach_agent_events for all to service_role using (true) with check (true);
drop policy if exists outreach_agent_capacity_service on public.outreach_agent_daily_capacity;
create policy outreach_agent_capacity_service on public.outreach_agent_daily_capacity for all to service_role using (true) with check (true);
drop policy if exists outreach_agent_attempts_service on public.outreach_agent_dispatch_attempts;
create policy outreach_agent_attempts_service on public.outreach_agent_dispatch_attempts for all to service_role using (true) with check (true);

revoke all on public.outreach_agent_accounts,public.outreach_agent_threads,public.outreach_agent_actions,public.outreach_agent_events,
  public.outreach_agent_daily_capacity,public.outreach_agent_dispatch_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.outreach_agent_accounts,public.outreach_agent_threads,public.outreach_agent_actions,public.outreach_agent_events,
  public.outreach_agent_daily_capacity,public.outreach_agent_dispatch_attempts to service_role;

revoke execute on function public.conversation_agent_enroll(uuid,text,text),public.conversation_agent_control(uuid,text,bigint),
  public.conversation_agent_set_policy(uuid,bigint,text),public.conversation_agent_ingest(jsonb),public.conversation_agent_enqueue(uuid,bigint,jsonb),public.conversation_agent_edit(uuid,bigint,text),
  public.conversation_agent_approve(uuid,bigint,text),public.conversation_agent_claim(text,timestamptz,text),
  public.conversation_agent_prepare_send(uuid,text,bigint),public.conversation_agent_reserve_model(text),public.conversation_agent_finish(uuid,text,jsonb),
  public.conversation_agent_reconciliation_claim(timestamptz,text),public.conversation_agent_before_manual_send(uuid),public.conversation_agent_manual_guard(uuid),
  public.conversation_agent_guard(uuid),public.conversation_agent_provider_guard(text,text,text),
  public.conversation_agent_owner(text,text),public.conversation_agent_cards() from public,anon,authenticated;

grant execute on function public.conversation_agent_enroll(uuid,text,text),public.conversation_agent_control(uuid,text,bigint),
  public.conversation_agent_set_policy(uuid,bigint,text),public.conversation_agent_edit(uuid,bigint,text),public.conversation_agent_approve(uuid,bigint,text),
  public.conversation_agent_before_manual_send(uuid),public.conversation_agent_guard(uuid),public.conversation_agent_owner(text,text),
  public.conversation_agent_cards() to authenticated,service_role;
grant execute on function public.conversation_agent_ingest(jsonb),public.conversation_agent_enqueue(uuid,bigint,jsonb),
  public.conversation_agent_claim(text,timestamptz,text),public.conversation_agent_prepare_send(uuid,text,bigint),
  public.conversation_agent_reserve_model(text),public.conversation_agent_finish(uuid,text,jsonb),public.conversation_agent_reconciliation_claim(timestamptz,text),
  public.conversation_agent_manual_guard(uuid),public.conversation_agent_provider_guard(text,text,text) to service_role;

revoke execute on function public.conversation_agent_is_service(),public.conversation_agent_is_operator(text),
  public.conversation_agent_payload_hash(jsonb),public.conversation_agent_cancel_future(uuid,text,timestamptz),
  public.conversation_agent_guard_result(public.outreach_agent_threads) from public,anon,authenticated;
grant execute on function public.conversation_agent_is_service(),public.conversation_agent_is_operator(text),
  public.conversation_agent_payload_hash(jsonb),public.conversation_agent_cancel_future(uuid,text,timestamptz),
  public.conversation_agent_guard_result(public.outreach_agent_threads) to service_role;
