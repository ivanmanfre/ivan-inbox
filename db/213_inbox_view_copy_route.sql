-- db/213 — thread list carries the COPY ROUTE each ARCH person is on, next to the lane tag (db/212).
-- Ivan, 2026-09-24: "not all i want tho also the path they take in regarding to copy lane, like there
-- are some going for apps, something games... but others also use the market narrowing or something
-- or other strategies".
--
-- READ-ONLY DERIVATION. No n8n workflow is touched (the senders are objects of a staged release that
-- refuses to apply on drift). Everything below reads what the senders already write:
--
--   SENT (what was actually used), per outbound row with sent_at and no send_blocked_at:
--     * draft_evidence->>'template_key'   DM Sequencer xEA3keC1tJYmcKkO + InMail Sender FwPZdGj0nsok7xMm
--                                         (InMail only since 2026-09-17; DM since the 09-16 release)
--     * ai_model = 'arch_' || key         DM Sequencer, every DM it ever sent
--     * connection_note ai_model          Connection Sender 9FpJ1cUqoEPTCeP2 ('arch_<note>_v1' / 'arch_blank*')
--     * message TEXT, only where no key exists: InMails before 09-17 ('template/arch_inmail_v1' carries no
--       variant) and 'manual_mirror' rows (the seat mirror, which re-records template sends as well as
--       Davorin's own hand messages). Matched on each ratified body's distinctive line.
--   Precedence over all sent rows: EU expansion > Audit offer > Sponsor door > vertical of the earliest
--   vertical opener (Apps/Games/PC/D2C) > Generic (retired dm1_b/inmail_body) > Custom (only hand /
--   reply-drafter messages). A custom strategy used at ANY point is the path the person is on; the
--   vertical default is what they get when no custom strategy applies.
--
--   NEXT (nothing route-bearing sent yet): a pending unsent draft's route if one exists, else the live
--   selector's step-1 pick replicated from the pulled node code (06-approach/pulled/*.cjs,
--   03-replay/code-v6/{approach,audit-offer}.cjs): copy vertical (archCopyVertical, same logic),
--   audit offer when a suitable verified artifact exists (auditSuitability + selectOffer row gates),
--   EU expansion only for the reviewed pilot companies with operator receipts (archApproachDecision),
--   sponsor door when a sponsor-lane invite would carry the sponsor note (connectNoteSelect). A person who
--   has written back gets 'custom' (the reply drafter / a hand reply answers, not a template).
--
--   "Markets question" (the asia_hq ask-markets opener) has NO template in outreach_templates and no branch
--   in any of the three senders as of 2026-09-24 (pulled read-only, grep asia_hq = 0 in all three), so
--   this function never emits it; the app keeps a label for it so the day it ships only this file changes.
--
-- Value shape: '<sent|next>:<route>[:<invite note arm>]', e.g. 'sent:games:engager', 'next:apps:blank',
-- 'sent:audit_offer'. Routes: eu_expansion, audit_offer, sponsor_door, apps, games, pc, d2c, generic,
-- custom, hold (copy vertical unknown / copy_hold: the sender would hold, not send).
--
-- SET-BASED, ONE PLAN PER PAGE QUERY. inbox_arch_copy_route_v computes the route for every ARCH prospect
-- that has a message in one grouped pass over their messages (~1.2k rows); inbox_messages_v LEFT JOINs it
-- and gains ONE column at the end (CREATE OR REPLACE VIEW stays legal). A per-row function was tried
-- first and rejected: a non-inlined SQL function is re-planned on every call (2.5 ms x ~1,150 ARCH rows
-- pushed a 1,000-row page from 0.9 s to 2.1 s). The helpers below are pure expressions so the planner
-- inlines them.

create or replace function public._inbox_try_ts(v text) returns timestamptz
language plpgsql stable as $$
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return v::timestamptz;
exception when others then return null;
end $$;

