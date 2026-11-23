begin;
create or replace function public.outreach_sender_demo_copy(p_sender text, p_copy text)
returns text language sql immutable parallel safe set search_path = pg_catalog as $copy$
  select case when p_sender in ('anna','leah') then
    regexp_replace(
      regexp_replace(p_copy, '(^|[.!?][[:space:]]+|[\n\r][[:blank:]]*)I([''’])ll(?=[[:blank:]]+demo\M)', '\1We\2ll', 'gi'),
      '\mI([''’])ll(?=[[:blank:]]+demo\M)', 'we\1ll', 'gi')
    else p_copy end;
$copy$;
revoke all on function public.outreach_sender_demo_copy(text,text) from public,anon,authenticated;
grant execute on function public.outreach_sender_demo_copy(text,text) to service_role;

do $migration$
declare
  scan_def text:=pg_get_functiondef('public.anna_scan_finish(uuid,uuid,text,text,jsonb,text)'::regprocedure);
  trigger_def text:=pg_get_functiondef('public.anna_stamp_reply_snapshot()'::regprocedure);
  marker text:=$mark$   if exists(select 1 from outreach_messages m where m.prospect_id=new.prospect_id$mark$;
begin
  if regexp_count(scan_def,$old$I''ll demo$old$)<>1 or strpos(trigger_def,'outreach_sender_demo_copy')<>0 or strpos(trigger_def,marker)=0 then
    raise exception 'Anna copy sources have changed';
  end if;
  execute replace(scan_def,$old$I''ll demo$old$,$new$we''ll demo$new$);
  execute replace(trigger_def,marker,$patch$   new.message_text:=public.outreach_sender_demo_copy('anna',new.message_text);
   if jsonb_typeof(new.draft_evidence->'generated_text')='string' then
     new.draft_evidence:=jsonb_set(new.draft_evidence,'{generated_text}',to_jsonb(public.outreach_sender_demo_copy('anna',new.draft_evidence->>'generated_text')));
   end if;
$patch$||marker);
end;
$migration$;
commit;
