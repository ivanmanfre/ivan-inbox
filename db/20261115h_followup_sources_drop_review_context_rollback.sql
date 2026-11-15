-- Rollback for 20261115h: the definition as it was live before (review_context included).
CREATE OR REPLACE FUNCTION public.inbox_followup_sources()
 RETURNS TABLE(seat text, prospect jsonb, rows jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if auth.role() is distinct from 'service_role' and not exists(
  select 1 from public.outreach_agent_accounts a where a.client_id='ivan' and auth.uid()=any(a.operator_ids)
 ) then raise exception 'operator_denied' using errcode='42501'; end if;
 return query
 select coalesce(c.client_id,'ivan'),
  jsonb_build_object('id',p.id,'name',p.name,'company',p.company,'stage',p.stage,'icp_score',p.icp_score,
   'blacklisted',p.blacklisted,'call_booked_at',p.call_booked_at,'needs_manual_reply',p.needs_manual_reply,
   'skip_state',p.skip_state,'skip_reason',p.skip_reason,'next_touch_after',p.next_touch_after,
   'enrichment_data',jsonb_build_object(
    'copy_hold',p.enrichment_data->'copy_hold','lang_hold',p.enrichment_data->'lang_hold',
    'qualification_hold',p.enrichment_data->'qualification_hold','ledger_hold',p.enrichment_data->'ledger_hold',
    'person_hold',p.enrichment_data->'person_hold','reply_hold',p.enrichment_data->'reply_hold',
    'ops_hold',p.enrichment_data->'ops_hold','scan_delivery_hold',p.enrichment_data->'scan_delivery_hold',
    'customer',p.enrichment_data->'customer','is_customer',p.enrichment_data->'is_customer',
    'followup_review',p.enrichment_data->'followup_review')),
  coalesce(h.history,'[]'::jsonb)
 from public.outreach_prospects p
 join public.outreach_campaigns c on c.id=p.campaign_id
 cross join lateral(
  select jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'message_type',m.message_type,
   'message_text',m.message_text,'sent_at',m.sent_at,'created_at',m.created_at,'is_reaction',m.is_reaction,
   'send_blocked_at',m.send_blocked_at,'send_blocked_reason',m.send_blocked_reason,
   'snoozed_until',m.snoozed_until,'ai_model',m.ai_model,'channel',m.channel,
   'unipile_message_id',m.unipile_message_id) order by m.created_at,m.id) history
  from public.outreach_messages m where m.prospect_id=p.id
 ) h
 where coalesce(c.client_id,'ivan') in ('ivan','risedtc','arch') and p.reply_count>0
  and p.blacklisted is not true and p.call_booked_at is null
  and p.stage in ('replied','positive_reply','dm_sent','connected')
  and p.skip_state is null and p.needs_manual_reply is not true
  and (p.skip_reason is null or p.skip_reason='follow_up_dated')
  and (p.icp_score>=case when c.client_id='risedtc' then 6 else 7 end or c.client_id='arch' and p.icp_score is null);
end;
$function$;
