import { describe, expect, it } from 'vitest'
import type { CcPayload } from '../../lib/campaignControl'
import type { CampaignPerf } from '../../lib/campaignPerf'
import { parseOpen, DEFAULT_OPEN } from './prefs'
import { acceptByCampaign, acceptByLane, acceptOf, rate, replyByLane, seatAccept } from './rates'

const row = (client_id: string, channel: string, source_lane: string, interval: string, sent: number, ac: object | null, rc: object | null = null) =>
  ({ client_id, channel, source_lane, interval, sent, acceptance_cohort: ac, reply_cohort: rc })
// Ivan's live 7d rows on 27 Sep (campaign_control_latest_v), trimmed.
const p = { ranges: { rows: [
  row('ivan', 'invitation', '__all__', '7d', 200, { invited: 160, accepted_within_72h: 46, matured_denominator: 130, rate_pct: 35 }),
  row('ivan', 'invitation', 'warm_engager', '7d', 183, { invited: 143, accepted_within_72h: 44, matured_denominator: 113, rate_pct: 39 }),
  row('ivan', 'invitation', 'cold', '7d', 17, { invited: 17, accepted_within_72h: 2, matured_denominator: 17, rate_pct: 12 }),
  row('ivan', 'invitation', 'profile_view', '7d', 0, { invited: 0, accepted_within_72h: 0, matured_denominator: 0, rate_pct: null }),
  row('ivan', 'invitation', '__all__', 'prev7d', 192, { invited: 192, accepted_within_72h: 29, matured_denominator: 192, rate_pct: 15 }),
  row('ivan', 'dm', '__all__', '7d', 97, null, { first_messaged: 48, replied_within_72h: 11, matured_denominator: null }),
  row('ivan', 'dm', 'warm_engager', '7d', 91, null, { first_messaged: 45, replied_within_72h: 11, matured_denominator: null }),
  row('ivan', 'dm', 'cold', '7d', 6, null, { first_messaged: 3, replied_within_72h: 0, matured_denominator: null }),
  row('arch', 'invitation', '__all__', '7d', 172, { invited: 172, accepted_within_72h: 37, matured_denominator: 132, rate_pct: 28 }),
] } } as unknown as CcPayload

describe('Lanes 3 rates', () => {
  it('rate is hit ÷ base to one decimal, null with nothing to judge', () => {
    expect(rate(46, 160)).toBe(28.8)
    expect(rate(0, 0)).toBeNull()
  })

  it('acceptance is accepted ÷ invited (one set), never the producer\'s accepted ÷ matured mix', () => {
    const a = acceptOf({ invited: 160, accepted_within_72h: 46, matured_denominator: 130, rate_pct: 35 })!
    expect(a).toEqual({ hit: 46, base: 160, young: 30, pct: 28.8 })
    expect(a.pct).not.toBe(35)
  })

  it('per lane: the seat row on top, lanes with sends only, busiest judged first, never another seat', () => {
    const r = acceptByLane(p, 'ivan', '7d')
    expect(r.total).toMatchObject({ label: 'All lanes', hit: 46, base: 160, pct: 28.8, young: 30 })
    expect(r.lanes.map(l => [l.label, l.hit, l.base, l.pct])).toEqual([['Warm engagers', 44, 143, 30.8], ['Cold', 2, 17, 11.8]])
    expect(acceptByLane(p, 'risedtc', '7d')).toEqual({ total: null, lanes: [] })
  })

  it('the previous window reads the same way (fully matured, so young = 0)', () => {
    expect(seatAccept(p, 'ivan', 'prev7d')).toEqual({ hit: 29, base: 192, young: 0, pct: 15.1 })
  })

  it('reply per lane: replied within 72h ÷ people first messaged', () => {
    const r = replyByLane(p, 'ivan', '7d')
    expect(r.total).toMatchObject({ hit: 11, base: 48, pct: 22.9 })
    expect(r.lanes.map(l => [l.key, l.pct])).toEqual([['warm_engager', 24.4], ['cold', 0]])
  })

  it('per campaign: accept_72h ÷ accept_judged, only campaigns that invited this week, seat only', () => {
    const c = (id: string, client_id: string, invites_7d: number, accept_72h: number, accept_judged: number) =>
      ({ campaign_id: id, campaign_name: id, client_id, invites_7d, accept_72h, accept_judged }) as CampaignPerf
    const r = acceptByCampaign([c('a', 'ivan', 137, 32, 137), c('b', 'ivan', 0, 0, 0), c('z', 'arch', 50, 10, 40)], 'ivan')
    expect(r.lanes.map(l => l.key)).toEqual(['a'])
    expect(r.total).toMatchObject({ hit: 32, base: 137, pct: 23.4 })
  })
})

describe('Lanes 3 remembered sections', () => {
  it('first section open by default, the rest folded; a stored choice wins; junk falls back', () => {
    expect(parseOpen(null)).toEqual(DEFAULT_OPEN)
    expect(DEFAULT_OPEN.today).toBe(true)
    expect(Object.values(DEFAULT_OPEN).filter(Boolean)).toHaveLength(1)
    expect(parseOpen('{"today":false,"perf":true}')).toMatchObject({ today: false, perf: true, lanes: false })
    expect(parseOpen('not json')).toEqual(DEFAULT_OPEN)
  })
})
