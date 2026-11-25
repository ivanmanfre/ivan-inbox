-- The only writer is the scheduled RISE scan-email check. The pilot starts in shadow.
begin;
create table if not exists public.assistant_scan_watch (
  inbound_id uuid primary key, checked_at timestamptz not null, decision text not null,
  first_chat_turn uuid unique
);
alter table public.assistant_scan_watch enable row level security;
revoke all on public.assistant_scan_watch from public, anon, authenticated;
grant select, insert, update on public.assistant_scan_watch to service_role;
insert into public.integration_config(key,value) values('assistant_scan_watch_mode','shadow')
  on conflict (key) do nothing;

create or replace function public.assistant_scan_watch_record(p_operator uuid, p_started timestamptz, p_observations jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  setting text;
  thread uuid;
  stamp record;
  evidence record;
  outcome text;
  old_turn uuid;
  new_turn uuid;
  total int := 0;
  posted int := 0;
  eligible int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('assistant_scan_watch_record'));
  select value into setting from public.integration_config where key='assistant_scan_watch_mode';
  if setting is null or setting not in ('shadow','chat') then return jsonb_build_object('mode','off'); end if;
  select id into thread from public.inbox_threads where user_id=p_operator and kind='bot';
  if setting='chat' and thread is null then raise exception 'main bot thread unavailable'; end if;
  if p_started < now()-interval '2 minutes' or p_started > now()+interval '30 seconds' then
    raise exception 'expired observation';
  end if;
  for stamp in select * from jsonb_to_recordset(p_observations)
      as m(inbound_id uuid, decision text, expected_report text, expected_address text, expected_sender text)
  loop
    continue when exists (select 1 from public.assistant_scan_watch w where w.inbound_id=stamp.inbound_id and w.checked_at >= p_started);
    outcome := stamp.decision;
    if outcome='missing_email' then
      -- A human reply, draft or delivery can arrive during the provider read.
      select * into evidence from public.assistant_rise_scan_email() e where e.inbound_id=stamp.inbound_id;
      if not found or evidence.disposition is not null or evidence.address_count<>1 or evidence.email_at is not null
        or evidence.request_signal not in ('address_after_acceptance_phrase','mentions_sending_scan')
        or evidence.linkedin_report_at is null or evidence.asked_at > now()-interval '24 hours'
        or stamp.expected_report is null or evidence.report_url is distinct from stamp.expected_report
        or stamp.expected_sender is null or evidence.sender is distinct from stamp.expected_sender
        or evidence.address is distinct from stamp.expected_address then
        outcome := 'source_changed';
      elsif exists (select 1 from public.outreach_messages m where m.prospect_id=evidence.prospect_id
          and coalesce(m.sent_at,m.created_at)>evidence.asked_at
          and (m.direction='inbound' or (m.direction='outbound' and m.sent_at is null))) then
        outcome := 'later_inbound_or_draft';
      end if;
    end if;
    insert into public.assistant_scan_watch(inbound_id,checked_at,decision)
      values(stamp.inbound_id,p_started,outcome)
      on conflict(inbound_id) do update set checked_at=excluded.checked_at, decision=excluded.decision
      returning first_chat_turn into old_turn;
    total := total+1;
    if outcome='missing_email' then eligible := eligible+1; end if;
    if setting='chat' and outcome='missing_email' and old_turn is null then
      new_turn := gen_random_uuid();
      insert into public.inbox_turns(id,thread_id,user_id,prompt,answer,status,origin,started_at,finished_at,sources)
        values(new_turn,thread,p_operator,'',
          format('%s supplied %s after the scan offer. Mattan shared the report on LinkedIn. I checked the connected RISE sender and found no email to that address. Reply “draft the email” to prepare it here.', evidence.person, evidence.address),
          'done','bot',now(),now(),jsonb_build_array(jsonb_build_object('kind','rise_scan_watch','path',stamp.inbound_id,'at',now())));
      update public.assistant_scan_watch set first_chat_turn=new_turn where inbound_id=stamp.inbound_id;
      update public.inbox_threads set last_turn_at=now(), updated_at=now() where id=thread;
      posted := posted+1;
    end if;
  end loop;
  return jsonb_build_object('mode',setting,'checked',total,'eligible',eligible,'posted',posted);
end;
$$;
revoke all on function public.assistant_scan_watch_record(uuid,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.assistant_scan_watch_record(uuid,timestamptz,jsonb) to service_role;
select cron.schedule('assistant-rise-scan-watch','10 8 * * *',
  $job$select net.http_post(
    url:='https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-scan-watch',
    headers:=jsonb_build_object('Content-Type','application/json','x-inbox-secret',
      (select value from public.integration_config where key='inbox_push_secret')),
    body:='{}'::jsonb, timeout_milliseconds:=50000)$job$);
commit;
