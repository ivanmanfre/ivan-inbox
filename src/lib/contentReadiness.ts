export type GateRead = { status: string; applies: boolean; checked_at?: string | null; failures?: { why?: string; text?: string }[] | null; verdict?: { reason?: string } | null }
export type CopyReadiness = { status: string; body_sha256?: string; source_gate?: GateRead; final_gate?: GateRead }
export type QaCopyState = { state: 'none' | 'unbound' | 'stale' | 'current' | 'failed'; label: string; reviewedAt: string | null }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const text = (v: unknown) => typeof v === 'string' ? v : ''
const score = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : ''

/** Only named review receipts qualify. Approval, source and arbitrary metadata are not editorial QA. */
export function qaForCopy(value: unknown, hash: string | null): QaCopyState {
  const qa = obj(value)
  const receipts = [obj(qa.copy_review), obj(qa.recovery_20261017), qa]
    .filter(r => text(r.body_sha256 ?? r.copy_sha256) && text(r.verdict ?? r.independent_editorial_review))
    .sort((a, b) => (Date.parse(text(b.reviewed_at ?? b.at)) || 0) - (Date.parse(text(a.reviewed_at ?? a.at)) || 0))
  const r = receipts[0]
  if (r) {
    const reviewedAt = text(r.reviewed_at ?? r.at) || null
    if (!hash || text(r.body_sha256 ?? r.copy_sha256) !== hash) return { state: 'stale', label: 'QA needs recheck', reviewedAt }
    const v = text(r.verdict ?? r.independent_editorial_review).toLowerCase()
    if (!['pass', 'approve', 'approved', 'approve_exact_sha_editorial'].includes(v)) return { state: 'failed', label: 'QA needs attention', reviewedAt }
    const n = score(r.score), denominator = score(r.denominator)
    return { state: 'current', label: `QA checked${n ? ` ${n}${denominator ? `/${denominator}` : ''}` : ''}`, reviewedAt }
  }
  const n = score(qa.score)
  return n || text(qa.verdict) ? { state: 'unbound', label: `QA recorded${n ? ` ${n}` : ''}`, reviewedAt: text(qa.reviewed_at) || null }
    : { state: 'none', label: 'QA not recorded', reviewedAt: null }
}

export function sourceForCopy(value: CopyReadiness | null, hash: string | null): {
  state: 'pass' | 'fail' | 'pending' | 'not_checked' | 'unavailable'; label: string; reasons: string[]
} {
  if (!value) return { state: 'unavailable', label: 'Source check unavailable', reasons: [] }
  if (value.status !== 'ok' && value.status !== 'copy_changed') return { state: 'unavailable', label: 'Source check unavailable', reasons: [] }
  if (value.status === 'copy_changed' || !hash || value.body_sha256 !== hash) return { state: 'pending', label: 'Copy changed; reopen this draft', reasons: [] }
  if (value.status !== 'ok') return { state: 'unavailable', label: 'Source check unavailable', reasons: [] }
  const gates = [value.source_gate, value.final_gate].filter((g): g is GateRead => g?.applies === true)
  const failed = gates.filter(g => g.status === 'fail')
  if (failed.length) return { state: 'fail', label: 'Source check failed', reasons: failed.flatMap(g => [...(g.failures ?? []).map(f => f.why || f.text || ''), g.verdict?.reason ?? '']).filter(Boolean).map(s => s.slice(0, 500)) }
  if (gates.some(g => g.status !== 'pass')) return { state: 'pending', label: 'Source check pending', reasons: [] }
  return gates.length ? { state: 'pass', label: 'Source checked', reasons: [] }
    : { state: 'not_checked', label: 'No automated source check for this post', reasons: [] }
}
