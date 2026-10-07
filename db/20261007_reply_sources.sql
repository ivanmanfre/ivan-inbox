-- Additive read API. No source rows, shared views, RLS policies or existing RPCs change.
begin;
create schema reply_source_private;
revoke all on schema reply_source_private from public, anon, authenticated;
grant usage on schema reply_source_private to service_role;

create function reply_source_private.purpose(p_type text,p_model text,p_step integer,p_template_key text,p_template_step text)
returns jsonb language sql immutable set search_path=pg_catalog as $$
-- Fixed names from the 239 audited groups and the approved purpose rules, 2026-10-07.
with reviewed(model,step,touch) as (values
 ('arch_cameback_followup_v1',null,'followup'),
 ('arch_deliver',null,'requested_delivery'),
 ('arch_dm1_a',1,'dm1'),
 ('arch_dm1_b',1,'dm1'),
 ('arch_dm1_b_apps',1,'dm1'),
 ('arch_dm1_b_d2c',1,'dm1'),
 ('arch_dm1_b_games',1,'dm1'),
 ('arch_dm1_b_pc',1,'dm1'),
 ('arch_dm1_h_apps',1,'dm1'),
 ('arch_dm1_h_d2c',1,'dm1'),
 ('arch_dm1_h_games',1,'dm1'),
 ('arch_dm3_b',3,'dm3'),
 ('arch_followup_hand_2026-09-14',null,'followup'),
 ('arch_manual_follow_up_v1',null,'followup'),
 ('arch_nudge',2,'dm2'),
 ('arch_nudge_d2c',2,'dm2'),
 ('arch_reply_draft_v1',null,'conversation_reply'),
 ('arch_reply_draft_v1_ivan_edit_20260831',null,'conversation_reply'),
 ('arch_reply_draft_v2',null,'conversation_reply'),
 ('arch_reply_followup_dated_v1',null,'followup'),
 ('arch_stall_bump_ctx_v1',null,'followup'),
 ('audit_opener_v2',1,'dm1'),
 ('audit_opener_v2_reframe',1,'dm1'),
 ('audit_reframe_v1',1,'dm1'),
 ('content_system_bump_v1',3,'dm3'),
 ('content_system_bump_v2',3,'dm3'),
 ('content_system_bump_v2_plan',3,'dm3'),
 ('content_system_dm4_v1',4,'dm4'),
 ('content_system_followup_v1',2,'dm2'),
 ('content_system_followup_v2',2,'dm2'),
 ('content_system_followup_v3',2,'dm2'),
 ('content_system_hook_v1',1,'dm1'),
 ('content_system_wins_v1',1,'dm1'),
 ('content_system_wins_v1',2,'dm2'),
 ('hiring_economic_v1',1,'dm1'),
 ('ivan_cameback_followup_v1',null,'followup'),
 ('ivan_cameback_followup_v1_hand',null,'followup'),
 ('ivan_manual_reply_v1',null,'conversation_reply'),
 ('ivan_reopen_v1',null,'followup'),
 ('ivan_scope_reply_v1',null,'conversation_reply'),
 ('ivan_stall_bump_ctx_v1',null,'followup'),
 ('ivan_stall_bump_scan_delivery_v1',null,'followup'),
 ('manual/scan_delivery_nick_format',null,'requested_delivery'),
 ('manual_operator_scan_delivery',null,'requested_delivery'),
 ('profile_view_opener_v1',1,'dm1'),
 ('recycle_60d_v2',null,'recycle'),
 ('rise_dm1_comp_engager_v1',1,'dm1'),
 ('rise_dm1_comp_engager_v2roas',1,'dm1'),
 ('rise_dm1_comp_engager_v3',1,'dm1'),
 ('rise_dm1_engager_v11a',1,'dm1'),
 ('rise_dm1_partner_brand_v3',1,'dm1'),
 ('rise_dm1_partner_c_v1',1,'dm1'),
 ('rise_dm1_partner_nobrand_v3',1,'dm1'),
 ('rise_dm1_partner_soft_v1',1,'dm1'),
 ('rise_dm1_scan_offer_v1',1,'dm1'),
 ('rise_dm1_scan_offer_v2roas',1,'dm1'),
 ('rise_dm1_scan_offer_v3',1,'dm1'),
 ('rise_dm1_sharp_v10',1,'dm1'),
 ('rise_dm2_deliver_v2',null,'requested_delivery'),
 ('rise_dm2_model_ask_v1',2,'dm2'),
 ('rise_dm2_nudge_v1',2,'dm2'),
 ('rise_dm2_partner_c_v1',2,'dm2'),
 ('rise_dm2_partner_nudge_v2',2,'dm2'),
 ('rise_dm2_partner_overlap_v1',2,'dm2'),
 ('rise_dm2_scan_delivery_v1',null,'requested_delivery'),
 ('rise_dm3_final_v1',3,'dm3'),
 ('rise_dm3_model_ask_v1',3,'dm3'),
 ('rise_dm3_partner_c_v1',3,'dm3'),
 ('rise_dm4_v1',4,'dm4'),
 ('rise_followup_hand_2026-09-21',null,'followup'),
 ('rise_hand_followup_v1',null,'followup'),
 ('rise_manual_booking_followup_v1',null,'followup'),
 ('rise_reply_draft_v1',null,'conversation_reply'),
 ('rise_reply_email_v1',null,'conversation_reply'),
 ('rise_reply_manual_ivan',null,'conversation_reply'),
 ('rise_reply_partner_draft_v1',null,'conversation_reply'),
 ('rise_reply_politedecline_v1',null,'conversation_reply'),
 ('rise_reply_softdecline_v1',null,'conversation_reply'),
 ('rise_scan_email_delivery_v1',null,'requested_delivery'),
 ('rise_stall_bump_ctx_v1',null,'followup'),
 ('rise_stall_bump_time_ask_v1',null,'followup'),
 ('rise_stall_bump_v1',null,'followup'),
 ('room_census_wins_v1',1,'dm1'),
 ('stall_bump_v1',null,'followup'),
 ('template/agency_dm_v3_owned',1,'dm1'),
 ('template/agency_dm_v3_owned_a',1,'dm1'),
 ('template/agency_dm_v3_owned_a_a',1,'dm1'),
 ('template/agency_dm_v3_owned_a_d',1,'dm1'),
 ('template/agency_dm_v3_owned_a_h',1,'dm1'),
 ('template/agency_dm_v3_owned_a_i',1,'dm1'),
 ('template/agency_dm_v3_owned_a_j',1,'dm1'),
 ('template/agency_dm_v3_owned_b_a',1,'dm1'),
 ('template/agency_dm_v3_owned_b_d',1,'dm1'),
 ('template/agency_dm_v3_owned_b_h',1,'dm1'),
 ('template/agency_dm_v3_owned_b_i',1,'dm1'),
 ('template/agency_dm_v3_owned_b_j',1,'dm1'),
 ('template/agency_dm_v3_owned_d',1,'dm1'),
 ('template/agency_followup_v1',2,'dm2'),
 ('template/arch_inmail_openprofile_v1',1,'dm1'),
 ('template/arch_inmail_v1',1,'dm1'),
 ('template/gift_dm_v1',1,'dm1'),
 ('template/gift_dm_v2',1,'dm1'),
 ('template/inmail_audit_v1',1,'dm1'),
 ('template/inmail_content_v1',1,'dm1'),
 ('template/inmail_content_v1/voss',1,'dm1'),
 ('template/inmail_content_v1/want',1,'dm1'),
 ('template/inmail_content_v1/worth',1,'dm1'),
 ('template/inmail_kyle_warm_v1',1,'dm1'),
 ('template/inmail_orbit_hook_v2',1,'dm1'),
 ('template/inmail_orbit_warm_v1',1,'dm1'),
 ('template/inmail_scan_ask_v1/a',1,'dm1'),
 ('template/inmail_scan_ask_v1/b',1,'dm1'),
 ('template/inmail_wins_kyle_v1',1,'dm1'),
 ('template/inmail_wins_orbit_v1',1,'dm1'),
 ('template/inmail_wins_v1',1,'dm1'),
 ('template/ivan_feed_probe_v1_cold',1,'dm1'),
 ('template/ivan_feed_probe_v1_warm',1,'dm1'),
 ('template/ivan_feed_probe_v2_cold',1,'dm1'),
 ('template/ivan_feed_probe_v2_cold_pl',1,'dm1'),
 ('template/ivan_feed_probe_v2_followup',2,'dm2'),
 ('template/ivan_feed_probe_v2_warm',1,'dm1'),
 ('template/ivan_openprofile_orbit_hook_v2',1,'dm1'),
 ('template/ivan_openprofile_orbit_v1',1,'dm1'),
 ('template/ivan_openprofile_reviewed_v2',1,'dm1'),
 ('template/ivan_openprofile_scan_ask_v1/a',1,'dm1'),
 ('template/ivan_openprofile_scan_ask_v1/b',1,'dm1'),
 ('template/ivan_openprofile_v1/voss',1,'dm1'),
 ('template/ivan_openprofile_v1/want',1,'dm1'),
 ('template/ivan_openprofile_wins_orbit_v1',1,'dm1'),
 ('template/ivan_openprofile_wins_v1',1,'dm1'),
 ('template/rise_inmail_anchorless_a_v1',1,'dm1'),
 ('template/rise_inmail_anchorless_b_v1',1,'dm1'),
 ('template/rise_inmail_anchorless_casual_v1',1,'dm1'),
 ('template/rise_inmail_client_past_v1',1,'dm1'),
 ('template/rise_inmail_client_v1',1,'dm1'),
 ('template/rise_openprofile_v1',1,'dm1'),
 ('template/rise_openprofile_v1_b_v1',1,'dm1'),
 ('template/rise_openprofile_v1_casual_v1',1,'dm1'),
 ('warm_reply_auto_v1',null,'conversation_reply')
), evidence as (
 select case p_type when 'connection_note' then 'connection_note' when 'audit_delivery' then 'requested_delivery'
 when 'manual_reply' then 'conversation_reply' end type_touch,
 (select touch from reviewed where model=p_model and (step is null or step=p_step) limit 1) model_touch,
 case when nullif(btrim(p_template_key),'') is not null and
 ((p_template_step in ('dm1','dm2','dm3','dm4','dm5') and p_step=right(p_template_step,1)::integer)
 or (p_template_step='recycle' and p_step=4)) then p_template_step end template_touch
), resolved as (
 select *, case when p_model='template/dm3_bump_v1' and p_step=2 then true
 when type_touch is not null and model_touch is not null and type_touch<>model_touch then true
 when coalesce(type_touch,model_touch) is not null and nullif(btrim(p_template_key),'') is not null
 and p_template_step in ('connection_note','dm1','dm2','dm3','dm4','dm5','recycle','followup','conversation_reply','requested_delivery')
 and coalesce(type_touch,model_touch)<>p_template_step then true
 else false end conflict from evidence
)
select jsonb_build_object('touch',case when conflict then 'unknown' else coalesce(template_touch,type_touch,model_touch,
 case p_type when 'inmail' then 'inmail' when 'email' then 'email' else 'unknown' end) end,
 'purpose_basis',case when conflict then 'purpose_conflict' when template_touch is not null then 'recorded_template_current_metadata'
 when type_touch is not null then 'message_type' when model_touch is not null then 'reviewed_model' else 'unknown' end,
 'channel_family',case p_type when 'email' then 'email' when 'inmail' then 'linkedin' else 'unknown' end,
 'channel_product',case p_type when 'email' then 'email' when 'inmail' then 'inmail' else 'unknown' end)
