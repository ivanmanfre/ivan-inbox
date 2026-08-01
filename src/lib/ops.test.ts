import { describe, it, expect } from 'vitest'
import { outboundApproveUrl, outboundSkipUrl, pendingOps, sentOps, blockedOps, canGenerateDraft, claimingOps, engineLabel, expiresIn, DISCARDED_REASON, type OpsDraft } from './ops'

const base: OpsDraft = {
  id: '1', client_id: 'risedtc', kind: 'escalation', slack_channel: '#rise-ops',
  body: 'hey', context: null, created_at: '2026-07-24T10:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null,
}

describe('pendingOps', () => {
  it('keeps only rows with no approve/send/block stamp', () => {
    const rows: OpsDraft[] = [
      { ...base, id: 'a' },
      { ...base, id: 'b', approved_at: '2026-07-24T11:00:00Z' },
      { ...base, id: 'c', sent_at: '2026-07-24T11:00:00Z' },
      { ...base, id: 'd', send_blocked_reason: 'rate_limited' },
    ]
    expect(pendingOps(rows).map(r => r.id)).toEqual(['a'])
  })
})

describe('sentOps', () => {
  it('returns sent rows newest-first, capped to the limit', () => {
    const rows: OpsDraft[] = [
      { ...base, id: 'a', sent_at: '2026-07-24T09:00:00Z' },
      { ...base, id: 'b', sent_at: '2026-07-24T11:00:00Z' },
      { ...base, id: 'c', sent_at: null },
    ]
    expect(sentOps(rows).map(r => r.id)).toEqual(['b', 'a'])
    expect(sentOps(rows, 1).map(r => r.id)).toEqual(['b'])
  })
})

describe('blockedOps', () => {
  it('excludes operator discards but keeps every other block reason', () => {
    const rows: OpsDraft[] = [
      { ...base, id: 'a', send_blocked_reason: DISCARDED_REASON },
      { ...base, id: 'b', send_blocked_reason: 'rate_limited', created_at: '2026-07-24T08:00:00Z' },
      { ...base, id: 'c', send_blocked_reason: 'invalid_channel', created_at: '2026-07-24T12:00:00Z' },
    ]
    expect(blockedOps(rows).map(r => r.id)).toEqual(['c', 'b'])
  })
})

describe('expiresIn', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime()
  it('counts down in hours, then minutes, then reports expired', () => {
    expect(expiresIn('2026-07-28T12:00:00Z', now)).toBe('24h left')
    expect(expiresIn('2026-07-27T13:30:00Z', now)).toBe('1h left')
    expect(expiresIn('2026-07-27T12:20:00Z', now)).toBe('20m left')
    expect(expiresIn('2026-07-27T11:00:00Z', now)).toBe('expired')
  })
  it('renders nothing without an expiry', () => {
    expect(expiresIn(undefined, now)).toBeNull()
  })
})

describe('engineLabel', () => {
  it('names both engines and falls back to the raw id', () => {
    expect(engineLabel('ivan')).toBe('your feed')
    expect(engineLabel('risedtc')).toBe('Rise')
    expect(engineLabel('someone-else')).toBe('someone-else')
  })
})

describe('claimingOps', () => {
  it('holds rows between approve and done, newest approval first', () => {
    const rows: OpsDraft[] = [
      { ...base, id: 'pending' },
      { ...base, id: 'a', approved_at: '2026-07-27T09:00:00Z' },
      { ...base, id: 'b', approved_at: '2026-07-27T11:00:00Z' },
      { ...base, id: 'done', approved_at: '2026-07-27T08:00:00Z', sent_at: '2026-07-27T08:05:00Z' },
      { ...base, id: 'blocked', approved_at: '2026-07-27T07:00:00Z', send_blocked_reason: 'qa_em_dash' },
    ]
    expect(claimingOps(rows).map(r => r.id)).toEqual(['b', 'a'])
  })
})

describe('weekly_report lifecycle', () => {
  // Nothing dispatches a weekly report, so approve stamps approved_at AND
  // sent_at together. If it ever stamps only approved_at the card lands in
  // claimingOps and sits in the Working group forever, waiting for a writer
  // that does not exist. This test is the guard on that.
  it('leaves the Working group empty once approved, and shows up as sent', () => {
    const weekly: OpsDraft = {
      ...base, id: 'wk', kind: 'weekly_report', slack_channel: null as unknown as string,
      approved_at: '2026-08-02T18:10:00Z', sent_at: '2026-08-02T18:10:00Z',
      context: { week: '2026-08-03', report_url: 'https://example.test/r', calls_booked: 0 },
    }
    expect(claimingOps([weekly])).toEqual([])
    expect(sentOps([weekly]).map(r => r.id)).toEqual(['wk'])
    expect(pendingOps([weekly])).toEqual([])
  })

  it('is pending while untouched, and discardable without ever being sent', () => {
    const fresh: OpsDraft = { ...base, id: 'wk2', kind: 'weekly_report' }
    expect(pendingOps([fresh]).map(r => r.id)).toEqual(['wk2'])
    const discarded: OpsDraft = { ...fresh, send_blocked_reason: DISCARDED_REASON }
    expect(pendingOps([discarded])).toEqual([])
    expect(blockedOps([discarded])).toEqual([])
  })
})

