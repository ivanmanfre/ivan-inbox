import { describe, it, expect, vi } from 'vitest'
import { groupThreads, type InboxMessage } from './inbox'
import type { OpsDraft } from './ops'
import type { GovernorRow, PipelineRow } from './kpis'
import {
  batchResultLine, focusSummary, laneName, pendingIdsOf, runBatch,
  supplyAlarmLane, type Batch,
} from './focus'

// Focus line + one-tap batches (instantly-picks item 1). Fixture builders
// mirror workQueue.test.ts's msg/opsDraft pattern so a never-opened thread
// and a pending ops draft are trivial to construct without hitting the
// network.

const NOW_ISO = '2026-09-22T12:00:00Z'
const NOW = Date.parse(NOW_ISO)

const msg = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm1', prospect_id: 'p1', direction: 'inbound', message_text: 'hey',
  message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
  read_at: null, created_at: '2026-09-01T10:00:00Z', send_blocked_at: null,
  send_blocked_reason: null, unipile_chat_id: null, ai_model: null,
  prospect_name: 'A Prospect', prospect_company: null,
  prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
  profile_photo_url: null, campaign_name: 'c', client_id: 'ivan',
  prospect_linkedin_url: 'https://www.linkedin.com/in/a-prospect', chat_provider_id: null,
  snoozed_until: null, snoozed_at: null, ...over,
})

let opsSeq = 0
const opsDraft = (over: Partial<OpsDraft> = {}): OpsDraft => ({
  id: `o${++opsSeq}`, client_id: 'ivan', kind: 'comment_outbound', slack_channel: '#x',
  body: 'a comment', context: null, created_at: '2026-09-01T10:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null, ...over,
})

const pipelineRow = (over: Partial<PipelineRow> = {}): PipelineRow => ({
  client_id: 'ivan', lane: 'cold', sendable: 20, sent_7d: 7, sent_30d: 30, ...over,
})
const governorRow = (over: Partial<GovernorRow> = {}): GovernorRow => ({
  client_id: 'ivan', model: 'weekly_adaptive', cap: 100, used: 10, window_label: 'week',
  mode: 'normal', daily_used: 5, daily_cap: 20, accept_rate: 30,
  headroom_week: 90, headroom_day: 15, monthly_cap: null, monthly_used: null, ...over,
})

describe('focusSummary', () => {
  it('zero items', () => {
    const s = focusSummary({ threads: [], opsDrafts: [], now: NOW })
    expect(s.count).toBe(0)
    expect(s.line).toBe('Nothing needs you. Everything is running.')
    expect(s.batches).toEqual([])
    expect(s.singles).toEqual([])
  })

  it('mixed kinds', () => {
    const t = groupThreads([msg({ read_at: null })], new Set(), NOW)[0]
    const escalation = opsDraft({ kind: 'escalation' })
    const invite = opsDraft({ kind: 'manual_invite' })
    const s = focusSummary({ threads: [t], opsDrafts: [escalation, invite], now: NOW })
    expect(s.count).toBe(3)
    expect(s.replyCount).toBe(1)
    expect(s.opsCount).toBe(2)
    expect(s.batches).toEqual([])
    expect(s.singles.map(d => d.id).sort()).toEqual([escalation.id, invite.id].sort())
    expect(s.line).toBe('3 things need you. Everything else is running.')
  })

  it('comment kinds excluded (stale comment_outbound dropped by pendingOps)', () => {
    const stale = opsDraft({
      kind: 'comment_outbound',
      context: { posted_at: '2026-09-01T00:00:00Z' }, // > 4 days before NOW (09-22)
    })
    const s = focusSummary({ threads: [], opsDrafts: [stale], now: NOW })
    expect(s.count).toBe(0)
    expect(s.batches).toEqual([])
    expect(s.singles).toEqual([])
  })

  it('6-batch + 3 singles = 9', () => {
    const invites = Array.from({ length: 6 }, (_, i) =>
      opsDraft({ kind: 'manual_invite', client_id: 'risedtc', id: `inv${i}` }))
    const singles = [
      opsDraft({ kind: 'escalation', id: 's1' }),
      opsDraft({ kind: 'weekly_report', id: 's2' }),
      opsDraft({ kind: 'booking', id: 's3' }),
    ]
    const s = focusSummary({ threads: [], opsDrafts: [...invites, ...singles], now: NOW })
    expect(s.count).toBe(9)
    expect(s.batches.length).toBe(1)
    expect(s.batches[0].ids.length).toBe(6)
    expect(s.batches[0].kind).toBe('manual_invite')
    expect(s.batches[0].client).toBe('risedtc')
    expect(s.singles.length).toBe(3)
  })

  it('ivan-lane comment_outbound rows (approve_url set) batch same as manual_invite', () => {
    const comments = Array.from({ length: 3 }, (_, i) => opsDraft({
      kind: 'comment_outbound', client_id: 'ivan', id: `c${i}`,
      context: { approve_url: 'https://n8n.ivanmanfredi.com/webhook/x', posted_at: NOW_ISO },
    }))
    const s = focusSummary({ threads: [], opsDrafts: comments, now: NOW })
    expect(s.batches.length).toBe(1)
    expect(s.batches[0].kind).toBe('comment_outbound')
    expect(s.batches[0].ids.length).toBe(3)
    expect(s.singles).toEqual([])
  })

  it('risedtc comment rows (no approve_url, clipboard lane) never batch (fable review, HIGH, 2026-09-22)', () => {
    const comments = Array.from({ length: 4 }, (_, i) => opsDraft({
      kind: 'comment_outbound', client_id: 'risedtc', id: `rc${i}`,
      context: { posted_at: NOW_ISO }, // no approve_url -> outboundApproveUrl(d) is null
    }))
    const s = focusSummary({ threads: [], opsDrafts: comments, now: NOW })
    expect(s.batches).toEqual([])
    expect(s.singles.length).toBe(4)
  })

  it('open supply alarm changes the line', () => {
    const invites = Array.from({ length: 6 }, (_, i) =>
      opsDraft({ kind: 'manual_invite', client_id: 'risedtc', id: `inv${i}` }))
    const singles = [
      opsDraft({ kind: 'escalation', id: 's1' }),
      opsDraft({ kind: 'weekly_report', id: 's2' }),
      opsDraft({ kind: 'booking', id: 's3' }),
    ]
    // risedtc: sendable 0, sent_7d 7 -> avg7=1, dailyRate=1, runway=0 (<1) -> alarm.
    const pipeline = [pipelineRow({ client_id: 'risedtc', sendable: 0, sent_7d: 7 })]
    const governor = [governorRow({ client_id: 'risedtc', daily_used: 0 })]
    const s = focusSummary({
      threads: [], opsDrafts: [...invites, ...singles], now: NOW, pipeline, governor,
    })
    expect(s.count).toBe(9)
    expect(s.alarmLane).toBe('risedtc')
    expect(s.line).toBe("9 things need you. Mattan's lane is out of leads.")
  })
})

