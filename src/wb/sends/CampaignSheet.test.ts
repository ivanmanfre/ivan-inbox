import { describe, expect, it } from 'vitest'
import { laneOf, splitsFor } from './CampaignSheet'
import type { PerfLane, PerfState } from '../../lib/outreachPerf'

const cell = (step: string, n: number) => ({ step, n, replies: 1, rate: 1 / n, positive_n: 0, positive_rate: null, viewed_n: 0, viewed_rate: null, base_n: 0, base_replies: 0, base_rate: 0, status: 'ok' as const })
const split = (step: string, dim: PerfLane['splits'][number]['dim'], value: string, n: number) => ({ step, dim, value, n, replies: 1, rate: 1 / n })
const lane: PerfLane = {
  lane: 'harvest', campaigns: ['Warm - Engagement Harvest', 'Warm - Kyle Engagers'],
  cells: [cell('nudge', 30), cell('dm1', 140)], variants: [], alarms: [], table: [],
  splits: [
    split('dm1', 'country', 'US', 90), split('dm1', 'country', 'unknown', 200), split('dm1', 'country', 'UK', 20),
    split('dm1', 'variant', 'v3', 140), split('nudge', 'source', 'post', 30),
  ],
}
const ready: PerfState = { kind: 'ready', data: { ok: true, client_id: 'ivan', days: 90, generated_at: '', mature_before: '', cur_from: '', base_from: '', floor: 20, child_floor: 15, lanes: [lane], reply_basis: { threaded: 0, stamp_only: 0 } } }

describe('campaign sheet', () => {
  it('finds the lane that carries the campaign, and nothing for one it does not', () => {
    expect(laneOf(ready, 'Warm - Kyle Engagers')?.lane).toBe('harvest')
    expect(laneOf(ready, 'Poland — Agencies (Cold)')).toBeNull()
    expect(laneOf({ kind: 'loading' }, 'Warm - Kyle Engagers')).toBeNull()
  })
  it('splits the biggest step only, busiest first, without unknown or variant rows', () => {
    const s = splitsFor(lane)
    expect(s?.step).toBe('dm1')
    expect(s?.dims).toEqual([{ dim: 'country', rows: [lane.splits[0], lane.splits[2]] }])
  })
})
