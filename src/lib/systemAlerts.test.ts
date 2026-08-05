import { describe, expect, it } from 'vitest'
import {
  SYSTEM_ALERTS_TABLE, alertSummary, rankAlerts, type Severity, type SystemAlert,
} from './systemAlerts'

const alert = (o: Partial<SystemAlert>): SystemAlert => ({
  id: 'a', source: 'zernio_token_watch', dedupe_key: 'k', severity: 'warn' as Severity,
  title: 't', body: null, action_url: null, action_label: null,
  created_at: '2026-08-05T09:00:00.000Z', resolved_at: null, ...o,
})

describe('table', () => {
  it('pins the table name the n8n watcher writes to', () => {
    expect(SYSTEM_ALERTS_TABLE).toBe('system_alerts')
  })
})

describe('rankAlerts', () => {
  // The whole point of the strip is that the worst thing is the first thing.
  // Sorting by created_at alone would bury a dead OAuth grant under a note.
  it('puts severity ahead of recency', () => {
    const rows = [
      alert({ id: 'note', severity: 'info', created_at: '2026-08-05T09:00:00.000Z' }),
      alert({ id: 'dead', severity: 'critical', created_at: '2026-08-01T09:00:00.000Z' }),
      alert({ id: 'warn', severity: 'warn', created_at: '2026-08-04T09:00:00.000Z' }),
    ]
    expect(rankAlerts(rows).map(r => r.id)).toEqual(['dead', 'warn', 'note'])
  })

  it('breaks a severity tie with the newer row', () => {
    const rows = [
      alert({ id: 'old', severity: 'critical', created_at: '2026-08-01T09:00:00.000Z' }),
      alert({ id: 'new', severity: 'critical', created_at: '2026-08-05T09:00:00.000Z' }),
    ]
    expect(rankAlerts(rows).map(r => r.id)).toEqual(['new', 'old'])
  })

  it('does not mutate its input', () => {
    const rows = [alert({ id: 'a', severity: 'info' }), alert({ id: 'b', severity: 'critical' })]
    rankAlerts(rows)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('alertSummary', () => {
  // "1 alert" and "1 critical" are different sentences; only one says whether
  // to stop what you are doing.
  it('names the severities rather than a bare total', () => {
    const rows = [
      alert({ severity: 'critical' }), alert({ severity: 'warn' }), alert({ severity: 'warn' }),
    ]
    expect(alertSummary(rows)).toBe('1 critical · 2 warnings')
  })

  it('singularises and drops empty buckets', () => {
    expect(alertSummary([alert({ severity: 'warn' })])).toBe('1 warning')
    expect(alertSummary([alert({ severity: 'info' })])).toBe('1 note')
  })

  it('is empty for no rows, which is when the strip renders nothing at all', () => {
    expect(alertSummary([])).toBe('')
  })
})