-- archAuditSlugify (audit-offer.cjs)
create or replace function public._inbox_audit_slug(v text) returns text
language plpgsql immutable as $$
declare s text := lower(btrim(coalesce(v, ''))); t text;
begin
  if s = '' then return ''; end if;
  s := regexp_replace(regexp_replace(s, '^https?://', ''), '^www\.', '');
  for i in 1..4 loop
    t := btrim(regexp_replace(regexp_replace(s, '[\s,.]*\y(inc|llc|ltd|limited|gmbh|pte|bv|b\.v|ab|oy|as|sa|srl|s\.r\.l|co)\.?$', '', 'i'), '[.\s]+$', ''));
    exit when t = s;
    s := t;
  end loop;
  return btrim(regexp_replace(s, '[^a-z0-9]+', '-', 'g'), '-');
end $$;

-- enrichment_data vertical value, as archCopyVertical reads it: ed.vertical || ed.gate.vertical || ed.company_vertical
create or replace function public._inbox_vertical_value(ed jsonb) returns text
language sql immutable as $$
  select lower(btrim(coalesce(
      case when jsonb_typeof(ed->'vertical') = 'string' then nullif(ed->>'vertical','') end,
      case when jsonb_typeof(ed#>'{gate,vertical}') = 'string' then nullif(ed#>>'{gate,vertical}','') end,
      case when jsonb_typeof(ed->'company_vertical') = 'string' then nullif(ed->>'company_vertical','') end,
      '')))
$$;

-- archCopyVertical (BEGIN/END ARCH COPY VERTICAL 2026-09-09, identical in all three senders)
create or replace function public._inbox_copy_vertical(ed jsonb) returns text
language sql immutable as $$
  select case
    when ed ? 'copy_vertical' then
      case when jsonb_typeof(ed->'copy_vertical') = 'string' and ed->>'copy_vertical' in ('apps','games','pc','d2c')
           then ed->>'copy_vertical' else 'unknown' end
    when public._inbox_vertical_value(ed) = 'pc' then 'pc'
    when public._inbox_vertical_value(ed) in ('games','mobile_games','gaming','game','mobile_gaming') then 'games'
    when public._inbox_vertical_value(ed) ~ '^(apps|apps_(?!d2c)\w+|travel|fintech|edtech|consumer_saas|productivity_saas|consumer_privacy_saas|consumer_app_news)$' then 'apps'
    when public._inbox_vertical_value(ed) in ('d2c','apps_d2c','d2c_subscription','d2c_ecom') then 'd2c'
    when public._inbox_vertical_value(ed) <> '' then 'unknown'
    when lower(coalesce(ed->>'lane','')) ~ '(^|_)(apps|fintech|csaas|saas)(_|$)' then 'apps'
    when lower(coalesce(ed->>'lane','')) ~ '(^|_)(games|gaming)(_|$)' then 'games'
    else 'unknown' end
$$;

-- The template key a sent row records: draft_evidence.template_key, else the DM Sequencer's ai_model 'arch_<key>'.
create or replace function public._inbox_template_key(ai_model text, draft_evidence jsonb) returns text
language sql immutable as $$
  select coalesce(nullif(draft_evidence->>'template_key',''),
                  case when ai_model ~ '^arch_' then substring(ai_model from '^arch_(.*)$') end)
$$;

-- The route ONE outbound message carries. Connection notes carry only an invite arm (_inbox_note_arm),
-- except the sponsor notes, which ARE the sponsor door.
drop function if exists public._inbox_message_route(text, jsonb, text, text);
create or replace function public._inbox_message_route(k text, ai_model text, message_type text, t text)
returns text language sql immutable as $$
  select case
    when message_type = 'connection_note' then
      case when coalesce(ai_model,'') ~ '^arch_sponsor_note(_eu)?_v' then 'sponsor_door' end
    when k in ('dm1_eu_expansion','inmail_body_eu_expansion') then 'eu_expansion'
    when k in ('dm1_a','inmail_body_audit','dm3','fu','deliver','recycle') then 'audit_offer'
    when k ~ '^sp_(eu|us)_' then 'sponsor_door'
    when k ~ '^(dm1_b|dm1_h|inmail_body)_pc$' then 'pc'
    when k ~ '^(dm1_b|dm1_h|inmail_body)_games$' then 'games'
    when k ~ '^(dm1_b|dm1_h|inmail_body)_apps$' then 'apps'
    when k ~ '^((dm1_b|dm1_h|inmail_body)_d2c|nudge_d2c)$' then 'd2c'
    when k in ('dm1_b','inmail_body') then 'generic'
    when k in ('nudge','dm3_b','recycle_b') then 'ladder'
    -- no key: only the template InMails and the seat mirror are read by their text
    when ai_model is null or ai_model = 'manual_mirror' or ai_model like 'template/arch_inmail%' then
      case
        when t ~* 'working with creators in the US|creator activity in Europe' then 'eu_expansion'
        when t ~* 'creator audits? (on|of)|madebyarch\.com/[a-z0-9-]+-audit|have that .{1,60} audit here|check the audit' then 'audit_offer'
        when t ~* 'saw (you''re |you’re )?(the )?.{0,80}sponsor(ing|ship)' then 'sponsor_door'
        when t ~* 'PC and mobile game studios' then 'pc'
        when t ~* 'for mobile game studios|help mobile game studios' then 'games'
        when t ~* 'consumer apps get real performance|influencer marketing for consumer apps' then 'apps'
        when t ~* 'subscription and D2C brands' then 'd2c'
        when t ~* 'specialised in performance influencer marketing' then 'generic'
        when t ~* 'Influencer campaigns for apps and subscription brands' then 'd2c'
        -- the vertical-neutral ladder bodies (nudge, dm3_b): the person's copy vertical decides
        when t ~* 'Influencer campaigns for games and apps are all we do|15 min chat about the creator side' then 'ladder'
        else 'custom' end
    else 'custom' end
$$;

create or replace function public._inbox_note_arm(ai_model text) returns text
language sql immutable as $$
  select case
    when ai_model is null then null
    when ai_model ~ '^arch_eng_note_v' then 'engager'
    when ai_model ~ '^arch_games_note_v' then 'games'
    when ai_model ~ '^arch_apps_note_v' then 'apps'
    when ai_model ~ '^arch_sponsor_note(_eu)?_v' then 'sponsor'
    when ai_model ~ '^arch_note_final_v' then 'custom'
    when ai_model ~ 'blank' then 'blank'
    else null end
$$;

-- superseded per-row attempt (never shipped in a view that stayed live)
drop function if exists public.inbox_copy_route(uuid);

create or replace view public.inbox_arch_copy_route_v with (security_invoker = on) as
with ids as (
  -- only ARCH people who have a message row (the inbox never shows anyone else)
  select distinct mm.prospect_id as id
  from outreach_messages mm join outreach_prospects pr on pr.id = mm.prospect_id
  join outreach_campaigns c on c.id = pr.campaign_id
  where c.client_id = 'arch'
), ap as materialized (
  -- enrichment_data is large and TOASTed; every ed->'x' would de-TOAST it again, so it is cut down ONCE to
  -- the keys the selectors read.
  select pr.id, pr.stage, pr.company, pr.company_domain, pr.company_linkedin_url, pr.blacklisted, pr.skip_state,
         pr.last_reply_at, coalesce(pr.reply_count,0) as reply_count,
         coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(pr.enrichment_data) e
                   where e.key in ('copy_vertical','vertical','gate','company_vertical','lane','copy_hold','lang_hold',
                                   'person_hold','audit_url','audit_sha','audit_read_at','audit_status','game',
                                   'audit_company','approach_evidence','eu_logic','channel','arch_note_final')), '{}'::jsonb) as ed
  from outreach_prospects pr join ids on ids.id = pr.id
), mk as materialized (
  -- MATERIALIZED on purpose (here and below): the helpers inline, and without a stored column the planner
  -- would paste the key expression (a de-TOAST of draft_evidence) into every WHEN of every aggregate.
  select mm.prospect_id, mm.direction, mm.message_type, mm.ai_model, mm.message_text, coalesce(mm.sent_at, mm.created_at) as at,
         (mm.sent_at is not null and mm.send_blocked_at is null) as sent,
         (mm.sent_at is null and mm.send_blocked_at is null) as pending,
         public._inbox_template_key(mm.ai_model, mm.draft_evidence) as k
  from outreach_messages mm join ids on ids.id = mm.prospect_id
), mr as materialized (
  select prospect_id, direction, message_type, ai_model, at, sent, pending,
         case when direction = 'outbound' then public._inbox_message_route(k, ai_model, message_type, message_text) end as route
  from mk
), agg as (
  select prospect_id,
    -- precedence over SENT rows
    case
      when bool_or(sent and route = 'eu_expansion') then 'eu_expansion'
      when bool_or(sent and route = 'audit_offer') then 'audit_offer'
      when bool_or(sent and route = 'sponsor_door') then 'sponsor_door'
      when bool_or(sent and route in ('apps','games','pc','d2c')) then
        (array_agg(route order by at) filter (where sent and route in ('apps','games','pc','d2c')))[1]
      when bool_or(sent and route = 'generic') then 'generic'
      when bool_or(sent and route = 'ladder') then 'ladder'
      when bool_or(sent and route = 'custom') then 'custom'
    end as sent_route,
    -- same precedence over PENDING drafts (what goes out next)
    case
      when bool_or(pending and route = 'eu_expansion') then 'eu_expansion'
      when bool_or(pending and route = 'audit_offer') then 'audit_offer'
      when bool_or(pending and route = 'sponsor_door') then 'sponsor_door'
      when bool_or(pending and route in ('apps','games','pc','d2c')) then
        (array_agg(route order by at) filter (where pending and route in ('apps','games','pc','d2c')))[1]
      when bool_or(pending and route = 'generic') then 'generic'
      when bool_or(pending and route = 'ladder') then 'ladder'
      when bool_or(pending and route = 'custom') then 'custom'
    end as draft_route,
    (array_agg(public._inbox_note_arm(ai_model) order by at)
       filter (where sent and direction = 'outbound' and message_type = 'connection_note'))[1] as note,
    bool_or(sent and direction = 'outbound' and message_type = 'connection_note') as note_sent,
    bool_or(direction = 'inbound') as has_inbound
  from mr group by prospect_id
), f as materialized (
  select ap.*, agg.sent_route, agg.draft_route, agg.note, coalesce(agg.note_sent,false) as note_sent,
         (coalesce(agg.has_inbound,false) or ap.reply_count > 0 or ap.last_reply_at is not null) as replied,
         public._inbox_copy_vertical(ap.ed) as cv
  from ap join agg on agg.prospect_id = ap.id
), g as (
  select f.*,
    -- selectOffer row gates + auditSuitability (vertical must have an audit body: apps/games/pc)
    ( not coalesce(f.blacklisted,false) and f.skip_state is null
      and coalesce(f.ed->>'copy_hold','') in ('','false','0')
      and coalesce(f.ed->>'lang_hold','') in ('','false','0')
      and coalesce(f.ed->>'person_hold','') in ('','false','0')
      and coalesce(f.stage,'') not in ('replied','archived','ballot_hold','disqualified','skipped')
      and f.cv in ('apps','games','pc')
      and coalesce(f.ed->>'audit_url','') ~ '^https://madebyarch\.com/[a-z0-9-]+-audit/$'
      and coalesce(f.ed->>'audit_sha','') ~* '^[a-f0-9]{64}$'
      and public._inbox_try_ts(f.ed->>'audit_read_at') <= now()
      and public._inbox_try_ts(f.ed->>'audit_read_at') >= now() - interval '30 days'
      and coalesce(f.ed->>'audit_status','') not in ('insufficient_material','research_failed','build_failed','build_pending','config_needed')
      and substring(f.ed->>'audit_url' from '^https://madebyarch\.com/([a-z0-9-]+)-audit/$') in (
            public._inbox_audit_slug(f.company), public._inbox_audit_slug(f.ed->>'game'),
            public._inbox_audit_slug(f.ed->>'audit_company'), public._inbox_audit_slug(f.company_domain))
      and exists (select 1 from outreach_templates t where t.client_id = 'arch' and t.in_rotation and t.key = 'dm1_a')
    ) as audit_ok,
    -- archApproachDecision: reviewed pilot companies + fresh operator receipts for both kinds
    ( f.cv in ('games','pc','apps','d2c')
      and lower(substring(coalesce(f.company_linkedin_url,'') from '(?i)linkedin\.com/company/([^/?#]+)')) in ('metacoregames','whatnot-inc')
      and exists (select 1 from outreach_templates t where t.client_id = 'arch' and t.in_rotation and t.key = 'dm1_eu_expansion')
      and (select count(distinct r->>'kind') from jsonb_array_elements(case when jsonb_typeof(f.ed->'approach_evidence') = 'array' then f.ed->'approach_evidence' else '[]'::jsonb end) r
           where r->>'kind' in ('us_creator_activity','eu_product_availability')
             and r->>'company_key' = lower(substring(f.company_linkedin_url from '(?i)linkedin\.com/company/([^/?#]+)'))
             and r->>'verified_by' = 'operator_review' and coalesce(r->>'id','') <> '' and coalesce(r->>'source_url','') <> ''
             and btrim(coalesce(r->>'source_quote','')) <> ''
             and public._inbox_try_ts(r->>'observed_at') between now() - interval '90 days' and now()
             and public._inbox_try_ts(r->>'checked_at') between now() - interval '30 days' and now()) = 2
    ) as eu_ok,
    -- connectNoteSelect for a sponsor-lane invite that has not gone out yet (A/B blank arm = odd hex digit)
    ( not f.note_sent and f.ed->>'lane' in ('sponsor_team','sponsor_mined')
      and jsonb_typeof(f.ed->'eu_logic') = 'boolean' and nullif(btrim(coalesce(f.ed->>'channel','')),'') is not null
      and coalesce(nullif(btrim(f.ed->>'arch_note_final'),''), '') = ''
      and (position(lower(substr(regexp_replace(f.id::text, '[^0-9a-fA-F]', '', 'g'), 30, 1)) in '0123456789abcdef') - 1) % 2 = 0
    ) as sponsor_ok
  from f
)
-- GROUP BY the (already unique) id makes the view provably distinct on prospect_id, so the planner REMOVES
-- the LEFT JOIN below whenever a reader of inbox_messages_v does not select copy_route (sends.ts, today.ts,
-- crossSearch.ts name their columns): those reads pay nothing for this.
select id as prospect_id, min(
  case
    when sent_route is not null and sent_route <> 'ladder' then 'sent:' || sent_route
    when sent_route = 'ladder' then 'sent:' || case when cv = 'unknown' then 'custom' else cv end
    -- a pending draft IS the next message, whoever wrote it
    when draft_route is not null and draft_route <> 'ladder' then 'next:' || draft_route
    when replied then 'next:custom'
    when sponsor_ok then 'next:sponsor_door'
    when cv = 'unknown' or coalesce(ed->>'copy_hold','') not in ('','false','0') then 'next:hold'
    when audit_ok then 'next:audit_offer'
    when eu_ok then 'next:eu_expansion'
    else 'next:' || cv
  end || coalesce(':' || note, '')) as copy_route
