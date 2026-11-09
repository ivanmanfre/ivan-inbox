import { describe, expect, it } from 'vitest'
import { mailboxesOf, readEmailStats } from './handler'

const campaign = { campaign_id: 'c1', campaign_name: 'Ivan | Fresh', campaign_status: 1, leads_count: 37, contacted_count: 39, emails_sent_count: 39,
  reply_count: 1, reply_count_unique: 1, reply_count_automatic_unique: 2, bounced_count: 1, unsubscribed_count: 0, completed_count: 1, total_opportunities: 1 }

describe('readEmailStats', () => {
  it('maps Instantly counters and keeps person replies apart from auto-replies', async () => {
    const paths: string[] = []
    const get = async (p: string) => { paths.push(p); return p.includes('daily') ? [{ date: '2026-11-09', sent: 20, unique_replies: 0, unique_replies_automatic: 1 }, { date: '2026-11-08', sent: 0 }] : p.startsWith('/api/v2/campaigns?') ? { items: [{ id: 'c1', daily_limit: 20, open_tracking: false }] } : [campaign] }
    const s = await readEmailStats(get, [], Date.parse('2026-11-09T17:00:00Z'))
    expect(paths.find(p => p.includes('daily'))).toBe('/api/v2/campaigns/analytics/daily?start_date=2026-10-27&end_date=2026-11-09')
    expect(s.campaigns[0]).toMatchObject({ daily_limit: 20, open_tracking: false, sent: 39, replies: 1, auto_replies: 2, bounced: 1, contacted: 39, leads: 37 })
    expect(s.days.map(d => d.date)).toEqual(['2026-11-08', '2026-11-09'])
    expect(s.mailboxes).toBeNull()
  })
  it('still reads the counters when the settings list fails', async () => {
    const get = async (p: string) => { if (p.startsWith('/api/v2/campaigns?')) throw Error('429'); return p.includes('daily') ? [] : [campaign] }
    const s = await readEmailStats(get, [])
    expect(s.campaigns[0]).toMatchObject({ sent: 39, daily_limit: null, open_tracking: null })
  })
  it('fails loudly on an unexpected answer instead of showing zeros', async () => {
    await expect(readEmailStats(async () => ({ error: 'x' }), [])).rejects.toThrow('unexpected shape')
  })
})

describe('mailboxesOf', () => {
  it('reads only the newest monitor day and lists problems', () => {
    const m = mailboxesOf([
      { day: '2026-11-08', email: 'a@x.com', health_score: 40, warmup_spam: 9, problems: ['old'] },
      { day: '2026-11-09', email: 'a@x.com', health_score: '100', warmup_spam: '0', problems: [] },
      { day: '2026-11-09', email: 'b@x.com', health_score: '97', warmup_spam: 1, problems: ['LISTED on dbl'] },
    ])
    expect(m).toEqual({ day: '2026-11-09', count: 2, healthy: 1, min_health: 97, spam: 1, problems: ['b@x.com: LISTED on dbl'] })
  })
})
