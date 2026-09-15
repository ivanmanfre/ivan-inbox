begin;

create or replace function pg_temp.assert_true(p_ok boolean,p_message text)
returns void language plpgsql as $$ begin if p_ok is distinct from true then raise exception 'assertion failed: %',p_message; end if; end $$;

insert into outreach_campaigns(id,name,client_id) values
 ('41000000-0000-0000-0000-000000000001','Takeover Ivan',null),
 ('41000000-0000-0000-0000-000000000002','Takeover Other','other');

insert into outreach_prospects(id,campaign_id,linkedin_url,linkedin_profile_id,name,trigger_type,profile_viewed_at,icp_score,icp_reasoning,scorer_version,scored_at,enrichment_data) values
 ('42000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','https://linkedin.com/in/approve','takeover-approve','Approve Viewer','profile_view',now()-interval '1 hour',9,'strong fit','rubric-1',now()-interval '1 hour','{"company":"Acme"}'),
 ('42000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001','https://linkedin.com/in/inbound','takeover-inbound','Inbound Viewer','profile_view',now()-interval '1 hour',9,'strong fit','rubric-1',now()-interval '1 hour','{}'),
 ('42000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000002','https://linkedin.com/in/other','takeover-other','Other Viewer','profile_view',now()-interval '1 hour',9,'strong fit','rubric-1',now()-interval '1 hour','{}'),
 ('42000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000001','https://linkedin.com/in/prior','takeover-prior','Prior Viewer','profile_view',now()-interval '1 hour',9,'strong fit','rubric-1',now()-interval '1 hour','{}'),
 ('42000000-0000-0000-0000-000000000005','41000000-0000-0000-0000-000000000001','https://linkedin.com/in/discard','takeover-discard','Discard Viewer','profile_view',now()-interval '1 hour',9,'strong fit','rubric-1',now()-interval '1 hour','{}'),
 ('42000000-0000-0000-0000-000000000006','41000000-0000-0000-0000-000000000001','https://linkedin.com/in/remap','takeover-remap','Remap Viewer','profile_view',now()-interval '1 hour',9,'strong fit','rubric-1',now()-interval '1 hour','{}');

insert into profile_view_log(seat,viewer_public_id,viewer_provider_id,viewer_name,viewed_at,capture_day,captured_at,provenance,prospect_id,icp_pass)
select case when campaign_id='41000000-0000-0000-0000-000000000002' then 'other' else 'ivan' end,
 'public-'||id::text,linkedin_profile_id,name,profile_viewed_at,profile_viewed_at::date,profile_viewed_at,'test',id,true
from outreach_prospects where campaign_id in ('41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002');

insert into outreach_agent_accounts(account_id,client_id,campaign_id,provider_account_id,operator_ids,enrollment_enabled,auto_enabled,dispatch_enabled,
 shared_cap_seat,required_scorer_version,provider_config,operating_start,operating_end) values
 ('takeover-ivan','ivan','41000000-0000-0000-0000-000000000001','provider-takeover-ivan',array['43000000-0000-0000-0000-000000000001'::uuid],true,true,true,'ivan','rubric-1','{"policy_version":"policy-1","new_chat":true,"takeover_review_required":true}','00:00','23:59:59'),
 ('takeover-other','other','41000000-0000-0000-0000-000000000002','provider-takeover-other',array['43000000-0000-0000-0000-000000000002'::uuid],true,true,true,'other','rubric-1','{"policy_version":"policy-1","new_chat":true,"takeover_review_required":true}','00:00','23:59:59');

set local request.jwt.claim.role='service_role';

