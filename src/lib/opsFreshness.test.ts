import { describe, expect, it } from 'vitest'
import { claimingOps, isStaleComment, opsBadge, pendingOps, sentOps, splitCommentIdeas, type OpsDraft } from './ops'
import { readBoard } from '../d/ops/model'
import { opsWaitingBySeat } from '../d/counts/ops'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const row = (id: string, posted_at?: string, extra: Partial<OpsDraft> = {}): OpsDraft => ({
  id, kind: 'comment_outbound', client_id: 'ivan', body: 'draft', slack_channel: '',
  created_at: '2026-10-24T11:59:00Z', context: { posted_at },
  approved_at: null, sent_at: null, send_blocked_reason: null, ...extra,
})

describe('outbound originals have an inclusive 24-hour window', () => {
  it.each([
    ['2026-10-23T12:00:00Z', false],
    ['2026-10-23T11:59:59.999Z', true],
    ['2026-10-24T12:00:00Z', false],
    ['2026-10-24T12:00:00.001Z', true],
    [undefined, true], ['', true], ['garbage', true],
  ])('posted_at %s has stale=%s for every seat', (posted_at, stale) => {
    for (const client_id of ['ivan', '', 'rise', 'risedtc', 'arch', 'swishdm', 'new-seat']) {
      const d = row('x', posted_at, { client_id })
      expect(isStaleComment(d, NOW)).toBe(stale)
      expect(pendingOps([d], NOW)).toHaveLength(stale ? 0 : 1)
    }
  })

  it('uses only the original timestamp even when created_at contradicts it', () => {
    expect(pendingOps([row('old-original', '2026-10-22T12:00:00Z')], NOW)).toEqual([])
    expect(pendingOps([row('fresh-original', '2026-10-24T11:00:00Z', { created_at: '2020-01-01T00:00:00Z' })], NOW)).toHaveLength(1)
    expect(pendingOps([row('unknown', undefined, { context: null })], NOW)).toEqual([])
  })

  it('keeps incoming reply calendar-day policy including unknown timestamps', () => {
    for (const [posted_at, stale] of [['2026-10-23T12:00:00Z', false], ['2026-10-22T12:00:00Z', true], ['2026-10-20T12:00:00Z', true], ['', false], ['garbage', false]] as const) {
      expect(isStaleComment(row('reply', posted_at, { kind: 'comment_reply' }), NOW)).toBe(stale)
    }
  })

  it('expires held and working opportunities while keeping completed history', () => {
    const old = row('old', '2026-10-23T11:59:59Z', { approved_at: '2026-10-24T11:00:00Z' })
    const fresh = row('fresh', '2026-10-24T11:00:00Z', { approved_at: '2026-10-24T11:30:00Z' })
    expect(readBoard([old, fresh], new Set(['old', 'fresh']), NOW).flat.map(d => d.id)).toEqual(['fresh'])
    expect(claimingOps([old, fresh], NOW).map(d => d.id)).toEqual(['fresh'])
    expect(sentOps([{ ...old, sent_at: '2026-10-24T11:30:00Z' }]).map(d => d.id)).toEqual(['old'])
  })
})

it('puts the freshest three originals first per seat, preserving noncomment slots', () => {
  const task = { ...row('task'), kind: 'task' as const }
  const reply = { ...row('reply'), kind: 'comment_reply' as const }
  const rows = [
    row('older', '2026-10-23T13:00:00Z'), task,
    row('newest', '2026-10-24T11:00:00Z'), reply,
    row('third', '2026-10-24T09:00:00Z'), row('second', '2026-10-24T10:00:00Z'),
    row('expired', '2026-10-23T11:59:59Z'), row('unknown'),
  ]
  expect(pendingOps(rows, NOW).map(d => d.id)).toEqual(['newest', 'task', 'second', 'reply', 'third', 'older'])
  expect(splitCommentIdeas(rows, NOW).today.map(d => d.id)).toEqual(['newest', 'second', 'third'])
  expect(splitCommentIdeas(rows, NOW).later.map(d => d.id)).toEqual(['older'])
  expect(readBoard(rows, new Set(), NOW).lanes.ivan.map(d => d.id)).toEqual(['newest', 'second', 'reply', 'third'])
  expect(opsBadge(rows, NOW)).toEqual({ n: 2, ideasFolded: 1 })
  expect(opsWaitingBySeat(rows, NOW)).toEqual({ ivan: 2, risedtc: 0, arch: 0, swishdm: 0 })
})

it('fills each seat’s remaining room with its freshest originals', () => {
  const rows = ['ivan', 'risedtc', 'arch', 'swishdm'].flatMap(client_id => [
    row(`${client_id}-posted`, '2026-10-23T10:00:00Z', { client_id, approved_at: '2026-10-24T08:00:00Z', sent_at: '2026-10-24T08:00:00Z' }),
    ...['03', '09', '07', '11'].map(hour => row(`${client_id}-${hour}`, `2026-10-24T${hour}:00:00Z`, { client_id })),
  ])
  const { today, later } = splitCommentIdeas(rows, NOW)
  const board = readBoard(rows, new Set(), NOW)
  for (const seat of ['ivan', 'risedtc', 'arch', 'swishdm'] as const) {
    expect(today.filter(d => d.client_id === seat).map(d => d.id)).toEqual([`${seat}-11`, `${seat}-09`])
    expect(later.filter(d => d.client_id === seat).map(d => d.id)).toEqual([`${seat}-07`, `${seat}-03`])
    expect(board.lanes[seat].map(d => d.id)).toEqual([`${seat}-11`, `${seat}-09`])
  }
})
