begin;
alter table anna_lane_state add column if not exists draft_cursor uuid;
create table if not exists anna_draft_state(prospect_id uuid primary key references outreach_prospects(id), snapshot text not null, mode text not null, attempted_at timestamptz not null default now(), status text not null default 'working', error text);
create table if not exists anna_scan_requests(prospect_id uuid primary key references outreach_prospects(id), requested_at timestamptz not null default now(), status text not null default 'queued', request_fingerprint text not null, url text, review jsonb not null default '{}', error text, checked_at timestamptz);
alter table anna_scan_requests add column if not exists build_attempts integer not null default 0;
alter table anna_draft_state enable row level security;
alter table anna_scan_requests enable row level security;
revoke all on anna_draft_state,anna_scan_requests from public,anon,authenticated;
grant all on anna_draft_state,anna_scan_requests to service_role;
create or replace function anna_conversation_ids(p_prospect uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from outreach_messages where prospect_id=p_prospect and nullif(btrim(message_text),'') is not null and (direction='inbound' or sent_at is not null)
$$;
create or replace function anna_conversation_snapshot(p_prospect uuid) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(id,message_text,direction,sent_at,created_at) order by id)::text,'[]')) from outreach_messages where prospect_id=p_prospect and nullif(btrim(message_text),'') is not null and (direction='inbound' or sent_at is not null)
$$;
create or replace function anna_reply_eligible(p_prospect uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from outreach_prospects p join anna_invites i on i.prospect_id=p.id join anna_lane_state s on s.campaign_id=p.campaign_id where p.id=p_prospect and i.status in('accepted','replied') and not coalesce(p.blacklisted,false) and p.call_booked_at is null and p.skip_state is null and coalesce(p.stage,'') not in('engaged','call_booked','archived','skipped','disqualified','unsubscribed','blacklisted') and (nullif(p.skip_reason,'') is null or p.skip_reason='follow_up_dated'))
$$;
-- Applies equally to typed replies and model drafts. The prospect lock serializes all draft writers.
create or replace function anna_stamp_reply_snapshot() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ids jsonb;
begin
 if new.direction<>'outbound' or new.sent_at is not null or not exists(select 1 from outreach_prospects p join anna_lane_state s on s.campaign_id=p.campaign_id where p.id=new.prospect_id) then return new;end if;
 perform 1 from outreach_prospects where id=new.prospect_id for update;
 if not anna_reply_eligible(new.prospect_id) then raise exception 'Anna conversation is closed or unavailable';end if;
 v_ids:=anna_conversation_ids(new.prospect_id);
 if new.ai_model='inbox_on_demand_reply' then
   if new.draft_evidence->>'client_id' is distinct from 'anna' or new.draft_evidence->>'author' is distinct from 'Anna Sol Manfredi' or new.draft_evidence->'input_message_ids' is null or not ((new.draft_evidence->'input_message_ids') @> v_ids and v_ids @> (new.draft_evidence->'input_message_ids')) then raise exception 'Anna draft conversation changed';end if;
   if exists(select 1 from outreach_messages m where m.prospect_id=new.prospect_id and m.direction='outbound' and m.sent_at is null and m.send_blocked_at is null and nullif(btrim(m.message_text),'') is not null) then raise exception 'Anna already has a pending reply';end if;
 end if;
 new.draft_evidence:=coalesce(new.draft_evidence,'{}')||jsonb_build_object('anna_snapshot',anna_conversation_snapshot(new.prospect_id));
 return new;
