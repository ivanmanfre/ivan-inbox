begin;

create or replace function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'assertion failed: %', p_message; end if;
end $$;

insert into outreach_campaigns(id,name,client_id) values
  ('10000000-0000-0000-0000-000000000001','Ivan legacy campaign',null),
  ('10000000-0000-0000-0000-000000000002','Other client','other'),
  ('10000000-0000-0000-0000-000000000003','Unmapped','ivan');

insert into outreach_prospects(id,campaign_id,linkedin_url,linkedin_profile_id,name,trigger_type) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/alice','member-alice','Alice','profile_view'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/alice-duplicate','member-alice','Alice Duplicate','profile_view'),
  ('20000000-0000-0000-0000-000000000003',null,'https://www.linkedin.com/in/no-campaign','member-none','No Campaign','profile_view'),
  ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','https://www.linkedin.com/in/other','member-other','Other Tenant','profile_view'),
  ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000003','https://www.linkedin.com/in/unmapped','member-unmapped','Unmapped','profile_view'),
  ('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/bob','member-bob','Bob','profile_view'),
  ('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/carol','member-carol','Carol','profile_view'),
  ('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/dave','member-dave','Dave','profile_view'),
  ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/eve','member-eve','Eve','profile_view'),
  ('20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/shadow','member-shadow','Shadow','profile_view'),
  ('20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/frank','member-frank','Frank','profile_view'),
  ('20000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000003','https://www.linkedin.com/in/legacy','member-legacy','Legacy','profile_view'),
  ('20000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/stale','member-stale','Stale Viewer','profile_view'),
  ('20000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/low','member-low','Low ICP','profile_view'),
  ('20000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/new-chat','member-new-chat','New Chat','profile_view'),
  ('20000000-0000-0000-0000-000000000016','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/no-reason','member-no-reason','No Score Evidence','profile_view'),
  ('20000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-000000000003','',null,'Email Only','email'),
  ('20000000-0000-0000-0000-000000000018','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/crash','member-crash','Crash Recovery','profile_view'),
  ('20000000-0000-0000-0000-000000000019','10000000-0000-0000-0000-000000000001','https://www.linkedin.com/in/optout','member-optout','Opt Out','profile_view');

update outreach_prospects set profile_viewed_at=now()-interval '1 day',icp_score=8,icp_reasoning='Persisted current rubric evidence',
  scorer_version='rubric-1',scored_at=now()-interval '1 day';
update outreach_prospects set profile_viewed_at=now()-interval '8 days' where id='20000000-0000-0000-0000-000000000013';
update outreach_prospects set icp_score=6 where id='20000000-0000-0000-0000-000000000014';
update outreach_prospects set icp_reasoning=null where id='20000000-0000-0000-0000-000000000016';

insert into profile_view_log(seat,viewer_public_id,viewer_provider_id,viewer_name,viewed_at,capture_day,captured_at,provenance,prospect_id,icp_pass)
select case when campaign_id='10000000-0000-0000-0000-000000000002' then 'other' else 'ivan' end,
  'public-'||right(id::text,2),linkedin_profile_id,name,profile_viewed_at,profile_viewed_at::date,profile_viewed_at,'persisted_test_fixture',id,icp_score>=7
from outreach_prospects where campaign_id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');

insert into outreach_messages(prospect_id,direction,message_text,unipile_message_id,unipile_chat_id,sent_at,channel) values
  ('20000000-0000-0000-0000-000000000001','inbound','Alice hello','alice-in','chat-alice',now()-interval '1 hour','linkedin'),
  ('20000000-0000-0000-0000-000000000008','inbound','Hi','dave-in','chat-dave','2026-09-15T09:00:00Z','linkedin'),
  ('20000000-0000-0000-0000-000000000009','inbound','One','eve-in-1','chat-eve-a','2026-09-15T09:00:00Z','linkedin'),
  ('20000000-0000-0000-0000-000000000009','inbound','Two','eve-in-2','chat-eve-b','2026-09-15T09:01:00Z','linkedin'),
  ('20000000-0000-0000-0000-000000000011','inbound','Hello','frank-in','chat-frank',now()-interval '1 hour','linkedin'),
  ('20000000-0000-0000-0000-000000000012','inbound','Legacy hello','legacy-in','chat-legacy',now()-interval '1 hour','linkedin'),
  ('20000000-0000-0000-0000-000000000018','inbound','Crash hello','crash-in','chat-crash',now()-interval '1 hour','linkedin'),
  ('20000000-0000-0000-0000-000000000019','inbound','No thanks','optout-in','chat-optout',now()-interval '1 hour','linkedin');

insert into outreach_agent_accounts(
  account_id,client_id,campaign_id,provider_account_id,operator_ids,
  shadow_enabled,enrollment_enabled,dispatch_enabled,auto_enabled,
  shared_cap_seat,shared_dm_action_type,shared_reaction_action_type,required_scorer_version,operating_start,operating_end
) values
  ('acct-ivan','ivan','10000000-0000-0000-0000-000000000001','provider-ivan',array['30000000-0000-0000-0000-000000000001'::uuid],true,true,true,true,'ivan','dm','reaction','rubric-1','00:00','23:59:59'),
  ('acct-other','other','10000000-0000-0000-0000-000000000002','provider-other',array['30000000-0000-0000-0000-000000000002'::uuid],true,true,true,true,'other','dm','reaction','rubric-1','00:00','23:59:59');

set local request.jwt.claim.role = 'service_role';