from resolved;
$$;

create function reply_source_private.people(p_client_id text,p_as_of timestamptz)
returns table(prospect_id uuid,campaign_id uuid,person_key text,identity_basis text,identity_conflict boolean,excluded boolean)
language sql stable set search_path=pg_catalog as $$
with
roster as (
  select 'd'::text as kind, lower(btrim(x)) as key
    from jsonb_array_elements_text(coalesce((select value::jsonb from public.integration_config where key = 'rise_do_not_target'), '[]'::jsonb)) x
   where p_client_id = 'risedtc' and position('.' in x) > 0
  union
  select 'n', regexp_replace(lower(x), '[^a-z0-9]', '', 'g')
    from jsonb_array_elements_text(coalesce((select value::jsonb from public.integration_config where key = 'rise_do_not_target'), '[]'::jsonb)) x
   where p_client_id = 'risedtc' and position('.' in x) = 0 and length(regexp_replace(lower(x), '[^a-z0-9]', '', 'g')) >= 4
  union
  select 'n', regexp_replace(lower(nm), '[^a-z0-9]', '', 'g')
    from jsonb_array_elements(coalesce((select value::jsonb->'companies' from public.integration_config where key = 'arch_company_exclusions'), '[]'::jsonb)) e
   cross join lateral (select e->>'name' union all select e->>'slug' union all select jsonb_array_elements_text(coalesce(e->'aliases', '[]'::jsonb))) a(nm)
   where p_client_id = 'arch' and (coalesce(e->>'reason', '') ilike 'arch_client%' or e->>'reason' = 'arch_own_company')
     and length(regexp_replace(lower(nm), '[^a-z0-9]', '', 'g')) >= 4
  union
  select 'd', lower(btrim(nm))
    from jsonb_array_elements(coalesce((select value::jsonb->'companies' from public.integration_config where key = 'arch_company_exclusions'), '[]'::jsonb)) e
   cross join lateral jsonb_array_elements_text(coalesce(e->'aliases', '[]'::jsonb)) a(nm)
   where p_client_id = 'arch' and (coalesce(e->>'reason', '') ilike 'arch_client%' or e->>'reason' = 'arch_own_company') and position('.' in nm) > 0
  union
  select 'p', lower(e->>'slug')
    from jsonb_array_elements(coalesce((select value::jsonb->'people' from public.integration_config where key = 'arch_person_exclusions'), '[]'::jsonb)) e
   where p_client_id = 'arch' and e->>'reason' = 'arch_own_employee'
),
raw as (
 select p.*,c.name campaign_name,nullif(btrim(p.linkedin_profile_id),'') profile,
 case when lower(btrim(p.linkedin_url)) ~ '^(https?://)?(www[.])?linkedin[.]com/in/[^/?#]+/?([?#].*)?$'
 then regexp_replace(regexp_replace(regexp_replace(lower(btrim(p.linkedin_url)),'^(https?://)?(www[.])?',''),'[?#].*$',''),'/+$','') end url
 from public.outreach_prospects p join public.outreach_campaigns c on c.id=p.campaign_id
 join public.client_registry cr on cr.client_id=coalesce(c.client_id,'ivan') and cr.is_active
 where cr.client_id=p_client_id
), aliases as (
 select url,count(distinct profile) ids,min(profile) profile from raw where url is not null group by url
), identified as (
 select r.*,coalesce('profile:'||r.profile,case when a.ids=1 then 'profile:'||a.profile when coalesce(a.ids,0)<2 then 'url:'||r.url end,'record:'||r.id::text) person,
 case when r.profile is not null or a.ids=1 then 'profile' when r.url is not null and coalesce(a.ids,0)<2 then 'url' else 'record' end basis,
 coalesce(a.ids>1,false) conflict,
 (p_client_id='arch' and r.campaign_name ilike '%inbound request%')
 or exists(select 1 from public.audn_person_label_v o where o.is_operator and o.person_key=r.linkedin_profile_id)
 or exists(select 1 from roster x where
 (x.kind='d' and (x.key=public._bk_host(r.company_domain) or x.key=public._bk_email_domain(r.email)
 or position(x.key in lower(coalesce(r.headline,'')||' '||coalesce(r.title,'')))>0))
 or (x.kind='n' and (position(x.key in regexp_replace(lower(coalesce(r.company,'')),'[^a-z0-9]','','g'))>0
 or position(x.key in regexp_replace(lower(coalesce(r.headline,'')||' '||coalesce(r.title,'')),'[^a-z0-9]','','g'))>0))
 or (x.kind='p' and x.key=public.li_slug(r.linkedin_url))) staff,
 exists(select 1 from public.outreach_messages m where m.prospect_id=r.id and m.direction='inbound'
 and m.reply_intent='vendor_pitch' and coalesce(m.sent_at,m.created_at)<=p_as_of) vendor
 from raw r left join aliases a on a.url=r.url
), population as (
 select person,bool_or(staff) or (bool_or(vendor) and not bool_or(call_booked_at is not null)) excluded
 from identified group by person
)
select i.id,i.campaign_id,i.person,i.basis,i.conflict,p.excluded from identified i join population p on p.person=i.person;
$$;

