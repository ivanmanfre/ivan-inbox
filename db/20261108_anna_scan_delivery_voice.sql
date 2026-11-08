begin;
do $guard$ begin if pg_get_functiondef('public.anna_scan_finish(uuid,uuid,text,text,jsonb,text)'::regprocedure) is distinct from 'CREATE OR REPLACE FUNCTION public.anna_scan_finish(p_worker uuid, p_prospect uuid, p_status text, p_url text DEFAULT NULL::text, p_review jsonb DEFAULT ''{}''::jsonb, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public'', ''pg_temp''
AS $function$
declare r anna_scan_requests;v_reply text;v_report jsonb;
begin
 perform anna_assert_worker(p_worker);perform 1 from outreach_prospects where id=p_prospect for update;select * into r from anna_scan_requests where prospect_id=p_prospect for update;
 if r.prospect_id is null or not anna_reply_eligible(p_prospect) or r.status=''ready'' then return false;end if;
 if p_status not in(''building'',''ready'',''failed'',''retry'') then raise exception ''Invalid scan transition'';end if;
 if p_review->>''request_fingerprint'' is distinct from r.request_fingerprint then raise exception ''Scan request changed'';end if;
 if p_status=''ready'' then
  if p_url is null or p_url !~ ''^https://inboundonsteroids\.com/scan/[a-z0-9-]+/$'' or p_review->>''prospect_id'' is distinct from p_prospect::text or p_review->>''review_checked'' is distinct from ''true'' or nullif(p_review->>''revision_id'','''') is null then raise exception ''Scan identity or review unavailable'';end if;
  if anna_conversation_snapshot(p_prospect)<>r.request_fingerprint then update anna_scan_requests set status=''failed'',error=''Conversation changed while building; review before requesting again'',checked_at=now() where prospect_id=p_prospect;return false;end if;
  select report_json into v_report from scans where id::text=p_review->>''scan_id'' for share;
  if v_report is null or v_report is distinct from p_review->''inspected_report'' then raise exception ''Scan report changed after inspection'';end if;
  p_review:=(p_review-''inspected_report'')||jsonb_build_object(''report_db_hash'',md5(v_report::text));
  v_reply:=''Here is your profile audit: ''||p_url||E''\n\nYou can book a call with Ivan here to go through it: https://calendly.com/im-ivanmanfredi/30min'';
  if exists(select 1 from outreach_messages m where m.prospect_id=p_prospect and m.direction=''outbound'' and m.sent_at is null and m.send_blocked_at is null and nullif(btrim(m.message_text),'''') is not null) then update anna_scan_requests set status=''retry'',error=''A reply is already waiting; review it before scan delivery'',checked_at=now() where prospect_id=p_prospect;return false;end if;
  insert into outreach_messages(prospect_id,direction,channel,message_type,message_text,ai_model,sent_at,approved_at,created_at,draft_evidence)values(p_prospect,''outbound'',''linkedin'',''dm'',v_reply,''inbox_on_demand_reply'',null,null,now(),jsonb_build_object(''v'',''inbox_on_demand_reply_v1'',''client_id'',''anna'',''author'',''Anna Sol Manfredi'',''kind'',''scan_delivery'',''generated_text'',v_reply,''input_message_ids'',anna_conversation_ids(p_prospect),''scan'',p_review||jsonb_build_object(''url'',p_url)));
 end if;
 update anna_scan_requests set status=p_status,url=p_url,review=p_review,error=left(p_error,300),checked_at=now(),build_attempts=build_attempts+case when p_review->>''build_started''=''true'' then 1 else 0 end where prospect_id=p_prospect;return true;
end $function$
' then raise exception 'Anna scan function changed during review';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.anna_scan_finish(p_worker uuid, p_prospect uuid, p_status text, p_url text DEFAULT NULL::text, p_review jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_reply:='Here u go: '||p_url||E'\n\nHave a look, and if it sounds like we could give you a hand I''ll demo how it works live :)\n\nhttps://calendly.com/im-ivanmanfredi/30min';
  if exists(select 1 from outreach_messages m where m.prospect_id=p_prospect and m.direction='outbound' and m.sent_at is null and m.send_blocked_at is null and nullif(btrim(m.message_text),'') is not null) then update anna_scan_requests set status='retry',error='A reply is already waiting; review it before scan delivery',checked_at=now() where prospect_id=p_prospect;return false;end if;
  insert into outreach_messages(prospect_id,direction,channel,message_type,message_text,ai_model,sent_at,approved_at,created_at,draft_evidence)values(p_prospect,'outbound','linkedin','dm',v_reply,'inbox_on_demand_reply',null,null,now(),jsonb_build_object('v','inbox_on_demand_reply_v1','client_id','anna','author','Anna Sol Manfredi','kind','scan_delivery','generated_text',v_reply,'input_message_ids',anna_conversation_ids(p_prospect),'scan',p_review||jsonb_build_object('url',p_url)));
 end if;
 update anna_scan_requests set status=p_status,url=p_url,review=p_review,error=left(p_error,300),checked_at=now(),build_attempts=build_attempts+case when p_review->>'build_started'='true' then 1 else 0 end where prospect_id=p_prospect;return true;
end $function$
;
commit;