do $$
declare r jsonb; t uuid; rev bigint;
begin
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000003','review','policy-1');
  perform pg_temp.assert_true(r->>'reason' = 'campaign_missing', 'NULL campaign fails closed');
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000005','review','policy-1');
  perform pg_temp.assert_true(r->>'reason' = 'account_unmapped', 'unknown campaign mapping fails closed');
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000013','review','policy-1');
  perform pg_temp.assert_true(r->>'reason' = 'viewer_evidence_stale', 'viewer evidence older than seven days cannot enroll');
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000014','review','policy-1');
  perform pg_temp.assert_true(r->>'reason' = 'icp_below_floor', 'viewer below the current ICP floor cannot enroll');
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000016','review','policy-1');
  perform pg_temp.assert_true(r->>'reason' = 'score_evidence_missing', 'viewer without persisted score reasoning cannot enroll');

  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000001','review','policy-1');
  perform pg_temp.assert_true((r->>'ok')::boolean, 'mapped person enrolls');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000001','review','policy-1');
  perform pg_temp.assert_true(r->>'reason' = 'already_enrolled', 'same prospect cannot enroll twice');
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000002','review','policy-1');
  perform pg_temp.assert_true(r->>'reason' = 'identity_conflict', 'same person cannot have duplicate ownership');

  r := conversation_agent_control(t,'pause',rev + 99);
  perform pg_temp.assert_true(r->>'reason' = 'stale_revision', 'control rejects stale revision');
end $$;

do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000004','review','policy-1');
  perform pg_temp.assert_true(r->>'reason' = 'operator_denied', 'operator cannot control another tenant');
  perform set_config('request.jwt.claim.role','service_role',true);
end $$;

do $$
declare r jsonb; t uuid; rev bigint; a uuid; good_hash text;
begin
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000006','review','policy-1');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  r := conversation_agent_enqueue(t,rev,jsonb_build_object(
    'turnId','turn-bob-1','kind','reply','reason','answer','evidenceIds',jsonb_build_array('message:in-1'),
    'dueAt','2026-09-15T10:00:00Z','expiresAt','2026-09-15T11:00:00Z','policyVersion','policy-1','opener',false,
    'bubbles',jsonb_build_array(jsonb_build_object('text','First answer?','quoteId',null),jsonb_build_object('text','Second bubble','quoteId',null)),
    'validationEvidence',jsonb_build_object('sourceSnippets',jsonb_build_array(jsonb_build_object('id','message:in-1','label','Inbound','snippet','Can you explain?')))
  ));
  perform pg_temp.assert_true(jsonb_array_length(r->'action_ids') = 2, 'two bubbles expand to two actions');
  a := (r->'action_ids'->>0)::uuid;
  select payload_hash into good_hash from outreach_agent_actions where id=a;
  r := conversation_agent_approve(a,rev,repeat('0',64));
  perform pg_temp.assert_true(r->>'reason' = 'payload_hash_mismatch', 'wrong text hash cannot approve');
  r := conversation_agent_approve(a,rev,good_hash);
  perform pg_temp.assert_true(r->>'reason' = 'approved', 'exact hash and revision approve');
  perform pg_temp.assert_true((select sent_at is null and approved_at is null from outreach_messages where agent_action_id=a), 'agent draft remains unsent and unstamped');

  r := conversation_agent_edit(a,rev,'Changed after approval');
  perform pg_temp.assert_true(r->>'reason' = 'edited' and r->>'status' = 'draft', 'edit invalidates approval');
  perform pg_temp.assert_true((select approval_source is null and approved_at is null from outreach_agent_actions where id=a), 'edit clears approval metadata');

  r := conversation_agent_ingest(jsonb_build_object(
    'accountId','acct-ivan','personKey','linkedin_profile_id:member-bob','eventKey','evt-bob-stop','type','stop_request',
    'direction','inbound','timestamp','2026-09-15T10:02:00Z','messageId','provider-stop','text','please stop'
  ));
  perform pg_temp.assert_true(r->>'owner' = 'human', 'stop transfers ownership');
  perform pg_temp.assert_true((select state='stopped' from outreach_agent_threads where id=t), 'stop request stops thread');
  perform pg_temp.assert_true((select count(*)=2 from outreach_agent_actions where thread_id=t and status='cancelled'), 'stop cancels both bubbles');
  r := conversation_agent_ingest(jsonb_build_object(
    'accountId','acct-ivan','personKey','linkedin_profile_id:member-bob','eventKey','evt-bob-reaction','type','message_reaction',
    'direction','inbound','timestamp','2026-09-15T10:03:00Z','messageId','provider-stop','text','like'
  ));
  perform pg_temp.assert_true((select state='stopped' from outreach_agent_threads where id=t), 'reaction cannot reopen a stopped thread');
end $$;