describe('comment cards age out', () => {
  const mkC = (posted_at: string | null): OpsDraft => ({
    id: 'x', client_id: 'risedtc', kind: 'comment_reply', slack_channel: '',
    body: 'hi', context: { posted_at: posted_at ?? undefined }, created_at: '2026-07-30T00:00:00Z',
    approved_at: null, sent_at: null, send_blocked_reason: null,
  })
  const now = Date.parse('2026-07-30T12:00:00Z')

  it('keeps a comment from inside the 4 day window', () => {
    expect(pendingOps([mkC('2026-07-28T12:00:00Z')], now)).toHaveLength(1)
  })
  it('drops a comment older than 4 days', () => {
    expect(pendingOps([mkC('2026-07-25T11:00:00Z')], now)).toHaveLength(0)
  })
  it('keeps a comment with no posted_at: unknown age is not staleness', () => {
    expect(pendingOps([mkC(null)], now)).toHaveLength(1)
  })
  it('never ages out other kinds', () => {
    const old = { ...mkC('2026-07-01T00:00:00Z'), kind: 'escalation' as const }
    expect(pendingOps([old], now)).toHaveLength(1)
  })
  it('ages out outbound comment cards on the same window', () => {
    const old = { ...mkC('2026-07-25T11:00:00Z'), kind: 'comment_outbound' as const }
    expect(pendingOps([old], now)).toHaveLength(0)
    const fresh = { ...mkC('2026-07-29T11:00:00Z'), kind: 'comment_outbound' as const }
    expect(pendingOps([fresh], now)).toHaveLength(1)
  })
})

describe('comment_outbound approve routing', () => {
  const mkO = (ctx: Record<string, unknown>): OpsDraft => ({
    id: 'o', client_id: 'ivan', kind: 'comment_outbound', slack_channel: null as unknown as string,
    body: 'draft', context: ctx, created_at: '2026-08-01T00:00:00Z',
    approved_at: null, sent_at: null, send_blocked_reason: null,
  })
  it('ivan lane: carries the gate link', () => {
    const d = mkO({ approve_url: 'https://n8n.example/webhook/comment-approve?id=a&k=b', skip_url: 'https://n8n.example/webhook/comment-approve?id=a&k=b&dismiss=1' })
    expect(outboundApproveUrl(d)).toContain('comment-approve')
    expect(outboundSkipUrl(d)).toContain('dismiss=1')
  })
  it('risedtc lane: no link means copy mode', () => {
    expect(outboundApproveUrl(mkO({ feed_id: 'f1' }))).toBeNull()
    expect(outboundSkipUrl(mkO({ feed_id: 'f1' }))).toBeNull()
  })
  it('refuses a non-https approve link', () => {
    expect(outboundApproveUrl(mkO({ approve_url: 'javascript:alert(1)' }))).toBeNull()
  })
  it('never returns links for other kinds', () => {
    const d = { ...mkO({ approve_url: 'https://x.example/y' }), kind: 'comment_reply' as const }
    expect(outboundApproveUrl(d)).toBeNull()
  })
})

describe('canGenerateDraft', () => {
  // The empty comment card is the whole reason the button exists: the pipeline
  // drafts only what it classified `auto`, so an escalate card (or one whose
  // candidates all failed the voice gates) arrives blank and used to offer
  // nothing but "Mark handled".
  const card: OpsDraft = {
    ...base, id: 'c', kind: 'comment_reply', slack_channel: null as unknown as string,
    body: '', context: { comment_id: 'c-1', author_name: 'Clive William Kreft', action: 'escalate' },
  }

  it('offers a draft on the empty comment card', () => {
    expect(canGenerateDraft(card)).toBe(true)
    expect(canGenerateDraft({ ...card, body: '   ' })).toBe(true)
  })

  // The body is what Ivan edits and then publishes. Regenerating over a draft he
  // has already read (or half-rewritten) would replace his words silently, so a
  // card with text is never a draft target.
  it('never offers to overwrite a body that already exists', () => {
    expect(canGenerateDraft({ ...card, body: 'Agreed -- we screen margin first.' })).toBe(false)
  })

  // Approved, posted, discarded and blocked are all closed states; the edge
  // function refuses each one, and the button must not offer them either.
  it('never offers a draft for a closed card', () => {
    expect(canGenerateDraft({ ...card, approved_at: '2026-07-31T10:00:00Z' })).toBe(false)
    expect(canGenerateDraft({ ...card, sent_at: '2026-07-31T10:00:00Z' })).toBe(false)
    expect(canGenerateDraft({ ...card, send_blocked_reason: 'thread_already_answered' })).toBe(false)
    expect(canGenerateDraft({ ...card, send_blocked_reason: DISCARDED_REASON })).toBe(false)
  })

  // Only the comment lane has a drafter behind it. A newsjack angle and a weekly
  // report come from different engines entirely.
  it('is comment-only', () => {
    for (const kind of ['newsjack', 'weekly_report', 'escalation', 'update'] as const) {
      expect(canGenerateDraft({ ...card, kind })).toBe(false)
    }
  })

  // rise-comment-draft looks the comment up by context->>'comment_id' and 400s
  // without one.
  it('needs the comment id the engine looks the row up by', () => {
    expect(canGenerateDraft({ ...card, context: { author_name: 'Clive William Kreft' } })).toBe(false)
    expect(canGenerateDraft({ ...card, context: null })).toBe(false)
  })
})
