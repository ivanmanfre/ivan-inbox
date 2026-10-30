-- 298 · Warm signals on every outreach seat (profile viewers), 2026-10-30.
--
-- Ivan, 2026-10-30: "all of these should show as signals with a draft to send... draft -> approve -> send
-- connection + dm1 after approval... depending on lead stage or if we wrote them already".
--
--   outreach_seats.settings.profile_view      per-seat lane config; the Profile View Lane reads it (no seat literals)
--   profile-view-judge-swishdm                judge prompt carrying Jonathan's niche rule verbatim (Railway lane.mjs)
--   engine_features 'profile_view_signals'    parity row: a seat with no judge verdict in 7 days shows a gap
--   outreach_seat_clients()                   seat -> client for invoker RPCs (outreach_seats is service_role only)
--   profile_view_signal_route(since, replay)  one routing decision per (seat, viewer); the 30-day replay and the
--                                             Warm Signal Drafter read the same function
--   warm_signal_cards()                       + tenant, signal_kind, qualification; every registry seat (return type
--                                             changed, so it is dropped and created)
--   warm_signal_decide()                      registry tenants; per-seat invite approval; a B-row skip discards only
--                                             the view draft; approve_dm_swishdm
--
-- Nothing here sends. Every send still needs an approval stamp the senders gate on.
-- Applied via the Supabase Management API on 2026-10-30. Regenerated from the live definitions.

-- 1. per-seat lane config
update outreach_seats set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('profile_view', '{"mode": "arch_staging", "dm_slug": null, "campaign": "15de1a7c-86f4-40b7-bdbd-3c1fce94b6b9", "geo_gate": false, "judge_slug": "profile-view-judge-arch", "owner_name": "Davorin Smit", "voice_slug": "arch-reply-voice-core", "min_audience": 0}'::jsonb), updated_at = now() where seat = 'arch';
update outreach_seats set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('profile_view', '{"mode": "lane", "dm_slug": "profile-view-dm-ivan", "campaign": "3eae4af4-e754-4ac0-a964-dc9f379eb709", "geo_gate": true, "judge_slug": "profile-view-judge-ivan", "owner_name": "Ivan Manfredi", "voice_slug": "ivan-reply-voice-core", "min_audience": 150}'::jsonb), updated_at = now() where seat = 'ivan';
update outreach_seats set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('profile_view', '{"mode": "lane", "dm_slug": "profile-view-dm-risedtc", "campaign": "cdc57dc3-bcee-4d7c-8dbd-6eabceb8ab9d", "geo_gate": true, "judge_slug": "profile-view-judge-risedtc", "owner_name": "Mattan Danino", "voice_slug": "rise-reply-voice-core", "min_audience": 0}'::jsonb), updated_at = now() where seat = 'risedtc';
update outreach_seats set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('profile_view', '{"mode": "swishdm_staging", "dm_slug": null, "campaign": "85110320-33da-4b11-9ce0-7b1f2fffe3cd", "geo_gate": false, "judge_slug": "profile-view-judge-swishdm", "owner_name": "Jonathan Kiekbusch", "voice_slug": "swishdm-text-voice-spec", "min_audience": 0}'::jsonb), updated_at = now() where seat = 'swishdm';

