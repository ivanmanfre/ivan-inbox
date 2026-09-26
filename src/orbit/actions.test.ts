import { describe, expect, it } from 'vitest'
import { campaignLaneOf, pickability, queueRefusal, type PickabilityRow } from './actions'

// Every id/value below is invented — no real prospect data in this repo.

function row(o: Partial<PickabilityRow> = {}): PickabilityRow {
  return {
    id: 'p-1', stage: null, blacklisted: false, country: 'US', scorer_version: 'v17', preferred_channel: null,
    connection_sent_at: null, connected_at: null, last_dm_sent_at: null, skip_state: null,
    icp_score: null, trigger_type: null, trigger_confidence: null,
    campaign_id: 'camp-1', enrichment_data: null, campaignActive: true, campaignLane: 'engager',
    ...o,
  }
}

describe('pickability', () => {
  it('ivan: a clean enriched/icp6/country row clears every gate', () => {
    const r = pickability('ivan', row({ stage: 'enriched', icp_score: 6 }))
    expect(r).toEqual({ ok: true, blockers: [] })
  })

  it('risedtc: identified + no sends yet + country present + active campaign clears the gate', () => {
    const r = pickability('risedtc', row({ stage: 'identified', country: 'DE' }))
    expect(r).toEqual({ ok: true, blockers: [] })
  })

  it('arch: queued + ICP >= 7 + a lane tag + no hold clears the gate', () => {
    const r = pickability('arch', row({ stage: 'queued', icp_score: 7 }))
    expect(r).toEqual({ ok: true, blockers: [] })
  })

  it('a blocked row names every real reason it is blocked, never a fabricated one', () => {
    // Ivan, blacklisted AND already invited AND missing country: three real,
    // independent sender-gate conditions, all must surface — a partial list
    // would read as "queued ✓" for a reason the sender never actually checks.
    const r = pickability('ivan', row({
      stage: 'enriched', blacklisted: true, country: null,
      connection_sent_at: '2026-09-01T00:00:00Z', icp_score: 6,
    }))
    expect(r.ok).toBe(false)
    expect(r.blockers).toContain('blacklisted')
    expect(r.blockers).toContain('no country on file yet')
    expect(r.blockers).toContain('already invited (connection request sent)')
  })

  it('ivan: icp_score 0 is reported as "awaiting re-score", distinct from a real low-ICP block', () => {
    const r = pickability('ivan', row({ stage: 'enriched', icp_score: 0 }))
    expect(r.blockers).toEqual(['ICP score is 0 — still awaiting re-score'])
  })

  it('ivan: skip_state is NEVER a blocker — the live Connection Request Sender does not read it (replay-verified)', () => {
    const r = pickability('ivan', row({ stage: 'enriched', icp_score: 6, skip_state: 'manual_skip' }))
    expect(r).toEqual({ ok: true, blockers: [] })
  })

  it('ivan: an unstamped scorer_version is called out honestly rather than validated against a guessed list', () => {
    const r = pickability('ivan', row({ stage: 'enriched', icp_score: 6, scorer_version: null }))
    expect(r.blockers).toEqual(['scorer version unknown (not yet stamped)'])
  })

  it('risedtc: skip_state DOES block — its branches filter on it (unlike ivan)', () => {
    const r = pickability('risedtc', row({ stage: 'identified', country: 'DE', skip_state: 'manual_skip' }))
    expect(r.ok).toBe(false)
    expect(r.blockers).toContain('skipped: manual_skip')
  })

  it('arch: an ICP-floor-waived row (flag lives in enrichment_data, not a column) clears the ICP gate', () => {
    const r = pickability('arch', row({ stage: 'queued', icp_score: 3, enrichment_data: { icp_floor_waived: true } }))
    expect(r).toEqual({ ok: true, blockers: [] })
  })
})

// Review 2026-09-26: Queue invite erased a RISE hand skip (`skip_state: null`)
// and ARCH always reported "campaign carries no lane tag" because queueInvite
// scored the fresh row with `campaignLane: null`.
describe('queueRefusal', () => {
  it('refuses a hand-skipped row instead of clearing the skip', () => {
    expect(queueRefusal(row({ skip_state: 'manual_skip' }))).toBe('skipped by hand, so it stays skipped')
  })
  it('an engine skip is not a refusal, and a clean row passes', () => {
    expect(queueRefusal(row({ skip_state: 'data_thin' }))).toBeNull()
    expect(queueRefusal(row())).toBeNull()
  })
  it('keeps the existing live-thread and blacklist refusals', () => {
    expect(queueRefusal(row({ blacklisted: true }))).toBe('blacklisted')
    expect(queueRefusal(row({ connected_at: '2026-09-01T00:00:00Z' }))).toBe('already invited')
  })
})

describe('campaignLaneOf', () => {
  const lanes = [{ id: 'camp-1', name: 'ARCH engagers', lane: 'engager', active: true, n: 3 }]
  it('reads the lane tag off the graph lanes, so a tagged ARCH row clears', () => {
    const lane = campaignLaneOf(lanes, 'camp-1')
    expect(lane).toBe('engager')
    const r = pickability('arch', row({ stage: 'queued', icp_score: 8, campaignLane: lane }))
    expect(r.blockers).not.toContain('campaign carries no lane tag')
  })
  it('null when the campaign is unknown', () => {
    expect(campaignLaneOf(lanes, 'other')).toBeNull()
    expect(campaignLaneOf(lanes, null)).toBeNull()
  })
})