do $$
declare r jsonb; p outreach_prospects%rowtype; candidate jsonb; proposal jsonb; d uuid; h text; t uuid; rev bigint; flag text; release_value text; valid_release jsonb; disabled_value jsonb;
begin
  perform pg_temp.assert_true((select count(*)=5 from conversation_agent_takeover_candidates(25)),'read-only discovery returns only eligible untouched Ivan viewers');
  perform pg_temp.assert_true((select count(*)=3 from pg_policies where tablename='ops_drafts' and policyname like 'ops_drafts_takeover_%_guard' and permissive='RESTRICTIVE'),
    'restrictive takeover policies cannot be bypassed by another permissive authenticated policy');
  select * into p from outreach_prospects where id='42000000-0000-0000-0000-000000000001';
  select x into candidate from conversation_agent_takeover_candidates(25) x where x->>'prospect_id'=p.id::text;
  proposal:=jsonb_build_object('kind','reply','reason','profile viewer','evidenceIds',jsonb_build_array('profile-view'),
    'bubbles',jsonb_build_array(jsonb_build_object('text','Hi Approve — enjoyed your profile. What brought you by?','quoteId',null)),
    'policyVersion',candidate->>'policy_version','expiresAt',(now()+interval '1 day')::text,'expectedProspectUpdatedAt',candidate->>'updated_at',
    'scoreVerifiedAt',candidate->>'scored_at','viewedAt',candidate->>'viewed_at','validationEvidence',jsonb_build_object(
      'sourceSnippets',jsonb_build_array(jsonb_build_object('id','profile-view','snippet','Viewed profile')),
      'promptVersions',jsonb_build_object('planner','v1'),'historyCheckpoint','[]'::jsonb));
  r:=conversation_agent_propose_takeover(p.id,proposal); d:=(r->>'draft_id')::uuid; h:=r->>'proposal_hash';
  perform pg_temp.assert_true((r->>'ok')::boolean and r->>'reason'='proposed','service creates an inert Ops proposal');
  perform pg_temp.assert_true((select count(*)=0 from outreach_agent_threads where prospect_id=p.id),'proposal creates no ownership');
  perform pg_temp.assert_true((select count(*)=0 from outreach_agent_actions),'proposal creates no action');

  r:=conversation_agent_takeover_readiness(d);
  perform pg_temp.assert_true(r=jsonb_build_object('ready',false,'reason','operator_denied'),'service cannot use the operator readiness endpoint');
  r:=conversation_agent_approve_takeover(d,h,'service must not approve');
  perform pg_temp.assert_true(r->>'reason'='operator_denied','service cannot approve a takeover');
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','43000000-0000-0000-0000-000000000002',true);
  r:=conversation_agent_takeover_readiness(d);
  perform pg_temp.assert_true(r=jsonb_build_object('ready',false,'reason','operator_denied'),'another account operator cannot inspect release readiness');
  perform set_config('request.jwt.claim.sub','43000000-0000-0000-0000-000000000001',true);
  r:=conversation_agent_approve_takeover(d,repeat('0',64),'Edited opener');
  perform pg_temp.assert_true(r->>'reason'='proposal_hash_mismatch','approval binds the original server proposal hash');
  r:=conversation_agent_takeover_readiness(d);
  perform pg_temp.assert_true(r=jsonb_build_object('ready',false,'reason','release_not_ready'),'missing release remains held without exposing configuration');
  r:=conversation_agent_approve_takeover(d,h,'Edited exact reviewed opener');
  perform pg_temp.assert_true(r->>'reason'='release_not_ready' and not exists(select 1 from outreach_agent_threads where prospect_id=p.id)
    and not exists(select 1 from outreach_agent_actions),'missing release cannot transfer ownership or queue an opener');
  foreach release_value in array array['invalid json','{}','{"clientId":"other","globalEnabled":true,"dispatchEnabled":true}',
    '{"clientId":"ivan","globalEnabled":false,"dispatchEnabled":true}',
    '{"clientId":"ivan","globalEnabled":true,"dispatchEnabled":false}',
    '{"clientId":"ivan","globalEnabled":"true","dispatchEnabled":true}'] loop
    insert into integration_config(key,value) values('conversation_agent_release_ivan',release_value)
      on conflict(key) do update set value=excluded.value;
    r:=conversation_agent_takeover_readiness(d);
    perform pg_temp.assert_true(r->>'reason'='release_not_ready' and not (r->>'ready')::boolean,'invalid, foreign, or disabled release is held');
  end loop;
  update integration_config set value='{"clientId":"ivan","globalEnabled":true,"dispatchEnabled":true,"planningEnabled":true,"eventsEnabled":true,"autoEnabled":true,"reviewedPolicyVersion":"policy-1","capabilities":{"new_chat":true}}'
    where key='conversation_agent_release_ivan';
  r:=conversation_agent_takeover_readiness(d);
  perform pg_temp.assert_true(r->>'reason'='new_chat_unverified','account capability must be explicitly verified');
  update outreach_agent_accounts set capabilities='{"new_chat":true}' where account_id='takeover-ivan';
  update integration_config set value='{"clientId":"ivan","globalEnabled":true,"dispatchEnabled":true,"planningEnabled":true,"eventsEnabled":true,"autoEnabled":true,"reviewedPolicyVersion":"policy-1","capabilities":{}}' where key='conversation_agent_release_ivan';
  r:=conversation_agent_takeover_readiness(d);
  perform pg_temp.assert_true(r->>'reason'='new_chat_unverified','release capability must also be explicitly verified');
  update integration_config set value='{"clientId":"ivan","globalEnabled":true,"dispatchEnabled":true,"planningEnabled":true,"eventsEnabled":true,"autoEnabled":true,"reviewedPolicyVersion":"policy-1","capabilities":{"new_chat":true}}'
    where key='conversation_agent_release_ivan';
  select value::jsonb into valid_release from integration_config where key='conversation_agent_release_ivan';
  foreach flag in array array['globalEnabled','dispatchEnabled','planningEnabled','eventsEnabled','autoEnabled'] loop
    foreach disabled_value in array array['false'::jsonb,'null'::jsonb,'"true"'::jsonb] loop
      update integration_config set value=(case when disabled_value='null'::jsonb then valid_release-flag
        else jsonb_set(valid_release,array[flag],disabled_value) end)::text where key='conversation_agent_release_ivan';
      r:=conversation_agent_takeover_readiness(d);
      perform pg_temp.assert_true(r=jsonb_build_object('ready',false,'reason','release_not_ready'),'each runtime lane requires strict true: '||flag);
      r:=conversation_agent_approve_takeover(d,h,'Edited exact reviewed opener');
      perform pg_temp.assert_true(r->>'reason'='release_not_ready' and not exists(select 1 from outreach_agent_threads where prospect_id=p.id)
        and not exists(select 1 from outreach_agent_actions),'held runtime lane cannot enroll or queue: '||flag);
    end loop;
  end loop;
  foreach disabled_value in array array['null'::jsonb,'"policy-old"'::jsonb] loop
    update integration_config set value=(case when disabled_value='null'::jsonb then valid_release-'reviewedPolicyVersion'
      else jsonb_set(valid_release,'{reviewedPolicyVersion}',disabled_value) end)::text where key='conversation_agent_release_ivan';
    r:=conversation_agent_takeover_readiness(d);
    perform pg_temp.assert_true(r=jsonb_build_object('ready',false,'reason','release_not_ready'),'missing or stale policy review prevents takeover');
    r:=conversation_agent_approve_takeover(d,h,'Edited exact reviewed opener');
    perform pg_temp.assert_true(r->>'reason'='release_not_ready' and not exists(select 1 from outreach_agent_threads where prospect_id=p.id)
      and not exists(select 1 from outreach_agent_actions),'stale policy review cannot enroll or queue');
  end loop;
  update integration_config set value=valid_release::text where key='conversation_agent_release_ivan';
  foreach flag in array array['enrollment_enabled','auto_enabled','dispatch_enabled'] loop
    execute format('update outreach_agent_accounts set %I=false where account_id=%L',flag,'takeover-ivan');
    r:=conversation_agent_takeover_readiness(d);
    perform pg_temp.assert_true(r->>'reason'='account_not_ready' and not (r->>'ready')::boolean,'each account switch must be enabled');
    r:=conversation_agent_approve_takeover(d,h,'Edited exact reviewed opener');
    perform pg_temp.assert_true(r->>'reason'='account_not_ready' and not exists(select 1 from outreach_agent_threads where prospect_id=p.id)
      and not exists(select 1 from outreach_agent_actions),'approval rechecks readiness and cannot queue while an account switch is closed');
    execute format('update outreach_agent_accounts set %I=true where account_id=%L',flag,'takeover-ivan');
  end loop;
  r:=conversation_agent_takeover_readiness(d);
  perform pg_temp.assert_true(r=jsonb_build_object('ready',true,'reason','ready'),'operator sees ready only after all deployment and capability gates pass');
  r:=conversation_agent_approve_takeover(d,h,'Edited exact reviewed opener'); t:=(r->>'thread_id')::uuid;
  select revision into rev from outreach_agent_threads where id=t;
  perform pg_temp.assert_true((r->>'ok')::boolean and r->>'reason'='approved','operator atomically approves takeover: '||r::text);
  perform pg_temp.assert_true((select owner='agent' and mode='auto' and state='active' from outreach_agent_threads where id=t),'approved takeover is ongoing auto ownership');
  perform pg_temp.assert_true((select count(*)=1 from outreach_agent_actions where thread_id=t and status='approved' and opener and payload->>'text'='Edited exact reviewed opener'),'approval queues only the reviewed opener');
  perform pg_temp.assert_true((select message_id is not null and turn_id=t::text||':'||rev::text||':policy-1' and validation_evidence#>>'{promptVersions,planner}'='v1'
    and jsonb_array_length(validation_evidence->'historyCheckpoint')=0 and jsonb_array_length(source_snippets)=1 from outreach_agent_actions where thread_id=t),
    'approved opener uses runtime turn key, links its message, and preserves snapshot validation evidence');
  perform pg_temp.assert_true((select approved_at is null and sent_at is null from outreach_messages where agent_action_id is not null and prospect_id=p.id),'approval does not claim or send');
  update outreach_agent_accounts set dispatch_enabled=false where account_id='takeover-ivan';
  r:=conversation_agent_approve_takeover(d,h,'anything');
  perform pg_temp.assert_true((r->>'ok')::boolean and r->>'reason'='already_approved' and (r->>'thread_id')::uuid=t,'double approval is idempotent');
  update outreach_agent_accounts set dispatch_enabled=true where account_id='takeover-ivan';