-- Read all relevant history before period, campaign, and population filters.
create function reply_source_private.events(p_client_id text,p_as_of timestamptz)
returns table(event_id uuid,source_ids uuid[],prospect_id uuid,person_key text,identity_basis text,campaign_id uuid,
 event_at timestamptz,end_at timestamptz,direction text,is_text boolean,is_reaction boolean,touch text,sequence_step integer,
 purpose_basis text,channel_family text,channel_product text,channel_basis text,chat_id text,receipt text,
 confirmed boolean,uncertain_reason text,reply_intent text,duplicate_rows integer,excluded boolean)
language sql stable set search_path=pg_catalog as $$
with raw as materialized (
 select m.id,m.prospect_id,p.person_key,p.identity_basis,p.campaign_id,p.excluded,p.identity_conflict,
 coalesce(m.sent_at,m.created_at) event_at,m.direction,
 nullif(btrim(m.message_text),'') is not null and m.is_reaction is not true and m.message_type is distinct from 'connection_note' is_text,
 coalesce(m.is_reaction,false) is_reaction,case when cl->>'purpose_basis'='unknown' then 'unknown' else cl->>'touch' end touch,m.sequence_step,cl->>'purpose_basis' purpose_basis,
 case when lower(m.channel) in ('linkedin','inmail') then 'linkedin' when lower(m.channel)='email' then 'email'
 when nullif(btrim(m.channel),'') is null and m.message_type='inmail' then 'linkedin'
 when nullif(btrim(m.channel),'') is null and m.message_type='email' then 'email' else 'unknown' end family,
 case when lower(m.channel)='email' or m.message_type='email' then 'email'
 when lower(m.channel)='inmail' or m.message_type='inmail' then 'inmail'
 when lower(m.channel)='linkedin' then 'dm' else 'unknown' end product,
 nullif(btrim(m.unipile_chat_id),'') chat,nullif(btrim(m.unipile_message_id),'') receipt,
 m.sent_at is not null and nullif(btrim(m.unipile_message_id),'') is not null
 and m.send_blocked_at is null and nullif(btrim(m.send_blocked_reason),'') is null confirmed,
 m.send_blocked_at is not null or nullif(btrim(m.send_blocked_reason),'') is not null blocked,
 nullif(btrim(m.reply_intent),'') reply_intent,m.agent_action_id
 from public.outreach_messages m join reply_source_private.people(p_client_id,p_as_of) p on p.prospect_id=m.prospect_id
 left join lateral (
 select case when count(distinct t.step)=1 then min(t.step) end step from public.outreach_templates t
 where t.client_id=p_client_id and t.key=nullif(btrim(m.draft_evidence->>'template_key'),'')
 ) t on true
 cross join lateral reply_source_private.purpose(m.message_type,m.ai_model,m.sequence_step,m.draft_evidence->>'template_key',t.step) cl
 where coalesce(m.sent_at,m.created_at)<=p_as_of and (m.direction='inbound' or
 (m.direction='outbound' and (m.sent_at is not null or nullif(btrim(m.unipile_message_id),'') is not null)))
), receipt_conflicts as (
 select receipt,count(distinct person_key)>1 identities,
 count(distinct coalesce(chat,''))>1 or count(distinct family)>1 or count(distinct direction)>1 scope_conflict
 from raw where receipt is not null group by receipt
), receipts as (
 select (array_agg(r.id order by (r.touch<>'unknown') desc,r.id))[1] id,array_agg(r.id order by r.id) source_ids,
 (array_agg(r.prospect_id order by (r.touch<>'unknown') desc,r.id))[1] prospect_id,r.person_key,min(r.identity_basis) identity_basis,
 (array_agg(r.campaign_id order by (r.touch<>'unknown') desc,r.id))[1] campaign_id,
 coalesce(min(r.event_at) filter(where r.confirmed),min(r.event_at)) event_at,
 coalesce(max(r.event_at) filter(where r.confirmed),max(r.event_at)) end_at,r.direction,bool_or(r.is_text) is_text,bool_or(r.is_reaction) is_reaction,
 case when count(distinct r.touch) filter(where r.touch<>'unknown')>1 then 'unknown'
 else coalesce(min(r.touch) filter(where r.touch<>'unknown'),'unknown') end touch,
 case when count(distinct r.sequence_step)=1 then min(r.sequence_step) end sequence_step,
 case when count(distinct r.touch) filter(where r.touch<>'unknown')>1 then 'purpose_conflict'
 else (array_agg(r.purpose_basis order by (r.touch<>'unknown') desc,r.id))[1] end purpose_basis,
 r.family,(array_agg(r.product order by (r.touch<>'unknown') desc,r.id))[1] product,r.chat,r.receipt,
 bool_or(r.confirmed) and not bool_or(r.blocked) and not coalesce(bool_or(c.identities or c.scope_conflict),false) confirmed,
 case when bool_or(c.identities) then 'receipt_identity_conflict' when bool_or(c.scope_conflict) then 'receipt_scope_conflict'
 when bool_or(r.blocked) then 'blocked_or_partial' when not bool_or(r.confirmed) and r.direction='outbound' then 'missing_delivery_evidence' end uncertain_reason,
 case when count(distinct r.reply_intent)=1 then min(r.reply_intent) end reply_intent,
 (count(*)-1)::integer duplicate_rows,bool_or(r.excluded) excluded,
 case when count(distinct r.agent_action_id)=1 then (array_agg(r.agent_action_id) filter(where r.agent_action_id is not null))[1] end action_id
 from raw r left join receipt_conflicts c on c.receipt=r.receipt
 group by r.person_key,r.direction,r.family,r.chat,r.receipt,case when r.receipt is null then r.id end
), action_conflicts as (
 select action_id,count(distinct person_key)>1 or count(distinct coalesce(chat,''))>1 or count(distinct family)>1
 or count(distinct touch) filter(where touch<>'unknown')>1 or bool_or(purpose_basis='purpose_conflict') conflict
 from receipts where action_id is not null group by action_id
), grouped as (
 select (array_agg(r.id order by r.event_at,r.id))[1] event_id,
 array_agg(r.id) receipt_ids,(array_agg(r.prospect_id order by r.event_at,r.id))[1] prospect_id,r.person_key,min(r.identity_basis) identity_basis,
 (array_agg(r.campaign_id order by r.event_at,r.id))[1] campaign_id,min(r.event_at) event_at,max(r.end_at) end_at,r.direction,
 bool_or(r.is_text) is_text,bool_or(r.is_reaction) is_reaction,
 case when bool_or(a.conflict) or count(distinct r.touch) filter(where r.touch<>'unknown')>1 then 'unknown'
 else coalesce(min(r.touch) filter(where r.touch<>'unknown'),'unknown') end touch,
 case when count(distinct r.sequence_step)=1 then min(r.sequence_step) end sequence_step,
 case when bool_or(a.conflict) then 'purpose_conflict' else (array_agg(r.purpose_basis order by (r.touch<>'unknown') desc,r.id))[1] end purpose_basis,
 r.family,r.product,r.chat,min(r.receipt) receipt,bool_and(r.confirmed) and not coalesce(bool_or(a.conflict),false) confirmed,
 case when bool_or(a.conflict) then 'action_conflict' else min(r.uncertain_reason) end uncertain_reason,
 case when count(distinct r.reply_intent)=1 then min(r.reply_intent) end reply_intent,
 sum(r.duplicate_rows)::integer duplicate_rows,bool_or(r.excluded) excluded
 from receipts r left join action_conflicts a on a.action_id=r.action_id
 group by r.person_key,r.direction,r.family,r.product,r.chat,
 case when r.direction='outbound' and r.action_id is not null then r.action_id else r.id end
)
select g.event_id,(select array_agg(s order by s) from receipts r cross join lateral unnest(r.source_ids) s where r.id=any(g.receipt_ids)),
 g.prospect_id,g.person_key,g.identity_basis,g.campaign_id,g.event_at,g.end_at,g.direction,g.is_text,g.is_reaction,
 case when g.touch='unknown' and g.purpose_basis<>'purpose_conflict' and g.product in ('email','inmail') then g.product else g.touch end,
 g.sequence_step,g.purpose_basis,g.family,g.product,case when g.family='unknown' then 'unknown' else 'recorded' end,
 g.chat,g.receipt,g.confirmed,g.uncertain_reason,g.reply_intent,g.duplicate_rows,g.excluded from grouped g;