do $$
declare r jsonb; t uuid; rev bigint; ids jsonb; a1 uuid; a2 uuid; h1 text; h2 text; c1 jsonb; c2 jsonb; rc jsonb; attempt text; confirmed_rev bigint;
begin
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000007','review','policy-1');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  update outreach_agent_threads set provider_chat_id='chat-carol', provider_recipient_id='member-carol' where id=t;
  r := conversation_agent_enqueue(t,rev,jsonb_build_object(
    'turnId','turn-carol-1','kind','reply','reason','answer','evidenceIds',jsonb_build_array('message:in-c'),
    'dueAt','2026-09-15T10:00:00Z','expiresAt','2026-09-15T11:00:00Z','policyVersion','policy-1','opener',false,
    'bubbles',jsonb_build_array(jsonb_build_object('text','Bubble one','quoteId',null),jsonb_build_object('text','Bubble two','quoteId',null))
  ));
  ids := r->'action_ids'; a1 := (ids->>0)::uuid; a2 := (ids->>1)::uuid;
  select payload_hash into h1 from outreach_agent_actions where id=a1;
  select payload_hash into h2 from outreach_agent_actions where id=a2;
  perform conversation_agent_approve(a1,rev,h1); perform conversation_agent_approve(a2,rev,h2);

  c1 := conversation_agent_claim('acct-ivan','2026-09-15T10:05:00Z','worker-a');
  perform pg_temp.assert_true((c1->>'ok')::boolean and (c1->'action'->>'id')::uuid=a1, 'first worker claims first bubble');
  c2 := conversation_agent_claim('acct-ivan','2026-09-15T10:05:00Z','worker-b');
  perform pg_temp.assert_true(c2->>'reason' = 'no_due_action', 'second worker cannot claim same turn while first is unresolved');

  r := conversation_agent_prepare_send(a1,c1->>'claim_token',rev);
  attempt := r->>'dispatch_attempt_id';
  perform pg_temp.assert_true((r->>'ok')::boolean and attempt is not null, 'attempt persists before provider call');
  r := conversation_agent_ingest(jsonb_build_object(
    'accountId','acct-ivan','personKey','linkedin_profile_id:member-carol','eventKey','evt-echo-early','type','message_sent',
    'direction','outbound','timestamp','2026-09-15T10:05:09Z','messageId','provider-out-1','chatId','chat-carol','text','Bubble one'
  ));
  perform pg_temp.assert_true((r->>'duplicate')::boolean and r->>'reason'='sender_echo', 'early own echo correlates to exactly one sending attempt without trusting a supplied action id');
  r := conversation_agent_finish(a1,c1->>'claim_token',jsonb_build_object(
    'status','confirmed','providerMessageId','provider-out-1','providerReceiptAt','2026-09-15T10:05:10Z',
    'deliveryEvidence',jsonb_build_object('httpStatus',201)
  ));
  perform pg_temp.assert_true(r->>'status' = 'sent', 'confirmed delivery is sent');
  perform pg_temp.assert_true((select sent_at is not null and unipile_message_id='provider-out-1' from outreach_messages where agent_action_id=a1), 'confirmed delivery stamps linked message');
  perform pg_temp.assert_true((select expected_revision=rev+1 and status='approved' from outreach_agent_actions where id=a2), 'same-turn second bubble rebases after confirmed first bubble');
  perform pg_temp.assert_true((select due_at between '2026-09-15T10:05:25Z'::timestamptz and '2026-09-15T10:05:55Z'::timestamptz from outreach_agent_actions where id=a2), 'second bubble receives one persisted 15-45 second post-confirmation delay');

  r := conversation_agent_ingest(jsonb_build_object(
    'accountId','acct-ivan','personKey','linkedin_profile_id:member-carol','eventKey','evt-echo-1','type','message_sent',
    'direction','outbound','timestamp','2026-09-15T10:05:11Z','messageId','provider-out-1','text','Bubble one'
  ));
  perform pg_temp.assert_true((r->>'duplicate')::boolean and (r->>'revision')::bigint=rev+1, 'provider echo does not increment own-send twice');

  c1 := conversation_agent_claim('acct-ivan','2026-09-15T10:06:00Z','worker-a');
  perform pg_temp.assert_true((c1->'action'->>'id')::uuid=a2, 'rebased second bubble becomes claimable');
  perform conversation_agent_prepare_send(a2,c1->>'claim_token',rev+1);
  r := conversation_agent_finish(a2,c1->>'claim_token',jsonb_build_object(
    'status','delivery_unknown','deliveryEvidence',jsonb_build_object('timeoutMs',15000)
  ));
  perform pg_temp.assert_true(r->>'status'='delivery_unknown', 'ambiguous delivery persists unknown hold');
  perform pg_temp.assert_true((select sent_at is null from outreach_messages where agent_action_id=a2), 'unknown delivery never stamps sent');
  rc := conversation_agent_reconciliation_claim('2026-09-15T10:06:30Z','reconciler-a');
  perform pg_temp.assert_true((rc->>'ok')::boolean and (rc->'action'->>'id')::uuid=a2 and (rc->'attempt'->>'reconciliation_count')::int=1, 'unknown delivery schedules a bounded read-only reconciliation claim');
  r := conversation_agent_finish(a2,rc->>'claim_token',jsonb_build_object('status','confirmed','providerMessageId','provider-out-2',
    'providerReceiptAt','2026-09-15T10:06:31Z','deliveryEvidence',jsonb_build_object('source','read_only_reconciliation')));
  confirmed_rev := (r->>'revision')::bigint;
  perform pg_temp.assert_true(r->>'status'='sent' and (select sent_at is not null from outreach_messages where agent_action_id=a2), 'reconciliation can confirm an unknown delivery');
  r := conversation_agent_finish(a2,rc->>'claim_token',jsonb_build_object('status','confirmed','providerMessageId','provider-out-2',
    'providerReceiptAt','2026-09-15T10:06:31Z','deliveryEvidence',jsonb_build_object('source','read_only_reconciliation')));
  perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'revision')::bigint=confirmed_rev, 'same confirmed receipt is idempotent and does not increment revision twice');
  c2 := conversation_agent_claim('acct-ivan','2026-09-15T10:10:00Z','worker-b');
  perform pg_temp.assert_true(c2->>'reason'='no_due_action', 'reconciled delivery does not requeue');
