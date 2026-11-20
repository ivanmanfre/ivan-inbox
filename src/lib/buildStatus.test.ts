import { describe, expect, it } from 'vitest'
import { readIvanBuild, readSwishBuild } from './buildStatus'

const hm = (iso: string) => iso.slice(11, 16)
const now = Date.parse('2026-01-05T10:20:00Z')
const ctx = { first: 'Alex', since: '2026-01-05T10:00:00Z', now, hm }

describe('readSwishBuild', () => {
  it('a running build says so, with its start', () => {
    const b = readSwishBuild({ status: 'requested', at: '2026-01-05T10:01:00Z', v8: { state: 'running', first_at: '2026-01-05T10:02:00Z', until: '2026-01-05T10:32:00Z' } }, ctx)
    expect(b?.tone).toBe('wait')
    expect(b?.head).toBe('Alex said yes to the report. It is being built now (started 10:02).')
  })
  it('a request with no live claim reads as queued, and a failed try says when it retries', () => {
    expect(readSwishBuild({ status: 'requested', at: '2026-01-05T10:01:00Z' }, ctx)?.head).toBe('Alex said yes to the report. It is queued to build (asked 10:01).')
    const stale = readSwishBuild({ status: 'requested', at: '2026-01-05T10:01:00Z', v8: { state: 'running', first_at: '2026-01-05T09:00:00Z', until: '2026-01-05T09:30:00Z' } }, ctx)
    expect(stale?.head).toContain('queued')
    expect(readSwishBuild({ status: 'requested', v8: { retry_after: '2026-01-05T10:40:00Z', why: 'proxy' } }, ctx)?.body).toContain('A build try failed (proxy), next try 10:40.')
  })
  it('a held page names what it waits for; an error is an alert', () => {
    expect(readSwishBuild({ status: 'held_rebuild', hold: 'post_accept_check_pending' }, ctx)?.head).toContain('the ChatGPT and Gemini check on the brand to finish')
    const e = readSwishBuild({ status: 'error', error: 'no_evidence' }, ctx)
    expect(e?.tone).toBe('alert')
    expect(e?.head).toContain('could not be built: there are no saved ChatGPT or Gemini answers')
  })
  it('a built page with no waiting reply links the page; nothing stamped draws nothing', () => {
    expect(readSwishBuild({ status: 'built_held', url: 'https://example.com/p/' }, ctx)?.url).toBe('https://example.com/p/')
    expect(readSwishBuild(null, ctx)).toBeNull()
    expect(readSwishBuild({}, ctx)).toBeNull()
  })
})

describe('readIvanBuild', () => {
  it('an attempt after the yes reads as building', () => {
    const b = readIvanBuild({ requested_at: '2026-01-05T10:02:00Z', first_requested_at: '2026-01-05T10:02:00Z', attempts: 1 }, ctx)
    expect(b?.head).toBe('Alex said yes to the audit. It is being built now (started 10:02).')
    expect(b?.body).toContain('usually within 30 minutes')
  })
  it('a stale stamp from an older yes draws nothing (the drafter never clears it)', () => {
    expect(readIvanBuild({ requested_at: '2025-12-01T10:00:00Z', attempts: 2 }, ctx)).toBeNull()
    expect(readIvanBuild({ requested_at: '2026-01-05T10:02:00Z' }, { ...ctx, since: null })).toBeNull()
  })
  it('a slow build says how many tries; a thin profile is an alert', () => {
    expect(readIvanBuild({ requested_at: '2026-01-05T10:15:00Z', first_requested_at: '2026-01-05T09:00:00Z', attempts: 4 }, ctx)?.body).toContain('try 4, the last one at 10:15')
    expect(readIvanBuild({ skipped: 'thin_corpus', at: '2026-01-05T10:03:00Z' }, ctx)?.tone).toBe('alert')
    expect(readIvanBuild({ skipped: 'thin_corpus', at: '2025-07-01T10:00:00Z' }, ctx)).toBeNull()
  })
})
