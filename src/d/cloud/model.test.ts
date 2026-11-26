import { describe, expect, it } from 'vitest'
import { conversations, errorWords, firstLine, merge, submissionDone, submissionKey, upsert, type CloudJob } from './model'

const job = (over: Partial<CloudJob>): CloudJob => ({
  id: 'a', origin: 'inbox', status: 'done', title: 'Build a scan', brief: 'Build a scan for the shop', t3_link: null,
  t3_thread_id: 'thread:1', result_summary: 'Done.', parent_job_id: null,
  created_at: '2026-11-26T10:00:00Z', updated_at: '2026-11-26T10:05:00Z', ...over,
})

describe('cloud conversations', () => {
  it('groups replies under their root, oldest turn first, newest conversation first', () => {
    const root = job({ id: 'r1' })
    const reply = job({ id: 'p1', origin: 'reply', parent_job_id: 'r1', created_at: '2026-11-26T11:00:00Z', updated_at: '2026-11-26T11:02:00Z' })
    const reply2 = job({ id: 'p2', origin: 'reply', parent_job_id: 'p1', created_at: '2026-11-26T12:00:00Z', updated_at: '2026-11-26T12:01:00Z' })
    const other = job({ id: 'r2', created_at: '2026-11-25T10:00:00Z', updated_at: '2026-11-25T10:00:00Z' })
    const c = conversations([reply2, other, reply, root])
    expect(c.map(x => x.root.id)).toEqual(['r1', 'r2'])
    expect(c[0].turns.map(t => t.id)).toEqual(['r1', 'p1', 'p2'])
    expect(c[0].latest.id).toBe('p2')
    expect(c[0].canReply).toBe(true)
  })

  it('no reply while any turn is still working, or before the thread exists', () => {
    expect(conversations([job({ id: 'r1', status: 'running' })])[0].canReply).toBe(false)
    expect(conversations([job({ id: 'r1', status: 'failed', t3_thread_id: null })])[0].canReply).toBe(false)
    const c = conversations([job({ id: 'r1' }), job({ id: 'p1', origin: 'reply', parent_job_id: 'r1', status: 'queued', created_at: '2026-11-26T11:00:00Z' })])
    expect(c[0].live).toBe(true)
    expect(c[0].canReply).toBe(false)
  })

  it('a reply whose root is missing from the page is left out, never shown as its own job', () => {
    expect(conversations([job({ id: 'p1', origin: 'reply', parent_job_id: 'gone' })])).toEqual([])
  })

  it('a reply answers the newest finished turn that has a thread, never a refused reply', () => {
    const root = job({ id: 'r1' })
    const refused = job({ id: 'p1', origin: 'reply', parent_job_id: 'r1', status: 'failed', t3_thread_id: null, created_at: '2026-11-26T11:00:00Z' })
    const c = conversations([root, refused])[0]
    expect(c.latest.id).toBe('p1')
    expect(c.replyTo?.id).toBe('r1')
    expect(c.canReply).toBe(true)
  })

  it('a late read never puts back an older copy than a live change', () => {
    const live = job({ id: 'r1', status: 'done', updated_at: '2026-11-26T10:09:00Z' })
    const stale = job({ id: 'r1', status: 'running', updated_at: '2026-11-26T10:01:00Z' })
    expect(merge([live], [stale])[0].status).toBe('done')
    expect(merge([stale], [live])[0].status).toBe('done')
  })

  it('a submission keeps its key until that key is confirmed, per destination and text', () => {
    let n = 0
    const make = () => `k${++n}`
    const a = submissionKey('new', 'build a scan', make)
    expect(submissionKey('new', 'build a scan', make)).toBe(a)
    expect(submissionKey('r1', 'build a scan', make)).not.toBe(a)
    const b = submissionKey('new', 'something else', make)
    expect(b).not.toBe(a)
    // a second submission never erases the first one's key (Sol r3 #5)
    expect(submissionKey('new', 'build a scan', make)).toBe(a)
    submissionDone('new', b)
    expect(submissionKey('new', 'build a scan', make)).toBe(a)
    submissionDone('new', a)
    expect(submissionKey('new', 'build a scan', make)).not.toBe(a)
  })

  it('upsert replaces by id', () => {
    const l = upsert([job({ id: 'r1', status: 'running' })], job({ id: 'r1', status: 'done', updated_at: '2026-11-26T10:06:00Z' }))
    expect(l).toHaveLength(1)
    expect(l[0].status).toBe('done')
  })

  it('first line strips markdown marks and cuts long lines', () => {
    expect(firstLine('\n## Done\nmore')).toBe('Done')
    expect(firstLine('x'.repeat(200), 10)).toHaveLength(10)
    expect(firstLine(null)).toBe('')
  })

  it('every server error has plain words', () => {
    for (const code of ['not_allowed', 'empty_job', 'still_running', 'thread_busy', 'no_thread_yet']) {
      expect(errorWords(code)).not.toMatch(/_/)
    }
    expect(errorWords('weird')).toBe('That did not go through. Try again.')
  })
})
