import { beforeEach, describe, expect, it, vi } from 'vitest'
import { msg } from '../d/dms/fixtures'
const db = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: db.rpc, from: () => ({ select: () => ({ eq: () => ({ single: db.read }) }) }) } }))
import { isIntentionalStop, isIntentionalStopReason, isSwishdmRow, sendFailed, stopLabel, swishdmDm1Wait, ladderSteps } from './inbox'
import { canSendRejectedDm, sendRejectedDm } from './rejectedDm'
import { buildSendLog } from './sends'
import { statusPill } from '../d/dms/History'
import { foldStageCounts, SWISHDM_STAGE_BUCKET } from '../d/lanes/reads'

beforeEach(() => { vi.clearAllMocks(); db.rpc.mockResolvedValue({ error: null }); db.read.mockResolvedValue({ data: { draft_evidence: null }, error: null }) })

const blocked = (reason: string, extra: Parameters<typeof msg>[0] | object = {}) => msg({
  prospect_id: 'p', approved_at: '2026-10-18T09:00:00Z', send_blocked_at: '2026-10-18T09:05:00Z', send_blocked_reason: reason, ...extra,
})

describe('intentional stops are never failed sends (any seat)', () => {
  it.each([
    ['routed_to_invite: SwishDM invite sent instead', 'Not sent: sent an invite instead'],
    ['replied_stop', 'Not sent: they replied'],
    ['reaction_stop', 'Not sent: they reacted'],
    ['manual_touch', 'Not sent: you messaged them yourself'],
    ['invite_withdrawn', 'Not sent: invite withdrawn'],
    ['swishdm_exclusion: competitor domain', 'Not sent: excluded'],
    ['exclusion_list_hit', 'Not sent: excluded'],
  ])('%s', (reason, label) => {
    for (const client_id of ['swishdm', 'ivan', 'risedtc', 'arch']) {
      const m = blocked(reason, { client_id })
      expect(isIntentionalStop(m)).toBe(true)
      expect(sendFailed(m)).toBe(false)
      expect(canSendRejectedDm(m)).toBe(false)
      expect(stopLabel(m)).toBe(label)
      expect(statusPill(m, 'connection_sent')).toEqual({ text: label, fail: false })
    }
  })

  it('treats a stop marker in the evidence as a stop', () => {
    const m = blocked('something_else', { draft_evidence: { stopped: { reason: 'replied', at: '2026-10-18T09:05:00Z' } } })
    expect(isIntentionalStop(m)).toBe(true)
    expect(sendFailed(m)).toBe(false)
  })

  it.each(['send_failed_429: check LinkedIn before retrying', 'inmail_failed_422: check LinkedIn before retrying (no credits)',
    'stale_send_claim: claimed 2026-10-18T09:00Z, never recorded', 'bad_text: empty body', 'send_failed_verified'])('keeps %s a real failure', reason => {
    const m = blocked(reason, { client_id: 'swishdm' })
    expect(isIntentionalStopReason(reason)).toBe(false)
    expect(sendFailed(m)).toBe(true)
    expect(statusPill(m, 'swishdm_connected')?.fail).toBe(true)
  })

  // Ivan 10-21: a person LinkedIn will not deliver to is a quiet "Not delivered" line, not a failure.
  it('shows provider_invalid_recipient as a muted "Not delivered" line, never a failure', () => {
    const m = blocked('provider_invalid_recipient', { client_id: 'swishdm' })
    expect(isIntentionalStopReason('provider_invalid_recipient')).toBe(false)
    expect(sendFailed(m)).toBe(false)
    expect(statusPill(m, 'swishdm_connected')).toEqual({ text: 'Not delivered \u00b7 can\u2019t receive messages on LinkedIn', fail: false })
  })

  it('does not swallow engine reasons that only look alike', () => {
    for (const r of ['replied_before_qualifier', 'arch_market_claim_unratified:Israel', 'supersededish_code']) expect(isIntentionalStopReason(r)).toBe(false)
  })

  // Send audit 2 (Krishna Solanki 6c22c6f3): an APPROVED row the sender superseded is not a failure in any spelling.
  it('a superseded row in any spelling is a quiet stop, never a failure or a Send anyway', () => {
    const cases: Array<[string, string]> = [
      ['superseded: not an open profile on Sales Navigator, rerouted to invite (invite sent)', 'Not sent: sent an invite instead'],
      ['superseded_awaiting_real_scan_2026-08-03', 'Not sent: replaced by another message'],
      ['superseded_by_newer_inbound', 'Not sent: replaced by another message'],
      ['superseded', 'Not sent: replaced by another message'],
      ['superseded_scan_owed', 'Not sent: blocked, the reply with the scan replaces it'],
    ]
    for (const [reason, label] of cases) {
      const m = blocked(reason, { client_id: 'ivan' })
      expect(isIntentionalStop(m), reason).toBe(true)
      expect(sendFailed(m), reason).toBe(false)
      expect(canSendRejectedDm(m), reason).toBe(false)
      expect(stopLabel(m), reason).toBe(label)
      expect(statusPill(m, 'dm_sent'), reason).toEqual({ text: label, fail: false })
    }
  })

  it('keeps a delivered row history, whatever its reason', () => {
    expect(isIntentionalStop(blocked('replied_stop', { sent_at: '2026-10-18T09:06:00Z' }))).toBe(false)
  })

  it('does not paint the thread ladder red for a routed InMail', () => {
    const t = { stage: 'connection_sent', messages: [blocked('routed_to_invite: x', { client_id: 'swishdm', message_type: 'inmail' })] }
    const l = ladderSteps(t as never)
    expect(l.kind).toBe("steps")
    if (l.kind === 'steps') expect(l.steps.some(s => s.state === 'failed')).toBe(false)
  })

  it('keeps intentional stops out of the send log failures', () => {
    const rows = [blocked('routed_to_invite: x'), blocked('send_failed_500: check LinkedIn before retrying')]
      .map(m => ({ ...m, message_type: m.message_type ?? 'dm' }))
    const log = buildSendLog([], rows as never)
    expect(log.map(i => i.reason)).toEqual(['send_failed_500: check LinkedIn before retrying'])
  })
})

