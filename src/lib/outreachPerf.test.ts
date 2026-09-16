import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { alarmLine, alarmTitle, pct, rankAlarms, stepLabel, type PerfAlarm, type PerfLane } from './outreachPerf'

const drift: PerfAlarm = { kind: 'drift', step: 'dm1', variant: null, now_n: 128, now_replies: 4, now_rate: 0.0312, prior_n: 250, prior_rate: 0.092, gap: 0.0608, suspect_dim: 'source', suspect_share: 0.8, split: [{ value: 'competitor_engagers', n: 71, replies: 2, rate: 0.0282 }] }
const sib: PerfAlarm = { kind: 'sibling', step: 'dm1', variant: 'rise_dm1_c', now_n: 35, now_replies: 1, now_rate: 0.0286, prior_n: 40, prior_rate: 0.3, gap: 0.2714, suspect_dim: 'variant', suspect_share: null, split: [] }

describe('outreachPerf helpers', () => {
  it('formats rates to one decimal', () => { expect(pct(0.0312)).toBe('3.1%'); expect(pct(0)).toBe('0.0%') })
  it('labels steps', () => { expect(stepLabel('dm1')).toBe('DM1'); expect(stepLabel('inmail')).toBe('InMail'); expect(stepLabel('nudge')).toBe('Nudge') })
  it('titles alarms with lane, step and variant when present', () => {
    expect(alarmTitle('cold', drift)).toBe('cold · DM1')
    expect(alarmTitle('warm', sib)).toBe('warm · DM1 · rise_dm1_c')
  })
  it('writes the alarm line with counts', () => {
    expect(alarmLine(drift)).toBe('3.1% now (4 of 128) vs 9.2% prior 60d')
    expect(alarmLine(sib)).toBe('2.9% now (1 of 35) vs 30.0% other variants')
  })
  it('ranks drift before sibling and larger gaps first', () => {
    const lanes = [{ lane: 'warm', alarms: [sib] }, { lane: 'cold', alarms: [drift, { ...drift, step: 'nudge', gap: 0.1 }] }] as unknown as PerfLane[]
    const r = rankAlarms(lanes)
    expect(r.map(x => `${x.lane}:${x.alarm.step}:${x.alarm.kind}`)).toEqual(['cold:nudge:drift', 'cold:dm1:drift', 'warm:dm1:sibling'])
  })
})