end $$;

do $$
declare r jsonb; p outreach_prospects%rowtype; viewed timestamptz; proposal jsonb; d uuid; h text;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  select * into p from outreach_prospects where id='42000000-0000-0000-0000-000000000002'; select max(viewed_at) into viewed from profile_view_log where prospect_id=p.id;
  proposal:=jsonb_build_object('kind','reply','reason','viewer','evidenceIds','[]'::jsonb,'bubbles',jsonb_build_array(jsonb_build_object('text','Hello there','quoteId',null)),
    'policyVersion','policy-1','expiresAt',(now()+interval '1 day')::text,'expectedProspectUpdatedAt',p.updated_at::text,'scoreVerifiedAt',p.scored_at::text,'viewedAt',viewed::text,'validationEvidence','{}'::jsonb);
  r:=conversation_agent_propose_takeover(p.id,proposal); d:=(r->>'draft_id')::uuid; h:=r->>'proposal_hash';
  insert into outreach_messages(prospect_id,direction,message_text,unipile_message_id,unipile_chat_id,sent_at,channel) values(p.id,'inbound','New inbound after review card','new-inbound','new-chat',now(),'linkedin');
  perform set_config('request.jwt.claim.role','authenticated',true); perform set_config('request.jwt.claim.sub','43000000-0000-0000-0000-000000000001',true);
  r:=conversation_agent_approve_takeover(d,h,'Hello there');
  perform pg_temp.assert_true(r->>'reason'='stale_history' and not exists(select 1 from outreach_agent_threads where prospect_id=p.id),'new inbound invalidates the card before ownership transfer');
