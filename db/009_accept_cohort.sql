-- Connection acceptance per client. COHORT style: denominator = connection_notes
-- SENT in the window; numerator = those same rows whose prospect connected at/after
-- the note (connected_at >= sent_at). Replaces the prior trailing style (005), whose
-- numerator (accepts by connected_at) and denominator (sends by sent_at) were drawn
-- from disjoint populations — cross-cohort inflation, structurally unbounded (>100%
-- reachable in a send-throttle week; ivan measured 07-24: trailing 29.3% vs cohort
-- 19.5%, 4 of 12 accepted_7d credited from notes sent before the 7d window).
-- NOTE this number no longer matches the trailing rate outreach_sender_health /
-- inbox_governor react to (see db/012_governor_v2.sql) — do not "reconcile" them,
-- they answer different questions on purpose.
-- Known, accepted edge semantics (measured 2026-07-24, do not re-litigate without
-- new data — see goal-runs/sends-kpi-elevation-2026-07-24/phase1/s1-cohort-skeptic.md):
--  * connected_at < sent_at (1 row ever): counts as a failed send in the denominator,
--    never in the numerator — a note to an already-connected prospect is a wasted send.
--  * two different notes to one prospect before a single accept (1 prospect ever):
--    both rows count as accepted; per-note over per-note stays <= 100%.
--  * Recent sends are right-censored: window rates are floors that rise as sends
--    mature (median accept lag 0.49d; ~90% of accepts land within 7d) — surfaced in
--    the UI caption, not corrected here.
-- Column shape UNCHANGED from 005 (client_id, sent_7d, accepted_7d, sent_30d,
-- accepted_30d, sent_total, accepted_total, rate_7d, rate_30d) — frontend-safe.
-- Phantom-dedup: distinct on (m.prospect_id, m.message_text, m.sent_at), same guard
-- as db/003_sends_views.sql.
-- Expected values at authoring time (2026-07-24, live snapshot):
--   ivan     sent_7d=41  accepted_7d=8  rate_7d=19.5  sent_30d=250 accepted_30d=52 rate_30d=20.8
--   risedtc  sent_7d=57  accepted_7d=3  rate_7d=5.3   sent_30d=57  accepted_30d=3  rate_30d=5.3
create or replace view inbox_accept_v with (security_invoker = on) as
with sends as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id, m.sent_at, p.connected_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound' and m.message_type = 'connection_note'
    and m.sent_at is not null
  order by m.prospect_id, m.message_text, m.sent_at, m.id
),
flagged as (
  select client_id, sent_at,
    (connected_at is not null and connected_at >= sent_at) as accepted
  from sends
)
select
  client_id,
  count(*) filter (where sent_at >= now() - interval '7 days')                          as sent_7d,
  count(*) filter (where sent_at >= now() - interval '7 days' and accepted)             as accepted_7d,
  count(*) filter (where sent_at >= now() - interval '30 days')                         as sent_30d,
  count(*) filter (where sent_at >= now() - interval '30 days' and accepted)            as accepted_30d,
  count(*)                                                                              as sent_total,
  count(*) filter (where accepted)                                                      as accepted_total,
  round(100.0 * count(*) filter (where sent_at >= now() - interval '7 days' and accepted)
        / nullif(count(*) filter (where sent_at >= now() - interval '7 days'),0), 1)    as rate_7d,
  round(100.0 * count(*) filter (where sent_at >= now() - interval '30 days' and accepted)
        / nullif(count(*) filter (where sent_at >= now() - interval '30 days'),0), 1)   as rate_30d
from flagged group by client_id;