end $$;

do $$
declare r jsonb; t uuid; rev bigint; a uuid; h text; manual_id uuid; manual_rev bigint;
begin
  update outreach_agent_threads set owner='agent',state='active',mode='review',pause_reason=null where prospect_id='20000000-0000-0000-0000-000000000001' returning id,revision into t,rev;
  r := conversation_agent_enqueue(t,rev,jsonb_build_object(
    'turnId','turn-manual','kind','reply','reason','followup','evidenceIds','[]'::jsonb,
    'dueAt','2026-09-15T10:00:00Z','expiresAt','2026-09-15T11:00:00Z','policyVersion','policy-1','opener',false,
    'bubbles',jsonb_build_array(jsonb_build_object('text','Queued text','quoteId',null))
  ));
  a := (r->'action_ids'->>0)::uuid; select payload_hash into h from outreach_agent_actions where id=a;
  perform conversation_agent_approve(a,rev,h);
  r := conversation_agent_before_manual_send('20000000-0000-0000-0000-000000000001');
  perform pg_temp.assert_true((r->>'allow_send')::boolean and r->>'reason'='manual_takeover', 'manual-send helper permits exact mapped prospect');
  manual_rev := (r->>'revision')::bigint;
  perform pg_temp.assert_true((select owner='human' and revision=rev+1 from outreach_agent_threads where id=t), 'manual takeover changes owner and revision');
  perform pg_temp.assert_true((select status='cancelled' from outreach_agent_actions where id=a), 'manual takeover cancels queued approval');
  insert into outreach_messages(prospect_id,direction,message_text,message_type,unipile_chat_id,approved_at,sent_at,channel,draft_evidence)
  values('20000000-0000-0000-0000-000000000001','outbound','Human answer','manual_reply','chat-alice',now(),null,'linkedin',
    jsonb_build_object('conversation_agent_manual_revision',manual_rev)) returning id into manual_id;
  r := conversation_agent_manual_guard(manual_id);
  perform pg_temp.assert_true((r->>'allow_manual')::boolean and r->>'provider_account_id'='provider-ivan' and r->>'provider_chat_id'='chat-alice', 'exact manual row receives server-bound route authorization');
  update outreach_messages set draft_evidence=jsonb_build_object('conversation_agent_manual_revision',manual_rev-1) where id=manual_id;
  r := conversation_agent_manual_guard(manual_id);
  perform pg_temp.assert_true(not (r->>'allow_manual')::boolean and r->>'reason'='stale_manual_revision', 'stale manual authorization cannot send');
end $$;

do $$
declare r jsonb; t uuid; rev bigint; a uuid; h text; card jsonb;
begin
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000008','review','policy-1');
  perform pg_temp.assert_true((r->>'ok')::boolean, 'unique existing provider chat enrolls');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  perform pg_temp.assert_true((select provider_chat_id='chat-dave' from outreach_agent_threads where id=t), 'enrollment derives unique trusted chat id');
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000009','review','policy-1');
  perform pg_temp.assert_true(not (r->>'ok')::boolean and r->>'reason'='chat_identity_ambiguous', 'multiple historic chat ids hold enrollment');

  r := conversation_agent_enqueue(t,rev,jsonb_build_object(
    'turnId','turn-dave-inbound','kind','reply','reason','answer','evidenceIds',jsonb_build_array('message:dave-in'),
    'dueAt','2026-09-15T10:00:00Z','expiresAt','2026-09-15T11:00:00Z','policyVersion','policy-1','opener',false,
    'bubbles',jsonb_build_array(jsonb_build_object('text','Approved before inbound','quoteId',null))
  ));
  a := (r->'action_ids'->>0)::uuid; select payload_hash into h from outreach_agent_actions where id=a;
  perform conversation_agent_approve(a,rev,h);
  r := conversation_agent_ingest(jsonb_build_object('accountId','acct-ivan','personKey','linkedin_profile_id:member-dave',
    'eventKey','evt-dave-new-inbound','type','message_received','direction','inbound','timestamp','2026-09-15T10:01:00Z',
    'messageId','dave-in-2','chatId','chat-dave','text','One more thing'));
  perform pg_temp.assert_true((select status='cancelled' and blocked_reason='inbound' from outreach_agent_actions where id=a), 'new inbound invalidates approved action');
  perform pg_temp.assert_true((r->>'revision')::bigint=rev+1, 'new inbound increments conversation revision once');
  rev := (r->>'revision')::bigint;
  perform conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-dave-wait','kind','wait','reason','historic hold',
    'evidenceIds','[]'::jsonb,'dueAt','2026-09-15T09:00:00Z','expiresAt','2026-09-15T09:30:00Z','policyVersion','policy-1','opener',false));
  perform conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-dave-current','kind','reply','reason','fresh answer',
    'evidenceIds',jsonb_build_array('message:dave-in-2'),'dueAt','2026-09-15T10:02:00Z','expiresAt','2026-09-15T11:02:00Z',
    'policyVersion','policy-1','opener',false,'bubbles',jsonb_build_array(jsonb_build_object('text','Current draft','quoteId',null))));
  select x into card from conversation_agent_cards() x where x->>'thread_id'=t::text;
  perform pg_temp.assert_true(card->'next_action'->>'status'='draft' and card->'next_action'->>'expected_revision'=rev::text,
    'cards prioritize current actionable work ahead of an older held ledger action');
  r := conversation_agent_ingest(jsonb_build_object('accountId','acct-ivan','personKey','linkedin_profile_id:member-dave',
    'eventKey','evt-dave-edit','type','message_edit','direction','inbound','timestamp','2026-09-15T10:01:30Z',
    'messageId','dave-in-2','chatId','chat-dave','text','Edited inbound text'));
  perform pg_temp.assert_true((select message_text='Edited inbound text' from outreach_messages where unipile_message_id='dave-in-2'),
    'provider edit updates the durable history row used by later planning');
  r := conversation_agent_ingest(jsonb_build_object('accountId','acct-ivan','personKey','linkedin_profile_id:member-dave',
    'eventKey','evt-dave-delete','type','message_delete','direction','inbound','timestamp','2026-09-15T10:01:40Z',
    'messageId','dave-in-2','chatId','chat-dave','text',''));
  perform pg_temp.assert_true((select message_text='' and message_type='deleted' from outreach_messages where unipile_message_id='dave-in-2'),
    'provider delete erases stale text while retaining a durable deletion marker');
  r := conversation_agent_ingest(jsonb_build_object('accountId','acct-ivan','personKey','linkedin_profile_id:member-dave',
    'eventKey','evt-dave-reaction','type','message_reaction','direction','inbound','timestamp','2026-09-15T10:01:50Z',
    'messageId','reaction-event-id','chatId','chat-dave','text','like'));
  perform pg_temp.assert_true(not exists(select 1 from outreach_messages where unipile_message_id='reaction-event-id'),
    'reaction receipt is not inserted as a text message');
