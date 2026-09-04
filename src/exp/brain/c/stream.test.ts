import { describe, expect, it } from 'vitest'
import { latestActivityAt, mergeStream, type StreamTurn } from './stream'
import type { Notification } from '../../../lib/turns'
import type { Turn } from '../../v2c/chat/events'

function turn(id: string, at: string, role: Turn['role'] = 'user'): StreamTurn {
  return { id, role, text: `text-${id}`, tools: [], error: null, at }
}

function note(over: Partial<Notification>): Notification {
  return {
    id: over.id ?? 'n1',
    family: over.family ?? 'reply_draft_pending',
    source: null,
    severity: over.severity ?? 'attention',
    title: over.title ?? 'Title',
    body: over.body ?? null,
    url: over.url ?? null,
    media: null,
    group_key: over.group_key ?? null,
    tenant: over.tenant ?? null,
    count: over.count ?? 1,
    first_seen_at: over.first_seen_at ?? '2026-09-04T10:00:00Z',
    last_seen_at: over.last_seen_at ?? '2026-09-04T10:00:00Z',
    created_at: over.created_at ?? '2026-09-04T10:00:00Z',
    read_at: over.read_at ?? null,
    dismissed_at: over.dismissed_at ?? null,
  }
}

describe('mergeStream — interleave by time', () => {
  it('orders turns and notifications oldest first, newest at the bottom', () => {
    const turns = [turn('a', '2026-09-04T10:00:00Z'), turn('c', '2026-09-04T10:10:00Z')]
    const notes = [note({ id: 'n1', last_seen_at: '2026-09-04T10:05:00Z' })]
    const out = mergeStream(turns, notes, { filter: 'all', quiet: false })
    expect(out.map(e => e.key)).toEqual(['t:a', 'n:f:reply_draft_pending:title', 't:c'])
  })

  it('is a pure function: same inputs, same output, no mutation of inputs', () => {
    const turns = [turn('a', '2026-09-04T10:00:00Z')]
    const notes = [note({})]
    const snapshotTurns = JSON.stringify(turns)
    const snapshotNotes = JSON.stringify(notes)
    mergeStream(turns, notes, { filter: 'all', quiet: false })
    expect(JSON.stringify(turns)).toBe(snapshotTurns)
    expect(JSON.stringify(notes)).toBe(snapshotNotes)
  })
})

describe('mergeStream — repeat folding', () => {
  it('folds repeats of the same family+shape into one notification group card', () => {
    const notes = [
      note({ id: 'n1', title: '3 drafts waiting', last_seen_at: '2026-09-04T10:00:00Z' }),
      note({ id: 'n2', title: '5 drafts waiting', last_seen_at: '2026-09-04T10:05:00Z' }),
    ]
    const out = mergeStream([], notes, { filter: 'all', quiet: false })
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('notification')
    if (out[0].kind === 'notification') {
      expect(out[0].group.items).toHaveLength(2)
      expect(out[0].group.latest.id).toBe('n2') // newest state of the situation
    }
  })
})

describe('mergeStream — filters', () => {
  const turns = [turn('a', '2026-09-04T10:00:00Z')]
  const notes = [
    note({ id: 'needs', family: 'reply_draft_pending', severity: 'attention', last_seen_at: '2026-09-04T10:01:00Z' }),
    note({ id: 'info', family: 'health_reminder', severity: 'info', title: 'Reminder', last_seen_at: '2026-09-04T10:02:00Z' }),
    note({ id: 'rise', family: 'booking_notice', severity: 'attention', tenant: 'RISE', title: 'Rise booking', last_seen_at: '2026-09-04T10:03:00Z' }),
    note({ id: 'arch', family: 'booking_notice', severity: 'attention', tenant: 'ARCH', title: 'Arch booking', last_seen_at: '2026-09-04T10:04:00Z' }),
  ]

  it('asks clears every notification and keeps only turns', () => {
    const out = mergeStream(turns, notes, { filter: 'asks', quiet: false })
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('turn')
  })

  it('needs keeps only groups that need a decision', () => {
    const out = mergeStream([], notes, { filter: 'needs', quiet: false })
    const ids = out.flatMap(e => (e.kind === 'notification' ? [e.group.latest.id] : []))
    expect(ids.sort()).toEqual(['arch', 'needs', 'rise'])
    expect(ids).not.toContain('info')
  })

  it('rise and arch each keep only their own tenant', () => {
    const rise = mergeStream([], notes, { filter: 'rise', quiet: false })
    expect(rise.map(e => (e.kind === 'notification' ? e.group.latest.id : null))).toEqual(['rise'])
    const arch = mergeStream([], notes, { filter: 'arch', quiet: false })
    expect(arch.map(e => (e.kind === 'notification' ? e.group.latest.id : null))).toEqual(['arch'])
  })

  it('never tenant-filters turns', () => {
    const rise = mergeStream(turns, [], { filter: 'rise', quiet: false })
    expect(rise).toHaveLength(1)
    expect(rise[0].kind).toBe('turn')
  })
})

describe('mergeStream — quiet fold', () => {
  it('folds only info-severity, quiet-eligible families into one row', () => {
    const notes = [
      note({ id: 'a', family: 'health_reminder', severity: 'info', last_seen_at: '2026-09-04T10:00:00Z' }),
      note({ id: 'b', family: 'content_sourcing_pipeline', severity: 'info', title: 'ideas', last_seen_at: '2026-09-04T10:01:00Z' }),
      note({ id: 'c', family: 'reply_draft_pending', severity: 'attention', title: 'draft', last_seen_at: '2026-09-04T10:02:00Z' }),
    ]
    const out = mergeStream([], notes, { filter: 'all', quiet: true })
    const quiet = out.find(e => e.kind === 'quiet')
    const cards = out.filter(e => e.kind === 'notification')
    expect(quiet).toBeDefined()
    if (quiet?.kind === 'quiet') expect(quiet.count).toBe(2)
    expect(cards).toHaveLength(1) // the needs-me card stays a full card
  })

  it('never folds a group that still needs a decision, even at quiet=true', () => {
    const notes = [note({ id: 'a', family: 'seat_health', severity: 'error', last_seen_at: '2026-09-04T10:00:00Z' })]
    const out = mergeStream([], notes, { filter: 'all', quiet: true })
    expect(out.find(e => e.kind === 'quiet')).toBeUndefined()
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('notification')
  })

  it('quiet=false shows every family as its own card, none folded', () => {
    const notes = [
      note({ id: 'a', family: 'health_reminder', severity: 'info', last_seen_at: '2026-09-04T10:00:00Z' }),
      note({ id: 'b', family: 'reporting_digest', severity: 'info', title: 'digest', last_seen_at: '2026-09-04T10:01:00Z' }),
    ]
    const out = mergeStream([], notes, { filter: 'all', quiet: false })
    expect(out.filter(e => e.kind === 'notification')).toHaveLength(2)
    expect(out.find(e => e.kind === 'quiet')).toBeUndefined()
  })
})

describe('latestActivityAt', () => {
  it('reads the most recent timestamp across turns and notifications', () => {
    const turns = [turn('a', '2026-09-04T10:00:00Z')]
    const notes = [note({ last_seen_at: '2026-09-04T11:00:00Z' })]
    expect(latestActivityAt(turns, notes)).toBe('2026-09-04T11:00:00Z')
  })
  it('returns null when there is nothing at all', () => {
    expect(latestActivityAt([], [])).toBeNull()
  })
})
