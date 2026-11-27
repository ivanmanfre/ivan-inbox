import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The newest migration that (re)defines inbox_referral_prewarm() is the live body (db/ files sort by date prefix).
const dir = join(__dirname, '../../db')
const latest = readdirSync(dir).filter(f => /^2026\d{4}[a-z]?_.*\.sql$/.test(f) && !/rollback/.test(f))
  .filter(f => /create or replace function public\.inbox_referral_prewarm\(\)/i.test(readFileSync(join(dir, f), 'utf8'))).sort().pop()!
const body = readFileSync(join(dir, latest), 'utf8')
const revision = readFileSync(join(__dirname, '../../supabase/functions/inbox-dm-draft/research.ts'), 'utf8').match(/export const REFERRAL_REVISION = (\d+)/)![1]

describe('inbox_referral_prewarm (newest migration)', () => {
  it('maps a campaign with no client to the ivan seat, as inbox_messages_v does', () => {
    expect(latest).toBe('20261127c_referral_opens.sql')
    // An Ivan campaign with a NULL client_id is the ivan seat in the inbox (COALESCE(c.client_id, 'ivan')); a raw
    // c.client_id filter skipped every open referral on such a campaign (one stuck at revision 12 on 2026-11-27).
    const joins = body.match(/join outreach_campaigns c on [^\n]*/gi) ?? []
    expect(joins.length).toBeGreaterThan(0)
    for (const j of joins) expect(j).toMatch(/coalesce\(c\.client_id, 'ivan'\) in \('ivan', 'arch', 'risedtc'\)/)
    expect(body).not.toMatch(/\bc\.client_id in \(/)
  })
  it('compares stored referrals to the handler revision', () => {
    const literals = [...body.matchAll(/->> 'revision'\) (?:=|is distinct from) '(\d+)'/g)].map(m => m[1])
    expect(literals.length).toBe(3)
    for (const l of literals) expect(l).toBe(revision)
  })
})