end $$;

do $$
declare r jsonb; t uuid; rev bigint;
begin
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000010','shadow','policy-1');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  r := conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-shadow-handoff','kind','handoff','reason','needs human',
    'evidenceIds','[]'::jsonb,'dueAt','2026-09-15T10:00:00Z','expiresAt','2026-09-15T10:30:00Z','policyVersion','policy-1','opener',false));
  perform pg_temp.assert_true((r->>'ok')::boolean, 'shadow proposal is logged');
  perform pg_temp.assert_true((select owner='legacy' and state='shadow' and revision=rev from outreach_agent_threads where id=t), 'shadow handoff proposal cannot mutate ownership or state');
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000010','review','policy-1');
  perform pg_temp.assert_true((r->>'ok')::boolean and r->>'reason'='promoted' and (r->>'revision')::bigint=rev+1, 'reviewed enrollment promotes an eligible shadow thread');
  perform pg_temp.assert_true((select owner='agent' and mode='review' and state='active' from outreach_agent_threads where id=t), 'promotion transfers ownership only after renewed eligibility checks');
  perform pg_temp.assert_true((select status='cancelled' from outreach_agent_actions where thread_id=t and turn_id='turn-shadow-handoff'), 'promotion never reuses shadow proposal approval');
end $$;

do $$
declare r jsonb; t uuid; rev bigint; a uuid; h text; c jsonb;
begin
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000011','review','policy-1');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  r := conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-frank-opener','kind','reply','reason','viewer opener',
    'evidenceIds',jsonb_build_array('view:frank'),'dueAt','2026-09-15T10:20:00Z','expiresAt','2026-09-15T11:20:00Z',
    'policyVersion','policy-1','opener',true,'bubbles',jsonb_build_array(jsonb_build_object('text','Thanks for stopping by','quoteId',null))));
  a := (r->'action_ids'->>0)::uuid; select payload_hash into h from outreach_agent_actions where id=a;
  perform conversation_agent_approve(a,rev,h);
  c := conversation_agent_claim('acct-ivan','2026-09-15T10:20:00Z','worker-opener');
  perform pg_temp.assert_true((c->'action'->>'id')::uuid=a, 'verified-chat opener is claimable');
  perform pg_temp.assert_true((select used=3 from outreach_agent_daily_capacity where account_id='acct-ivan' and capacity_day='2026-09-15' and metric='dm_bubbles'), 'opener reserves shared DM-bubble lane ceiling');
  perform pg_temp.assert_true((select used=1 from outreach_agent_daily_capacity where account_id='acct-ivan' and capacity_day='2026-09-15' and metric='viewer_openers'), 'opener also reserves viewer ceiling');
  r := conversation_agent_finish(a,c->>'claim_token',jsonb_build_object('status','held','reason','freshness_failed'));
  perform pg_temp.assert_true((r->>'ok')::boolean and r->>'status'='held', 'never-attempted claim can finalize to a hold');
  perform pg_temp.assert_true((select used=2 from outreach_agent_daily_capacity where account_id='acct-ivan' and capacity_day='2026-09-15' and metric='dm_bubbles'), 'never-attempted hold releases local DM reservation');
  perform pg_temp.assert_true((select used=0 from outreach_agent_daily_capacity where account_id='acct-ivan' and capacity_day='2026-09-15' and metric='viewer_openers'), 'never-attempted hold releases local opener reservation');
end $$;

do $$
declare r jsonb; t uuid; rev bigint;
begin
  select id,revision into t,rev from outreach_agent_threads where prospect_id='20000000-0000-0000-0000-000000000001';
  r := conversation_agent_set_policy(t,rev,'policy-2');
  perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'revision')::bigint=rev+1, 'policy edit increments revision atomically');
  perform pg_temp.assert_true((select reviewed_policy_version='policy-2' and state='paused' from outreach_agent_threads where id=t), 'policy edit pauses pending renewed review');
