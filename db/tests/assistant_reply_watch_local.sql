-- Run on a fresh, disposable PostgreSQL 17 database with a local Unix socket.
\set ON_ERROR_STOP on
do $$ begin
  if inet_server_addr() is not null or to_regclass('public.outreach_messages') is not null then
    raise exception 'requires a fresh local socket database';
  end if;
end $$;
create role anon;
create role authenticated;
create role service_role;
create table integration_config(key text primary key,value text,updated_at timestamptz);
create table outreach_campaigns(id uuid primary key,client_id text);
create table outreach_prospects(id uuid primary key,campaign_id uuid,name text,stage text,blacklisted boolean,needs_manual_reply boolean,enrichment_data jsonb,solved_at timestamptz,call_booked_at timestamptz,skip_state text,skip_reason text,next_touch_after timestamptz);
create table outreach_messages(id uuid primary key,prospect_id uuid,direction text,message_type text,channel text,sent_at timestamptz,created_at timestamptz,approved_at timestamptz,is_reaction boolean,sequence_step int,send_blocked_at timestamptz,send_blocked_reason text,unipile_chat_id text,discard_mode text,snoozed_until timestamptz,replies_to_message_id uuid,unipile_message_id text,draft_evidence jsonb,reply_intent text,message_text text);
create table assistant_scan_watch(inbound_id uuid primary key);
create table inbox_threads(id uuid primary key,user_id uuid,kind text,last_turn_at timestamptz,updated_at timestamptz);
create table inbox_turns(id uuid primary key,thread_id uuid,user_id uuid,prompt text,answer text,status text,origin text,started_at timestamptz,finished_at timestamptz,sources jsonb);
\ir ../20261126_assistant_reply_watch.sql
do $$
declare
  p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); m uuid:=gen_random_uuid();
  u uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); other_t uuid:=gen_random_uuid(); n int; r jsonb;
  observed timestamptz:='2026-11-25 14:10Z'; due timestamptz:='2026-11-25 03:16Z';
