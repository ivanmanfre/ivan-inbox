import type { MeasurementPayload, MeasurementMetric } from './audience'

/** Summarize only an identical server-returned cohort; never recompute or pool ranks. */
export function measurementSummary(payload: MeasurementPayload, age: number, metric: MeasurementMetric) {
  const rows = payload.matched_age.filter(r => r.target_age_days === age && r.metric === metric)
  const supported = rows.filter(r => r.status === 'supported' && (r.eligible_n ?? 0) >= (r.minimum_n ?? payload.minimum_n))
  const tuples = new Set(supported.map(r => JSON.stringify([r.eligible_n, r.minimum_n ?? payload.minimum_n, r.p50, r.p75, r.p90])))
  return { rows, cohort: tuples.size === 1 ? supported[0] : null, conflicting: tuples.size > 1 }
}

export function evidenceUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? value : null } catch { return null }
}