end $$;
drop trigger if exists anna_stamp_reply_snapshot on outreach_messages;
create trigger anna_stamp_reply_snapshot before insert on outreach_messages for each row execute function anna_stamp_reply_snapshot();
create or replace function anna_draft_claim(p_worker uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p outreach_prospects; v_mode text; v_snapshot text; last_m outreach_messages; v_ids jsonb;v_seen integer:=0;v_after uuid;
begin
 perform anna_assert_worker(p_worker);
 select draft_cursor into v_after from anna_lane_state where id=true;
 for p in select x.* from outreach_prospects x join anna_invites i on i.prospect_id=x.id join anna_lane_state s on s.campaign_id=x.campaign_id
 where (v_after is null or x.id>v_after) and i.status in('accepted','replied') and anna_reply_eligible(x.id) and (x.next_touch_after is null or x.next_touch_after<=now())
 and not exists(select 1 from anna_scan_requests r where r.prospect_id=x.id and r.status in('queued','building','retry'))
 and not exists(select 1 from outreach_messages m where m.prospect_id=x.id and m.direction='outbound' and m.sent_at is null and m.send_blocked_at is null and nullif(btrim(m.message_text),'') is not null)
 order by x.id limit 100
 loop
  v_seen:=v_seen+1;update anna_lane_state set draft_cursor=p.id where id=true;
  select * into last_m from outreach_messages m where m.prospect_id=p.id and nullif(btrim(m.message_text),'') is not null and (m.direction='inbound' or m.sent_at is not null) order by coalesce(m.sent_at,m.created_at) desc,m.created_at desc,m.id desc limit 1;
  if last_m.id is null then
   if not exists(select 1 from anna_invites where prospect_id=p.id and accepted_at<now()-interval '30 minutes') then continue;end if;
   v_mode:='intro';
  elsif last_m.direction='inbound' then v_mode:='reply';
  elsif last_m.sent_at<=now()-interval '48 hours' or (p.skip_reason='follow_up_dated' and p.next_touch_after<=now()) then v_mode:='followup';
  else continue;end if;
  v_snapshot:=anna_conversation_snapshot(p.id);
  if exists(select 1 from anna_draft_state d where d.prospect_id=p.id and d.snapshot=v_snapshot and (d.status='done' or d.attempted_at>now()-interval '30 minutes')) then continue;end if;
  -- Discarding a draft is a decision for this turn; only a new conversation turns drafting back on.
  if exists(select 1 from outreach_messages m where m.prospect_id=p.id and m.ai_model='inbox_on_demand_reply' and m.draft_evidence->>'anna_snapshot'=v_snapshot and m.send_blocked_at is not null and m.send_blocked_reason not like 'Anna stale%') then continue;end if;
  insert into anna_draft_state(prospect_id,snapshot,mode,status)values(p.id,v_snapshot,v_mode,'working')on conflict(prospect_id)do update set snapshot=excluded.snapshot,mode=excluded.mode,status='working',attempted_at=now(),error=null;
  v_ids:=anna_conversation_ids(p.id);
  return jsonb_build_object('prospect_id',p.id,'mode',v_mode,'name',p.name,'input_message_ids',v_ids,'snapshot',v_snapshot,'prospect',to_jsonb(p),'history',coalesce((select jsonb_agg(to_jsonb(m) order by coalesce(m.sent_at,m.created_at),m.created_at,m.id) from outreach_messages m where m.prospect_id=p.id),'[]'));
 end loop;
 if v_seen<100 then update anna_lane_state set draft_cursor=null where id=true;end if;
 return null;
end $$;
create or replace function anna_request_scan(p_prospect uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r anna_scan_requests;
begin
 perform anna_assert_operator();perform 1 from outreach_prospects where id=p_prospect for update;
 if not anna_reply_eligible(p_prospect) then raise exception 'Anna scan contact unavailable';end if;
 select * into r from anna_scan_requests where prospect_id=p_prospect for update;
 if r.prospect_id is not null and r.status<>'failed' and (r.status<>'ready' or r.request_fingerprint=anna_conversation_snapshot(p_prospect)) then return to_jsonb(r);end if;
 insert into anna_scan_requests(prospect_id,request_fingerprint)values(p_prospect,anna_conversation_snapshot(p_prospect))on conflict(prospect_id)do update set requested_at=now(),status='queued',request_fingerprint=excluded.request_fingerprint,url=null,review='{}',error=null,checked_at=null,build_attempts=0 returning * into r;
 return to_jsonb(r);
end $$;
create or replace function anna_scan_status(p_prospect uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform anna_assert_operator();if not exists(select 1 from outreach_prospects p join anna_lane_state s on s.campaign_id=p.campaign_id where p.id=p_prospect) then raise exception 'Anna ownership';end if;return (select to_jsonb(r) from anna_scan_requests r where prospect_id=p_prospect);end $$;
create or replace function anna_draft_finish(p_worker uuid,p_prospect uuid,p_snapshot text,p_reply text,p_evidence jsonb,p_error text default null,p_scan_requested boolean default false) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare d anna_draft_state;v_id uuid;v_scan jsonb;
begin
 perform anna_assert_worker(p_worker);perform 1 from outreach_prospects where id=p_prospect for update;
 select * into d from anna_draft_state where prospect_id=p_prospect for update;
 if d.snapshot is distinct from p_snapshot or d.status<>'working' then return false;end if;
 if not anna_reply_eligible(p_prospect) or anna_conversation_snapshot(p_prospect)<>p_snapshot then update anna_draft_state set status='stale' where prospect_id=p_prospect;return false;end if;
 if p_error is not null then update anna_draft_state set status='retry',error=left(p_error,300) where prospect_id=p_prospect;return false;end if;
 if p_scan_requested then v_scan:=anna_request_scan(p_prospect);end if;
 if nullif(btrim(p_reply),'') is not null and not p_scan_requested then
  if length(p_reply)>8000 then raise exception 'Anna draft too long';end if;
  if exists(select 1 from outreach_messages m where m.prospect_id=p_prospect and m.direction='outbound' and m.sent_at is null and m.send_blocked_at is null and nullif(btrim(m.message_text),'') is not null) then return false;end if;
  insert into outreach_messages(prospect_id,direction,channel,message_type,message_text,ai_model,sent_at,approved_at,created_at,draft_evidence)
  values(p_prospect,'outbound','linkedin','dm',p_reply,'inbox_on_demand_reply',null,null,now(),coalesce(p_evidence,'{}')||jsonb_build_object('v','inbox_on_demand_reply_v1','client_id','anna','author','Anna Sol Manfredi','input_message_ids',anna_conversation_ids(p_prospect),'kind',d.mode,'generated_text',p_reply));
  if d.mode='followup' then update outreach_prospects set next_touch_after=null,skip_reason=case when skip_reason='follow_up_dated' then null else skip_reason end where id=p_prospect;end if;
 end if;
 update anna_draft_state set status='done',error=null where prospect_id=p_prospect;return true;
end $$;
create or replace function anna_scan_claim(p_worker uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r anna_scan_requests;p outreach_prospects;
begin
 perform anna_assert_worker(p_worker);
 update anna_scan_requests set status='failed',error='Scan build exceeded one hour; retry after checking the builder' where status in('queued','building','retry') and (requested_at<now()-interval '1 hour' or build_attempts>=3 and status='retry');
 select x.* into r from anna_scan_requests x where x.status in('queued','building','retry') and (x.checked_at is null or x.checked_at<now()-interval '2 minutes') and anna_reply_eligible(x.prospect_id) order by x.checked_at nulls first,x.requested_at limit 1 for update;
 if r.prospect_id is null then return null;end if;
 update anna_scan_requests set checked_at=now() where prospect_id=r.prospect_id;
 select * into p from outreach_prospects where id=r.prospect_id;
 return to_jsonb(r)||jsonb_build_object('name',p.name,'company_domain',p.company_domain);
end $$;
create or replace function anna_scan_finish(p_worker uuid,p_prospect uuid,p_status text,p_url text default null,p_review jsonb default '{}',p_error text default null) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r anna_scan_requests;v_reply text;v_report jsonb;
begin
 perform anna_assert_worker(p_worker);perform 1 from outreach_prospects where id=p_prospect for update;select * into r from anna_scan_requests where prospect_id=p_prospect for update;
 if r.prospect_id is null or not anna_reply_eligible(p_prospect) or r.status='ready' then return false;end if;
 if p_status not in('building','ready','failed','retry') then raise exception 'Invalid scan transition';end if;
 if p_review->>'request_fingerprint' is distinct from r.request_fingerprint then raise exception 'Scan request changed';end if;
 if p_status='ready' then
  if p_url is null or p_url !~ '^https://inboundonsteroids\.com/scan/[a-z0-9-]+/$' or p_review->>'prospect_id' is distinct from p_prospect::text or p_review->>'review_checked' is distinct from 'true' or nullif(p_review->>'revision_id','') is null then raise exception 'Scan identity or review unavailable';end if;
  if anna_conversation_snapshot(p_prospect)<>r.request_fingerprint then update anna_scan_requests set status='failed',error='Conversation changed while building; review before requesting again',checked_at=now() where prospect_id=p_prospect;return false;end if;
  select report_json into v_report from scans where id::text=p_review->>'scan_id' for share;
  if v_report is null or v_report is distinct from p_review->'inspected_report' then raise exception 'Scan report changed after inspection';end if;
  p_review:=(p_review-'inspected_report')||jsonb_build_object('report_db_hash',md5(v_report::text));
  v_reply:='Here is your profile audit: '||p_url||E'\n\nYou can book a call with Ivan here to go through it: https://calendly.com/im-ivanmanfredi/30min';
  if exists(select 1 from outreach_messages m where m.prospect_id=p_prospect and m.direction='outbound' and m.sent_at is null and m.send_blocked_at is null and nullif(btrim(m.message_text),'') is not null) then update anna_scan_requests set status='retry',error='A reply is already waiting; review it before scan delivery',checked_at=now() where prospect_id=p_prospect;return false;end if;
  insert into outreach_messages(prospect_id,direction,channel,message_type,message_text,ai_model,sent_at,approved_at,created_at,draft_evidence)values(p_prospect,'outbound','linkedin','dm',v_reply,'inbox_on_demand_reply',null,null,now(),jsonb_build_object('v','inbox_on_demand_reply_v1','client_id','anna','author','Anna Sol Manfredi','kind','scan_delivery','generated_text',v_reply,'input_message_ids',anna_conversation_ids(p_prospect),'scan',p_review||jsonb_build_object('url',p_url)));
 end if;
 update anna_scan_requests set status=p_status,url=p_url,review=p_review,error=left(p_error,300),checked_at=now(),build_attempts=build_attempts+case when p_review->>'build_started'='true' then 1 else 0 end where prospect_id=p_prospect;return true;
end $$;
create or replace function anna_approve_reply(p_message_id uuid,p_text text,p_expected_scan jsonb default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare m outreach_messages;v_text text;v_scan anna_scan_requests;
begin
 perform anna_assert_operator();select * into m from outreach_messages where id=p_message_id for update;
 perform 1 from outreach_prospects where id=m.prospect_id for update;
 if m.id is null or not anna_reply_eligible(m.prospect_id) or m.ai_model is distinct from 'inbox_on_demand_reply' or m.draft_evidence->>'client_id' is distinct from 'anna' or m.direction<>'outbound' or m.channel<>'linkedin' or m.sent_at is not null or m.approved_at is not null or m.send_blocked_at is not null then raise exception 'Anna draft changed; refresh before approving';end if;
 if m.draft_evidence->>'anna_snapshot' is distinct from anna_conversation_snapshot(m.prospect_id) then raise exception 'Anna conversation changed; create a fresh draft';end if;
 v_text:=regexp_replace(btrim(p_text),E'\n[ \t]*---+[ \t]*\n',E'\n\n','g');if nullif(v_text,'') is null or length(v_text)>8000 then raise exception 'Reply empty or too long';end if;
 if m.draft_evidence->'scan' is not null then
  select * into v_scan from anna_scan_requests where prospect_id=m.prospect_id;
  if p_expected_scan is distinct from m.draft_evidence->'scan' or v_scan.status is distinct from 'ready' or (v_scan.review||jsonb_build_object('url',v_scan.url)) is distinct from p_expected_scan or position(v_scan.url in v_text)=0 then raise exception 'Review the current scan and retain its link before approving';end if;
 end if;
 update outreach_messages set message_type='manual_reply',message_text=v_text,approved_at=now(),draft_evidence=coalesce(draft_evidence,'{}')||jsonb_build_object('operator_copy_approval',jsonb_build_object('source','inbox','text',v_text,'approved_at',now()),'scan_approved',p_expected_scan is not null) where id=m.id;
end $$;
-- The shared Calendly tracker persists unmatched events but only stamps Ivan campaigns.
-- Read its exact-email evidence without changing its attribution verdict or source rows.
create or replace function anna_reconcile_bookings(p_worker uuid) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;n integer:=0;
begin
 perform anna_assert_worker(p_worker);
 -- Clear only the exact timestamp this worker owns. A manual or newer booking stays intact.
 update outreach_prospects p set call_booked_at=null,enrichment_data=p.enrichment_data-'anna_booking',updated_at=now()
 where p.call_booked_at is not null and p.enrichment_data#>>'{anna_booking,source}'='booking_attributions'
  and to_jsonb(p.call_booked_at)=p.enrichment_data#>'{anna_booking,booked_at}'
  and exists(select 1 from anna_invites a join anna_lane_state s on s.campaign_id=p.campaign_id where a.prospect_id=p.id)
  and exists(select 1 from booking_attributions b where b.meeting_id=p.enrichment_data#>>'{anna_booking,meeting_id}' and b.client_id='ivan' and lower(b.meeting_outcome) in('canceled','cancelled'))
  and not exists(select 1 from booking_attributions b where b.client_id='ivan' and lower(btrim(b.booker_email))=lower(btrim(p.email))
   and coalesce(lower(b.meeting_outcome),'') not in('canceled','cancelled') and (b.prospect_id is null or b.prospect_id=p.id)
   and exists(select 1 from outreach_messages m where m.prospect_id=p.id and m.direction='outbound' and m.sent_at<=b.booked_at and m.message_type<>'connection_note'));

 for r in
  select p.id as prospect_id,min(b.booked_at) as booked_at,(array_agg(b.meeting_id order by b.booked_at,b.meeting_id))[1] as meeting_id
  from booking_attributions b join outreach_prospects p on lower(btrim(p.email))=lower(btrim(b.booker_email))
  join anna_invites a on a.prospect_id=p.id join anna_lane_state s on s.campaign_id=p.campaign_id
  where b.client_id='ivan' and nullif(btrim(b.booker_email),'') is not null and b.booker_email like '%@%'
   and coalesce(lower(b.meeting_outcome),'') not in('canceled','cancelled') and b.booked_at is not null
   and (b.prospect_id is null or b.prospect_id=p.id) and p.call_booked_at is null and a.status in('accepted','replied')
   and exists(select 1 from outreach_messages m where m.prospect_id=p.id and m.direction='outbound' and m.sent_at is not null and m.sent_at<=b.booked_at and m.message_type<>'connection_note')
   and not exists(select 1 from outreach_prospects other where other.id<>p.id and lower(btrim(other.email))=lower(btrim(b.booker_email)))
  group by p.id
 loop
  update outreach_prospects set call_booked_at=r.booked_at,needs_manual_reply=false,next_touch_after=null,
   skip_reason=case when skip_reason='follow_up_dated' then null else skip_reason end,
   enrichment_data=coalesce(enrichment_data,'{}')||jsonb_build_object('anna_booking',jsonb_build_object('meeting_id',r.meeting_id,'booked_at',r.booked_at,'source','booking_attributions','match','email_exact','checked_at',now())),updated_at=now()
   where id=r.prospect_id and call_booked_at is null;
  if found then n:=n+1;end if;
  update outreach_messages m set approved_at=null,send_blocked_at=now(),send_blocked_reason='Anna call already booked'
   where m.prospect_id=r.prospect_id and m.direction='outbound' and m.sent_at is null and m.send_blocked_at is null
   and m.ai_model='inbox_on_demand_reply' and not exists(select 1 from anna_reply_dispatch d where d.message_id=m.id and d.status in('sending','uncertain'));
 end loop;
 return n;
end $$;
-- New inbound or a manual reply invalidates old model drafts before the sender can claim them.
create or replace function anna_retire_stale_drafts(p_worker uuid) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 perform anna_assert_worker(p_worker);
 update outreach_messages m set approved_at=null,send_blocked_at=now(),send_blocked_reason='Anna stale conversation; draft a fresh reply'
 where m.ai_model='inbox_on_demand_reply' and m.sent_at is null and m.send_blocked_at is null and m.draft_evidence->>'client_id'='anna' and m.draft_evidence->>'anna_snapshot' is distinct from anna_conversation_snapshot(m.prospect_id)
 and not exists(select 1 from anna_reply_dispatch d where d.message_id=m.id and d.status in('sending','uncertain'));
 get diagnostics n=row_count;return n;
end $$;
create or replace function anna_scan_delivery_valid(p_prospect uuid,p_scan jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from anna_scan_requests r join scan_story_revisions rev on rev.id::text=p_scan->>'revision_id'
 join scans sc on sc.id::text=p_scan->>'scan_id'
 where r.prospect_id=p_prospect and r.status='ready' and r.review||jsonb_build_object('url',r.url)=p_scan
 and rev.source->>'prospect_id'=p_prospect::text and rev.status='approved' and rev.review->>'checked'='true'
 and rev.scan_slug=p_scan->>'scan_slug' and sc.company_slug=rev.scan_slug and sc.status='complete'
 and sc.report_json#>>'{content_system,story_v1,reviewStatus}'='approved' and md5(sc.report_json::text)=p_scan->>'report_db_hash'
 and not exists(select 1 from scan_story_revisions newer where newer.scan_slug=rev.scan_slug and newer.revision>rev.revision))
$$;
create or replace function anna_reply_prepare(p_worker uuid,p_id uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare d anna_reply_dispatch;m outreach_messages;
begin
 perform anna_assert_worker(p_worker);perform 1 from anna_lane_state where id for update;
 select * into d from anna_reply_dispatch where message_id=p_id for update;select * into m from outreach_messages where id=p_id for update;
 if d.status is distinct from 'checking' or d.worker is distinct from p_worker then return false;end if;
 -- A temporary stop/snooze preserves the queued approval for a later worker.
 if not anna_sends_enabled() or (m.snoozed_until is not null and m.snoozed_until>now()) then return false;end if;
 if m.sent_at is not null or m.approved_at is distinct from d.approved_at or md5(m.message_text) is distinct from d.text_hash
 or not anna_reply_eligible(m.prospect_id) or m.draft_evidence->>'anna_snapshot' is distinct from anna_conversation_snapshot(m.prospect_id)
 or (m.draft_evidence->'scan' is not null and not anna_scan_delivery_valid(m.prospect_id,m.draft_evidence->'scan'))
 or m.message_type<>'manual_reply' or m.channel<>'linkedin' or m.direction<>'outbound' or m.send_blocked_reason is not null
 or exists(select 1 from outreach_messages prior where prior.prospect_id=m.prospect_id and prior.id<>m.id and prior.direction='outbound' and prior.sent_at is not null and md5(prior.message_text)=md5(m.message_text))
 or not exists(select 1 from outreach_prospects p join anna_invites a on a.prospect_id=p.id join anna_lane_state s on s.campaign_id=p.campaign_id where p.id=m.prospect_id and not coalesce(p.blacklisted,false) and a.status in('accepted','replied')) then
 update anna_reply_dispatch set status='excluded',error='Manual reply approval, identity or duplicate check failed' where message_id=p_id;
 update outreach_messages set send_blocked_reason=coalesce(send_blocked_reason,'Anna manual reply check failed; compose a new reply'),send_blocked_at=now() where id=p_id and sent_at is null;
 return false;end if;
 update anna_reply_dispatch set status='sending' where message_id=p_id;return true;
end $$;

do $$declare r record;begin
 for r in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'anna\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
grant execute on function anna_lane_status(),anna_lane_control(boolean),anna_request_scan(uuid),anna_scan_status(uuid),anna_approve_reply(uuid,text,jsonb) to authenticated;
commit;