-- 2. SwishDM judge prompt
insert into content_prompts (slug, title, body, kind, variables, version, is_active, category, scope, updated_by, updated_at)
values ('profile-view-judge-swishdm', 'Profile View Lane — ICP Judge (SwishDM seat)', $judge$You judge ONE LinkedIn person who viewed the LinkedIn profile of Jonathan Kiekbusch, founder of SwishDM, a UK agency that sells ecommerce SEO and AI-search visibility (getting a store described correctly and recommended by ChatGPT, Gemini and Google AI) to consumer product brands. Engagements are $5k+ per month. The view is a soft intent signal: PASS means this person is someone SwishDM would want to talk to, so Ivan sees a draft to approve. Nothing is sent without his approval, but a wrong PASS wastes his time and a client seat's reputation.

The client's rule: FOUNDERS and C-LEVEL (founder, co-founder, owner, CEO, president, managing director of the company, or any Chief ... Officer), plus the senior online-growth leader defined below, at a brand that sells its own physical products to consumers (DTC / ecommerce / consumer brand) or an online retailer. Any other VP, Head, Director, Manager, advisor, investor, consultant, and every agency, SEO / marketing / AI-search service provider, software or SaaS vendor, freelancer, recruiter, media or B2B supplier person FAILS. Most people who look at an agency founder's profile are peers and sellers: an SEO, GEO, ecommerce, Shopify, Amazon or marketing agency founder FAILS even when their clients are consumer brands.

You only have the person's name, LinkedIn headline and connection distance. Decide:
 seniority: "founder" | "c_level" | "growth_lead" | "other"
 "growth_lead" = the senior person who owns the brand's online revenue or marketing budget: VP, Head or Director of Ecommerce, Digital, Growth or Marketing (including SVP / EVP and "Director of Ecommerce & Marketing"), or the General Manager (GM) of the brand or of its online business. NOT growth_lead: sales, wholesale, retail-sales or business-development leaders, operations, supply chain, finance, product development, creative, brand-design, PR, social, community, paid-media, CRM, retention or Amazon specialists, and anyone at manager, senior manager, associate director or coordinator level.
 brand: the consumer product brand that founder / C-level / growth_lead role is at, as the brand is called, or null when the headline names none
 consumer_brand: true only if that brand plausibly sells its own physical products to consumers
 niche: "out" when that brand's main products fall in an OUT niche of the client niche rule below, else "in" ("in" when the headline does not show what it sells)
 pass: true only if seniority is founder, c_level or growth_lead AND a brand is named AND consumer_brand AND niche is "in". A headline that names no brand, or is ambiguous about whether the person sells their own products or sells services, FAILS.
 reason: max 16 words, plain English, naming the brand and what decided it

Judge meaning, never keywords. A brand NAME alone is not proof of who the person works for: read the whole headline. The brand is verified against store data before any invite.
CLIENT NICHE RULE (Jonathan, SwishDM, 2026-10-27). SwishDM wins where shoppers search for a kind of product before they buy: consumer electronics and accessories (phone cases, laptops, power stations, audio, smart home), hunting, outdoor and sports gear, protective clothing, kitchen appliances such as air fryers, and other considered direct-to-consumer purchases (home, pets, baby, beauty and similar stay in).
OUT, whatever the size or fit:
- food and drink of any kind (snacks, beverages, coffee, tea, alcohol, sauces, oils, meal kits, protein powders, shakes and drink mixes). Vitamins and supplements in capsule, tablet or gummy form are NOT food and drink: they stay in
- CBD and other cannabinoid products (hemp-derived CBD, THC, delta-8), cannabis, or any other controlled substance (kratom, psychedelics, nicotine and vapes): regulated markets cannot advertise and AI assistants avoid citing them. Hemp used only as a material (hemp clothing, hemp rope) is not this
- high fashion and fashion-led clothing, shoes and accessories (luxury, designer or everyday fashion labels bought on brand and style): buyers go straight to a brand they know instead of searching
Clothing is IN only when it is technical: protective, built for a specific sport or activity (hunting, cycling, golf, climbing, expeditions), or for a particular job or industry (workwear), because shoppers search "best hunting jacket under $500".
Judge what the brand mainly sells, from its own description, products and site, never from isolated words.

Answer ONLY one JSON object on one line: {"pass": true|false, "reason": "...", "seniority": "...", "brand": "..." or null, "consumer_brand": true|false, "niche": "in"|"out"}$judge$,
        'prompt', '{}'::text[], 1, true, 'outreach', 'client:swishdm', 'claude-pv-warm-signals-2026-10-30', now())
on conflict (slug) do nothing;

