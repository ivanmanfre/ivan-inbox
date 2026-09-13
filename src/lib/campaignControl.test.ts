import { describe, it, expect } from 'vitest'
import {
  parsePayload, isContractError, monitorLiveness, STATUS_TONE, CC_STATUSES,
  type CcPayload,
} from './campaignControl'
import healthy from './cc-fixtures/healthy.json'
import incident from './cc-fixtures/incident.json'
import partial from './cc-fixtures/partial.json'

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T }

describe('parsePayload', () => {
  it('accepts the frozen fixtures', () => {
    for (const f of [healthy, incident, partial]) {
      const p = parsePayload(f)
      expect(isContractError(p)).toBe(false)
      expect((p as CcPayload).payload_version).toBe('cc03.v1')
    }
  })

  it('accepts an explicit null recurrence as the partial state', () => {
    const p = parsePayload(partial)
    expect(isContractError(p)).toBe(false)
    expect((p as CcPayload).recurrence).toBeNull()
  })

  it('rejects a wrong schema_version', () => {
    const bad = clone(healthy) as Record<string, unknown>
    bad.schema_version = 2
    expect(isContractError(parsePayload(bad))).toBe(true)
  })

  it('rejects a wrong payload_version', () => {
    const bad = clone(healthy) as Record<string, unknown>
    bad.payload_version = 'cc03.v2'
    const r = parsePayload(bad)
    expect(isContractError(r)).toBe(true)
    expect((r as { contract_error: string }).contract_error).toContain('cc03.v1')
  })

  it.each(['clients', 'ranges', 'recurrence'] as const)('rejects a payload with no %s', section => {
    const bad = clone(healthy) as Record<string, unknown>
    delete bad[section]
    const r = parsePayload(bad)
    expect(isContractError(r)).toBe(true)
    expect((r as { contract_error: string }).contract_error).toContain(section)
  })

  it('rejects a status outside the five', () => {
    const bad = clone(healthy) as { clients: Array<{ status: string }> }
    bad.clients[0].status = 'ok'
    expect(isContractError(parsePayload(bad))).toBe(true)
  })

  it('rejects a non-numeric invitation confirmed_sent', () => {
    const bad = clone(healthy) as { clients: Array<{ invitation: { confirmed_sent: unknown } }> }
    bad.clients[0].invitation.confirmed_sent = '12'
    const r = parsePayload(bad)
    expect(isContractError(r)).toBe(true)
    expect((r as { contract_error: string }).contract_error).toContain('confirmed_sent')
  })

  it('rejects a rate_pct on a zero denominator', () => {
    const bad = clone(healthy) as { ranges: { rows: Array<Record<string, unknown>> } }
    const row = bad.ranges.rows.find(r => r.channel === 'invitation' && r.acceptance_cohort)!
    ;(row.acceptance_cohort as Record<string, unknown>).matured_denominator = 0
    ;(row.acceptance_cohort as Record<string, unknown>).rate_pct = 21
    const r = parsePayload(bad)
    expect(isContractError(r)).toBe(true)
    expect((r as { contract_error: string }).contract_error).toContain('matured_denominator')
  })

  it('accepts a null rate_pct on a zero denominator', () => {
    const ok = clone(healthy) as { ranges: { rows: Array<Record<string, unknown>> } }
    const row = ok.ranges.rows.find(r => r.channel === 'invitation' && r.acceptance_cohort)!
    ;(row.acceptance_cohort as Record<string, unknown>).matured_denominator = 0
    ;(row.acceptance_cohort as Record<string, unknown>).rate_pct = null
    expect(isContractError(parsePayload(ok))).toBe(false)
  })

  it('rejects a daily series with a day missing from the middle', () => {
    const bad = clone(healthy) as { ranges: { daily: Array<{ client_id: string; channel: string; day: string }> } }
    const victim = bad.ranges.daily.find(d => d.client_id === 'ivan' && d.channel === 'invitation' && d.day === '2026-08-20')!
    bad.ranges.daily = bad.ranges.daily.filter(d => d !== victim)
    const r = parsePayload(bad)
    expect(isContractError(r)).toBe(true)
    expect((r as { contract_error: string }).contract_error).toContain('2026-08-20')
    expect((r as { contract_error: string }).contract_error).toContain('not a zero')
  })

  it('rejects a daily series that stops short of the today interval', () => {
    const bad = clone(healthy) as { ranges: { daily: Array<{ day: string }> } }
    bad.ranges.daily = bad.ranges.daily.filter(d => d.day !== '2026-09-13')
    const r = parsePayload(bad)
    expect(isContractError(r)).toBe(true)
    expect((r as { contract_error: string }).contract_error).toContain('today')
  })

  it('accepts a day that is present carrying zero', () => {
    const ok = clone(healthy) as { ranges: { daily: Array<{ client_id: string; channel: string; day: string; sent: number }> } }
    const row = ok.ranges.daily.find(d => d.client_id === 'ivan' && d.channel === 'invitation' && d.day === '2026-08-20')!
    row.sent = 0
    expect(isContractError(parsePayload(ok))).toBe(false)
  })

  it('privacy guard: rejects a text key anywhere in the browser payload', () => {
    const bad = clone(healthy) as { evidence: Array<Record<string, unknown>> }
    bad.evidence[0].text = 'a memory body that must never reach a browser'
    const r = parsePayload(bad)
    expect(isContractError(r)).toBe(true)
    expect((r as { contract_error: string }).contract_error).toContain('private key')
  })

  it('privacy guard: rejects a source_locator key at any depth', () => {
    const bad = clone(incident) as { clients: Array<{ client_id: string; incidents?: Array<Record<string, unknown>> }> }
    bad.clients.find(c => c.client_id === 'arch')!.incidents![0].source_locator = '/Users/x/.claude/memory/whatever.md'
    const r = parsePayload(bad)
    expect(isContractError(r)).toBe(true)
    expect((r as { contract_error: string }).contract_error).toContain('source_locator')
  })
})

