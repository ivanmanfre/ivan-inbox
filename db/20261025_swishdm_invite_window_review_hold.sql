-- Keep withdrawn SwishDM approvals reviewable and stop invites at the rolling weekly ceiling.
create or replace function public.swishdm_restore_reply_review_hold()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.approved_at is not null and new.approved_at is null
    and new.sent_at is null and new.unipile_message_id is null
    and new.direction='outbound' and new.message_type='dm'
    and coalesce(new.channel,'linkedin')='linkedin'
    and new.ai_model like 'swishdm\_reply\_%' escape '\'
    and new.draft_evidence->>'lane' in ('swishdm_reply','swishdm_followup')
    and not (new.draft_evidence ? 'stopped')
    and new.send_blocked_reason is null and new.send_blocked_at is null
    and exists (select 1 from public.outreach_prospects p
      join public.outreach_campaigns c on c.id=p.campaign_id
      where p.id=new.prospect_id and c.client_id='swishdm') then
    new.send_blocked_reason := 'awaiting_client_review';
    new.send_blocked_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists swishdm_restore_reply_review_hold on public.outreach_messages;
create trigger swishdm_restore_reply_review_hold
before update of approved_at on public.outreach_messages
for each row execute function public.swishdm_restore_reply_review_hold();

-- Count durable send records across every SwishDM campaign, including blank reconnects.
-- Invites to one person cannot legitimately repeat within this seven-day window.
create or replace function public.swishdm_invite_weekly_window()
returns jsonb language sql stable security definer
set search_path = public, pg_temp
as $$
  with sent as (
    select p.id,greatest(p.connection_sent_at,max(m.sent_at)) sent_at
    from public.outreach_prospects p
    join public.outreach_campaigns c on c.id=p.campaign_id
    left join public.outreach_messages m on m.prospect_id=p.id
      and m.direction='outbound' and m.message_type='connection_note' and m.sent_at>now()-interval '7 days'
    where c.client_id='swishdm'
    group by p.id,p.connection_sent_at
  )
  select jsonb_build_object('sent_count',count(*),'limit',200,
    'retry_at',(array_agg(sent_at order by sent_at desc))[200]+interval '7 days 1 second')
  from sent where sent_at>now()-interval '7 days';
$$;
revoke all on function public.swishdm_invite_weekly_window() from public, anon, authenticated;
grant execute on function public.swishdm_invite_weekly_window() to service_role;

-- Serialize the capacity check and provider call across overlapping five-minute runs.
-- A dead run retains the slot for 15 minutes; existing send-claim recovery reconciles its outcome.
create or replace function public.swishdm_reserve_invite()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare slot jsonb; budget jsonb; token uuid := gen_random_uuid();
begin
  insert into public.integration_config(key,value) values('swishdm_invite_reservation','{}') on conflict(key) do nothing;
  select value::jsonb into slot from public.integration_config where key='swishdm_invite_reservation' for update;
  if nullif(slot->>'at','')::timestamptz>now()-interval '15 minutes' then
    return jsonb_build_object('ok',false,'reason','seat_busy');
  end if;
  budget := public.swishdm_invite_weekly_window();
  if (budget->>'sent_count')::integer>=200 then
    return jsonb_build_object('ok',false,'reason','weekly_cap_reached','retry_at',budget->'retry_at');
  end if;
  update public.integration_config set value=jsonb_build_object('token',token,'at',clock_timestamp())::text where key='swishdm_invite_reservation';
  return jsonb_build_object('ok',true,'token',token);
end;
$$;
create or replace function public.swishdm_release_invite(p_token uuid)
returns void language sql security definer
set search_path = public, pg_temp
as $$
  update public.integration_config set value='{}'
  where key='swishdm_invite_reservation' and value::jsonb->>'token'=p_token::text;
$$;
revoke all on function public.swishdm_reserve_invite() from public, anon, authenticated;
revoke all on function public.swishdm_release_invite(uuid) from public, anon, authenticated;
grant execute on function public.swishdm_reserve_invite() to service_role;
grant execute on function public.swishdm_release_invite(uuid) to service_role;
notify pgrst, 'reload schema';