$$;

-- One inbound time group per person. Equal earliest times never establish provider order.
create function reply_source_private.replies(p_client_id text,p_as_of timestamptz)
returns table(person_key text,prospect_id uuid,reply_id uuid,reply_at timestamptz,reply_intent text,
 campaign_id uuid,source_id uuid,source_at timestamptz,touch text,is_first boolean,source jsonb)
language sql stable set search_path=pg_catalog as $$
with e as materialized (select * from reply_source_private.events(p_client_id,p_as_of)),
ins as (
 select person_key,event_at,(array_agg(event_id order by event_id))[1] id,
 count(*) tie_count,case when count(distinct reply_intent)=1 and bool_and(reply_intent is not null) then min(reply_intent) end intent,
 row_number() over(partition by person_key order by event_at)=1 first
 from e where direction='inbound' and is_text and not is_reaction and not excluded group by person_key,event_at
), candidates as (
 select i.*,r.prospect_id,r.campaign_id inbound_campaign,r.chat_id,r.channel_family inbound_family,r.uncertain_reason inbound_conflict,
 o.event_id outbound_id,o.event_at sent_at,o.end_at,o.campaign_id outbound_campaign,o.touch,o.sequence_step,o.confirmed,o.uncertain_reason,
 o.channel_family outbound_family,o.channel_product,o.chat_id outbound_chat,c.families,c.family,
 (select count(*) from e t where t.person_key=i.person_key and t.direction='outbound' and t.end_at=o.end_at
 and (t.chat_id=r.chat_id or t.chat_id is null or r.chat_id is null)) outbound_ties
 from ins i join e r on r.event_id=i.id
 left join lateral (
 select * from e x where x.person_key=i.person_key and x.direction='outbound' and x.event_at<=i.event_at
 and (x.chat_id=r.chat_id or r.chat_id is null or (x.chat_id is null and
 (x.channel_family='unknown' or r.channel_family='unknown' or x.channel_family=r.channel_family)))
 order by x.end_at desc,x.event_id limit 1
 ) o on true
 left join lateral (
 select count(distinct channel_family) filter(where channel_family<>'unknown') families,
 min(channel_family) filter(where channel_family<>'unknown') family from e x
 where x.person_key=i.person_key and x.chat_id=r.chat_id
 ) c on true
), resolved as (
 select *,case when tie_count>1 then 'reply_time_tie' when inbound_conflict is not null then inbound_conflict when chat_id is null then 'missing_chat'
 when outbound_id is null then 'no_prior_send' when outbound_chat is null then 'unlocated_later_send'
 when outbound_ties>1 or sent_at=event_at then 'outbound_time_tie' when end_at>=event_at then 'unfinished_action'
 when families>1 then 'channel_conflict'
 when inbound_family<>'unknown' and outbound_family<>'unknown' and inbound_family<>outbound_family then 'channel_conflict'
 when coalesce(family,'unknown')='unknown' then 'unknown_channel'
 when not confirmed then coalesce(uncertain_reason,'uncertain_send')
 else null end reason from candidates
)
select person_key,prospect_id,id,event_at,intent,case when reason is null then outbound_campaign else inbound_campaign end,
 case when reason is null then outbound_id end,case when reason is null then sent_at end,
 case when reason is null then touch else 'unknown' end,first,
 jsonb_build_object('reply_id',id,'reply_at',event_at,'source_id',case when reason is null then outbound_id end,
 'sent_at',case when reason is null then sent_at end,'touch',case when reason is null then touch else 'unknown' end,
 'sequence_step',case when reason is null then sequence_step end,
 'campaign_id',case when reason is null then outbound_campaign else inbound_campaign end,
 'method',case when reason is null then 'inferred_same_chat' else 'unknown' end,'reason',reason,
 'channel',case when reason is null then family else 'unknown' end,
 'product',case when reason is null then channel_product else 'unknown' end,
 'channel_basis',case when reason is not null then 'unknown' when inbound_family='unknown' or outbound_family='unknown' then 'chat_inferred' else 'recorded' end,
 'followup_ordinal',null,'episode_outcome',null)
