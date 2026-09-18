import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { OutreachView } from './OutreachBlock'
import type { PerfAlarm, PerfPayload } from '../../lib/outreachPerf'

const drift: PerfAlarm = { kind: 'drift', step: 'dm1', variant: null, now_n: 128, now_replies: 4, now_rate: 0.0312, prior_n: 250, prior_rate: 0.092, gap: 0.0608, suspect_dim: 'source', suspect_share: 0.8, split: [{ value: 'competitor_engagers', n: 71, replies: 2, rate: 0.0282 }, { value: 'own_engagers', n: 40, replies: 6, rate: 0.15 }] }
const payload: PerfPayload = {
  ok: true, client_id: 'risedtc', days: 90, generated_at: '2026-09-16T00:00:00Z', mature_before: '', cur_from: '', base_from: '', floor: 30, child_floor: 15,
  reply_basis: { threaded: 10, stamp_only: 2 },
  lanes: [{
    lane: 'cold', campaigns: ['RiseDTC — Cold (DTC Sales Nav)'],
    cells: [{ step: 'dm1', n: 128, replies: 4, rate: 0.0312, positive_n: 3, positive_rate: 0.0234, viewed_n: 9, viewed_rate: 0.0703, base_n: 250, base_replies: 23, base_rate: 0.092, status: 'drift' },
            { step: 'nudge', n: 12, replies: 3, rate: 0.25, positive_n: 0, positive_rate: null, viewed_n: 0, viewed_rate: 0, base_n: 0, base_replies: 0, base_rate: 0, status: 'thin' }],
    variants: [{ step: 'dm1', variant: 'rise_dm1_a', n: 128, replies: 4, rate: 0.0312, viewed_n: 9, viewed_rate: 0.0703, others_n: 0, others_rate: 0, status: 'thin' }],
    splits: [], alarms: [drift],
    table: [{ step: 'dm1', variant: 'rise_dm1_a', source: 'competitor_engagers', country: 'US', vertical: 'unknown', n: 71, replies: 2, rate: 0.0282 }],
  }],
}

describe('OutreachView', () => {
  it('puts the alarm card before the cells and names the suspect with its split', () => {
    const html = renderToStaticMarkup(<OutreachView lane="risedtc" state={{ kind: 'ready', data: payload }} />)
    expect(html.indexOf('cold · DM1')).toBeLessThan(html.indexOf('Lane and step'))
    expect(html).toContain('3.1% now (4 of 128) vs 9.2% prior 60d')
    expect(html).toContain('Suspect: source')
    expect(html).toContain('competitor_engagers')
    expect(html).toContain('2 of 71')
  })
  it('labels a thin cell too few to call and dashes a missing positive rate', () => {
    const html = renderToStaticMarkup(<OutreachView lane="risedtc" state={{ kind: 'ready', data: payload }} />)
    expect(html).toContain('too few to call')
    expect(html).toContain('no reply classification on this seat')
  })
  it('shows viewed back on the tile and on a variant that has any', () => {
    const html = renderToStaticMarkup(<OutreachView lane="risedtc" state={{ kind: 'ready', data: payload }} />)
    expect(html).toContain('viewed back 7.0% (9)')
    expect(html).toContain('4 of 128 (3.1%) · viewed back 7.0%')
  })
  it('renders the empty and failed states as words', () => {
    expect(renderToStaticMarkup(<OutreachView lane="arch" state={{ kind: 'empty', reason: 'No active lanes with DM sends in the last 90 days.' }} />)).toContain('No active lanes')
    expect(renderToStaticMarkup(<OutreachView lane="arch" state={{ kind: 'failed', message: 'boom' }} />)).toContain('boom')
  })
  it('keeps the raw table behind a disclosure', () => {
    const html = renderToStaticMarkup(<OutreachView lane="risedtc" state={{ kind: 'ready', data: payload }} />)
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf('competitor_engagers</td>'))
  })
})