describe('supplyAlarmLane', () => {
  it('no alarm when every lane has runway', () => {
    const pipeline = [pipelineRow({ client_id: 'ivan', sendable: 100, sent_7d: 7 })]
    const governor = [governorRow({ client_id: 'ivan', daily_used: 1 })]
    expect(supplyAlarmLane(pipeline, governor)).toBe(null)
  })
  it('flags the first lane (sorted) with runway under 1 day', () => {
    const pipeline = [
      pipelineRow({ client_id: 'ivan', sendable: 100, sent_7d: 7 }),
      pipelineRow({ client_id: 'arch', sendable: 0, sent_7d: 14 }),
    ]
    const governor = [governorRow({ client_id: 'arch', daily_used: 0 })]
    expect(supplyAlarmLane(pipeline, governor)).toBe('arch')
  })
})

describe('laneName', () => {
  it('maps the three known clients to the locked copy', () => {
    expect(laneName('ivan')).toBe('Your lane')
    expect(laneName('risedtc')).toBe("Mattan's lane")
    expect(laneName('arch')).toBe("Davorin's lane")
  })
})

describe('batch orchestration', () => {
  it('expand lists every id', () => {
    const invites = Array.from({ length: 6 }, (_, i) =>
      opsDraft({ kind: 'manual_invite', client_id: 'risedtc', id: `inv${i}` }))
    const s = focusSummary({ threads: [], opsDrafts: invites, now: NOW })
    expect(s.batches[0].ids).toEqual(invites.map(d => d.id))
  })

  it('partial batch failure leaves failed id pending', async () => {
    const drafts = Array.from({ length: 3 }, (_, i) =>
      opsDraft({ kind: 'manual_invite', client_id: 'risedtc', id: `b${i}` }))
    const byId = new Map(drafts.map(d => [d.id, d]))
    const act = vi.fn(async (id: string) => {
      if (id === 'b1') throw new Error('open') // the one that fails
      byId.get(id)!.approved_at = '2026-09-22T12:00:00Z'
    })
    const result = await runBatch(drafts.map(d => d.id), act)
    expect(result.succeeded.sort()).toEqual(['b0', 'b2'])
    expect(result.failed).toEqual([{ id: 'b1', error: 'open' }])
    expect(batchResultLine(result, 3)).toBe('2 of 3 approved, 1 failed: open')
    expect(batchResultLine(result, 3, 'discarded')).toBe('2 of 3 discarded, 1 failed: open')
    // The failed id is still pending (no approved_at/sent_at/send_blocked_reason).
    const batch: Batch = { key: 'k', kind: 'manual_invite', client: 'risedtc', ids: drafts.map(d => d.id), label: 'x' }
    expect(pendingIdsOf(batch, [...byId.values()])).toEqual(['b1'])
  })

  it('reject one then approve batch approves only the rest', async () => {
    const drafts = Array.from({ length: 3 }, (_, i) =>
      opsDraft({ kind: 'manual_invite', client_id: 'risedtc', id: `r${i}` }))
    // Reject r1 out of band (discard path stamps send_blocked_reason).
    drafts[1].send_blocked_reason = 'discarded_by_operator'
    const batch: Batch = { key: 'k', kind: 'manual_invite', client: 'risedtc', ids: drafts.map(d => d.id), label: 'x' }
    const stillPending = pendingIdsOf(batch, drafts)
    expect(stillPending).toEqual(['r0', 'r2'])
    const seen: string[] = []
    const act = vi.fn(async (id: string) => { seen.push(id) })
    const result = await runBatch(stillPending, act)
    expect(seen).toEqual(['r0', 'r2'])
    expect(result.succeeded).toEqual(['r0', 'r2'])
  })
})

describe('batchResultLine names the verb that ran', () => {
  it('a clean approve batch says how many were approved', () => {
    expect(batchResultLine({ succeeded: ['a', 'b', 'c'], failed: [] }, 3)).toBe('3 approved.')
  })
  it('a clean discard batch never says approved', () => {
    const line = batchResultLine({ succeeded: ['a', 'b'], failed: [] }, 2, 'discarded')
    expect(line).toBe('2 discarded.')
    expect(line).not.toMatch(/approved/)
  })
})