end $$;

do $$
declare r jsonb; other_t uuid;
begin
  r := conversation_agent_guard('20000000-0000-0000-0000-000000000012');
  perform pg_temp.assert_true((r->>'allow_legacy')::boolean and r->>'reason'='unenrolled', 'unregistered campaign is inert for a proven unenrolled prospect');
  r := conversation_agent_provider_guard('provider-unregistered','chat-legacy','member-legacy');
  perform pg_temp.assert_true((r->>'allow_legacy')::boolean and r->>'reason'='unenrolled', 'unique authoritative legacy chat stays allowed without an agent account mapping');
  r := conversation_agent_provider_guard('provider-unregistered',null,'member-legacy');
  perform pg_temp.assert_true((r->>'allow_legacy')::boolean and r->>'reason'='unenrolled', 'known unenrolled recipient stays allowed for an unmapped legacy provider account');
  r := conversation_agent_provider_guard('provider-ivan','chat-legacy','member-legacy');
  perform pg_temp.assert_true((r->>'allow_legacy')::boolean and r->>'reason'='unenrolled', 'one provider account may serve another same-client campaign without enrolling it');
  r := conversation_agent_provider_guard('provider-ivan','chat-carol','member-carol');
  perform pg_temp.assert_true(not (r->>'allow_legacy')::boolean and r->>'reason'='agent_owned', 'provider guard blocks exact agent-owned route');
  r := conversation_agent_provider_guard(null,'chat-carol','member-carol');
  perform pg_temp.assert_true(not (r->>'allow_legacy')::boolean and r->>'reason'='agent_owned', 'unique global chat resolves without account id');
  r := conversation_agent_provider_guard('provider-ivan','chat-carol','wrong-member');
  perform pg_temp.assert_true(r->>'reason'='recipient_mismatch', 'provider guard rejects inconsistent recipient');
  r := conversation_agent_provider_guard('provider-ivan',null,'new-member');
  perform pg_temp.assert_true((r->>'allow_legacy')::boolean and r->>'reason'='unenrolled', 'exact account and recipient prove unenrolled legacy route');
  r := conversation_agent_provider_guard(null,null,'new-member');
  perform pg_temp.assert_true(r->>'reason'='routing_missing', 'missing account and chat fail closed');

  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000004','review','policy-1');
  other_t := (r->>'thread_id')::uuid;
  update outreach_agent_threads set provider_chat_id='chat-carol' where id=other_t;
  r := conversation_agent_provider_guard(null,'chat-carol',null);
  perform pg_temp.assert_true(r->>'reason'='routing_ambiguous', 'chat shared across accounts fails closed');
  r := conversation_agent_before_manual_send('20000000-0000-0000-0000-000000000012');
  perform pg_temp.assert_true((r->>'allow_send')::boolean and r->>'reason'='unenrolled', 'manual send stays inert for a proven unenrolled unmapped campaign');
  r := conversation_agent_before_manual_send('20000000-0000-0000-0000-000000000017');
  perform pg_temp.assert_true((r->>'allow_send')::boolean and r->>'reason'='unenrolled', 'email-only unenrolled manual reply remains allowed without LinkedIn identity');
end $$;

do $$
declare r jsonb; t uuid; rev bigint; a uuid; h text; c jsonb;
begin
  update outreach_agent_accounts set capabilities=jsonb_build_object('new_chat',true) where account_id='acct-ivan';
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000015','review','policy-1');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  perform pg_temp.assert_true((r->>'ok')::boolean and (select provider_chat_id is null from outreach_agent_threads where id=t),
    'eligible first-degree viewer can enroll before a provider chat exists');
  r := conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-new-chat','kind','reply','reason','viewer opener',
    'evidenceIds',jsonb_build_array('view:new-chat'),'dueAt','2026-09-15T10:30:00Z','expiresAt','2026-09-15T11:30:00Z',
    'policyVersion','policy-1','opener',true,'bubbles',jsonb_build_array(jsonb_build_object('text','New chat opener','quoteId',null))));
  a := (r->'action_ids'->>0)::uuid; select payload_hash into h from outreach_agent_actions where id=a;
  perform conversation_agent_approve(a,rev,h);
  c := conversation_agent_claim('acct-ivan','2026-09-15T10:30:00Z','worker-new-chat');
  perform pg_temp.assert_true((c->>'ok')::boolean and c->'action'->>'provider_chat_id' is null, 'new-chat capability permits only an approved opener without an existing chat');
  r := conversation_agent_prepare_send(a,c->>'claim_token',rev);
  perform pg_temp.assert_true((r->>'ok')::boolean, 'new-chat opener passes the final database gate');
  r := conversation_agent_finish(a,c->>'claim_token',jsonb_build_object('status','confirmed','providerMessageId','provider-new-chat',
    'providerChatId','chat-created-by-provider','providerReceiptAt','2026-09-15T10:30:03Z','deliveryEvidence',jsonb_build_object('httpStatus',201)));
  perform pg_temp.assert_true(r->>'status'='sent' and (select provider_chat_id='chat-created-by-provider' from outreach_agent_threads where id=t),
    'confirmed new-chat receipt durably binds the provider chat to the thread');
  perform pg_temp.assert_true((select unipile_chat_id='chat-created-by-provider' from outreach_messages where agent_action_id=a),
    'confirmed new-chat receipt binds the linked history row to the same provider chat');
end $$;

