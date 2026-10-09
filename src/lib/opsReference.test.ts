import { describe, expect, it } from 'vitest'
import { opsBadge, pendingDmLaneOps, pendingTasks, type OpsDraft } from './ops'
import { opsWaitingBySeat } from '../d/counts/ops'
import { readBoard } from '../d/ops/model'

const reference: OpsDraft = {
  id: 'reference', client_id: 'ivan', kind: 'task', slack_channel: '', body: 'SWPPP',
  context: { presentation: 'reference' }, created_at: '2026-10-09T10:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null,
}

describe('internal reference records', () => {
  it('keep project history out of every actionable count and task/DM queue', () => {
    const task = { ...reference, id: 'real-task', context: {} }
    const rows = [reference, task]
    expect(opsBadge(rows).n).toBe(1)
    expect(opsWaitingBySeat(rows).ivan).toBe(1)
    expect(readBoard(rows, new Set()).waiting.ivan).toBe(1)
    expect(pendingTasks(rows).map(r => r.id)).toEqual(['real-task'])
    expect(pendingDmLaneOps(rows).map(r => r.id)).toEqual(['real-task'])
  })
  it('never hides an actionable client message because its context has the marker', () => {
    expect(opsBadge([{ ...reference, kind: 'update' }]).n).toBe(1)
  })
})