end $$;

do $$
declare r jsonb; p outreach_prospects%rowtype; viewed timestamptz; proposal jsonb; d uuid; h text;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  insert into outreach_messages(prospect_id,direction,message_text,unipile_message_id,unipile_chat_id,sent_at,channel) values('42000000-0000-0000-0000-000000000004','outbound','Prior human contact','prior-out','prior-chat',now(),'linkedin');
  select * into p from outreach_prospects where id='42000000-0000-0000-0000-000000000004'; select max(viewed_at) into viewed from profile_view_log where prospect_id=p.id;
  proposal:=jsonb_build_object('kind','reply','reason','viewer','evidenceIds','[]'::jsonb,'bubbles',jsonb_build_array(jsonb_build_object('text','Should fail','quoteId',null)),
    'policyVersion','policy-1','expiresAt',(now()+interval '1 day')::text,'expectedProspectUpdatedAt',p.updated_at::text,'scoreVerifiedAt',p.scored_at::text,'viewedAt',viewed::text,'validationEvidence','{}'::jsonb);
  r:=conversation_agent_propose_takeover(p.id,proposal);
  perform pg_temp.assert_true(r->>'reason'='ineligible','prior contact cannot create a takeover card');

  select * into p from outreach_prospects where id='42000000-0000-0000-0000-000000000003'; select max(viewed_at) into viewed from profile_view_log where prospect_id=p.id;
  proposal:=proposal||jsonb_build_object('expectedProspectUpdatedAt',p.updated_at::text,'scoreVerifiedAt',p.scored_at::text,'viewedAt',viewed::text);
  r:=conversation_agent_propose_takeover(p.id,proposal);
  perform pg_temp.assert_true(r->>'reason'='client_out_of_scope','service proposal cannot cross the explicit Ivan client scope');
