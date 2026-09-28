/* ==========================================================================
   src/d/lanes/rates.ts — the Performance rates, pure.

   Every rate is a count over a count from rows the app already reads, never a
   stored percentage re-rounded, and the two counts ride along so the chart can
   say "142 of 726". Seats are never added together; a lane with nothing to
   judge has pct null (drawn as "nothing to judge yet", never 0%).

   Acceptance per lane: the send monitor's payload, `ranges.rows` for the seat,
     channel invitation, the chosen window, one row per source lane:
     accepted_within_72h ÷ invited (people whose FIRST invite went out in the
     window). NOT ÷ matured_denominator: the producer counts accepts from ALL
     invited people but only the invites >=72h old in matured_denominator, so
     its own rate_pct mixes two sets (Ivan 7d on 09-27: 46 ÷ 130 = 35% where
     the 130 matured invites alone had 35 accepts = 27%; checked in SQL,
     O/B/lanes3-verify.md). accepted ÷ invited is one set; its newest invites
     (under 72h old, `young`) can still accept, so it reads a little low and
     only rises. A fully matured window (the previous 7 or 30 days) is exact.
   Reply per lane: the same payload, channel dm, per source lane, reply_cohort:
     replied_within_72h ÷ first_messaged (people whose FIRST DM went out in the
     window). The payload carries no matured denominator for replies, so the
     newest 3 days of the window count in the base before they had 72h: the
     rate reads a little low, and the tooltip says so.
   Acceptance per campaign: `inbox_campaign_perf_v` (db/214), last 7 days:
     accept_72h ÷ accept_judged (invites sent 7 days to 72h ago).
   ========================================================================== */
import type { CcCohort, CcPayload, CcRangeRow } from '../../lib/campaignControl'
import type { CampaignPerf } from '../../lib/campaignPerf'
import type { Seat } from '../seats'
import { laneLabel } from './labels'
import { campaignDisplay, laneInfo } from './laneInfo'
import type { Range } from './model'

export type RateRow = { key: string; label: string; info?: string | null; hit: number; base: number; pct: number | null; sent: number; young?: number }

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

/** One acceptance cohort as a proportion of ONE set: accepted within 72h ÷ everyone invited in the window. */
export function acceptOf(c: CcCohort | null | undefined): { hit: number; base: number; young: number; pct: number | null } | null {
  if (!c || c.invited == null) return null
  const hit = c.accepted_within_72h ?? 0, base = c.invited
  return { hit, base, young: Math.max(0, base - (c.matured_denominator ?? base)), pct: rate(hit, base) }
}

/** The seat's whole-window acceptance for an interval name (7d, 30d, prev7d...), or null. */
export function seatAccept(p: CcPayload | null, seat: Seat, interval: string) {
  const r = p?.ranges.rows.find(x => x.client_id === seat && x.channel === 'invitation' && x.interval === interval && x.source_lane === '__all__')
  return acceptOf(r?.acceptance_cohort)
}

export function acceptByLane(p: CcPayload | null, seat: Seat, range: Range): Rates {
  const one = (r: CcRangeRow): RateRow => {
    const a = acceptOf(r.acceptance_cohort) ?? { hit: 0, base: 0, young: 0, pct: null }
    return { key: r.source_lane, label: r.source_lane === '__all__' ? 'All lanes' : sourceLabel(r.source_lane), info: laneInfo(seat, r.source_lane), hit: a.hit, base: a.base, pct: a.pct, sent: r.sent, young: a.young }
  }
  const rows = rowsOf(p, seat, 'invitation', range)
  const all = rows.find(r => r.source_lane === '__all__')
  return { total: all ? one(all) : null, lanes: sortRows(rows.filter(r => r.source_lane !== '__all__' && r.sent > 0).map(one)) }
}

export function replyByLane(p: CcPayload | null, seat: Seat, range: Range): Rates {
  const one = (r: CcRangeRow): RateRow => {
    const c = r.reply_cohort
    const hit = c?.replied_within_72h ?? 0, base = c?.first_messaged ?? 0
    return { key: r.source_lane, label: r.source_lane === '__all__' ? 'All lanes' : sourceLabel(r.source_lane), info: laneInfo(seat, r.source_lane), hit, base, pct: rate(hit, base), sent: r.sent }
  }
  const rows = rowsOf(p, seat, 'dm', range)
  const all = rows.find(r => r.source_lane === '__all__')
  return { total: all ? one(all) : null, lanes: sortRows(rows.filter(r => r.source_lane !== '__all__' && r.sent > 0).map(one)) }
}

export function acceptByCampaign(perf: CampaignPerf[] | null, seat: Seat): Rates {
  const mine = (perf ?? []).filter(c => c.client_id === seat && c.invites_7d > 0)
  const lanes = sortRows(mine.map(c => ({ key: c.campaign_id, label: campaignDisplay(c.campaign_name), info: laneInfo(seat, c.campaign_name), hit: c.accept_72h, base: c.accept_judged, pct: rate(c.accept_72h, c.accept_judged), sent: c.invites_7d })))
  const hit = mine.reduce((a, c) => a + c.accept_72h, 0), base = mine.reduce((a, c) => a + c.accept_judged, 0)
  return { total: mine.length ? { key: '__all__', label: 'All campaigns', hit, base, pct: rate(hit, base), sent: mine.reduce((a, c) => a + c.invites_7d, 0) } : null, lanes }
}

export const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 }

export const FORMULA = {
  accept: (range: Range) => `Accepted within 72h ÷ people first invited in the last ${RANGE_DAYS[range]} completed days (Warsaw). Invites under 72h old are counted and can still accept, so the rate reads a little low and only rises. Source: the send monitor, one row per source lane (lane = the campaign's name).`,
  reply: (range: Range) => `Replied within 72h ÷ people whose first DM went out in the last ${RANGE_DAYS[range]} completed days. The monitor gives no matured base for replies, so people first messaged in the last 3 days count before they had 72h: the rate reads a little low.`,
  campaign: 'Accepted within 72h ÷ invites sent between 7 days and 72h ago, per campaign (the campaign list\'s own numbers).',
}