describe('SwishDM rows are never sent from the inbox', () => {
  it('recognises a SwishDM row by seat, evidence client or lane', () => {
    expect(isSwishdmRow(msg({ prospect_id: 'p', client_id: 'swishdm' }))).toBe(true)
    expect(isSwishdmRow(msg({ prospect_id: 'p', draft_evidence: { client: 'swishdm' } }))).toBe(true)
    expect(isSwishdmRow(msg({ prospect_id: 'p', draft_evidence: { lane: 'swishdm_reply' } }))).toBe(true)
    expect(isSwishdmRow(msg({ prospect_id: 'p', lane: 'swishdm_first_list' }))).toBe(true)
    expect(isSwishdmRow(msg({ prospect_id: 'p', client_id: 'arch', lane: 'engager_warm' }))).toBe(false)
  })

  it('offers no Send anyways and refuses before any RPC', async () => {
    const m = blocked('send_failed_400: check LinkedIn before retrying', { client_id: 'swishdm', approved_at: null })
    expect(canSendRejectedDm(m)).toBe(false)
    await expect(sendRejectedDm(m)).rejects.toThrow(/SwishDM messages are sent only by the SwishDM senders/)
    expect(db.rpc).not.toHaveBeenCalled()
    expect(canSendRejectedDm({ ...m, client_id: 'arch' })).toBe(true)
  })
})

describe('SwishDM DM1 wait', () => {
  const dm1 = (stage: string, extra: object = {}) => msg({ prospect_id: 'p', client_id: 'swishdm', prospect_stage: stage, approved_at: '2026-10-18T09:00:00Z', ...extra })
  it('waits for the invite, then the accept, then reads as queued', () => {
    expect(swishdmDm1Wait(dm1('swishdm_staged_hold'))).toBe('Waiting for invite')
    expect(swishdmDm1Wait(dm1('connection_sent'))).toBe('Waiting for accept')
    expect(swishdmDm1Wait(dm1('swishdm_connected'))).toBeNull()
    expect(swishdmDm1Wait(dm1('connection_sent', { draft_evidence: { dm_queue: { state: 'queued' } } }))).toBeNull()
  })
  it('leaves invites, InMails, replies, sent rows and other seats alone', () => {
    expect(swishdmDm1Wait(dm1('swishdm_staged_hold', { message_type: 'connection_note' }))).toBeNull()
    expect(swishdmDm1Wait(dm1('swishdm_staged_hold', { message_type: 'inmail' }))).toBeNull()
    expect(swishdmDm1Wait(dm1('connection_sent', { draft_evidence: { lane: 'swishdm_reply' } }))).toBeNull()
    expect(swishdmDm1Wait(dm1('connection_sent', { sent_at: '2026-10-18T10:00:00Z' }))).toBeNull()
    expect(swishdmDm1Wait(dm1('connection_sent', { client_id: 'arch' }))).toBeNull()
  })
})

describe('Lanes stage counts fold SwishDM stages into the shared buckets', () => {
  it('maps each SwishDM stage and keeps the shared order', () => {
    expect(foldStageCounts([
      { stage: 'connection_sent', n: 6 }, { stage: 'swishdm_staged_hold', n: 230 }, { stage: 'swishdm_connected', n: 2 }, { stage: 'connected', n: 1 },
      { stage: 'swishdm_dm_sent', n: 3 }, { stage: 'swishdm_inmail_sent', n: 4 }, { stage: 'swishdm_replied', n: 1 }, { stage: 'swishdm_invite_withdrawn', n: 2 }, { stage: 'skipped', n: 0 },
    ])).toEqual([
      { stage: 'queued', n: 230 }, { stage: 'connection_sent', n: 6 }, { stage: 'connected', n: 3 }, { stage: 'dm_sent', n: 7 }, { stage: 'replied', n: 1 }, { stage: 'archived', n: 2 },
    ])
    expect(SWISHDM_STAGE_BUCKET.swishdm_invite_withdrawn).toBe('archived')
  })
})
