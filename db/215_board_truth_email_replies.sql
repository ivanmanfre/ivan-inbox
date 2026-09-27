-- 215: board reply counts include inbound EMAIL replies, dated by the email (2026-09-27, Ofir Bello).
-- ARCH: no email-channel exclusion on replies / leads last_reply_at. RISE: email replies count from 2026-09-21 (closed weeks never move).

CREATE OR REPLACE FUNCTION public.arch_outreach_truth_compute()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with camps as (
  select id from outreach_campaigns
   where client_id = 'arch'
     and id in ('15de1a7c-86f4-40b7-bdbd-3c1fce94b6b9','1a2701a0-931b-4949-95fb-9bbf2de16f09',
                '12c53034-7176-4950-be20-1c1bf5ba11a7','f17e4dac-d6b7-4c66-8d5c-8f1b2ace0685')
),
pros as (
  select p.id, p.name, p.company, p.linkedin_profile_id, p.title,
         p.connection_sent_at, p.connected_at, p.call_booked_at, p.blacklisted,
         p.stage, p.skip_state, p.enrichment_data->>'lane' as lane,
         p.enrichment_data->>'source_kind' as source_kind,
         case when nullif(p.linkedin_profile_id, '') is not null
                then 'li:' || p.linkedin_profile_id
              when nullif(btrim(lower(coalesce(p.name, ''))), '') is not null
                then 'nm:' || btrim(lower(p.name))
              else 'pid:' || p.id::text end as pk
  from outreach_prospects p
  where p.campaign_id in (select id from camps)
),
msg as (
  select m.id, m.prospect_id, m.direction, m.sent_at, m.is_reaction, m.channel, m.message_type, pr.pk,
         m.reply_intent, m.reply_intent_at, pr.blacklisted
  from outreach_messages m
  join pros pr on pr.id = m.prospect_id
),
fm as (
  select distinct on (prospect_id) prospect_id, direction
  from msg
  where prospect_id is not null
  order by prospect_id, sent_at asc nulls last, id asc
),
obt as (
  select prospect_id from fm where direction = 'inbound'
),
ie as (
  select prospect_id from booking_attributions
  where client_id = 'arch' and verdict = 'inbound_engaged' and prospect_id is not null
),
replies as (
  select m.id, m.pk, m.prospect_id, m.sent_at, m.reply_intent, m.reply_intent_at, m.blacklisted,
         (date_trunc('week', (m.sent_at at time zone 'UTC')))::date as wk
  from msg m
  where m.direction = 'inbound'
    and m.is_reaction is distinct from true
    -- 2026-09-27 (Ivan, Ofir Bello): an inbound EMAIL reply is a reply, dated by the email (was LinkedIn-only)
    and m.sent_at is not null
    and m.prospect_id not in (select prospect_id from obt)
),
weeks as (
  select generate_series(
           date '2026-08-24',
           greatest(date '2026-08-24', (date_trunc('week', (now() at time zone 'UTC')))::date),
           interval '7 day')::date as wk
),
weekly as (
  select w.wk, count(distinct r.pk) as people
  from weeks w left join replies r on r.wk = w.wk
  group by w.wk
),
r7 as (
  select pk, max(sent_at) as last_reply_at
  from replies
  where sent_at >= now() - interval '7 days'
    and blacklisted is distinct from true
  group by pk
),
r7i as (
  select distinct on (pk) pk, reply_intent, reply_intent_at
  from replies
  where sent_at >= now() - interval '7 days'
    and blacklisted is distinct from true
  order by pk, sent_at desc nulls last, id desc
),
r7n as (
  select r7.pk, r7.last_reply_at,
    (select p.name from pros p
      where p.pk = r7.pk and nullif(btrim(p.name), '') is not null
      order by p.connection_sent_at asc nulls last limit 1) as name,
    (select p.company from pros p
      where p.pk = r7.pk and nullif(btrim(p.company), '') is not null
      order by p.connection_sent_at asc nulls last limit 1) as company,
    (select p.linkedin_profile_id from pros p
      where p.pk = r7.pk and nullif(p.linkedin_profile_id, '') is not null limit 1) as linkedin_profile_id,
    i.reply_intent, i.reply_intent_at
  from r7 left join r7i i on i.pk = r7.pk
),
booked as (
  select p.id, p.name, p.company, p.call_booked_at, p.connection_sent_at
  from pros p
  where p.call_booked_at is not null
    and (p.id not in (select prospect_id from obt) or p.id in (select prospect_id from ie))
),
-- THE CLOCK. Ported verbatim from rise_outreach_truth_compute() 2026-08-31 (Ivan:
-- "to davorin's report as well its just a standard thing"). Three rungs off ONE
-- anchor: the moment the connection request goes out. People not rows, medians not
-- means, negative gaps dropped rather than clamped, and booked people with no invite
-- stamp counted out loud instead of quietly leaving the denominator. The surfaces
-- refuse to draw a rung under three readings, so on a young lane the rungs appear
-- one at a time as evidence accumulates.
spd_inv as (
  select pk,
         min(connection_sent_at) as invited_at,
         min(connected_at)       as accepted_at,
         min(call_booked_at)     as booked_at
  from pros
  where connection_sent_at is not null
    and id not in (select prospect_id from obt)
  group by pk
),
spd_reply as (
  select pk, min(sent_at) as first_reply_at from replies group by pk
),
spd as (
  select i.pk,
         case when i.accepted_at is not null and i.accepted_at >= i.invited_at
              then extract(epoch from (i.accepted_at - i.invited_at)) / 86400.0 end as accept_days,
         case when r.first_reply_at is not null and r.first_reply_at >= i.invited_at
              then extract(epoch from (r.first_reply_at - i.invited_at)) / 86400.0 end as reply_days,
         case when i.booked_at is not null and i.booked_at >= i.invited_at
              then extract(epoch from (i.booked_at - i.invited_at)) / 86400.0 end as book_days
  from spd_inv i
  left join spd_reply r on r.pk = i.pk
),
lanes as (
  select l.lane,
         count(*) as total,
         count(*) filter (where l.stage = 'ballot_hold') as ballot_hold,
         count(*) filter (where l.stage = 'queued') as queued,
         count(*) filter (where l.connection_sent_at is not null) as invited,
         count(*) filter (where l.connected_at is not null) as accepted,
         count(*) filter (where l.pk in (select pk from replies)) as replied,
         count(*) filter (where l.call_booked_at is not null) as booked,
         count(*) filter (where l.blacklisted or l.skip_state is not null) as parked
  from pros l
  where l.lane is not null
  group by l.lane
),
lead_msg as (
  select prospect_id,
         max(sent_at) filter (where direction = 'outbound'
           and is_reaction is distinct from true
           and channel is distinct from 'email') as last_dm_sent_at,
         max(sent_at) filter (where direction = 'inbound'
           and is_reaction is distinct from true
           ) as last_reply_at,   -- 2026-09-27: inbound email counts, dated by the email
         -- 2026-09-06 (Ivan: panel must show DM sent / follow-up sent): touches per person for the leads strip
         count(*) filter (where direction = 'outbound' and sent_at is not null
           and message_type = 'dm' and channel = 'linkedin') as dm_count,
         count(*) filter (where direction = 'outbound' and sent_at is not null
           and channel = 'linkedin_inmail') as inmail_count
  from msg
  group by prospect_id
),
leads_list as (
  select row_number() over (
           order by greatest(p.connection_sent_at, lm.last_dm_sent_at,
                             lm.last_reply_at, p.call_booked_at) desc nulls last,
                    p.name asc nulls last) as ord,
         p.name, p.company, p.lane,
         coalesce(p.source_kind = 'client_sourced_sponsor', false) as from_team,
         p.stage, p.connection_sent_at, lm.last_dm_sent_at, lm.last_reply_at, p.call_booked_at,
         coalesce(lm.dm_count, 0) as dm_count, coalesce(lm.inmail_count, 0) as inmail_count
  from pros p
  left join lead_msg lm on lm.prospect_id = p.id
  where (p.stage in ('queued','connection_sent','connected','dm_sent','replied')
         or p.call_booked_at is not null)
    and p.blacklisted is distinct from true
  order by ord
  limit 400
)
select jsonb_build_object(
  'counted_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'semantics_version', 'arch-launch-2026-08-26',
  'booked', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'prospect_id', id, 'name', name, 'company', company,
      'booked_at', call_booked_at,
      'connection_sent_at', connection_sent_at,
      'days_to_book', case
        when connection_sent_at is not null and call_booked_at >= connection_sent_at
        then round((extract(epoch from (call_booked_at - connection_sent_at)) / 86400.0)::numeric, 2)
      end
    ) order by call_booked_at desc), '[]'::jsonb) from booked),
  'speed', jsonb_build_object(
    'anchor', 'connection_sent_at',
    'accept', (select jsonb_build_object(
        'n', count(*),
        'median_days', round(percentile_cont(0.5) within group (order by accept_days)::numeric, 2)
      ) from spd where accept_days is not null),
    'reply', (select jsonb_build_object(
        'n', count(*),
        'median_days', round(percentile_cont(0.5) within group (order by reply_days)::numeric, 2)
      ) from spd where reply_days is not null),
    'book', (select jsonb_build_object(
        'n', count(*),
        'median_days', round(percentile_cont(0.5) within group (order by book_days)::numeric, 2),
        'fastest_days', round(min(book_days)::numeric, 2),
        'slowest_days', round(max(book_days)::numeric, 2)
      ) from spd where book_days is not null),
    'book_unmeasured', (select count(*) from booked
                         where connection_sent_at is null
                            or call_booked_at < connection_sent_at)
  ),
  'replied_7d', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'company', company, 'linkedin_profile_id', linkedin_profile_id,
      'last_reply_at', last_reply_at,
      'reply_intent', reply_intent, 'reply_intent_at', reply_intent_at
    ) order by last_reply_at desc), '[]'::jsonb) from r7n),
  'replied_weekly', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week_monday', wk::text, 'people', people
    ) order by wk), '[]'::jsonb) from weekly),
  'funnel', jsonb_build_object(
    'contacted', (select count(distinct pk) from msg
                   where direction = 'outbound' and sent_at is not null
                     and prospect_id not in (select prospect_id from obt)),
    'accepted', (select count(distinct pk) from pros
                  where connected_at is not null
                    and id not in (select prospect_id from obt)),
    'replied_people', (select count(distinct pk) from replies),
    'booked', (select count(*) from booked)
  ),
  'lanes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'lane', lane, 'total', total, 'ballot_hold', ballot_hold, 'queued', queued,
      'invited', invited, 'accepted', accepted, 'replied', replied,
      'booked', booked, 'parked', parked
    ) order by total desc), '[]'::jsonb) from lanes),
  'leads', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'company', company, 'lane', lane, 'from_team', from_team,
      'stage', stage, 'connection_sent_at', connection_sent_at,
      'last_dm_sent_at', last_dm_sent_at, 'last_reply_at', last_reply_at,
      'call_booked_at', call_booked_at, 'dm_count', dm_count, 'inmail_count', inmail_count
    ) order by ord), '[]'::jsonb) from leads_list)
)
$function$
;

