import { describe, expect, it } from 'vitest'
import { acceptLine, answerLine, groupBySeat, shortName, type CampaignPerf } from './campaignPerf'

const c = (o: Partial<CampaignPerf>): CampaignPerf => ({
  campaign_id: Math.random().toString(), campaign_name: 'x', client_id: 'ivan', is_active: true,
  invites_7d: 0, dms_7d: 0, replied_7d: 0, positive_7d: 0, calls_7d: 0, calls_30d: 0,
  accept_judged: 0, accept_72h: 0, last_send: null, ...o,
})

describe('campaignPerf', () => {
  it('answers replies per seat and calls, never summing invitations', () => {
    const rows = [
      c({ client_id: 'ivan', replied_7d: 24, invites_7d: 179 }), c({ client_id: 'ivan', replied_7d: 1 }),
      c({ client_id: 'risedtc', replied_7d: 25, calls_7d: 1 }), c({ client_id: 'arch', replied_7d: 19, calls_7d: 1 }),
    ]
    expect(answerLine(rows)).toBe('69 replied this week: Ivan 25, Rise 25, Arch 19. 2 calls booked.')
    expect(answerLine(rows, ['ivan'])).toBe('25 replied this week. No calls booked yet.')
  })
  it('folds idle campaigns: quiet when active, paused otherwise, paused hidden on Ivan', () => {
    const rows = [
      c({ client_id: 'ivan', invites_7d: 3 }), c({ client_id: 'ivan', invites_7d: 100 }),
      c({ client_id: 'ivan' }), c({ client_id: 'ivan', is_active: false }),
      c({ client_id: 'risedtc', is_active: false }), c({ client_id: 'risedtc' }),
    ]
    const [iv, rise] = groupBySeat(rows)
    expect(iv.shown.map(r => r.invites_7d)).toEqual([100, 3])
    expect([iv.quiet.length, iv.paused.length]).toEqual([1, 0])
    expect([rise.quiet.length, rise.paused.length]).toEqual([1, 1])
  })
  it('a campaign with only a call in 30 days still shows', () => {
    expect(groupBySeat([c({ calls_30d: 1 })])[0].shown).toHaveLength(1)
  })
  it('accept rate is a dash when nothing is old enough', () => {
    expect(acceptLine(c({}))).toMatch(/—/)
    expect(acceptLine(c({ accept_judged: 118, accept_72h: 30 }))).toBe('25% accepted within 72h (30 of 118 old enough to judge)')
  })
  it('drops the client prefix', () => {
    expect(shortName('RiseDTC — Competitor Engagers')).toBe('Competitor Engagers')
    expect(shortName('ARCH. Influencer Agency — Cold')).toBe('Cold')
    expect(shortName('Warm - Engagement Harvest')).toBe('Warm - Engagement Harvest')
  })
})
