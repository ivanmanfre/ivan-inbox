-- 2026-11-17 speed pass: inbox_followup_sources reads enrichment_data ONCE per prospect. NOT APPLIED: for review.
--
-- Why. The DMs page calls this on every open (3-4 s in the browser). It returns ~400 prospects, and its
-- jsonb_build_object reads p.enrichment_data twelve times per row; Postgres detoasts the whole jsonb for each
-- read. EXPLAIN ANALYZE of the body (2026-11-17): 1165 ms, 1263 ms, 1159 ms, of which ~1.1 s is that projection
-- (the scans and the per-prospect history together are ~100 ms).
--
-- What. The same function, same signature, same operator check, same rows. A lateral
-- `(select p.enrichment_data || '{}'::jsonb as ed offset 0) e` makes one detoasted copy per row and the
-- projection reads `e.ed`. `|| '{}'` keeps NULL as NULL and adds nothing to an object.
-- Measured on the live data, old body vs new body: identical md5 over every row, 1.16-1.26 s -> 0.20-0.22 s.
-- Grants (authenticated, service_role) and SECURITY DEFINER stay as they are (CREATE OR REPLACE keeps both).

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
    'copy_hold',e.ed->'copy_hold','lang_hold',e.ed->'lang_hold',
    'qualification_hold',e.ed->'qualification_hold','ledger_hold',e.ed->'ledger_hold',
    'person_hold',e.ed->'person_hold','reply_hold',e.ed->'reply_hold',
    'ops_hold',e.ed->'ops_hold','scan_delivery_hold',e.ed->'scan_delivery_hold',
    'customer',e.ed->'customer','is_customer',e.ed->'is_customer',
    'followup_review',case when jsonb_typeof(e.ed->'followup_review')='object' then (e.ed->'followup_review') #- '{verdict,review_context}' else e.ed->'followup_review' end)),
  coalesce(h.history,'[]'::jsonb)
 from public.outreach_prospects p
 join public.outreach_campaigns c on c.id=p.campaign_id
 cross join lateral (select p.enrichment_data || '{}'::jsonb as ed offset 0) e
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
