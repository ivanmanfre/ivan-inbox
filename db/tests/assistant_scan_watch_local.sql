-- Run only in a new, disposable local PostgreSQL instance.
\set ON_ERROR_STOP on
do $$ begin
  if inet_server_addr() is not null or to_regclass('public.integration_config') is not null then
    raise exception 'requires a fresh local socket database';
  end if;
end $$;
create role anon;
create role authenticated;
create role service_role;
create schema cron;
create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
create table integration_config (key text primary key, value text not null);
create table inbox_threads(id uuid primary key, user_id uuid, kind text,last_turn_at timestamptz,updated_at timestamptz);
create table inbox_turns(id uuid primary key,thread_id uuid,user_id uuid,prompt text,answer text,status text,origin text,started_at timestamptz,finished_at timestamptz,sources jsonb);
create table outreach_messages(prospect_id uuid, direction text, sent_at timestamptz, created_at timestamptz);
create table fixture(inbound_id uuid, prospect_id uuid, disposition text, address_count int, email_at timestamptz,request_signal text,linkedin_report_at timestamptz,asked_at timestamptz,report_url text,sender text,address text,person text);
create function assistant_rise_scan_email() returns setof fixture language sql stable as $$ select * from fixture $$;
\ir ../20261125_assistant_scan_watch.sql
insert into inbox_threads values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','bot',now(),now());
insert into fixture values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',null,1,null,'address_after_acceptance_phrase',now()-interval '2 days',now()-interval '3 days','https://resources.risedtc.com/scan/eco','m@example.test','e@example.test','Example');
create function pg_temp.scan_pass(t timestamptz) returns jsonb language sql as $$select assistant_scan_watch_record('00000000-0000-4000-8000-000000000004',t,jsonb_build_array(jsonb_build_object('inbound_id',inbound_id,'decision','missing_email','expected_report',report_url,'expected_sender',sender,'expected_address',address))) from fixture$$;
do $$
declare base timestamptz := now()-interval '20 seconds'; r jsonb;
begin
  r:=pg_temp.scan_pass(base);
  assert r->>'mode'='shadow' and r->>'posted'='0' and r->>'eligible'='1';
  assert (select count(*) from inbox_turns)=0;
  assert not has_table_privilege('authenticated','assistant_scan_watch','select');
  assert not has_function_privilege('anon','assistant_scan_watch_record(uuid,timestamptz,jsonb)','execute');
  update integration_config set value='chat' where key='assistant_scan_watch_mode';
  insert into outreach_messages values('00000000-0000-4000-8000-000000000002','inbound',now(),now());
  r:=pg_temp.scan_pass(base+interval '1 second'); assert r->>'posted'='0' and r->>'eligible'='0';
  assert (select decision from assistant_scan_watch)='later_inbound_or_draft';
  update outreach_messages set direction='outbound',sent_at=null;
  r:=pg_temp.scan_pass(base+interval '2 seconds'); assert r->>'posted'='0';
  update outreach_messages set direction='outbound',sent_at=now();
  r:=pg_temp.scan_pass(base+interval '3 seconds'); assert r->>'posted'='1';
  r:=pg_temp.scan_pass(base+interval '4 seconds'); assert r->>'posted'='0';
  r:=pg_temp.scan_pass(base); assert r->>'checked'='0';
  update fixture set email_at=now();
  r:=pg_temp.scan_pass(base+interval '5 seconds'); assert r->>'eligible'='0' and r->>'posted'='0';
  assert (select count(*) from inbox_turns)=1;
  assert (select sources->0->>'path' from inbox_turns)='00000000-0000-4000-8000-000000000001';
end $$;