begin
  insert into outreach_campaigns values(c,'anna');
  insert into outreach_prospects(id,campaign_id,name,stage,blacklisted,needs_manual_reply) values(p,c,'Example','replied',false,true);
  insert into outreach_messages(id,prospect_id,direction,message_type,channel,created_at,reply_intent,message_text)
     values(i,p,'inbound','dm','linkedin',now()-interval '3 days','info_ask','Could you send the details?');
  assert (select kind from assistant_reply_watch_cases())='missing_reply_draft';
  update outreach_campaigns set client_id='leah'; assert (select seat from assistant_reply_watch_cases())='leah';
  update outreach_campaigns set client_id='unknown'; assert not exists(select from assistant_reply_watch_cases());
  update outreach_campaigns set client_id='rise'; assert (select seat from assistant_reply_watch_cases())='risedtc';
  update outreach_prospects set next_touch_after=now()+interval '1 day'; assert not exists(select from assistant_reply_watch_cases());
  update outreach_prospects set next_touch_after=null,solved_at=now(); assert not exists(select from assistant_reply_watch_cases());
  update outreach_prospects set solved_at=null;
  insert into outreach_messages(id,prospect_id,direction,message_type,channel,created_at,replies_to_message_id)
    values(m,p,'outbound','dm','linkedin',now()-interval '2 days',i);
  assert not exists(select from assistant_reply_watch_cases());
  update outreach_messages set send_blocked_reason='discarded_in_inbox',send_blocked_at=now() where id=m;
  assert not exists(select from assistant_reply_watch_cases());
  update outreach_messages set direction='inbound',reply_intent='negative',message_text='all set' where id=m;
  assert not exists(select from assistant_reply_watch_cases());
  delete from outreach_messages where id=m;
  insert into inbox_threads values(t,u,'bot',now(),now()),(other_t,gen_random_uuid(),'bot',now(),now());
  r:=assistant_reply_watch_sweep(u); assert r->>'mode'='shadow' and r->>'eligible'='1' and r->>'posted'='0';
  update integration_config set value='chat' where key='assistant_reply_watch_mode';
  r:=assistant_reply_watch_sweep(u); assert r->>'posted'='1';
  r:=assistant_reply_watch_sweep(u); assert r->>'posted'='0';
  assert (select count(*) from inbox_turns where thread_id=t and user_id=u)=1;
  assert not exists(select from inbox_turns where thread_id=other_t);
  assert not has_function_privilege('authenticated','assistant_reply_watch_cases(timestamptz)','execute');
  assert not has_function_privilege('anon','assistant_reply_watch_sweep(uuid)','execute');
  update outreach_prospects set solved_at=now();
  r:=assistant_reply_watch_sweep(u); assert r->>'eligible'='0';
  assert (select cleared_at is not null from assistant_reply_watch where inbound_id=i);

  update outreach_campaigns set client_id='swishdm';
  update outreach_prospects set solved_at=null,stage='swishdm_connected',needs_manual_reply=false;
  update outreach_messages set is_reaction=true,reply_intent=null,created_at=due-interval '12 minutes',message_text='👍' where id=i;
  insert into integration_config(key,value) values ('swishdm_dm_daily_cap','20'),('swishdm_dm_send_enabled','true'),('swishdm_outreach_enabled','true');
  insert into outreach_messages(id,prospect_id,direction,message_type,channel,created_at,approved_at,sequence_step,draft_evidence)
    values(m,p,'outbound','dm','linkedin',due-interval '2 days',due-interval '2 days',1,
      jsonb_build_object('lane','swishdm_first_list','dm_queue',jsonb_build_object('reason','reaction_fast_path','state','queued','due_at',due)));
  assert not exists(select from assistant_reply_watch_cases('2026-11-25 10:00:22Z'));
  assert (select kind from assistant_reply_watch_cases(observed))='overdue_reaction_queue';
  assert exists(select from assistant_reply_watch_cases('2026-11-28 15:00Z')); -- Saturday
  assert exists(select from assistant_reply_watch_cases('2026-11-29 09:20Z')); -- Sunday reopening
  update outreach_messages set draft_evidence=jsonb_set(draft_evidence,'{dm_queue,due_at}','"2026-11-25T13:00:00Z"') where id=m;
  assert not exists(select from assistant_reply_watch_cases('2026-11-25 16:59Z'));
  assert exists(select from assistant_reply_watch_cases('2026-11-25 17:00Z'));
  assert exists(select from assistant_reply_watch_cases('2026-11-26 10:00Z'));
  update outreach_messages set draft_evidence=jsonb_set(draft_evidence,'{dm_queue,due_at}',to_jsonb(due)) where id=m;
  update outreach_messages set unipile_message_id='confirmed',sent_at=due+interval '7 hours' where id=m;
  assert not exists(select from assistant_reply_watch_cases(observed)); -- old queued metadata survives a confirmed send
  update outreach_messages set unipile_message_id=null,sent_at=null where id=m;
  insert into integration_config(key,value) values('swishdm_dm_pause_until',(observed+interval '1 day')::text);
  assert not exists(select from assistant_reply_watch_cases(observed));
  update outreach_messages set draft_evidence=jsonb_set(draft_evidence,'{dm_queue,due_at}','"2026-11-25T14:00:00Z"') where id=m;
  update integration_config set value='2026-11-26T09:00:00Z',updated_at='2026-11-25 18:00Z' where key='swishdm_dm_pause_until';
  assert not exists(select from assistant_reply_watch_cases('2026-11-26 09:59Z'));
  assert exists(select from assistant_reply_watch_cases('2026-11-26 10:00Z'));
  update integration_config set updated_at='2026-11-25 16:00Z' where key='swishdm_dm_pause_until';
  assert not exists(select from assistant_reply_watch_cases('2026-11-26 10:00Z'));
  assert exists(select from assistant_reply_watch_cases('2026-11-26 11:00Z'));
  update outreach_messages set draft_evidence=jsonb_set(draft_evidence,'{dm_queue,due_at}',to_jsonb(due)) where id=m;
  delete from integration_config where key='swishdm_dm_pause_until';
  update integration_config set value='0' where key='swishdm_dm_daily_cap';
  assert not exists(select from assistant_reply_watch_cases(observed));
  update integration_config set value='20' where key='swishdm_dm_daily_cap';
  update outreach_messages set draft_evidence=jsonb_set(draft_evidence,'{dm_queue,due_at}','"broken"') where id=m;
  assert not exists(select from assistant_reply_watch_cases(observed)); -- one malformed row cannot break a sweep
end $$;

-- Verified referrals may override a stale intent label only on the exact inbound. An existing
-- acknowledgement draft is already work in progress. A later different-channel send is ambiguous.
do $$
declare c uuid:=gen_random_uuid(); pp uuid:=gen_random_uuid(); i uuid:=gen_random_uuid();
        prepared uuid:=gen_random_uuid(); unrelated uuid:=gen_random_uuid(); cross_channel uuid:=gen_random_uuid();