from resolved;
$$;

create function reply_source_private.followup_events(p_client_id text,p_as_of timestamptz)
returns table(event_id uuid,person_key text,campaign_id uuid,event_at timestamptz,episode_id uuid,ordinal integer,
 reply_id uuid,reply_at timestamptz,outcome text)
language sql stable set search_path=pg_catalog as $$
with e as materialized(select * from reply_source_private.events(p_client_id,p_as_of)),
 r as materialized(select * from reply_source_private.replies(p_client_id,p_as_of)),
 f as (
 select o.*,prev.event_id episode_id,prev.event_at episode_at,nxt.event_id next_id,nxt.event_at next_at
 from e o
 join lateral(select * from e i where i.person_key=o.person_key and i.chat_id=o.chat_id and i.direction='inbound'
 and i.is_text and not i.is_reaction and i.event_at<o.event_at order by i.event_at desc,i.event_id limit 1) prev on true
 left join lateral(select * from e i where i.person_key=o.person_key and i.chat_id=o.chat_id and i.direction='inbound'
 and i.is_text and not i.is_reaction and i.event_at>=o.event_at order by i.event_at,i.event_id limit 1) nxt on true
 where o.direction='outbound' and o.touch='followup' and not o.excluded and o.chat_id is not null
), numbered as (
 select f.*,
 case when not f.confirmed or exists(select 1 from e x where x.person_key=f.person_key and x.direction='outbound'
 and (x.chat_id=f.chat_id or x.chat_id is null) and x.event_at>f.episode_at and x.event_at<=f.event_at
 and (not x.confirmed or x.purpose_basis in ('unknown','purpose_conflict') or x.touch='unknown' or (x.event_at=f.event_at and x.event_id<>f.event_id))) then null
 else (select count(*)::integer from f f2 where f2.person_key=f.person_key and f2.chat_id=f.chat_id
 and f2.episode_id=f.episode_id and f2.event_at<=f.event_at) end ordinal
 from f
)
select n.event_id,n.person_key,n.campaign_id,n.event_at,n.episode_id,n.ordinal,r.reply_id,r.reply_at,
 case when n.ordinal is null or exists(select 1 from e x where x.person_key=n.person_key and x.direction='outbound'
 and (x.chat_id=n.chat_id or x.chat_id is null) and x.event_at>n.episode_at and x.event_at<=coalesce(n.next_at,p_as_of)
 and (not x.confirmed or x.purpose_basis in ('unknown','purpose_conflict') or x.touch='unknown')) then 'unknown' when n.next_id is null then null
 when r.source_id=n.event_id and r.touch='followup' then 'replied'
 when r.source_id is null or exists(select 1 from numbered x where x.episode_id=n.episode_id and x.ordinal is null) then 'unknown'
 when r.touch='conversation_reply' then 'interrupted' else null end