end $$;

do $$
declare r jsonb; p outreach_prospects%rowtype; candidate jsonb; proposal jsonb; d uuid; h text;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  select * into p from outreach_prospects where id='42000000-0000-0000-0000-000000000005';
  insert into outreach_messages(prospect_id,direction,message_text,unipile_chat_id,sent_at,channel)
  values(p.id,'outbound','Unsent legacy draft','discard-chat',null,'linkedin');
  r:=conversation_agent_guard(p.id);
  perform pg_temp.assert_true(r->>'reason'='takeover_review_required' and not (r->>'allow_legacy')::boolean,'prospect guard holds an uncontacted qualified viewer before proposal');
  r:=conversation_agent_provider_guard('provider-takeover-ivan',null,'takeover-discard');
  perform pg_temp.assert_true(r->>'reason'='takeover_review_required','known account and recipient route is held before proposal');
  r:=conversation_agent_provider_guard(null,null,'takeover-discard');
  perform pg_temp.assert_true(r->>'reason'='takeover_review_required','recipient fallback route is held before proposal');
  r:=conversation_agent_provider_guard('provider-takeover-ivan','discard-chat','takeover-discard');
  perform pg_temp.assert_true(r->>'reason'='takeover_review_required','chat-resolved legacy route is held before proposal');
  select x into candidate from conversation_agent_takeover_candidates(25) x where x->>'prospect_id'=p.id::text;
  proposal:=jsonb_build_object('kind','reply','reason','viewer','evidenceIds','[]'::jsonb,
    'bubbles',jsonb_build_array(jsonb_build_object('text','Discard me','quoteId',null)),
    'policyVersion',candidate->>'policy_version','expiresAt',(now()+interval '1 day')::text,
    'expectedProspectUpdatedAt',candidate->>'updated_at','scoreVerifiedAt',candidate->>'scored_at','viewedAt',candidate->>'viewed_at',
    'validationEvidence',jsonb_build_object('sourceSnippets','[]'::jsonb,'historyCheckpoint','[]'::jsonb));
  r:=conversation_agent_propose_takeover(p.id,proposal); d:=(r->>'draft_id')::uuid;
  proposal:=jsonb_set(proposal,'{bubbles,0,text}',to_jsonb('Different regenerated model text'::text));
  r:=conversation_agent_propose_takeover(p.id,proposal);
  perform pg_temp.assert_true(r->>'reason'='already_proposed' and (r->>'proposal_hash')=(select context->>'proposal_hash' from ops_drafts where id=d)
    and (select body='Discard me' from ops_drafts where id=d),'fresh repeated proposal preserves the original reviewed card, hash, and body');
  update ops_drafts set context=jsonb_set(context,'{expires_at}',to_jsonb((now()-interval '1 minute')::timestamptz)) where id=d;
  perform pg_temp.assert_true(exists(select 1 from conversation_agent_takeover_candidates(25) x where x->>'prospect_id'=p.id::text),
    'expired pending card becomes discoverable for refresh');
  r:=conversation_agent_propose_takeover(p.id,proposal); h:=r->>'proposal_hash';
  perform pg_temp.assert_true(r->>'reason'='refreshed','expired pending card refreshes in place with a new server hash');
  update ops_drafts set body='tampered raw body' where id=d;
  perform set_config('request.jwt.claim.role','authenticated',true); perform set_config('request.jwt.claim.sub','43000000-0000-0000-0000-000000000001',true);
  r:=conversation_agent_approve_takeover(d,h,'Discard me');
  perform pg_temp.assert_true(r->>'reason'='proposal_tampered','approval recomputes the immutable stored card hash');
  update ops_drafts set body='Different regenerated model text' where id=d;
  r:=conversation_agent_discard_takeover(d,h);
  perform pg_temp.assert_true((r->>'ok')::boolean and r->>'reason'='discarded','Skip permanently discards through the operator RPC');
  perform set_config('request.jwt.claim.role','service_role',true);
  update outreach_prospects set scored_at=now()-interval '400 days' where id=p.id;
  update profile_view_log set viewed_at=now()-interval '30 days' where prospect_id=p.id;
  update outreach_agent_accounts set provider_config=provider_config||jsonb_build_object('takeover_review_required',false) where account_id='takeover-ivan';
  r:=conversation_agent_provider_guard('provider-takeover-ivan','discard-chat','takeover-discard');
  perform pg_temp.assert_true(r->>'reason'='takeover_review_required','discard keeps queued legacy automation held after evidence ages and rollout flag is revoked');
  update outreach_agent_accounts set provider_config=provider_config||jsonb_build_object('takeover_review_required',true) where account_id='takeover-ivan';
  r:=conversation_agent_propose_takeover(p.id,proposal);
  perform pg_temp.assert_true(r->>'reason' in ('discarded_candidate','ineligible','stale_candidate') and
    (select count(*)=1 from ops_drafts where kind='conversation_takeover' and context->>'prospect_id'=p.id::text),
    'discarded candidate is never silently regenerated after evidence ages');