do $$
declare r jsonb; t uuid; rev bigint; a uuid; h text; c jsonb; used_before integer;
begin
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000019','review','policy-1');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  r := conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-final-gate','kind','reply','reason','answer',
    'evidenceIds',jsonb_build_array('message:optout-in'),'dueAt','2026-09-15T10:40:00Z','expiresAt','2026-09-15T11:40:00Z',
    'policyVersion','policy-1','opener',false,'bubbles',jsonb_build_array(jsonb_build_object('text','Final gate fixture','quoteId',null))));
  a := (r->'action_ids'->>0)::uuid; select payload_hash into h from outreach_agent_actions where id=a;
  perform conversation_agent_approve(a,rev,h);
  select used into used_before from outreach_agent_daily_capacity where account_id='acct-ivan' and capacity_day='2026-09-15' and metric='dm_bubbles';
  c := conversation_agent_claim('acct-ivan','2026-09-15T10:40:00Z','worker-final-gate');
  perform pg_temp.assert_true((c->'action'->>'id')::uuid=a, 'final-gate fixture claims the current reviewed action');
  update outreach_prospects set stage='archived' where id='20000000-0000-0000-0000-000000000019';
  r := conversation_agent_prepare_send(a,c->>'claim_token',rev);
  perform pg_temp.assert_true(not (r->>'ok')::boolean and r->>'reason'='ineligible_contact_state',
    'prepare rechecks durable contact eligibility immediately before provider dispatch');
  perform pg_temp.assert_true((select dispatch_attempt_id is null and status='held' and not capacity_reserved from outreach_agent_actions where id=a),
    'failed final gate creates no attempt and leaves no retryable claim');
  perform pg_temp.assert_true((select used from outreach_agent_daily_capacity where account_id='acct-ivan' and capacity_day='2026-09-15' and metric='dm_bubbles')=used_before,
    'failed final gate releases its account-local reservation');
  r := conversation_agent_finish(a,c->>'claim_token',jsonb_build_object('status','held','reason','ineligible_contact_state'));
  perform pg_temp.assert_true((r->>'ok')::boolean and r->>'status'='held', 'finish acknowledges a prepare-held action idempotently');
  update outreach_prospects set stage='identified' where id='20000000-0000-0000-0000-000000000019';
  r := conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-opt-out','kind','close','reason','opt_out',
    'evidenceIds',jsonb_build_array('message:optout-in'),'dueAt','2026-09-15T10:41:00Z','expiresAt','2026-09-15T11:41:00Z',
    'policyVersion','policy-1','opener',false));
  perform pg_temp.assert_true((select owner='human' and state='stopped' and pause_reason='opt_out' from outreach_agent_threads where id=t),
    'planner opt-out close becomes durable stopped human ownership');
  r := conversation_agent_ingest(jsonb_build_object('accountId','acct-ivan','personKey','linkedin_profile_id:member-optout',
    'eventKey','evt-optout-thanks','type','message_received','direction','inbound','timestamp','2026-09-15T10:42:00Z',
    'messageId','optout-thanks','chatId','chat-optout','text','thanks'));
  perform pg_temp.assert_true((select state='stopped' and owner='human' from outreach_agent_threads where id=t),
    'acknowledgement cannot reopen an opt-out');
end $$;

do $$
declare r jsonb; t uuid; rev bigint; a uuid; h text; c jsonb; rc jsonb;
begin
  r := conversation_agent_enroll('20000000-0000-0000-0000-000000000018','review','policy-1');
  t := (r->>'thread_id')::uuid; rev := (r->>'revision')::bigint;
  r := conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-crash-recovery','kind','reply','reason','answer',
    'evidenceIds',jsonb_build_array('message:crash-in'),'dueAt','2026-09-15T10:50:00Z','expiresAt','2026-09-15T11:50:00Z',
    'policyVersion','policy-1','opener',false,'bubbles',jsonb_build_array(jsonb_build_object('text','Crash recovery text','quoteId',null))));
  a := (r->'action_ids'->>0)::uuid; select payload_hash into h from outreach_agent_actions where id=a;
  perform conversation_agent_approve(a,rev,h);
  c := conversation_agent_claim('acct-ivan','2026-09-15T10:50:00Z','worker-crash');
  perform conversation_agent_prepare_send(a,c->>'claim_token',rev);
  rc := conversation_agent_reconciliation_claim('2026-09-15T10:50:16Z','reconciler-crash');
  perform pg_temp.assert_true((rc->>'ok')::boolean and (rc->'action'->>'id')::uuid=a,
    'stale sending attempt enters bounded read-only reconciliation after its persisted first deadline');
  perform pg_temp.assert_true(rc->'attempt'->'baseline_ids' @> jsonb_build_array('crash-in'),
    'attempt baseline is persisted before the provider call');
  r := conversation_agent_finish(a,rc->>'claim_token',jsonb_build_object('status','delivery_unknown','deliveryEvidence',jsonb_build_object('source','read_only_reconciliation')));
  perform pg_temp.assert_true((select baseline_ids @> jsonb_build_array('crash-in') from outreach_agent_dispatch_attempts where action_id=a),
    'an unsuccessful reconciliation cannot overwrite the immutable delivery baseline');
  r := conversation_agent_before_manual_send('20000000-0000-0000-0000-000000000018');
  perform pg_temp.assert_true(not (r->>'allow_send')::boolean and (r->>'in_flight')::boolean and r->>'reason'='delivery_in_flight',
    'manual takeover stays blocked while an attempted delivery is unresolved');
end $$;

