import { describe, expect, it } from 'vitest'
import type { ContentDraft } from '../../../lib/content'
import { contentWeek, limitOf, nextWeekDays } from './model'
import { domainOf, isSaturdayNy, readyOf, type ReadyRead } from './ready'

const SUN = Date.parse('2026-09-27T13:00:00Z') // Sunday
const WED = Date.parse('2026-09-30T13:00:00Z') // Wednesday
const row = (o: Partial<ContentDraft>): ContentDraft => ({ id: Math.random().toString(36), status: 'scheduled', published_at: null, board_visible: null, title: 'T', topic: null, post_body: '', ...o } as unknown as ContentDraft)

describe('glance: next week', () => {
  it('on a Sunday is tomorrow’s Mon–Fri; on a Wednesday the FOLLOWING Mon–Fri', () => {
    expect(nextWeekDays(SUN).map(d => d.key)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
    expect(nextWeekDays(WED).map(d => d.key)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'])
  })
  it('counts with the board rule: client rows on the board even in review; Ivan only scheduled; warns below 3', () => {
    const days = nextWeekDays(SUN)
    const rise = contentWeek([
      row({ status: 'review', board_visible: true, scheduled_at: '2026-09-28T08:45:00Z' }),
      row({ status: 'review', board_visible: false, scheduled_at: '2026-09-29T08:45:00Z' }), // not on the board
      row({ status: 'scheduled', board_visible: true, scheduled_at: '2026-09-30T08:45:00Z', published_at: '2026-09-30T09:00:00Z' }), // published
    ], 'risedtc', days)
    expect(rise.n).toBe(1)
    expect(rise.below).toBe(true)
    const ivan = contentWeek([
      row({ status: 'scheduled', scheduled_at: '2026-09-28T08:45:00Z', title: 'Armed' }),
      row({ status: 'approved', scheduled_at: '2026-09-29T08:45:00Z', title: 'Dated' }),
      row({ status: 'scheduled', scheduled_at: '2026-10-05T08:45:00Z' }), // the week after
    ], 'ivan', days)
    expect(ivan.n).toBe(1)
    expect(ivan.days[0]).toMatchObject({ posts: 1, stub: 'Armed', planned: false })
    expect(ivan.days[1]).toMatchObject({ posts: 0, stub: 'Dated', planned: true })
  })
})

describe('glance: rate limit', () => {
  const NOW = Date.parse('2026-09-27T13:40:00Z')
  it('a pause in the future = limited, resumes at the pause', () => {
    const v = limitOf({ incident: null, seatPause: '2026-09-27T15:32:00Z', globalPause: null, last: { at: '2026-09-27T13:34:00Z', ok: false, error: null }, now: NOW })
    expect(v).toMatchObject({ limited: true, resumes: '2026-09-27T15:32:00Z', resumesBy: 'seat' })
  })
  it('the global kill switch outranks an earlier seat pause and says so', () => {
    const v = limitOf({ incident: null, seatPause: '2026-09-27T14:00:00Z', globalPause: '2026-09-27T20:00:00Z', last: null, now: NOW })
    expect(v).toMatchObject({ limited: true, resumesBy: 'global', why: 'Every seat is on the manual stop' })
  })
  it('refused again after the pause ended = still limited; a pause older than a day is not drawn', () => {
    expect(limitOf({ incident: null, seatPause: '2026-09-27T13:00:00Z', globalPause: null, last: { at: '2026-09-27T13:30:00Z', ok: false, error: null }, now: NOW }))
      .toMatchObject({ limited: true, refusedAfterPause: true })
    expect(limitOf({ incident: null, seatPause: null, globalPause: '2026-09-06T23:16:10Z', last: { at: '2026-09-27T13:24:00Z', ok: true, error: null }, now: NOW }))
      .toMatchObject({ limited: false, resumes: null, why: null })
  })
  it('an open LinkedIn-refusal incident alone = limited', () => {
    expect(limitOf({ incident: { lead: 'x', cooldown: null }, seatPause: null, globalPause: null, last: null, now: NOW }).limited).toBe(true)
  })
})

describe('glance: ready', () => {
  const r: ReadyRead = {
    saturdayNy: false,
    lanes: [
      { seat: 'ivan', lane: 'cold', label: 'Cold', n: 108, capped: false, campaignId: 'c', off: null },
      { seat: 'ivan', lane: 'engage', label: 'Warm engagers', n: 114, capped: false, campaignId: 'e', off: null },
      { seat: 'ivan', lane: 'view', label: 'Profile views', n: 3, capped: false, campaignId: 'v', off: 'switched off' },
      { seat: 'arch', lane: 'company_expansion', label: 'Company expansion', n: 143, capped: false, campaignId: 'a', off: null },
    ],
  }
  it('never adds seats; the total leaves out lanes the sender skips; busiest first', () => {
    const v = readyOf(r, 'ivan')
    expect(v.total).toBe(222)
    expect(v.lanes.map(l => l.lane)).toEqual(['engage', 'cold', 'view'])
    expect(readyOf(r, 'arch').total).toBe(143)
    expect(readyOf(r, 'risedtc')).toEqual({ total: 0, lanes: [] })
  })
  it('governor warm-only drops Ivan’s cold from the total and says why', () => {
    const v = readyOf(r, 'ivan', { mode: 'warm_only' } as never)
    expect(v.total).toBe(114)
    expect(v.lanes.find(l => l.lane === 'cold')?.off).toBe('warm only this week')
  })
  it('Saturday in New York, company domains normalised', () => {
    expect(isSaturdayNy(Date.parse('2026-09-26T15:00:00Z'))).toBe(true)
    expect(isSaturdayNy(SUN)).toBe(false)
    expect(domainOf('https://www.Brand.com/about')).toBe('brand.com')
  })
})

import { buildReady, laneOf, type Cand, type Ctx } from './ready'
describe('glance: the picker filter, classified in code', () => {
  const NOW = Date.parse('2026-09-27T13:00:00Z')
  const x: Ctx = { now: NOW, cfg: { rise_company_expansion: 'on', profile_view_send_enabled: 'true', ivan_invite_retry_enabled: 'true' }, scorer: 17,
    ivanIds: new Set(['iv']), riseLive: new Set(['b9c55e21-ed67-42e1-94ab-b9e948a4bed9', '92c745f2-bd37-4887-96c3-ef930d542e24']), archLive: new Set(['1a2701a0-931b-4949-95fb-9bbf2de16f09']),
    stop: new Set(), touch: new Set(['spaced.com']), satNy: false }
  const c = (o: Partial<Cand>): Cand => ({ id: Math.random().toString(36), campaign_id: 'iv', stage: 'enriched', icp_score: 7, trigger_type: null, trigger_confidence: null, scorer_version: '17', country: 'US',
    preferred_channel: null, connection_sent_at: null, connected_at: null, last_dm_sent_at: null, liveness_checked_at: '2026-09-01', created_at: '2026-09-26T00:00:00Z', skip_state: null, skip_reason: null,
    reply_count: 0, note_variant: null, hypertarget_reserved: null, company_domain: null, ed_lane: null, sig_ok: null, sig_note: null, rise_note: null, anchor: null, gate: null,
    partner: null, colleague: null, refused: null, src: null, waived: null, lang_hold: null, copy_hold: null, ...o })
  it('Ivan: engagers take icp 6, cold needs liveness, a fresh refusal holds the row, an old scorer never picks', () => {
    expect(laneOf(c({ trigger_type: 'engaged_post', trigger_confidence: 3, icp_score: 6 }), x)).toEqual({ seat: 'ivan', lane: 'engage' })
    expect(laneOf(c({ liveness_checked_at: null }), x)).toBeNull()
    expect(laneOf(c({}), x)).toEqual({ seat: 'ivan', lane: 'cold' })
    expect(laneOf(c({ refused: '2026-09-27T10:00:00Z' }), x)).toBeNull()
    expect(laneOf(c({ scorer_version: '6' }), x)).toBeNull()
  })
  it('Rise: company expansion needs the colleague name and skips a company touched in 7 days; partners are exempt from spacing', () => {
    const exp = 'b9c55e21-ed67-42e1-94ab-b9e948a4bed9'
    expect(laneOf(c({ campaign_id: exp, colleague: 'Ann' }), x)).toEqual({ seat: 'risedtc', lane: 'expansion' })
    expect(laneOf(c({ campaign_id: exp, colleague: 'Ann', company_domain: 'www.spaced.com' }), x)).toBeNull()
    expect(laneOf(c({ campaign_id: '92c745f2-bd37-4887-96c3-ef930d542e24', partner: 'true', rise_note: 'hi', company_domain: 'spaced.com' }), x)).toEqual({ seat: 'risedtc', lane: 'partner' })
  })
  it('Arch: queued, icp 7 or waived, split by the enrichment lane', () => {
    const a = (o: Partial<Cand>) => c({ campaign_id: '1a2701a0-931b-4949-95fb-9bbf2de16f09', stage: 'queued', country: null, ...o })
    expect(laneOf(a({ ed_lane: 'company_expansion' }), x)).toEqual({ seat: 'arch', lane: 'company_expansion' })
    expect(laneOf(a({ ed_lane: 'company_expansion', icp_score: 5 }), x)).toBeNull()
    expect(laneOf(a({ ed_lane: 'company_expansion', icp_score: 5, waived: 'true' }), x)).not.toBeNull()
    const r = buildReady([a({ ed_lane: 'company_expansion' }), a({ ed_lane: 'engager_warm' })], x, false)
    expect(r.lanes.filter(l => l.seat === 'arch').map(l => [l.lane, l.n])).toEqual([['company_expansion', 1], ['engager_warm', 1]])
  })
})