-- 3. parity row
insert into engine_features (feature, description, kind, evidence_sql, where_lives)
values ('profile_view_signals', 'Profile viewers judged and routed to Warm signals cards (a judge verdict in the last 7 days)', 'evidence', 'SELECT coalesce((SELECT s.settings ? ''profile_view'' FROM public.outreach_seats s WHERE s.seat = $1), false) AND EXISTS (SELECT 1 FROM public.profile_view_log l WHERE l.seat = $1 AND l.captured_at > now() - interval ''7 days'' AND l.icp_pass IS NOT NULL)', 'outreach_seats.settings.profile_view + n8n VIVdJTOFkX1PIBss + profile_view_signal_route + warm_signal_cards')
on conflict (feature) do update set description = excluded.description, kind = excluded.kind, evidence_sql = excluded.evidence_sql, where_lives = excluded.where_lives, updated_at = now();

-- 4. seat clients helper
CREATE OR REPLACE FUNCTION public.outreach_seat_clients()
 RETURNS TABLE(seat text, client_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ select s.seat, s.client_id from outreach_seats s where s.active $function$
;
revoke all on function public.outreach_seat_clients() from public, anon;
grant execute on function public.outreach_seat_clients() to authenticated, service_role;

-- 5. routing function
CREATE OR REPLACE FUNCTION public.profile_view_signal_route(p_since timestamp with time zone DEFAULT (now() - '7 days'::interval), p_replay boolean DEFAULT false)
 RETURNS TABLE(seat text, viewer_public_id text, viewer_name text, viewer_headline text, distance text, viewed_at timestamp with time zone, prospect_id uuid, prospect_name text, stage text, campaign_id uuid, kind text, reason text, last_out_at timestamp with time zone, last_out_model text, dm_count integer, pending_draft_id uuid, pending_draft_model text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with seats as (
  select s.seat, s.client_id from outreach_seats s where s.active
),
v as (
  select distinct on (l.seat, l.viewer_public_id) l.*
  from profile_view_log l join seats s on s.seat = l.seat
  where coalesce(l.viewed_at, l.captured_at) >= p_since and l.viewer_public_id is not null
  order by l.seat, l.viewer_public_id, coalesce(l.viewed_at, l.captured_at) desc
),
m as (
  select v.*, s.client_id as seat_client,
         coalesce(v.prospect_id,
           (select p2.id from outreach_prospects p2
             where p2.linkedin_url = 'https://www.linkedin.com/in/' || v.viewer_public_id
                or (v.viewer_provider_id is not null and p2.linkedin_profile_id = v.viewer_provider_id)
             order by p2.created_at desc limit 1)) as pid,
         case when p_replay then coalesce(v.viewed_at, v.captured_at) else now() end as t
  from v join seats s on s.seat = v.seat
),
j as (
  select m.*, p.name as p_name, p.stage as p_stage, p.campaign_id as p_campaign, p.blacklisted, p.skip_state, p.trigger_type as p_trigger,
         p.call_booked_at, p.reply_count, p.last_reply_at, p.connection_sent_at, p.connected_at, coalesce(p.dm_count, 0)::integer as p_dm_count,
         c.client_id as p_client,
         (c.client_id is not distinct from m.seat_client) as same_seat,
         lo.sent_at as lo_at, lo.ai_model as lo_model,
         exists (select 1 from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound'
                   and coalesce(i.sent_at, i.created_at) <= m.t) as has_in,
         pd.id as pd_id, pd.ai_model as pd_model
  from m
  left join outreach_prospects p on p.id = m.pid
  left join outreach_campaigns c on c.id = p.campaign_id
  left join lateral (
    select o.sent_at, o.ai_model from outreach_messages o
    where o.prospect_id = p.id and o.direction = 'outbound' and o.message_type in ('dm', 'inmail')
      and o.sent_at is not null and o.sent_at <= m.t
    order by o.sent_at desc limit 1) lo on true
  left join lateral (
    select o.id, o.ai_model from outreach_messages o
    where not p_replay and o.prospect_id = p.id and o.direction = 'outbound' and o.sent_at is null
      and o.send_blocked_at is null and o.message_type in ('dm', 'inmail')
    order by o.created_at desc limit 1) pd on true
)
select j.seat, j.viewer_public_id, j.viewer_name, j.viewer_headline, j.distance, coalesce(j.viewed_at, j.captured_at),
       j.pid, j.p_name, j.p_stage, j.p_campaign,
       k.kind, k.reason, j.lo_at, j.lo_model, j.p_dm_count, j.pd_id, j.pd_model
from j
cross join lateral (
  select case
    when j.pid is null then
      case when j.icp_pass is true then 'new_unstaged' when j.icp_pass is false then 'not_icp' else 'unjudged' end
    when not j.same_seat then 'other_seat'
    when j.blacklisted or j.p_stage in ('disqualified', 'archived', 'skipped', 'dropped') then 'closed'
    when (j.call_booked_at is not null and j.call_booked_at <= j.t) or j.has_in
         or j.p_stage in ('replied', 'positive_reply', 'booked', 'call_booked', 'lm_delivered', 'swishdm_replied', 'inbound_request_dm')
         or (not p_replay and (coalesce(j.reply_count, 0) > 0 or j.last_reply_at is not null)) then 'in_conversation'
    when j.lo_at is not null and (j.connected_at is null or j.connected_at > j.t) then
      case when j.connection_sent_at is not null and j.connection_sent_at <= j.t then 'viewed_after_invite' else 'viewed_after_inmail' end
    when j.lo_at is not null and j.t - j.lo_at >= interval '90 days' then 'cooldown'
    when j.lo_at is not null and (j.p_dm_count >= 6 or j.lo_model ~* '(dm7|breakup)') then 'cooldown'
    when j.lo_at is not null and j.t - j.lo_at < interval '3 days' then
      case when p_replay and j.lo_at + interval '3 days' < j.t + interval '7 days'
                and not exists (select 1 from outreach_messages x where x.prospect_id = j.pid
                                 and ((x.direction = 'inbound' and coalesce(x.sent_at, x.created_at) > j.lo_at
                                       and coalesce(x.sent_at, x.created_at) <= j.lo_at + interval '3 days')
                                   or (x.direction = 'outbound' and x.sent_at > j.lo_at and x.sent_at <= j.lo_at + interval '3 days')))
           then 'next_touch' else 'too_soon' end
    when j.lo_at is not null then 'next_touch'
    when (j.connected_at is not null and j.connected_at <= j.t)
         or j.p_stage in ('connected', 'inbound_accepted_no_dm', 'swishdm_connected') then 'dm1_pull'
    when j.connection_sent_at is not null and j.connection_sent_at <= j.t then 'viewed_after_invite'
    when j.p_trigger = 'profile_view' and j.p_stage = 'profile_view_dm' then 'new_dm1'
    when j.p_trigger = 'profile_view' then 'new_invite'
    else 'queued' end as kind,
  case
    when j.pid is null then coalesce(left(j.icp_reasoning, 200), '')
    when not j.same_seat then 'prospect is in ' || coalesce(j.p_client, 'ivan') || ' campaign'
    else coalesce(j.p_stage, '') || ' dm_count ' || j.p_dm_count || coalesce(' last ' || j.lo_model || ' ' || to_char(j.lo_at, 'MM-DD'), '')
  end as reason
) k;
$function$
;
revoke all on function public.profile_view_signal_route(timestamptz, boolean) from public, anon;
grant execute on function public.profile_view_signal_route(timestamptz, boolean) to authenticated, service_role;

-- 6. cards
DROP FUNCTION IF EXISTS public.warm_signal_cards();
CREATE FUNCTION public.warm_signal_cards()
 RETURNS TABLE(prospect_id uuid, name text, headline text, company text, title text, country text, city text, icp_score integer, stage text, trigger_type text, campaign_id uuid, linkedin_url text, connection_sent_at timestamp with time zone, connected_at timestamp with time zone, note_variant text, skip_reason text, created_at timestamp with time zone, signal_source text, signal_evidence jsonb, signal_note_draft text, signal_note_final text, signal_approved_at text, signal_invite_state text, signal_lint jsonb, view_window_ends timestamp with time zone, draft_id uuid, draft_text text, draft_model text, draft_created_at timestamp with time zone, draft_approved_at timestamp with time zone, draft_sent_at timestamp with time zone, dm_sent_count integer, tenant text, signal_kind text, qualification text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with seats as (
  select s.seat, s.client_id from outreach_seat_clients() s
),
camps as (
  select c.id, s.seat from outreach_campaigns c join seats s on c.client_id is not distinct from s.client_id
),
rows as (
  select p.*, cs.seat as tenant,
         case when p.enrichment_data->>'lane' = 'own_post_engager' then 'own_post'
              when p.trigger_type = 'profile_view' then
                case when p.stage = 'profile_view_dm' or coalesce(p.enrichment_data->>'network_distance', p.enrichment_data->>'distance') = 'DISTANCE_1'
                     then 'new_dm1' else 'new_invite' end
              else coalesce(p.enrichment_data->'pv_signal'->>'kind', 'view') end as kind
  from outreach_prospects p
  join camps cs on cs.id = p.campaign_id
  where p.blacklisted = false
    and (
      (cs.seat = 'ivan' and p.enrichment_data->>'lane' = 'own_post_engager' and p.stage not in ('archived', 'skipped'))
      or
      (p.trigger_type = 'profile_view'
         and p.stage in ('enriched', 'ballot_hold', 'queued', 'connection_sent', 'connected', 'profile_view_dm',
                         'swishdm_staged_hold', 'swishdm_connected')
         and p.created_at >= now() - interval '21 days'
         -- ARCH research already excluded the person: no card
         and coalesce(p.enrichment_data->'qualification'->>'status', '') <> 'excluded')
      or
      -- already in a campaign, viewed, and the Warm Signal Drafter wrote ONE view draft: shown while it waits
      (p.enrichment_data->'pv_signal'->>'draft_id' is not null
         and exists (select 1 from outreach_messages m
                      where m.id::text = p.enrichment_data->'pv_signal'->>'draft_id'
                        and m.sent_at is null and m.approved_at is null
                        and (m.send_blocked_reason is null or m.send_blocked_reason = 'awaiting_client_review'
                             or m.send_blocked_reason like 'lint_%')))
    )
),
drafts as (
  select distinct on (m.prospect_id)
         m.prospect_id, m.id, m.message_text, m.ai_model, m.created_at, m.approved_at, m.sent_at
  from outreach_messages m
  join rows r on r.id = m.prospect_id
  where m.direction = 'outbound'
    and m.message_type = 'dm'
    and m.sent_at is null
    and (m.send_blocked_reason is null or m.send_blocked_reason like 'post_approval_race:%' or m.send_blocked_reason like 'lint_%'
         or m.send_blocked_reason = 'awaiting_client_review')
    and (m.ai_model in ('warm_signal_dm1_v1', 'profile_view_dm_v2', 'profile_view_opener_v1', 'rise_view_opener_v1',
                        'pv_dm1_v1', 'pv_cameback_followup_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
         -- ARCH's own DM1 for a viewer lands approval-held (DM Sequencer 2026-10-30 gate)
         or (r.tenant = 'arch' and r.trigger_type = 'profile_view' and m.ai_model like 'arch\_dm1%' escape '\' and m.approved_at is null))
  order by m.prospect_id, m.created_at desc
),
sent as (
  select m.prospect_id, count(*)::integer as n
  from outreach_messages m
  join rows r on r.id = m.prospect_id
  where m.direction = 'outbound' and m.message_type = 'dm' and m.sent_at is not null
  group by m.prospect_id
)
select
  r.id, r.name, r.headline, r.company, r.title, r.country, r.city, r.icp_score, r.stage,
  r.trigger_type, r.campaign_id, r.linkedin_url, r.connection_sent_at, r.connected_at,
  r.note_variant, r.skip_reason, r.created_at,
  coalesce(r.enrichment_data->>'signal_source',
           case when r.trigger_type = 'profile_view' or r.kind in ('dm1_pull', 'next_touch', 'view') then 'profile_view'
                when (r.enrichment_data->>'commented')::boolean then 'commented_own_post'
                when coalesce((r.enrichment_data->>'n_posts')::integer, 0) >= 2 then 'reacted_two_posts'
                else 'engaged_own_post' end) as signal_source,
  coalesce(r.enrichment_data->'signal_evidence',
           case when r.kind in ('dm1_pull', 'next_touch')
                then jsonb_build_object('viewed_at', r.enrichment_data->'pv_signal'->>'view_at',
                                        'distance', r.enrichment_data->'pv_signal'->>'distance',
                                        'last_out_at', r.enrichment_data->'pv_signal'->>'last_out_at',
                                        'last_out_model', r.enrichment_data->'pv_signal'->>'last_out_model',
                                        'trigger_detail', r.trigger_detail)
                else jsonb_build_object('touches', r.enrichment_data->'touches',
                                        'viewed_at', r.enrichment_data->>'viewed_at',
                                        'distance', coalesce(r.enrichment_data->>'network_distance', r.enrichment_data->>'distance'),
                                        'trigger_detail', r.trigger_detail) end) as signal_evidence,
  r.enrichment_data->>'signal_note_draft',
  r.enrichment_data->>'signal_note_final',
  r.enrichment_data->>'signal_approved_at',
  case
    when r.kind in ('dm1_pull', 'next_touch') then 'in_campaign'
    when r.enrichment_data->>'signal_invite_state' is not null and r.tenant = 'ivan' then r.enrichment_data->>'signal_invite_state'
    when r.connection_sent_at is not null then 'sent:' || coalesce(r.note_variant, '?') || '@' || r.connection_sent_at::text
    when r.stage in ('profile_view_dm', 'connected', 'swishdm_connected') then 'first_degree'
    when r.kind = 'new_dm1' and r.enrichment_data->>'signal_approved_at' is null then 'first_degree_pending'
    when r.kind = 'new_dm1' then 'first_degree'
    else 'pending' end as signal_invite_state,
  r.enrichment_data->'signal_lint',
  case when r.trigger_type = 'profile_view' then r.created_at + interval '7 days' else null end as view_window_ends,
  d.id, d.message_text, d.ai_model, d.created_at, d.approved_at, d.sent_at,
  coalesce(s.n, 0),
  r.tenant, r.kind,
  r.enrichment_data->'qualification'->>'status'
from rows r
left join drafts d on d.prospect_id = r.id
left join sent s on s.prospect_id = r.id
order by r.created_at desc;
$function$
;
revoke execute on function public.warm_signal_cards() from public, anon;
grant execute on function public.warm_signal_cards() to authenticated, service_role;

-- 7. decide
CREATE OR REPLACE FUNCTION public.warm_signal_decide(p_prospect_id uuid, p_action text, p_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row outreach_prospects%rowtype; v_client text; v_seat text; v_now timestamptz := now(); v_note text; v_stage text;
  v_discarded integer := 0; v_lane_row boolean; v_pv_draft uuid; v_first boolean; v_msg outreach_messages%rowtype; v_text text;
begin
  select p.* into v_row from outreach_prospects p where p.id = p_prospect_id for update;
  if v_row.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select c.client_id into v_client from outreach_campaigns c where c.id = v_row.campaign_id;
  select s.seat into v_seat from outreach_seat_clients() s where s.client_id is not distinct from v_client;
  if v_seat is null then return jsonb_build_object('ok', false, 'error', 'not_a_registry_seat'); end if;
  v_lane_row := coalesce(v_row.trigger_type = 'profile_view', false)
             or (v_seat = 'ivan' and coalesce(v_row.enrichment_data->>'lane' = 'own_post_engager', false));
  v_pv_draft := nullif(v_row.enrichment_data->'pv_signal'->>'draft_id', '')::uuid;
  if not v_lane_row and v_pv_draft is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_warm_signal_row');
  end if;
  v_first := coalesce(coalesce(v_row.enrichment_data->>'network_distance', v_row.enrichment_data->>'distance') = 'DISTANCE_1', false);

  if p_action = 'save_note' then
    if v_seat <> 'ivan' then return jsonb_build_object('ok', false, 'error', 'notes_are_ivan_seat_only'); end if;
    v_note := left(coalesce(p_text, ''), 200);
    update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_note_draft', v_note, 'signal_note_edited_at', v_now), updated_at = v_now where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'note', v_note);

  elsif p_action = 'approve_invite' then
    if not v_lane_row then return jsonb_build_object('ok', false, 'error', 'not_an_invite_row'); end if;
    if v_row.connection_sent_at is not null then return jsonb_build_object('ok', false, 'error', 'invite_already_sent'); end if;
    if coalesce(v_row.enrichment_data->>'signal_approved_at', '') <> '' and v_seat in ('arch', 'swishdm') then
      return jsonb_build_object('ok', false, 'error', 'already_approved');
    end if;
    if v_seat in ('ivan', 'risedtc') then
      v_note := left(coalesce(p_text, v_row.enrichment_data->>'signal_note_draft', ''), 200);
      if v_row.trigger_type <> 'profile_view' and length(trim(v_note)) = 0 then return jsonb_build_object('ok', false, 'error', 'note_required'); end if;
      v_stage := case when v_row.stage = 'ballot_hold' then 'enriched' else v_row.stage end;
      update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_note_final', v_note, 'signal_approved_at', v_now, 'signal_approved_by', 'inbox'), stage = v_stage, skip_reason = case when v_row.stage = 'ballot_hold' then null else skip_reason end, updated_at = v_now where id = p_prospect_id;
      return jsonb_build_object('ok', true, 'stage', v_stage, 'note', v_note, 'approved_at', v_now);
    elsif v_seat = 'arch' then
      -- 1st degree: no invite exists to send; the row becomes 'connected' and the ARCH DM Sequencer drafts its
      -- DM1 approval-held (lane profile_view gate). Otherwise the Ballot Promoter promotes it once research
      -- says eligible, and the ARCH sender sends the blank invite. Both read signal_approved_at.
      v_stage := case when v_first then 'connected' else v_row.stage end;
      update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_approved_at', v_now, 'signal_approved_by', 'inbox'),
             stage = v_stage, connected_at = case when v_first then coalesce(connected_at, v_now) else connected_at end, updated_at = v_now
       where id = p_prospect_id;
      return jsonb_build_object('ok', true, 'stage', v_stage, 'approved_at', v_now, 'qualification', v_row.enrichment_data->'qualification'->>'status');
    elsif v_seat = 'swishdm' then
      if v_first then
        update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_approved_at', v_now, 'signal_approved_by', 'inbox'),
               stage = 'swishdm_connected', connected_at = coalesce(connected_at, v_now), updated_at = v_now where id = p_prospect_id;
        return jsonb_build_object('ok', true, 'stage', 'swishdm_connected', 'approved_at', v_now);
      end if;
      -- the SwishDM Connection Sender sends an approved first-list connection_note row once the person carries a
      -- review approve; a note_arm outside its two named arms sends blank
      insert into outreach_messages (prospect_id, direction, message_type, channel, message_text, sent_at, approved_at, ai_model, draft_evidence)
      values (p_prospect_id, 'outbound', 'connection_note', 'linkedin', '', null, v_now, 'swishdm_pv_invite_blank_v1',
              jsonb_build_object('lane', 'swishdm_first_list', 'source', 'profile_view', 'note_arm', 'profile_view_blank', 'approved_in', 'inbox_warm_signals'));
      update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
               || jsonb_build_object('signal_approved_at', v_now, 'signal_approved_by', 'inbox',
                                     'swishdm_review', coalesce(enrichment_data->'swishdm_review', '{}'::jsonb)
                                        || jsonb_build_object('ivan', jsonb_build_object('decision', 'approve', 'by', 'inbox_warm_signals', 'at', v_now))),
             updated_at = v_now where id = p_prospect_id;
      return jsonb_build_object('ok', true, 'stage', v_row.stage, 'approved_at', v_now);
    end if;
    return jsonb_build_object('ok', false, 'error', 'seat_has_no_invite_path');

  elsif p_action = 'approve_dm1_stage' then
    v_stage := v_row.stage;
    if v_row.stage = 'ballot_hold' and v_row.connection_sent_at is not null then
      v_stage := 'connection_sent';
      update outreach_prospects set stage = v_stage, skip_reason = null, updated_at = v_now where id = p_prospect_id;
    end if;
    return jsonb_build_object('ok', true, 'stage', v_stage);

  elsif p_action = 'approve_dm_swishdm' then
    -- SwishDM drafts are held with send_blocked_reason 'awaiting_client_review'; the generic approve does not
    -- reach them. Follow-ups go through approve_swishdm_reply_draft (its own checks); a viewer DM1 is a
    -- first-list DM1 queued now with the operator's copy approval.
    if v_seat <> 'swishdm' then return jsonb_build_object('ok', false, 'error', 'not_swishdm'); end if;
    select m.* into v_msg from outreach_messages m
     where m.prospect_id = p_prospect_id and m.direction = 'outbound' and m.message_type = 'dm' and m.sent_at is null
       and m.approved_at is null and m.send_blocked_reason = 'awaiting_client_review'
       and m.ai_model in ('swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
     order by m.created_at desc limit 1 for update;
    if v_msg.id is null then return jsonb_build_object('ok', false, 'error', 'no_held_view_draft'); end if;
    v_text := btrim(coalesce(p_text, v_msg.message_text));
    if v_text = '' then return jsonb_build_object('ok', false, 'error', 'empty'); end if;
    if v_msg.ai_model = 'swishdm_reply_followup_pv_v1' then
      update outreach_messages set message_text = v_text where id = v_msg.id;
      perform approve_swishdm_reply_draft(v_msg.id, v_text, v_msg.draft_evidence);
      return jsonb_build_object('ok', true, 'message_id', v_msg.id);
    end if;
    if v_row.connected_at is null then return jsonb_build_object('ok', false, 'error', 'not_connected_yet'); end if;
    update outreach_messages
       set message_text = v_text, approved_at = v_now, send_blocked_reason = null,
           draft_evidence = coalesce(draft_evidence, '{}'::jsonb)
             || jsonb_build_object('dm_queue', jsonb_build_object('state', 'queued', 'due_at', v_now, 'queued_by', 'inbox_warm_signals'),
                                   'operator_copy_approval', jsonb_build_object('source', 'inbox', 'text', v_text, 'approved_at', v_now))
     where id = v_msg.id;
    update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
             || jsonb_build_object('swishdm_review', coalesce(enrichment_data->'swishdm_review', '{}'::jsonb)
                  || jsonb_build_object('ivan', jsonb_build_object('decision', 'approve', 'by', 'inbox_warm_signals', 'at', v_now))),
           updated_at = v_now
     where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'message_id', v_msg.id, 'approved_at', v_now);

  elsif p_action = 'skip' then
    update outreach_messages set send_blocked_reason = 'discarded_in_inbox', send_blocked_at = v_now
     where prospect_id = p_prospect_id and direction = 'outbound' and sent_at is null and approved_at is null
       and (send_blocked_at is null or send_blocked_reason = 'awaiting_client_review')
       and (ai_model in ('warm_signal_dm1_v1', 'profile_view_dm_v2', 'profile_view_opener_v1', 'rise_view_opener_v1',
                         'pv_dm1_v1', 'pv_cameback_followup_v1', 'swishdm_pv_dm1_v1', 'swishdm_reply_followup_pv_v1')
            or (v_seat = 'arch' and v_lane_row and ai_model like 'arch\_dm1%' escape '\'));
    get diagnostics v_discarded = row_count;
    if not v_lane_row then
      -- a person already in a sequence: drop the view draft only, never touch their stage
      update outreach_prospects set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
               || jsonb_build_object('pv_signal', coalesce(enrichment_data->'pv_signal', '{}'::jsonb) || jsonb_build_object('skipped_at', v_now)),
             updated_at = v_now where id = p_prospect_id;
      return jsonb_build_object('ok', true, 'stage', v_row.stage, 'drafts_discarded', v_discarded);
    end if;
    update outreach_prospects set stage = 'skipped', skip_state = 'manual_skip', skip_state_reason = 'warm_signal:operator_skip', skip_state_at = v_now, skip_reason = 'warm_signal:operator_skip', enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('signal_skipped_at', v_now, 'signal_skipped_from_stage', v_row.stage), updated_at = v_now where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'stage', 'skipped', 'drafts_discarded', v_discarded);
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
end;
$function$
;
revoke execute on function public.warm_signal_decide(uuid, text, text) from public, anon;
grant execute on function public.warm_signal_decide(uuid, text, text) to authenticated, service_role;