CREATE OR REPLACE FUNCTION public.rise_outreach_truth_compute()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with camps as (
  select id from outreach_campaigns where client_id = 'risedtc'
),
pros as (
  select p.id, p.name, p.company, p.linkedin_profile_id, p.title,
         p.connection_sent_at, p.connected_at, p.call_booked_at, p.blacklisted,
         case when nullif(p.linkedin_profile_id, '') is not null
                then 'li:' || p.linkedin_profile_id
              when nullif(btrim(lower(coalesce(p.name, ''))), '') is not null
                then 'nm:' || btrim(lower(p.name))
              else 'pid:' || p.id::text end as pk
  from outreach_prospects p
  where p.campaign_id in (select id from camps)
),
msg as (
  select m.id, m.prospect_id, m.direction, m.sent_at, m.is_reaction, m.channel, pr.pk,
         m.reply_intent, m.reply_intent_at, pr.blacklisted
  from outreach_messages m
  join pros pr on pr.id = m.prospect_id
),
fm as (
  select distinct on (prospect_id) prospect_id, direction
  from msg
  where prospect_id is not null
  order by prospect_id, sent_at asc nulls last, id asc
),
obt as (
  select prospect_id from fm where direction = 'inbound'
),
ie as (
  select prospect_id from booking_attributions
  where client_id = 'risedtc' and verdict = 'inbound_engaged' and prospect_id is not null
),
-- 🔴 replies is the HISTORICAL ledger and is NOT blacklist-filtered. Excluding
-- blacklisted people here would move a week Mattan has already been shown:
-- measured 2026-08-25, week 2026-07-20 goes 4 -> 3, and 4 is the delivered figure.
-- A prospect blacklisted in August still replied in July, and a closed week may
-- never move. The blacklist exclusion is scoped to replied_7d, the forward-looking
-- roster, where a vendor or a phishing thread would otherwise render to the client.
replies as (
  select m.id, m.pk, m.prospect_id, m.sent_at, m.reply_intent, m.reply_intent_at, m.blacklisted,
         (date_trunc('week', (m.sent_at at time zone 'UTC')))::date as wk
  from msg m
  where m.direction = 'inbound'
    and m.is_reaction is distinct from true
    -- 2026-09-27 (Ivan): inbound EMAIL replies count, dated by the email, from the week this shipped on; the
    -- delivered weeks never move (the two August email replies stay out, per the closed-week rule above)
    and (m.channel is distinct from 'email' or m.sent_at >= '2026-09-21T00:00:00Z')
    and m.sent_at is not null
    and m.prospect_id not in (select prospect_id from obt)
),
weeks as (
  select generate_series(
           date '2026-07-13',
           (date_trunc('week', (now() at time zone 'UTC')))::date,
           interval '7 day')::date as wk
),
weekly as (
  select w.wk, count(distinct r.pk) as people
  from weeks w left join replies r on r.wk = w.wk
  group by w.wk
),
r7 as (
  select pk, max(sent_at) as last_reply_at
  from replies
  where sent_at >= now() - interval '7 days'
    and blacklisted is distinct from true
  group by pk
),
-- Intent shown for a person = the intent of their MOST RECENT inbound message, not
-- the best one in the thread. The roster answers "what is this conversation right
-- now", so a positive that has since turned into a no must read as the no. Ties
-- break on message id, matching the fm/who-spoke-first ordering used above.
r7i as (
  select distinct on (pk) pk, reply_intent, reply_intent_at
  from replies
  where sent_at >= now() - interval '7 days'
    and blacklisted is distinct from true
  order by pk, sent_at desc nulls last, id desc
),
r7n as (
  select r7.pk, r7.last_reply_at,
    (select p.name from pros p
      where p.pk = r7.pk and nullif(btrim(p.name), '') is not null
      order by p.connection_sent_at asc nulls last limit 1) as name,
    (select p.company from pros p
      where p.pk = r7.pk and nullif(btrim(p.company), '') is not null
      order by p.connection_sent_at asc nulls last limit 1) as company,
    (select p.linkedin_profile_id from pros p
      where p.pk = r7.pk and nullif(p.linkedin_profile_id, '') is not null limit 1) as linkedin_profile_id,
    i.reply_intent, i.reply_intent_at
  from r7 left join r7i i on i.pk = r7.pk
),
brief_rows as (
  select e->>'id' as mid, e->>'brief_url' as brief_url, e->>'scan_url' as scan_url
  from client_boards cb
  cross join lateral jsonb_array_elements(coalesce(cb.board->'precall_briefs', '[]'::jsonb)) e
  where cb.slug = 'risedtc-com'
),
briefs as (
  select ba.prospect_id, max(b.brief_url) as brief_url, max(b.scan_url) as scan_url
  from brief_rows b
  join booking_attributions ba on ba.meeting_id = b.mid and ba.prospect_id is not null
  group by ba.prospect_id
),
booked as (
  select p.id, p.name, p.company, p.call_booked_at, p.connection_sent_at,
         nullif(br.brief_url, '') as brief_url,
         nullif(br.scan_url, '') as scan_url
  from pros p
  left join briefs br on br.prospect_id = p.id
  where p.call_booked_at is not null
    and (p.id not in (select prospect_id from obt) or p.id in (select prospect_id from ie))
),
-- ============================================================================
-- THE CLOCK (2026-08-31, Ivan: "connection to booking time")
-- How long the lane takes, measured from ONE anchor: the moment the connection
-- request goes out. Three rungs off that same zero -- accepted, first reply,
-- booked call -- so the three figures compose into one sentence instead of
-- being three unrelated stats measured from three different starts.
--
-- Computed HERE and nowhere else. The panel and the weekly report both read it
-- from this RPC, for the same reason `replied` was single-sourced on 2026-08-26:
-- two implementations of one definition drift, and the day they disagree the
-- client reads one number on his board and another on his report.
--
-- RULES THIS CARRIES:
--  * People, not rows. Aggregated on pk exactly like every other count here, so
--    a person holding two prospect rows contributes one clock reading.
--  * Negative gaps are DROPPED, never clamped to zero. A booking stamped before
--    its own invite means the chain does not hold for that person (it happens:
--    an accept webhook can land after the call is already on the calendar), and
--    a clamped zero would print "same day" for a sequence we cannot vouch for.
--  * A booked person with no invite stamp (InMail and open-profile lanes DM
--    without ever sending an invite) is outside the measure, and the payload
--    says how many were left out rather than quietly shrinking the denominator.
--  * Median, not mean. n is small and one 30-day outlier drags a mean into a
--    number that describes nobody.
-- ============================================================================
spd_inv as (
  select pk,
         min(connection_sent_at) as invited_at,
         min(connected_at)       as accepted_at,
         min(call_booked_at)     as booked_at
  from pros
  where connection_sent_at is not null
    and id not in (select prospect_id from obt)
  group by pk
),
spd_reply as (
  select pk, min(sent_at) as first_reply_at from replies group by pk
),
spd as (
  select i.pk,
         case when i.accepted_at is not null and i.accepted_at >= i.invited_at
              then extract(epoch from (i.accepted_at - i.invited_at)) / 86400.0 end as accept_days,
         case when r.first_reply_at is not null and r.first_reply_at >= i.invited_at
              then extract(epoch from (r.first_reply_at - i.invited_at)) / 86400.0 end as reply_days,
         case when i.booked_at is not null and i.booked_at >= i.invited_at
              then extract(epoch from (i.booked_at - i.invited_at)) / 86400.0 end as book_days
  from spd_inv i
  left join spd_reply r on r.pk = i.pk
),
-- ============================================================================
-- funnel_gates  (goal-run rise-panel-truth-2026-08-25, phase 4)
-- "Mattan asked to SEE the filters." Section 7 showed looked-at -> queued and
-- stopped. These CTEs rebuild the real per-lane gate chain from the gate
-- verdicts already stored on outreach_prospects.enrichment_data + skip_reason.
--
-- KEY LIST RESOLVED FROM LIVE ROWS 2026-08-25, not from memory. Census:
--   warm engager (1757): exec_gate 58.9% -> store_recon_v2/name_gate/
--     shopify_verified/store_url/rise_note_final 41.1% -> ad_intel 36.6% /
--     vendor_check 36.5% / gold_icp_v2_seatless 36.5% -> title_gate 28.9% ->
--     revenue_signal 28.8%.  The DESCENDING presence cascade IS the order: a
--     row cut at gate N never receives gate N+1's key.
--   cold (521): shopify_verified + ad_intel 100% (they are the SOURCING
--     criteria here, not downstream filters) -> follower_check 96.9% ->
--     name_gate + vendor_check 85% -> store_recon_v2 64.7% -> gold 58%.
--   inbound_request (95) and profile_view (40): judge_reason only. No store,
--     ad, vendor or title gate has EVER run on these two lanes.
--   network_activation (46): source + bucket only. Zero gate data, ever.
--
-- THREE HONESTY RULES, each with the incident it exists for:
--  1. SENT IS TERMINAL AND WINS. 31 rows carry a cut reason stamped AFTER the
--     invite went out (exec_nonowner 15, employee_title_regate 16). Counting
--     those as "filtered" would tell Mattan we blocked someone he has already
--     messaged. They count as sent, and the retro-cut is reported separately.
--  2. untracked IS NEVER FOLDED INTO failed. A row that stopped at a stage
--     whose evidence key it does not carry has not been rejected - the gate
--     never ran on it. Folding those into fails is how a funnel invents a
--     strictness it does not have.
--  3. The tail is checked against the PICKER'S OWN PREDICATE, copied verbatim
--     from Connection Request Sender (5ZXtArhobWrDDpfJ) line 465 + the in-loop
--     name_gate and ads gates at lines 472-498. Where "waiting" and
--     "picker-eligible" disagree, the lane emits a discrepancy naming the
--     delta and the hold reasons rather than smoothing it.
-- ============================================================================
lanes(cid, lane, lane_label) as (values
  ('6549db14-3bdf-4462-a7ee-c97d762bb2cb','warm_engager','Warm - people who engaged with a competitor post'),
  ('9a9ee3a5-c3a6-452d-8442-52285248d70c','cold','Cold - DTC founders from Sales Navigator'),
  ('c46d5f86-878f-4ffc-a2aa-e00e92cbf4db','inbound_request','Inbound - people who asked to connect with Mattan'),
  ('cdc57dc3-bcee-4d7c-8dbd-6eabceb8ab9d','profile_view','Profile views - people who looked at Mattan'),
  ('a2194be6-6c18-429c-873e-2a120e505250','client_orbit','Client orbit - inside a current client network'),
  ('e8b77c17-33f3-4ef0-b417-20bf7ac46737','network_activation','Network activation - existing connections')
),
stagecat(lane, idx, stage, label, evidence_key, note) as (values
  ('warm_engager',1,'harvested','Engaged with a competitor post and got pulled in as a candidate','source',null::text),
  ('warm_engager',2,'owner_title','Is this the brand owner or founder, and not an employee or an agency rep?','exec_gate / title_gate','By far the biggest cut in the whole engine. Two recorded verdicts: exec_nonowner (works there, cannot buy) and bizdev_nonbuyer (agency or vendor business development).'),
  ('warm_engager',3,'store_recon','Do they run a real store - products, store age, price band, reviews?','store_recon_v2',null),
  ('warm_engager',4,'own_brand','Is it their own brand, and not a dropshipper reselling other people goods?','vendor_check','Recorded on every row that reaches it, but nothing in the send path reads it. It informs a human decision; it does not auto-cut.'),
  ('warm_engager',5,'ads_gate','Are they spending on paid ads right now?','ad_intel.paid_active_any_network','Mattan hard gate, live as integration_config rise_ads_gate=on since 2026-08-19. It only cuts when BOTH networks answered definitively - Google checked and silent AND Meta returning page_no_ads. Unable-to-check passes on purpose (fail open) and sorts last.'),
  ('warm_engager',6,'icp_fit','Right size and right fit - not too big, not too small, not already known','gold_icp_v2_seatless / icp_score',null),
  ('warm_engager',7,'armed','A personalised invite has been written and cleared to send','rise_note_final / name_gate',null),
  ('warm_engager',8,'queued','Waiting in the connect queue for a daily slot','picker predicate',null),
  ('warm_engager',9,'sent','Connection request actually sent','connection_sent_at',null),
  ('cold',1,'harvested','Pulled from Sales Navigator against the DTC search','source',null),
  ('cold',2,'store_verify','Does the domain resolve to a real Shopify storefront?','shopify_verified / store_url',null),
  ('cold',3,'ads_gate','Are they spending on paid ads right now?','ad_intel.paid_active_any_network','Every cold row carries an ad reading, because ad presence is part of how this lane is sourced. Zero cold rows meet the definite-no test, so the ads gate cuts nothing here - it ranks.'),
  ('cold',4,'liveness','Is the LinkedIn profile alive - posting recently, real follower base?','liveness_checked_at / follower_check',null),
  ('cold',5,'own_brand','Is it their own brand, and not a dropshipper reselling other people goods?','vendor_check',null),
  ('cold',6,'store_recon','Store substance - products, store age, price band, reviews','store_recon_v2',null),
  ('cold',7,'icp_fit','Right size and right fit - not too big, not too small, not already known','gold_icp_v2_seatless / icp_score',null),
  ('cold',8,'armed','A personalised invite has been written and cleared to send','rise_note_final / name_gate',null),
  ('cold',9,'queued','Waiting in the connect queue for a daily slot','picker predicate',null),
  ('cold',10,'sent','Connection request actually sent','connection_sent_at',null),
  ('profile_view',1,'viewed','Looked at Mattan profile','viewed_at',null),
  ('profile_view',2,'icp_fit','Are they a DTC brand owner, and not a vendor, recruiter or agency?','judge_reason',null),
  ('profile_view',3,'audience_floor','Does their audience clear the floor?','audience_floor',null),
  ('profile_view',4,'queued','Waiting in the connect queue for a daily slot','picker predicate',null),
  ('profile_view',5,'sent','Actually contacted - connection request or DM','connection_sent_at / stage',null::text),
  ('inbound_request',1,'request_received','Sent Mattan a connection request','invitation_id',null),
  ('inbound_request',2,'icp_fit','Are they a DTC brand owner, and not a vendor, recruiter or spammer?','judge_reason / judge_score','This lane runs ONE gate. No store check, no ad check, no vendor check has ever run on an inbound request - they are qualified on intent, not on fit evidence.'),
  ('inbound_request',3,'accepted','Accepted and moved into a conversation','stage',null),
  ('client_orbit',1,'harvested','Sits inside a current client network','anchor_client',null),
  ('client_orbit',2,'name_clearance','Cleared by name - safe to approach given the client relationship','name_gate',null),
  ('client_orbit',3,'store_recon','Do they run a real store - products, store age, price band, reviews?','store_recon',null),
  ('client_orbit',4,'queued','Waiting in the connect or InMail queue','picker predicate',null),
  ('client_orbit',5,'sent','Actually contacted - connection request, InMail or DM','connection_sent_at / stage',E'This lane is InMail-led. 14 rows sit at inmail_ready, which is a queue state, not a send.'),
  ('network_activation',1,'harvested','Already a first-degree connection of Mattan','source',null),
  ('network_activation',2,'qualified','No qualification has ever been run on this lane','(none)','46 rows harvested, zero gate keys of any kind, zero sends. This lane was built and never switched on. Reported as untracked, not as passed.')
),
gp as (
  select pr.id, pr.stage, pr.skip_reason, pr.blacklisted, pr.country, pr.preferred_channel,
         pr.icp_score, pr.last_dm_sent_at, pr.liveness_checked_at, pr.connection_sent_at,
         l.lane, l.lane_label, l.cid,
         regexp_replace(coalesce(pr.skip_reason,''), '[:(].*$', '') as sr,
         coalesce(pr.enrichment_data, '{}'::jsonb) as ed
  from outreach_prospects pr
  join lanes l on l.cid = pr.campaign_id::text
),
gcls as (
  select g.*,
    (g.connection_sent_at is not null) as sent,
    (g.ed ? 'exec_gate') as k_exec,
    (g.ed ? 'store_recon_v2' or g.ed ? 'store_recon') as k_recon,
    (g.ed ? 'vendor_check') as k_vendor,
    (g.ed ? 'ad_intel') as k_ad,
    (g.ed ? 'gold_icp_v2_seatless' or g.icp_score is not null) as k_icp,
    (g.ed->>'rise_note_final' is not null) as k_armed,
    (g.ed ? 'shopify_verified') as k_shop,
    (g.liveness_checked_at is not null or g.ed ? 'follower_check') as k_live,
    (g.ed ? 'name_gate') as k_name,
    (g.ed ? 'judge_reason') as k_judge,
    (g.ed ? 'audience_floor') as k_aud,
    (g.ed ? 'ad_intel'
      and coalesce((g.ed->'ad_intel'->>'paid_active_any_network')='true', false) = false
      and (g.ed->'ad_intel'->'google'->>'checked') = 'true'
      and coalesce((g.ed->'ad_intel'->'google'->>'active')='true', false) = false
      and (g.ed->'ad_intel'->>'meta_outcome') = 'page_no_ads') as ads_cut,
    -- Connection Request Sender 5ZXtArhobWrDDpfJ line 465 base predicate,
    -- plus the in-loop name_gate skip (line 472) and ads gate (lines 484-497).
    (g.blacklisted is not true
      and g.country is not null
      and g.connection_sent_at is null
      and g.last_dm_sent_at is null
      and g.stage in ('identified','enriched')
      and (g.preferred_channel is null or g.preferred_channel = 'linkedin')
      and (g.lane <> 'cold' or (g.ed->>'rise_note_final' is not null and g.liveness_checked_at is not null))
      and (g.lane <> 'warm_engager' or g.ed->>'rise_note_final' is not null)
      and coalesce(g.ed->'name_gate'->>'status','') <> 'blocked_until_mattan_ok'
      and not (g.ed ? 'ad_intel'
               and coalesce((g.ed->'ad_intel'->>'paid_active_any_network')='true', false) = false
               and (g.ed->'ad_intel'->'google'->>'checked') = 'true'
               and coalesce((g.ed->'ad_intel'->'google'->>'active')='true', false) = false
               and (g.ed->'ad_intel'->>'meta_outcome') = 'page_no_ads')
    ) as picker_ok,
    case when g.blacklisted is true then 'blacklisted'
         when g.country is null then 'no country on the row'
         when g.last_dm_sent_at is not null then 'already DM-ed, not a first touch'
         when g.stage = 'ballot_hold' then 'held on a ballot awaiting Ivan'
         when g.stage not in ('identified','enriched') then 'stage ' || g.stage
         when not (g.preferred_channel is null or g.preferred_channel = 'linkedin') then 'routed to ' || g.preferred_channel
         when g.ed->>'rise_note_final' is null then 'no invite copy written yet'
         when g.lane = 'cold' and g.liveness_checked_at is null then 'liveness never checked'
         when coalesce(g.ed->'name_gate'->>'status','') = 'blocked_until_mattan_ok' then 'name blocked until Mattan OKs'
         else 'eligible' end as hold_reason
  from gp g
),
gasg as (
  select c.*,
    case
      when c.sent then case c.lane when 'inbound_request' then 'accepted' when 'network_activation' then 'qualified' else 'sent' end
      when c.lane = 'inbound_request' and c.stage in ('replied','dm_sent','inbound_request_dm','inbound_accepted_no_dm','lm_delivered','inbound_personal') then 'accepted'
      when c.lane = 'profile_view' and c.stage in ('replied','dm_sent','connected') then 'sent'
      when c.lane = 'client_orbit' and c.stage in ('replied','dm_sent','connected') then 'sent'
      when c.lane in ('warm_engager','cold') and (c.k_exec
           or c.sr in ('exec_nonowner','bizdev_nonbuyer','not_founder_dtc','identity_mismatch_row_vs_linkedin_profile')
           or c.sr like 'employee_title_regate%')
        then case c.lane when 'warm_engager' then 'owner_title' else 'icp_fit' end
      when c.sr in ('store_not_live','store_not_real','not_dtc','not_dtc_brand','vc_backed_marketplace') or c.sr like 'Data-quality%'
        then case c.lane when 'cold' then 'store_verify' when 'warm_engager' then 'store_recon' when 'client_orbit' then 'store_recon' else 'icp_fit' end
      when c.sr like 'restricted_category%' or c.sr like 'PHISHING%'
        then case c.lane when 'warm_engager' then 'store_recon' when 'cold' then 'store_recon' else 'icp_fit' end
      when c.sr = 'vendor_not_store' then case c.lane when 'warm_engager' then 'own_brand' when 'cold' then 'own_brand' else 'icp_fit' end
      when c.sr = 'liveness' then case c.lane when 'cold' then 'liveness' when 'warm_engager' then 'icp_fit' else 'icp_fit' end
      when c.sr in ('low_icp_auto_archived','too_famous','too_established','icp','REVIEW_HOLD','rescore_failed',
                    'inbound_request_not_icp','profile_view_not_icp','inbound_vendor_pitch',
                    'mattan_prior_chat','prospect_is_roster_anchor','stale_thread')
           or c.sr like 'ICP right-size%' or c.sr like 'duplicate_of%'
        then 'icp_fit'
      when c.lane = 'warm_engager' then
        case when not c.k_recon then 'store_recon' when not c.k_vendor then 'own_brand'
             when not c.k_ad or c.ads_cut then 'ads_gate' when not c.k_icp then 'icp_fit'
             when not c.k_armed then 'armed' else 'queued' end
      when c.lane = 'cold' then
        case when not c.k_shop then 'store_verify' when not c.k_ad or c.ads_cut then 'ads_gate'
             when not c.k_live then 'liveness' when not c.k_vendor then 'own_brand'
             when not c.k_recon then 'store_recon' when not c.k_icp then 'icp_fit'
             when not c.k_armed then 'armed' else 'queued' end
      when c.lane = 'profile_view' then
        case when not c.k_judge then 'icp_fit' when not c.k_aud then 'audience_floor' else 'queued' end
      when c.lane = 'inbound_request' then
        case when not c.k_judge then 'icp_fit' else 'accepted' end
      when c.lane = 'client_orbit' then
        case when not c.k_name then 'name_clearance' when not c.k_recon then 'store_recon' else 'queued' end
      else 'qualified'
    end as cut_stage,
    case
      when c.sent then 'passed'
      when c.lane = 'inbound_request' and c.stage in ('replied','dm_sent','inbound_request_dm','inbound_accepted_no_dm','lm_delivered','inbound_personal') then 'passed'
      when c.lane in ('profile_view','client_orbit') and c.stage in ('replied','dm_sent','connected') then 'passed'
      when c.skip_reason is not null or c.k_exec or c.ads_cut then 'failed'
      else 'pending' end as kind0
  from gcls c
),
gasg2 as (
  select a.*,
    case
      when a.kind0 <> 'pending' then a.kind0
      when a.lane='warm_engager' and a.cut_stage='store_recon' and not a.k_recon then 'untracked'
      when a.lane='warm_engager' and a.cut_stage='own_brand'   and not a.k_vendor then 'untracked'
      when a.lane='warm_engager' and a.cut_stage='ads_gate'    and not a.k_ad then 'untracked'
      when a.lane='warm_engager' and a.cut_stage='icp_fit'     and not a.k_icp then 'untracked'
      when a.lane='warm_engager' and a.cut_stage='armed'       and not a.k_armed then 'untracked'
      when a.lane='cold' and a.cut_stage='store_verify' and not a.k_shop then 'untracked'
      when a.lane='cold' and a.cut_stage='ads_gate'     and not a.k_ad then 'untracked'
      when a.lane='cold' and a.cut_stage='liveness'     and not a.k_live then 'untracked'
      when a.lane='cold' and a.cut_stage='own_brand'    and not a.k_vendor then 'untracked'
      when a.lane='cold' and a.cut_stage='store_recon'  and not a.k_recon then 'untracked'
      when a.lane='cold' and a.cut_stage='icp_fit'      and not a.k_icp then 'untracked'
      when a.lane='cold' and a.cut_stage='armed'        and not a.k_armed then 'untracked'
      when a.lane='profile_view' and a.cut_stage='icp_fit' and not a.k_judge then 'untracked'
      when a.lane='profile_view' and a.cut_stage='audience_floor' and not a.k_aud then 'untracked'
      when a.lane='inbound_request' and a.cut_stage='icp_fit' and not a.k_judge then 'untracked'
      when a.lane='client_orbit' and a.cut_stage='name_clearance' and not a.k_name then 'untracked'
      when a.lane='client_orbit' and a.cut_stage='store_recon' and not a.k_recon then 'untracked'
      when a.lane='network_activation' then 'untracked'
      else 'pending' end as kind
  from gasg a
),
gidx as (
  select a.lane, a.id, a.kind, a.picker_ok, a.hold_reason, s.idx as cut_idx, a.cut_stage
  from gasg2 a join stagecat s on s.lane = a.lane and s.stage = a.cut_stage
),
gper as (
  select sc.lane, sc.idx, sc.stage, sc.label, sc.evidence_key, sc.note,
    (select count(*) from gidx i where i.lane=sc.lane and i.cut_idx >= sc.idx) as entered,
    (select count(*) from gidx i where i.lane=sc.lane and i.cut_idx = sc.idx and i.kind='failed') as failed,
    (select count(*) from gidx i where i.lane=sc.lane and i.cut_idx = sc.idx and i.kind='untracked') as untracked,
    (select count(*) from gidx i where i.lane=sc.lane and i.cut_idx = sc.idx and i.kind='pending') as pending,
    (select count(*) from gidx i where i.lane=sc.lane and i.cut_idx = sc.idx and i.kind='passed') as arrived
  from stagecat sc
),
gtail as (
  select l.lane,
    (select count(*) from gidx i where i.lane=l.lane and i.kind='pending' and i.cut_stage in ('queued','accepted','qualified') and i.picker_ok) as eligible_now,
    (select count(*) from gidx i where i.lane=l.lane and i.kind='pending' and i.cut_stage in ('queued','accepted','qualified')) as waiting,
    (select count(*) from gcls c where c.lane=l.lane and c.sent and c.skip_reason is not null
        and (c.k_exec or c.sr in ('exec_nonowner','bizdev_nonbuyer','not_founder_dtc') or c.sr like 'employee_title_regate%'
             or c.sr like 'restricted_category%' or c.sr in ('low_icp_auto_archived','too_famous','too_established','icp','liveness'))) as retro_cut,
    (select count(*) from gidx i where i.lane=l.lane and i.kind='passed') as contacted,
    -- INDEPENDENT re-measure of the picker's own predicate across the WHOLE lane, not just
    -- the rows this funnel shows waiting. The two disagree on purpose: the picker never reads
    -- skip_reason and never requires the store or vendor checks to have finished, so a row this
    -- funnel reports as cut or unfinished can still be picked. That leak is stated, not smoothed.
    (select count(*) from gcls c where c.lane=l.lane and c.picker_ok) as elig_all,
    (select count(*) from gidx i where i.lane=l.lane and i.picker_ok and i.kind='failed') as elig_cut,
    (select count(*) from gidx i where i.lane=l.lane and i.picker_ok and i.kind='untracked') as elig_untracked,
    (select coalesce(jsonb_object_agg(hr, n), '{}'::jsonb) from (
        select i.hold_reason hr, count(*) n from gidx i
        where i.lane=l.lane and i.kind='pending' and i.cut_stage in ('queued','accepted','qualified') and not i.picker_ok
        group by 1) z) as holds
  from lanes l
),
gjson as (
  select jsonb_build_object(
    'computed_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source', 'outreach_prospects.enrichment_data + skip_reason, per risedtc campaign, full population',
    'reading', 'entered = reached this gate. passed = cleared it and moved to the next line. failed = this gate stopped them. untracked = this gate never ran on them, so we are not claiming a verdict. waiting = still in front of this gate today.',
    'lanes', (
      select coalesce(jsonb_agg(x order by x->>'lane'), '[]'::jsonb) from (
        select jsonb_build_object(
          'lane', l.lane,
          'lane_label', l.lane_label,
          'campaign_id', l.cid,
          'total', (select count(*) from gp g where g.lane = l.lane),
          'connection_sent_at_total', (select count(*) from gcls c where c.lane = l.lane and c.sent),
          'contacted_total', t.contacted,
          'retro_cut', t.retro_cut,
          'picker_eligible_now', t.eligible_now,
          'picker_eligible_anywhere', t.elig_all,
          'stages', (select coalesce(jsonb_agg(jsonb_build_object(
                'stage', p.stage,
                'label_plain_english', p.label,
                'evidence_key', p.evidence_key,
                'entered', p.entered,
                'passed', p.entered - p.failed - p.untracked - p.pending - p.arrived,
                'failed', p.failed,
                'untracked', p.untracked,
                'waiting', p.pending,
                'arrived', p.arrived,
                'note', p.note
              ) order by p.idx), '[]'::jsonb) from gper p where p.lane = l.lane),
          'discrepancy', (
            case when t.waiting <> t.eligible_now or t.retro_cut > 0 or t.elig_all <> t.eligible_now
                   or t.contacted <> (select count(*) from gcls c where c.lane = l.lane and c.sent) then
              nullif(concat_ws(' ',
                case when t.waiting <> t.eligible_now then
                  format('%s rows are sitting at the queue line but only %s are pickable right now; the other %s are held: %s.',
                    t.waiting, t.eligible_now, t.waiting - t.eligible_now,
                    coalesce((select string_agg(k || ' x' || v, ', ' order by (v)::int desc)
                              from jsonb_each_text(t.holds) as e(k,v)), 'reason not resolved'))
                end,
                case when t.retro_cut > 0 then
                  format('%s rows carry a cut reason stamped AFTER the invite had already been sent; they are counted as sent, not as filtered.', t.retro_cut)
                end,
                case when t.elig_all <> t.eligible_now then
                  format('%s rows anywhere in this lane still satisfy the send picker own filter, but only %s of them are shown waiting at the queue line. The picker never reads skip_reason and never requires the store or vendor checks to have finished, so %s rows this funnel reports as cut and %s it reports as never-checked are still sendable today.',
                    t.elig_all, t.eligible_now, t.elig_cut, t.elig_untracked)
                end,
                case when t.contacted <> (select count(*) from gcls c where c.lane = l.lane and c.sent) then
                  format('The contacted figure is %s but connection_sent_at is stamped on only %s: this lane also reaches people by InMail or DM, which never stamps that column.',
                    t.contacted, (select count(*) from gcls c where c.lane = l.lane and c.sent))
                end), '')
            else null end)
        ) as x
        from lanes l join gtail t on t.lane = l.lane
      ) s)
  ) as gates
)
select jsonb_build_object(
  'counted_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'semantics_version', 'clientweekpacket-2026-08-25',
  'booked', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'prospect_id', id, 'name', name, 'company', company,
      'booked_at', call_booked_at, 'brief_url', brief_url, 'scan_url', scan_url,
      'connection_sent_at', connection_sent_at,
      -- null, never 0, when there is no invite stamp or the booking predates it.
      'days_to_book', case
        when connection_sent_at is not null and call_booked_at >= connection_sent_at
        then round((extract(epoch from (call_booked_at - connection_sent_at)) / 86400.0)::numeric, 2)
      end
    ) order by call_booked_at desc), '[]'::jsonb) from booked),
  'speed', jsonb_build_object(
    'anchor', 'connection_sent_at',
    'accept', (select jsonb_build_object(
        'n', count(*),
        'median_days', round(percentile_cont(0.5) within group (order by accept_days)::numeric, 2)
      ) from spd where accept_days is not null),
    'reply', (select jsonb_build_object(
        'n', count(*),
        'median_days', round(percentile_cont(0.5) within group (order by reply_days)::numeric, 2)
      ) from spd where reply_days is not null),
    'book', (select jsonb_build_object(
        'n', count(*),
        'median_days', round(percentile_cont(0.5) within group (order by book_days)::numeric, 2),
        'fastest_days', round(min(book_days)::numeric, 2),
        'slowest_days', round(max(book_days)::numeric, 2)
      ) from spd where book_days is not null),
    -- Booked people the clock cannot measure, named as a count so the reader can
    -- see the measure's own denominator against the booked total above.
    'book_unmeasured', (select count(*) from booked
                         where connection_sent_at is null
                            or call_booked_at < connection_sent_at)
  ),
  'replied_7d', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'company', company, 'linkedin_profile_id', linkedin_profile_id,
      'last_reply_at', last_reply_at,
      'reply_intent', reply_intent, 'reply_intent_at', reply_intent_at
    ) order by last_reply_at desc), '[]'::jsonb) from r7n),
  'replied_weekly', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week_monday', wk::text, 'people', people
    ) order by wk), '[]'::jsonb) from weekly),
  'funnel', jsonb_build_object(
    'contacted', (select count(distinct pk) from msg
                   where direction = 'outbound' and sent_at is not null
                     and prospect_id not in (select prospect_id from obt)),
    'accepted', (select count(distinct pk) from pros
                  where connected_at is not null
                    and id not in (select prospect_id from obt)),
    'replied_people', (select count(distinct pk) from replies),
    'booked', (select count(*) from booked)
  ),
  'funnel_gates', (select gates from gjson)
) || jsonb_build_object('month', (
  -- instantly-picks-2026-09-22: the monthly report's own numbers for the CURRENT renewal period,
  -- [most recent 17th 00:00 UTC <= now, now), each from rise_month_numbers() (a port of the
  -- IHOpAedk4gJFNQo4 Client Week Packet counts). by_week = 7-day slices from window_start, the
  -- last one open (end null, counted to now). Weekly replies are people per slice and do not sum
  -- to the month figure, which counts each person once.
  with mw as (
    select case when extract(day from (now() at time zone 'UTC')) >= 17
                then (date_trunc('month', now() at time zone 'UTC') + interval '16 days')::date
                else (date_trunc('month', now() at time zone 'UTC') - interval '1 month' + interval '16 days')::date
           end as ws
  ),
  mt as (
    select ws, (ws::timestamp at time zone 'UTC') as ws_ts from mw
  ),
  sl as (
    select g as st, g + interval '7 days' as en
    from mt, generate_series(mt.ws_ts, now(), interval '7 days') as g
    where g < now()
  ),
  slj as (
    select st, en, en > now() as open,
           public.rise_month_numbers(st, case when en > now() then now() else en end) as n
    from sl
  )
  select jsonb_build_object(
    'window_start', to_char(mt.ws, 'YYYY-MM-DD'),
    'window_end', null,
    'next_report', to_char((mt.ws + interval '1 month')::date, 'YYYY-MM-DD'),
    'invites', mn->'invites',
    'accepted', mn->'accepted',
    'replies', mn->'replied',
    'booked', mn->'callsBooked',
    'by_week', coalesce((select jsonb_agg(jsonb_build_object(
        'start', to_char(st at time zone 'UTC', 'YYYY-MM-DD'),
        'end', case when open then null else to_char(en at time zone 'UTC', 'YYYY-MM-DD') end,
        'invites', n->'invites',
        'accepted', n->'accepted',
        'replies', n->'replied',
        'booked', n->'callsBooked'
      ) order by st) from slj), '[]'::jsonb)
  )
  from mt, lateral (select public.rise_month_numbers(mt.ws_ts, now()) as mn) m
))
$function$
;
