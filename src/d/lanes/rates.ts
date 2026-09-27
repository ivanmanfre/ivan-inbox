/* ==========================================================================
   src/d/lanes/rates.ts — the Performance rates, pure.

   Every rate is a count over a count from rows the app already reads, never a
   stored percentage re-rounded, and the two counts ride along so the chart can
   say "142 of 726". Seats are never added together; a lane with nothing to
   judge has pct null (drawn as "nothing to judge yet", never 0%).

   Acceptance per lane: the send monitor's payload, `ranges.rows` for the seat,
     channel invitation, the chosen window, one row per source lane:
     accepted_within_72h ÷ matured_denominator (invites in the window that are
     at least 72h old; an invite younger than 72h is not judged yet).
   Reply per lane: the same payload, channel dm, per source lane, reply_cohort:
     replied_within_72h ÷ first_messaged (people whose FIRST DM went out in the
     window). The payload carries no matured denominator for replies, so the
     newest 3 days of the window count in the base before they had 72h: the
     rate reads a little low, and the tooltip says so.
   Acceptance per campaign: `inbox_campaign_perf_v` (db/214), last 7 days:
     accept_72h ÷ accept_judged (invites sent 7 days to 72h ago).
   ========================================================================== */
import type { CcPayload, CcRangeRow } from '../../lib/campaignControl'
import { shortName, type CampaignPerf } from '../../lib/campaignPerf'
import type { Seat } from '../seats'
import { laneLabel } from './labels'
import type { Range } from './model'

export type RateRow = { key: string; label: string; hit: number; base: number; pct: number | null; sent: number }

const SOURCE: Record<string, string> = {
  cold: 'Cold', warm_engager: 'Warm engagers', competitor_engager: 'Competitor engagers', client_orbit: 'Client orbit',
  partner: 'CMO partners', profile_view: 'Profile views', inbound: 'Inbound', unclassified: 'No lane recorded',
}
export const sourceLabel = (k: string) => SOURCE[k] ?? laneLabel(k)

/** hit ÷ base as a percentage with one decimal; null when there is nothing to judge. */
export function rate(hit: number, base: number): number | null {
  return base > 0 ? Math.round((hit / base) * 1000) / 10 : null
}

const rowsOf = (p: CcPayload | null, seat: Seat, ch: string, range: Range): CcRangeRow[] =>
  p ? p.ranges.rows.filter(r => r.client_id === seat && r.channel === ch && r.interval === range) : []

function sortRows(rows: RateRow[]): RateRow[] {
  return rows.sort((a, b) => Number(b.pct != null) - Number(a.pct != null) || b.base - a.base || a.label.localeCompare(b.label))
}

export type Rates = { total: RateRow | null; lanes: RateRow[] }

export function acceptByLane(p: CcPayload | null, seat: Seat, range: Range): Rates {
  const one = (r: CcRangeRow): RateRow => {
    const c = r.acceptance_cohort
    const hit = c?.accepted_within_72h ?? 0, base = c?.matured_denominator ?? 0
    return { key: r.source_lane, label: r.source_lane === '__all__' ? 'All lanes' : sourceLabel(r.source_lane), hit, base, pct: rate(hit, base), sent: r.sent }
  }
  const rows = rowsOf(p, seat, 'invitation', range)
  const all = rows.find(r => r.source_lane === '__all__')
  return { total: all ? one(all) : null, lanes: sortRows(rows.filter(r => r.source_lane !== '__all__' && r.sent > 0).map(one)) }
}

export function replyByLane(p: CcPayload | null, seat: Seat, range: Range): Rates {
  const one = (r: CcRangeRow): RateRow => {
    const c = r.reply_cohort
    const hit = c?.replied_within_72h ?? 0, base = c?.first_messaged ?? 0
    return { key: r.source_lane, label: r.source_lane === '__all__' ? 'All lanes' : sourceLabel(r.source_lane), hit, base, pct: rate(hit, base), sent: r.sent }
  }
  const rows = rowsOf(p, seat, 'dm', range)
  const all = rows.find(r => r.source_lane === '__all__')
  return { total: all ? one(all) : null, lanes: sortRows(rows.filter(r => r.source_lane !== '__all__' && r.sent > 0).map(one)) }
}

export function acceptByCampaign(perf: CampaignPerf[] | null, seat: Seat): Rates {
  const mine = (perf ?? []).filter(c => c.client_id === seat && c.invites_7d > 0)
  const lanes = sortRows(mine.map(c => ({ key: c.campaign_id, label: shortName(c.campaign_name), hit: c.accept_72h, base: c.accept_judged, pct: rate(c.accept_72h, c.accept_judged), sent: c.invites_7d })))
  const hit = mine.reduce((a, c) => a + c.accept_72h, 0), base = mine.reduce((a, c) => a + c.accept_judged, 0)
  return { total: mine.length ? { key: '__all__', label: 'All campaigns', hit, base, pct: rate(hit, base), sent: mine.reduce((a, c) => a + c.invites_7d, 0) } : null, lanes }
}

export const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 }

export const FORMULA = {
  accept: (range: Range) => `Accepted within 72h ÷ invites sent in the last ${RANGE_DAYS[range]} completed days that are at least 72h old (younger invites are not judged yet). Source: the send monitor, one row per source lane.`,
  reply: (range: Range) => `Replied within 72h ÷ people whose first DM went out in the last ${RANGE_DAYS[range]} completed days. The monitor gives no matured base for replies, so people first messaged in the last 3 days count before they had 72h: the rate reads a little low.`,
  campaign: 'Accepted within 72h ÷ invites sent between 7 days and 72h ago, per campaign (the campaign list\'s own numbers).',
}