from g
group by id;

create or replace view public.inbox_messages_v with (security_invoker = on) as
 SELECT m.id, m.prospect_id, m.direction, m.message_text, m.message_type,
    COALESCE(m.channel, 'linkedin'::text) AS channel,
    m.sent_at, m.approved_at, m.read_at, m.created_at, m.send_blocked_at, m.send_blocked_reason,
    m.unipile_chat_id, m.ai_model,
    p.name AS prospect_name, p.company AS prospect_company, p.headline AS prospect_headline,
    p.stage AS prospect_stage, p.email AS prospect_email, p.profile_photo_url,
    c.name AS campaign_name, COALESCE(c.client_id, 'ivan'::text) AS client_id,
    m.snoozed_until, m.snoozed_at,
    p.linkedin_url AS prospect_linkedin_url,
    COALESCE(uc.provider_id, ua.provider_id) AS chat_provider_id,
    p.skip_reason AS prospect_skip_reason,
    m.reply_intent,
    p.blacklisted AS prospect_blacklisted,
    p.enrichment_data->>'lane' AS lane,
    acr.copy_route
   FROM outreach_messages m
     JOIN outreach_prospects p ON p.id = m.prospect_id
     JOIN outreach_campaigns c ON c.id = p.campaign_id
     LEFT JOIN unipile_chats uc ON uc.chat_id = m.unipile_chat_id
     LEFT JOIN LATERAL ( SELECT x.provider_id FROM unipile_chats x
          WHERE x.attendee_provider_id IS NOT NULL AND x.attendee_provider_id = p.linkedin_profile_id LIMIT 1) ua ON true
     LEFT JOIN public.inbox_arch_copy_route_v acr ON acr.prospect_id = m.prospect_id;
