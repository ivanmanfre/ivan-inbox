import { describe, expect, it } from 'vitest'
import { measurementSummary, evidenceUrl } from './measurement-summary'
import type { MeasurementPayload, MeasurementRow } from './audience'
const row = { client_id: 'ivan', metric: 'impressions', target_age_days: 7, status: 'supported', eligible_n: 8, minimum_n: 8, p50: 100, p75: 200, p90: 300 } as MeasurementRow
const payload = (rows: MeasurementRow[]) => ({ matched_age: rows, minimum_n: 8 }) as MeasurementPayload

describe('matched-age summary', () => {
  it('selects an age and metric without mixing other cohorts', () => {
    const result = measurementSummary(payload([row, { ...row, target_age_days: 14, p90: 999 }, { ...row, metric: 'engagement_count', p90: 6 }]), 7, 'impressions')
    expect(result.rows).toEqual([row]); expect(result.cohort?.p90).toBe(300)
  })
  it('withholds ambiguous or under-floor summaries', () => {
    expect(measurementSummary(payload([row, { ...row, p90: 999 }]), 7, 'impressions').conflicting).toBe(true)
    expect(measurementSummary(payload([{ ...row, eligible_n: 7 }]), 7, 'impressions').cohort).toBeNull()
  })
  it('keeps every selected row and leaves missing history empty', () => {
    expect(measurementSummary(payload(Array.from({ length: 30 }, () => row)), 7, 'impressions').rows).toHaveLength(30)
    expect(measurementSummary(payload([row]), 14, 'impressions').rows).toHaveLength(0)
  })
  it('allows only actual web source URLs', () => {
    expect(evidenceUrl('https://linkedin.com/feed/update/test')).toContain('https:')
    expect(evidenceUrl('javascript:alert(1)')).toBeNull()
    expect(evidenceUrl('canonical:123')).toBeNull()
  })
})