describe('status → tone', () => {
  it('never renders unknown as clear', () => {
    expect(STATUS_TONE.unknown).toBe('attention')
    expect(STATUS_TONE.unknown).not.toBe('clear')
  })
  it('gives only healthy the clear tone, and outside_window no tone at all', () => {
    expect(STATUS_TONE.healthy).toBe('clear')
    expect(STATUS_TONE.outside_window).toBeUndefined()
    expect(STATUS_TONE.capacity_reached).toBe('attention')
    expect(STATUS_TONE.incident).toBe('urgent')
    expect(CC_STATUSES.filter(s => STATUS_TONE[s] === 'clear')).toEqual(['healthy'])
  })
})

describe('monitorLiveness', () => {
  const at = (iso: string) => new Date(iso).getTime()
  const p = (last: string | null, stale = 900) => ({ monitor: { last_tick_at: last, stale_after_s: stale } })

  it('is fresh inside the staleness budget', () => {
    expect(monitorLiveness(p('2026-09-13T15:39:20Z'), at('2026-09-13T15:40:00Z'))).toBe('fresh')
  })
  it('is stale past it', () => {
    expect(monitorLiveness(p('2026-09-13T15:00:00Z'), at('2026-09-13T15:40:00Z'))).toBe('stale')
  })
  it('is unknown with no tick and unknown with no budget', () => {
    expect(monitorLiveness(p(null), at('2026-09-13T15:40:00Z'))).toBe('unknown')
    expect(monitorLiveness(p('2026-09-13T15:39:20Z', 0), at('2026-09-13T15:40:00Z'))).toBe('unknown')
  })
  it('reads the unknown fixture as stale', () => {
    const parsed = parsePayload(clone(healthy)) as CcPayload
    parsed.monitor.last_tick_at = '2026-09-13T14:05:00Z'
    expect(monitorLiveness(parsed, at('2026-09-13T15:40:00Z'))).toBe('stale')
  })
})

/* The adapter's soft-fail is proven where it matters and where it can be proven
   without a network: `src/wb/sends/Control.test.tsx` renders both failure states
   ({state:'unavailable'} and {state:'error'}) and asserts the reason is printed
   and no figure is; `evidence/render/measured-facts.json` carries the same two
   states from the real app (`?wbmock=fetch-error` and `?wbmock=cc:empty`).
   A unit test here would have to reach Supabase to fail, which is a network
   test wearing a unit test's clothes. */