begin
  insert into outreach_campaigns values(c,'ivan');
  insert into outreach_prospects(id,campaign_id,name,stage,needs_manual_reply,enrichment_data)
    values(pp,c,'Verified','replied',true,jsonb_build_object('inbox_referral',jsonb_build_object('status','verified','input_message_id',i))),
      (prepared,c,'Ack ready','replied',true,jsonb_build_object('inbox_referral',jsonb_build_object('status','verified','input_message_id',prepared,'acknowledgement','Thanks, I will follow up.'))),
      (unrelated,c,'Old referral','replied',true,jsonb_build_object('inbox_referral',jsonb_build_object('status','verified','input_message_id',i))),
      (cross_channel,c,'Handled elsewhere','replied',true,null);
  insert into outreach_messages(id,prospect_id,direction,message_type,channel,created_at,reply_intent,message_text)
    values(i,pp,'inbound','dm','linkedin',now()-interval '3 days','negative','Contact my colleague.'),
     (prepared,prepared,'inbound','dm','linkedin',now()-interval '3 days','negative','Contact our lead.'),
     (unrelated,unrelated,'inbound','dm','linkedin',now()-interval '3 days','negative','All set.'),
     (cross_channel,cross_channel,'inbound','dm','linkedin',now()-interval '3 days','price_ask','Is it free?');
  insert into outreach_messages(id,prospect_id,direction,message_type,channel,created_at,sent_at)
    values(gen_random_uuid(),cross_channel,'outbound','manual_reply','email',now(),now());
  assert (select count(*) from assistant_reply_watch_cases() where prospect_id=pp)=1;
  assert not exists(select from assistant_reply_watch_cases() where prospect_id in(prepared,unrelated));
  assert exists(select from assistant_reply_watch_cases() where prospect_id=cross_channel);
end $$;

-- Synthetic rows only. The guard at the top requires a fresh local socket database.
do $$
declare c uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); o uuid:=gen_random_uuid();
begin
  insert into outreach_campaigns values(c,'arch');
  insert into outreach_prospects(id,campaign_id,name,stage,needs_manual_reply) values(p,c,'Example email','replied',true);
  insert into outreach_messages(id,prospect_id,direction,message_type,channel,created_at,message_text)
    values(i,p,'inbound','email_reply','email',now()-interval '3 days','Can we speak?'),
          (gen_random_uuid(),p,'inbound','dm','linkedin',now(),'Thank you');
  insert into outreach_messages(id,prospect_id,direction,message_type,channel,created_at,sent_at)
    values(o,p,'outbound','dm','linkedin',now(),now());
  assert exists(select from assistant_reply_watch_cases() where inbound_id=i);
  update outreach_messages set channel='email',sent_at=null,draft_evidence=jsonb_build_object('replies_to_inbound',gen_random_uuid()) where id=o;
  assert exists(select from assistant_reply_watch_cases() where inbound_id=i);
  update outreach_messages set channel='linkedin',draft_evidence=jsonb_build_object('replies_to_inbound',i) where id=o;
  assert not exists(select from assistant_reply_watch_cases() where inbound_id=i);
  update outreach_messages set channel='email', draft_evidence=jsonb_build_object('email_reply_to_message_id',gen_random_uuid()) where id=o;
  assert exists(select from assistant_reply_watch_cases() where inbound_id=i);
  update outreach_messages set unipile_chat_id='first' where id=i;
  update outreach_messages set unipile_chat_id='another',draft_evidence=jsonb_build_object('email_reply_to_message_id',i) where id=o;
  assert not exists(select from assistant_reply_watch_cases() where inbound_id=i);
  update outreach_messages set send_blocked_at=now(),send_blocked_reason='post_approval_race:inbound' where id=o;
  assert not exists(select from assistant_reply_watch_cases() where inbound_id=i);
  update outreach_messages set send_blocked_reason='post_approval_race:scheduled_thread_changed' where id=o;
  assert exists(select from assistant_reply_watch_cases() where inbound_id=i);
  update outreach_messages set send_blocked_reason='stale_draft_expired',send_blocked_at=now() where id=o;
  assert exists(select from assistant_reply_watch_cases() where inbound_id=i);
  update outreach_messages set send_blocked_reason='discarded_in_inbox',discard_mode='reply_myself' where id=o;
  assert exists(select from assistant_reply_watch_cases() where inbound_id=i);
end $$;