do $$
declare r jsonb; t uuid; rev bigint; a uuid; h text; c jsonb; sent_rev bigint;
begin
  update outreach_agent_accounts set provider_owner_id='owner-ivan',capabilities=capabilities||jsonb_build_object('message_reaction',true)
    where account_id='acct-ivan';
  select id,revision into t,rev from outreach_agent_threads where prospect_id='20000000-0000-0000-0000-000000000007';
  r := conversation_agent_enqueue(t,rev,jsonb_build_object('turnId','turn-reaction-confirm','kind','react_message','reason','acknowledge',
    'evidenceIds',jsonb_build_array('message:provider-out-2'),'dueAt','2026-09-15T11:00:00Z','expiresAt','2026-09-15T12:00:00Z',
    'policyVersion','policy-1','opener',false,'targetId','provider-out-2','reaction','like'));
  a := (r->'action_ids'->>0)::uuid; select payload_hash into h from outreach_agent_actions where id=a;
  perform conversation_agent_approve(a,rev,h);
  c := conversation_agent_claim('acct-ivan','2026-09-15T11:00:00Z','worker-reaction');
  perform conversation_agent_prepare_send(a,c->>'claim_token',rev);
  r := conversation_agent_finish(a,c->>'claim_token',jsonb_build_object('status','confirmed','providerTargetId','provider-out-2',
    'providerReaction','like','providerReceiptAt','2026-09-15T11:00:02Z','deliveryEvidence',jsonb_build_object(
      'source','reaction_readback','accountId','provider-ivan','chatId','chat-carol','targetId','provider-out-2',
      'ownerProviderId','owner-ivan','reaction','like','value','like')));
  sent_rev := (r->>'revision')::bigint;
  perform pg_temp.assert_true(r->>'status'='sent' and (select provider_message_id is null from outreach_agent_actions where id=a),
    'message reaction confirms from owner readback without inventing a message receipt id');
  perform pg_temp.assert_true(not exists(select 1 from outreach_messages where agent_action_id=a),
    'confirmed reaction does not create or stamp an outreach text row');
  r := conversation_agent_finish(a,c->>'claim_token',jsonb_build_object('status','confirmed','providerTargetId','provider-out-2',
    'providerReaction','like','providerReceiptAt','2026-09-15T11:00:02Z','deliveryEvidence',jsonb_build_object(
      'source','reaction_readback','accountId','provider-ivan','chatId','chat-carol','targetId','provider-out-2',
      'ownerProviderId','owner-ivan','reaction','like','value','like')));
  perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'revision')::bigint=sent_rev and r->>'reason'='already_confirmed',
    'same reaction readback is idempotent');
end $$;

do $$
declare r jsonb;
begin
  update outreach_agent_accounts set model_call_daily_cap=2 where account_id='acct-ivan';
  r := conversation_agent_reserve_model('acct-ivan');
  perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'used')::int=1, 'first model call reserves atomically');
  r := conversation_agent_reserve_model('acct-ivan');
  perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'used')::int=2, 'repair attempt spends a second model slot');
  r := conversation_agent_reserve_model('acct-ivan');
  perform pg_temp.assert_true(not (r->>'ok')::boolean and r->>'reason'='model_cap_reached', 'model calls stop at account ceiling');
end $$;

do $$
begin
  perform pg_temp.assert_true(not has_function_privilege('public','public.conversation_agent_claim(text,timestamptz,text)','execute'), 'PUBLIC cannot claim');
  perform pg_temp.assert_true(not has_function_privilege('anon','public.conversation_agent_claim(text,timestamptz,text)','execute'), 'anon cannot claim');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.conversation_agent_claim(text,timestamptz,text)','execute'), 'authenticated cannot claim');
  perform pg_temp.assert_true(has_function_privilege('service_role','public.conversation_agent_claim(text,timestamptz,text)','execute'), 'service role can claim');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.conversation_agent_reserve_model(text)','execute'), 'authenticated cannot reserve model budget');
  perform pg_temp.assert_true(has_function_privilege('service_role','public.conversation_agent_reserve_model(text)','execute'), 'service role can reserve model budget');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.conversation_agent_reconciliation_claim(timestamptz,text)','execute'), 'authenticated cannot claim delivery reconciliation');
  perform pg_temp.assert_true(has_function_privilege('service_role','public.conversation_agent_reconciliation_claim(timestamptz,text)','execute'), 'service role can claim delivery reconciliation');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.conversation_agent_manual_guard(uuid)','execute'), 'authenticated cannot authorize provider manual sends');
  perform pg_temp.assert_true(has_function_privilege('service_role','public.conversation_agent_manual_guard(uuid)','execute'), 'service role can authorize exact manual sends');
  perform pg_temp.assert_true(not has_table_privilege('authenticated','public.outreach_agent_actions','select'), 'authenticated has no direct action table grant');
  perform pg_temp.assert_true(has_function_privilege('authenticated','public.conversation_agent_cards()','execute'), 'authenticated can call scoped cards RPC');
  perform pg_temp.assert_true(has_function_privilege('authenticated','public.conversation_agent_set_policy(uuid,bigint,text)','execute'), 'authenticated operator can change policy through scoped RPC');
end $$;

select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims','{"role":"service_role","sub":"30000000-0000-0000-0000-000000000001"}',true);
set local role service_role;
do $$
begin
  perform pg_temp.assert_true(public.conversation_agent_is_service(), 'JWT claims JSON authorizes service role inside security-definer RPCs');
end $$;
reset role;

rollback;
select 1::int as tests_passed;
