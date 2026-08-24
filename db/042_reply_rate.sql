-- 042: Reply rate per client. Ivan, 2026-08-24: "I'm tracking at send rate, but
-- I'm not tracking reply rates."
--
-- COHORT BASIS, not trailing. Denominator = people DM'd inside the window;
-- numerator = how many of THOSE have replied by now. A trailing basis (replies
-- landing in the window over DMs sent in the window) mixes two populations and
-- reads as broken arithmetic on any week where the two differ, which is the
-- exact defect the month-1 client report was rebuilt to remove.
--
-- Measured from the first touch that can actually earn a reply. Ivan asked for
-- "post connection note, or post DM1 when the note is empty"; there are ZERO
-- empty notes on either lane (checked 2026-08-24, 728 Rise + 1538 Ivan invites,
-- every one carries note text), so the empty-note branch has no rows to serve
-- and is deliberately not built. The gate that matters is the accept: a note is
-- only read if they accept, so the honest denominator is accepted AND DM'd.
--
-- Warm-era cutoff mirrors 017/018: Ivan counts only from 2026-07-11, Rise keeps
-- full history. Without it Ivan's pre-warm-era rows inflate his side of the
-- comparison, which is how the first cut of this number was measured wrong.
create or replace view inbox_reply_v with (security_invoker = on) as
with base as (
  select coalesce(c.client_id, 'ivan') as client_id,
         pr.connected_at, pr.last_dm_sent_at, pr.last_reply_at
  from outreach_prospects pr
  join outreach_campaigns c on c.id = pr.campaign_id
  where pr.connection_sent_at is not null
    and pr.connected_at is not null
    and pr.last_dm_sent_at is not null
    and not (coalesce(c.client_id, 'ivan') = 'ivan' and pr.connection_sent_at < '2026-07-11')
)
select
  client_id,
  count(*) filter (where last_dm_sent_at >= now() - interval '7 days')                    as dmd_7d,
  count(*) filter (where last_dm_sent_at >= now() - interval '7 days'
                     and last_reply_at is not null)                                       as replied_7d,
  count(*) filter (where last_dm_sent_at >= now() - interval '30 days')                   as dmd_30d,
  count(*) filter (where last_dm_sent_at >= now() - interval '30 days'
                     and last_reply_at is not null)                                       as replied_30d,
  count(*)                                                                                as dmd_total,
  count(*) filter (where last_reply_at is not null)                                       as replied_total,
  round(100.0 * count(*) filter (where last_dm_sent_at >= now() - interval '7 days'
                                   and last_reply_at is not null)
        / nullif(count(*) filter (where last_dm_sent_at >= now() - interval '7 days'), 0), 1) as rate_7d,
  round(100.0 * count(*) filter (where last_dm_sent_at >= now() - interval '30 days'
                                   and last_reply_at is not null)
        / nullif(count(*) filter (where last_dm_sent_at >= now() - interval '30 days'), 0), 1) as rate_30d,
  round(100.0 * count(*) filter (where last_reply_at is not null)
        / nullif(count(*), 0), 1)                                                         as rate_total
from base
group by client_id;

grant select on inbox_reply_v to anon, authenticated;
