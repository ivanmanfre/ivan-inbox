-- 023: Two accuracy fixes for the Sends tab views (found in the 2026-07-31 audit,
-- session 3586434b — full diff against a paged recomputation of outreach_messages).
--
-- Fix 1 — campaign-less DMs dropped: inbox_sends_v and inbox_sends_daily_v inner-join
--   outreach_campaigns, so a DM whose prospect has campaign_id NULL (mostly
--   manual_mirror rows: Ivan's own hand-sent DMs the mirror logs) vanishes from the
--   counts. Live impact at audit time: Ivan DMs read 121, reality since era = 135.
--   → LEFT JOIN + the existing coalesce(client_id,'ivan') keeps them, attributed to Ivan.
--
-- Fix 2 — Ivan's blocked counter always 0: the era clause
--   `not (ivan and m.sent_at < '2026-07-11')` evaluates NULL for blocked rows
--   (sent_at IS NULL), and a NULL where-clause drops the row — so every Ivan blocked
--   row is invisible (31 real non-discarded blocked DMs at audit time). Rise was
--   unaffected (era clause short-circuits false → not(false) = true).
--   → null-safe rewrite: keep a row when it's Rise, OR sent in-era, OR blocked in-era.
--
-- inbox_campaign_sends_v is untouched: it counts sent rows only (no blocked column)
-- and per-campaign attribution genuinely requires a campaign row — verified exact
-- against raw for every Rise + Ivan campaign on 2026-07-31.
--
-- Era rule (db/017+018) is unchanged: Ivan counts from 2026-07-11, Rise full history.

create or replace view inbox_sends_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id,
    m.message_type,
    coalesce(m.channel, 'linkedin') as channel,
    m.sent_at,
    m.send_blocked_at,
    m.send_blocked_reason
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  left join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.message_type = any (array['connection_note','dm','inmail','email'])
    -- warm-era cutoff, null-safe (fix 2): Rise keeps all; Ivan keeps rows sent OR
    -- blocked on/after the era start. Pre-era blocked noise stays out by the same rule.
    and (
      coalesce(c.client_id, 'ivan') <> 'ivan'
      or m.sent_at >= '2026-07-11'
      or m.send_blocked_at >= '2026-07-11'
    )
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select client_id, message_type, channel,
  count(*) filter (where sent_at is not null)                                   as sent_total,
  count(*) filter (where sent_at >= now() - interval '24 hours')                as sent_24h,
  count(*) filter (where sent_at >= now() - interval '7 days')                  as sent_7d,
  count(*) filter (where sent_at >= now() - interval '30 days')                 as sent_30d,
  count(*) filter (where send_blocked_at is not null
                   and send_blocked_reason <> 'discarded_in_inbox')             as blocked,
  max(sent_at) as last_sent
from dedup
group by client_id, message_type, channel;

create or replace view inbox_sends_daily_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    coalesce(c.client_id, 'ivan') as client_id,
    m.message_type,
    m.sent_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  left join outreach_campaigns c on c.id = p.campaign_id
  where m.direction = 'outbound'
    and m.sent_at >= now() - interval '90 days'
    and m.message_type = any (array['connection_note','dm','inmail','email'])
    -- warm-era cutoff (null-safe form for consistency; sent_at is never null here)
    and (coalesce(c.client_id, 'ivan') <> 'ivan' or m.sent_at >= '2026-07-11')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select client_id, message_type,
  to_char(date_trunc('day', sent_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
  count(*) as sent
from dedup
group by 1, 2, 3;