end $$;

do $$
declare r jsonb; p outreach_prospects%rowtype; candidate jsonb; proposal jsonb; d uuid; h text;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  select * into p from outreach_prospects where id='42000000-0000-0000-0000-000000000006';
  select x into candidate from conversation_agent_takeover_candidates(25) x where x->>'prospect_id'=p.id::text;
  proposal:=jsonb_build_object('kind','reply','reason','viewer','evidenceIds','[]'::jsonb,
    'bubbles',jsonb_build_array(jsonb_build_object('text','Mapping-bound opener','quoteId',null)),
    'policyVersion',candidate->>'policy_version','expiresAt',(now()+interval '1 day')::text,
    'expectedProspectUpdatedAt',candidate->>'updated_at','scoreVerifiedAt',candidate->>'scored_at','viewedAt',candidate->>'viewed_at',
    'validationEvidence',jsonb_build_object('sourceSnippets','[]'::jsonb,'historyCheckpoint','[]'::jsonb));
  r:=conversation_agent_propose_takeover(p.id,proposal); d:=(r->>'draft_id')::uuid; h:=r->>'proposal_hash';
  update outreach_agent_accounts set provider_config=provider_config||jsonb_build_object('takeover_review_required',false) where account_id='takeover-ivan';
  perform set_config('request.jwt.claim.role','authenticated',true); perform set_config('request.jwt.claim.sub','43000000-0000-0000-0000-000000000001',true);
  r:=conversation_agent_approve_takeover(d,h,'Mapping-bound opener');
  perform pg_temp.assert_true(r->>'reason'='takeover_review_disabled','approval rejects an explicitly disabled takeover rollout');
  perform set_config('request.jwt.claim.role','service_role',true);
  update outreach_agent_accounts set provider_config=provider_config||jsonb_build_object('takeover_review_required',true) where account_id='takeover-ivan';
  update outreach_agent_accounts set provider_account_id='provider-remapped' where account_id='takeover-ivan';
  perform set_config('request.jwt.claim.role','authenticated',true); perform set_config('request.jwt.claim.sub','43000000-0000-0000-0000-000000000001',true);
  r:=conversation_agent_approve_takeover(d,h,'Mapping-bound opener');
  perform pg_temp.assert_true(r->>'reason'='stale_account_mapping' and not exists(select 1 from outreach_agent_threads where prospect_id=p.id),
    'provider account remapping invalidates approval before ownership transfer');
end $$;

rollback;
select 1 as takeover_tests_passed;