from numbered n left join r on r.person_key=n.person_key and r.reply_at=n.next_at;
$$;

create function reply_source_private.payload(p_client_id text,p_days integer,p_campaign_id uuid,p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog set timezone='UTC' as $$
declare result jsonb;
begin
 if p_days is null or p_days not in (7,30,90) then raise exception 'invalid_days' using errcode='22023'; end if;
 if not exists(select 1 from public.client_registry where client_id=p_client_id and is_active) then
 raise exception 'client_denied' using errcode='42501'; end if;
 if p_campaign_id is not null and not exists(select 1 from public.outreach_campaigns where id=p_campaign_id and coalesce(client_id,'ivan')=p_client_id) then
 raise exception 'campaign_denied' using errcode='42501'; end if;
 if not exists(select 1 from public.outreach_campaigns where coalesce(client_id,'ivan')=p_client_id) then return null; end if;
 with e as materialized(select * from reply_source_private.events(p_client_id,p_as_of)),
 people as materialized(select * from reply_source_private.people(p_client_id,p_as_of)),
 r as materialized(select * from reply_source_private.replies(p_client_id,p_as_of)),
 f as materialized(select * from reply_source_private.followup_events(p_client_id,p_as_of)),
 touches(touch,position) as (select t,ord from unnest(array['connection_note','dm1','dm2','dm3','dm4','dm5','recycle','followup','conversation_reply','requested_delivery','inmail','email','unknown']) with ordinality x(t,ord)),
 period_replies as (
 select * from r where is_first and reply_at>p_as_of-make_interval(days=>p_days)
 and (p_campaign_id is null or campaign_id=p_campaign_id)
 ), sends as (
 select * from e where direction='outbound' and confirmed and not excluded
 and event_at>p_as_of-make_interval(days=>p_days) and (p_campaign_id is null or campaign_id=p_campaign_id)
 ), eligible as (
 select s.* from sends s where not exists(select 1 from r where r.person_key=s.person_key and r.reply_at<=s.event_at)
 ), units as (
 select person_key,touch,min(event_at) anchor_at,count(*)-1 repeated from eligible group by person_key,touch
 ), outcomes as (
 select u.*,u.anchor_at+interval '7 days'<=p_as_of mature,
 r.reply_at>u.anchor_at and r.reply_at<=u.anchor_at+interval '7 days'
 and r.reply_at>r.source_at and r.reply_at<=r.source_at+interval '7 days' on_time,
 r.reply_at>u.anchor_at+interval '7 days' late
 from units u left join r on r.person_key=u.person_key and r.is_first and r.touch=u.touch
 and exists(select 1 from eligible s where s.person_key=u.person_key and s.touch=u.touch and s.event_id=r.source_id)
 ), followups as (
 select * from f where event_at>p_as_of-make_interval(days=>p_days) and (p_campaign_id is null or campaign_id=p_campaign_id)
 ), source_rows as (
 select t.position,jsonb_build_object('touch',t.touch,'responders',count(r.person_key),
 'positive',count(*) filter(where r.reply_intent in ('positive','soft_yes','booking','price_ask','info_ask')),
 'unclassified',count(*) filter(where r.person_key is not null and r.reply_intent is null),
 'share_pct',100.0*count(r.person_key)/nullif((select count(*) from period_replies),0)) value
 from touches t left join period_replies r on r.touch=t.touch group by t.touch,t.position
 ), touch_rows as (
 select t.position,jsonb_build_object('touch',t.touch,
 'sends',(select count(*) from sends s where s.touch=t.touch),
 'recipients',(select count(distinct person_key) from sends s where s.touch=t.touch),
 'eligible',count(o.person_key),'mature',count(*) filter(where o.mature),'pending',count(*) filter(where not o.mature),
 'replies_7d',count(*) filter(where o.mature and o.on_time),
 'rate_pct',100.0*count(*) filter(where o.mature and o.on_time)/nullif(count(*) filter(where o.mature),0),
 'late',count(*) filter(where o.mature and o.late),'repeated',coalesce(sum(o.repeated),0)) value
 from touches t left join outcomes o on o.touch=t.touch group by t.touch,t.position
 ), followup_rows as (
 select ordinal,jsonb_build_object('ordinal',ordinal,'episodes',count(*),
 'responders',count(distinct person_key) filter(where outcome='replied'),
 'mature',count(*) filter(where event_at+interval '7 days'<=p_as_of),
 'pending',count(*) filter(where event_at+interval '7 days'>p_as_of),
 'replies_7d',count(*) filter(where outcome='replied' and event_at+interval '7 days'<=p_as_of and reply_at>event_at and reply_at<=event_at+interval '7 days'),
 'rate_pct',100.0*count(*) filter(where outcome='replied' and event_at+interval '7 days'<=p_as_of and reply_at>event_at and reply_at<=event_at+interval '7 days')/
 nullif(count(*) filter(where event_at+interval '7 days'<=p_as_of),0),
 'late',count(*) filter(where outcome='replied' and event_at+interval '7 days'<=p_as_of and reply_at>event_at+interval '7 days')) value
 from followups where ordinal is not null group by ordinal
 )
 select jsonb_build_object('schema_version',1,'client_id',p_client_id,'as_of',p_as_of,'configured',true,
 'period',jsonb_build_object('days',p_days,'from',p_as_of-make_interval(days=>p_days),'to',p_as_of,'basis','rolling_utc','observation_days',7),
 'coverage',jsonb_build_object('history_complete',false,'first_event_at',(select min(event_at) from e where not excluded),
 'feature_started_on','2026-10-07','classifier_version','reply-touch-v1','seat_basis','registered_client_lane',
 'campaign_basis','current_prospect_membership','population_basis','message_history_v1','unknown_campaign_basis','inbound_current_campaign',
 'record_identities',(select count(distinct person_key) from people where identity_basis='record' and not excluded),
 'excluded_people',(select count(distinct person_key) from people where excluded),
 'missing_receipts',(select count(*) from e where direction='outbound' and receipt is null and not excluded),
 'uncertain_sends',(select count(*) from e where direction='outbound' and not confirmed and not excluded),
 'duplicate_rows',(select coalesce(sum(duplicate_rows),0) from e where not excluded),
 'identity_conflicts',(select count(distinct person_key) from people where identity_conflict and not excluded)+(select count(*) from e where uncertain_reason in ('receipt_identity_conflict','action_conflict') and not excluded),
 'missing_chats',(select count(*) from e where chat_id is null and not excluded),
 'channel_conflicts',(select count(*) from (select person_key,chat_id from e where chat_id is not null and not excluded group by person_key,chat_id having count(distinct channel_family) filter(where channel_family<>'unknown')>1) x),
 'unknown_purpose',(select count(*) from e where direction='outbound' and touch='unknown' and not excluded),
 'unknown_sources',(select count(*) from period_replies where source_id is null or touch='unknown'),
 'unknown_episodes',(select count(distinct episode_id) from followups where outcome='unknown' or ordinal is null),
 'interrupted_episodes',(select count(distinct episode_id) from followups where outcome='interrupted'),
 'current_template_purpose',(select count(*) from e where direction='outbound' and purpose_basis='recorded_template_current_metadata' and not excluded)),
 'totals',jsonb_build_object('first_responders',(select count(distinct person_key) from period_replies),
 'recipients',(select count(distinct person_key) from sends),
 'reactions',(select count(distinct person_key) from e where direction='inbound' and is_reaction and not excluded
 and event_at>p_as_of-make_interval(days=>p_days) and (p_campaign_id is null or campaign_id=p_campaign_id)),
 'followup_responders',(select count(distinct person_key) from followups where outcome='replied' and ordinal is not null)),
 'sources',(select jsonb_agg(value order by position) from source_rows),
 'touches',(select jsonb_agg(value order by position) from touch_rows),
 'followups',coalesce((select jsonb_agg(value order by ordinal) from followup_rows),'[]'::jsonb)) into result;
 return result;
end;
$$;

create function reply_source_private.detail(p_client_id text,p_prospect_id uuid,p_as_of timestamptz)
returns jsonb language sql stable set search_path=pg_catalog as $$
with p as (select * from reply_source_private.people(p_client_id,p_as_of) where prospect_id=p_prospect_id and not excluded),
 r as (select * from reply_source_private.replies(p_client_id,p_as_of) where person_key=(select person_key from p)),
 f as (select * from reply_source_private.followup_events(p_client_id,p_as_of)),
 enriched as (
 select r.reply_at,r.reply_id,r.source||jsonb_build_object('followup_ordinal',
 (select ordinal from f where f.event_id=r.source_id and f.outcome='replied'),
 'episode_outcome',case when exists(select 1 from f where f.reply_id=r.reply_id and (f.outcome='unknown' or f.ordinal is null)) then 'unknown'
 when exists(select 1 from f where f.reply_id=r.reply_id and f.outcome='interrupted') then 'interrupted'
 when exists(select 1 from f where f.event_id=r.source_id and f.outcome='replied') then 'replied' end) source from r
)
select case when exists(select 1 from p) then jsonb_build_object('schema_version',1,'as_of',p_as_of,
 'first_reply',(select source from enriched order by reply_at,reply_id limit 1),
 'latest_reply',(select source from enriched order by reply_at desc,reply_id desc limit 1)) end;
$$;

-- One envelope for operator and board reads. Only authenticated wrappers call this helper.
create function reply_source_private.read_result(p_client_id text,p_days integer,p_campaign_id uuid,p_prospect_id uuid,p_detail boolean,p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not exists(select 1 from public.client_registry where client_id=p_client_id and is_active) then
 raise exception 'client_denied' using errcode='42501'; end if;
 if p_detail then
  if not exists(select 1 from public.outreach_prospects p join public.outreach_campaigns c on c.id=p.campaign_id
   where p.id=p_prospect_id and coalesce(c.client_id,'ivan')=p_client_id) then
   raise exception 'prospect_denied' using errcode='42501'; end if;
  result:=reply_source_private.detail(p_client_id,p_prospect_id,p_as_of);
  return jsonb_build_object('status',case when result is null then 'not_found' else 'ok' end,'data',result);
 end if;
 result:=reply_source_private.payload(p_client_id,p_days,p_campaign_id,p_as_of);
 return jsonb_build_object('status',case when result is null then 'not_configured' else 'ok' end,'data',result);
end;
$$;

create function reply_source_private.board_read(p_slug text,p_credential text,p_session boolean,p_days integer,p_prospect_id uuid,p_detail boolean,p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare b public.client_boards%rowtype;
begin
 if nullif(btrim(p_slug),'') is null or nullif(btrim(p_credential),'') is null then
 raise exception 'board_denied' using errcode='42501'; end if;
 if p_session and not exists(select 1 from public.client_board_sessions s where s.slug=p_slug
 and s.token_hash=encode(extensions.digest(p_credential,'sha256'),'hex')
 and s.revoked_at is null and s.expires_at>p_as_of) then
 raise exception 'board_denied' using errcode='42501'; end if;
 select * into b from public.client_boards where slug=p_slug and (p_session or token=p_credential)
 and (expires_at is null or expires_at>p_as_of);
 if not found then raise exception 'board_denied' using errcode='42501'; end if;
 if b.client_id is not null and not exists(select 1 from public.client_registry where client_id=b.client_id and is_active) then
 raise exception 'client_denied' using errcode='42501'; end if;
 if not p_detail and (p_days is null or p_days not in (7,30,90)) then raise exception 'invalid_days' using errcode='22023'; end if;
 if b.mode in ('preview','generating') then return jsonb_build_object('status','preview','data',null); end if;
 if b.mode is distinct from 'live' then raise exception 'board_denied' using errcode='42501'; end if;
 if b.client_id is null then return jsonb_build_object('status','not_configured','data',null); end if;
 return reply_source_private.read_result(b.client_id,p_days,null,p_prospect_id,p_detail,p_as_of);
end;
$$;

create function public.outreach_reply_sources(p_client_id text,p_days integer default 30,p_campaign_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare as_of timestamptz:=statement_timestamp();
begin
 if auth.role() is distinct from 'service_role' and not exists(
 select 1 from public.outreach_agent_accounts a where a.client_id='ivan' and auth.uid()=any(a.operator_ids)
 ) then raise exception 'operator_denied' using errcode='42501'; end if;
 return reply_source_private.read_result(p_client_id,p_days,p_campaign_id,null,false,as_of);
end;
$$;

create function public.inbox_reply_source(p_prospect_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare as_of timestamptz:=statement_timestamp(); cid text;
begin
 if auth.role() is distinct from 'service_role' and not exists(
 select 1 from public.outreach_agent_accounts a where a.client_id='ivan' and auth.uid()=any(a.operator_ids)
 ) then raise exception 'operator_denied' using errcode='42501'; end if;
 select coalesce(c.client_id,'ivan') into cid from public.outreach_prospects p join public.outreach_campaigns c on c.id=p.campaign_id where p.id=p_prospect_id;
 if not found then return jsonb_build_object('status','not_found','data',null); end if;
 return reply_source_private.read_result(cid,30,null,p_prospect_id,true,as_of);
end;
$$;

create function public.client_board_reply_sources(p_slug text,p_token text,p_days integer default 30)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select reply_source_private.board_read(p_slug,p_token,false,p_days,null,false,statement_timestamp());
$$;

create function public.client_board_reply_source(p_slug text,p_token text,p_prospect_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select reply_source_private.board_read(p_slug,p_token,false,30,p_prospect_id,true,statement_timestamp());
$$;

create function public.client_board_reply_sources_v2(p_slug text,p_session text,p_days integer default 30)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select reply_source_private.board_read(p_slug,p_session,true,p_days,null,false,statement_timestamp());
$$;

create function public.client_board_reply_source_v2(p_slug text,p_session text,p_prospect_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select reply_source_private.board_read(p_slug,p_session,true,30,p_prospect_id,true,statement_timestamp());
$$;

revoke all on function reply_source_private.purpose(text,text,integer,text,text) from public,anon,authenticated;
grant execute on function reply_source_private.purpose(text,text,integer,text,text) to service_role;

revoke all on function reply_source_private.people(text,timestamptz) from public,anon,authenticated;
grant execute on function reply_source_private.people(text,timestamptz) to service_role;

revoke all on function reply_source_private.events(text,timestamptz) from public,anon,authenticated;
grant execute on function reply_source_private.events(text,timestamptz) to service_role;

revoke all on function reply_source_private.replies(text,timestamptz) from public,anon,authenticated;
grant execute on function reply_source_private.replies(text,timestamptz) to service_role;

revoke all on function reply_source_private.followup_events(text,timestamptz) from public,anon,authenticated;
grant execute on function reply_source_private.followup_events(text,timestamptz) to service_role;

revoke all on function reply_source_private.payload(text,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function reply_source_private.payload(text,integer,uuid,timestamptz) to service_role;

revoke all on function reply_source_private.detail(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function reply_source_private.detail(text,uuid,timestamptz) to service_role;

revoke all on function reply_source_private.read_result(text,integer,uuid,uuid,boolean,timestamptz) from public,anon,authenticated;
grant execute on function reply_source_private.read_result(text,integer,uuid,uuid,boolean,timestamptz) to service_role;

revoke all on function reply_source_private.board_read(text,text,boolean,integer,uuid,boolean,timestamptz) from public,anon,authenticated;
grant execute on function reply_source_private.board_read(text,text,boolean,integer,uuid,boolean,timestamptz) to service_role;

revoke all on function public.outreach_reply_sources(text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.outreach_reply_sources(text,integer,uuid) to authenticated,service_role;

revoke all on function public.inbox_reply_source(uuid) from public,anon,authenticated,service_role;
grant execute on function public.inbox_reply_source(uuid) to authenticated,service_role;

revoke all on function public.client_board_reply_sources(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.client_board_reply_sources(text,text,integer) to anon,authenticated,service_role;

revoke all on function public.client_board_reply_source(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.client_board_reply_source(text,text,uuid) to anon,authenticated,service_role;

revoke all on function public.client_board_reply_sources_v2(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.client_board_reply_sources_v2(text,text,integer) to anon,authenticated,service_role;

revoke all on function public.client_board_reply_source_v2(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.client_board_reply_source_v2(text,text,uuid) to anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
