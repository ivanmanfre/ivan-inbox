import { describe, expect, it } from 'vitest'
import { qaForCopy, sourceForCopy, type CopyReadiness } from './contentReadiness'
const hash = 'a'.repeat(64)
const other = 'b'.repeat(64)
describe('current-copy review', () => {
  it('keeps an unbound PASS as historical evidence', () => {
    expect(qaForCopy({ verdict: 'PASS', score: 80 }, hash)).toMatchObject({ state: 'unbound', label: 'QA recorded 80' })
  })
  it('does not keep a passing label after the copy changes', () => {
    expect(qaForCopy({ copy_review: { body_sha256: other, verdict: 'approve', score: 64, denominator: 80 } }, hash)).toMatchObject({ state: 'stale', label: 'QA needs recheck' })
  })
  it('shows the exact receipt score and denominator for reviewed copy', () => {
    expect(qaForCopy({ copy_review: { body_sha256: hash, verdict: 'approve', score: 64, denominator: 80, reviewed_at: '2026-10-18T10:00:00Z' } }, hash)).toMatchObject({ state: 'current', label: 'QA checked 64/80' })
  })
  it('reads the recovery receipt without upgrading the old QA score', () => {
    expect(qaForCopy({ score: 80, verdict: 'PASS', recovery_20261017: { copy_sha256: hash, independent_editorial_review: 'approve', score: 64, denominator: 80 } }, hash)).toMatchObject({ state: 'current', label: 'QA checked 64/80' })
  })
  it('a later failing review wins over an older matching pass', () => {
    expect(qaForCopy({ copy_sha256: hash, verdict: 'PASS', score: 90, reviewed_at: '2026-10-17T10:00:00Z', copy_review: { body_sha256: hash, verdict: 'reject', reviewed_at: '2026-10-18T10:00:00Z' } }, hash)).toMatchObject({ state: 'failed' })
  })
  it('does not infer review from an approval or unrelated nested hash', () => {
    expect(qaForCopy({ operator_publication_approval: { copy_sha256: hash }, other: { verdict: 'PASS', copy_sha256: hash } }, hash).state).toBe('none')
  })
})
describe('source checks', () => {
  const ready: CopyReadiness = { status: 'ok', body_sha256: hash, source_gate: { status: 'pass', applies: true }, final_gate: { status: 'off', applies: false } }
  it('shows current source check only for the requested copy', () => {
    expect(sourceForCopy(ready, hash)).toMatchObject({ state: 'pass', label: 'Source checked' })
    expect(sourceForCopy(ready, other).state).toBe('pending')
  })
  it('shows factual failure even when editorial QA passed', () => {
    expect(sourceForCopy({ ...ready, source_gate: { status: 'fail', applies: true, failures: [{ why: 'The source only said might.' }] } }, hash)).toMatchObject({ state: 'fail', label: 'Source check failed', reasons: ['The source only said might.'] })
  })
  it('does not turn an off gate or an unreadable check into a pass', () => {
    expect(sourceForCopy({ ...ready, source_gate: { status: 'not_applicable', applies: false } }, hash).state).toBe('not_checked')
    expect(sourceForCopy(null, hash).state).toBe('unavailable')
    expect(sourceForCopy({ status: 'unavailable' }, hash).state).toBe('unavailable')
  })
  it('exposes the final fact-gate explanation', () => {
    expect(sourceForCopy({ ...ready, final_gate: { applies: true, status: 'fail', verdict: { reason: 'Unsupported product count.' } } }, hash).reasons).toContain('Unsupported product count.')
  })
  it('an enforced final-artifact hold overrides a passing call check', () => {
    expect(sourceForCopy({ ...ready, final_gate: { applies: true, status: 'pending' } }, hash).state).toBe('pending')
  })
})
