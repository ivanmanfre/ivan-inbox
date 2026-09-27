import { describe, expect, it } from 'vitest'
import { threadSubject } from '../../exp/v2c/chat/paneContext'
import { LANE_LABEL } from '../../lib/content'
import type { Thread } from '../../lib/turns'
import { sourcesLine } from './Answer'
import { outgoing } from './Composer'
import { bundleLabel, chatTail, chatsByDay, chipLabel, draftStarter, firstLine, secsSince, shortTitle, statusOf, stepOffset, subjectMeta, uuidOrNull } from './model'
import { runnerCount, visibleJobs } from './Runner'
import { stepWords } from './Steps'
import type { RunnerJob } from '../../wb/ask/jobs'

const subj = (lane: string, draft: boolean) => threadSubject({
  prospect_id: '33efc8cb-7c1e-4820-8049-14f683b0a813', prospect_name: 'Angel Wang', prospect_company: 'Seeking Alpha (US)',
  channel: 'linkedin', stage: 'replied', hasPendingDraft: draft,
  messages: [{ direction: 'outbound', created_at: '2026-09-20T10:00:00Z', message_text: 'hi' }, { direction: 'inbound', created_at: '2026-09-27T09:34:00Z', message_text: 'later' }],
}, lane, Date.parse('2026-09-27T12:00:00Z'))

describe('subject chip (read back from today\'s threadSubject)', () => {
  it('names the person, the seat and a waiting draft', () => {
    const m = subjectMeta(subj(LANE_LABEL.arch, true))
    expect(m).toEqual({ name: 'Angel Wang', first: 'Angel', seat: 'Arch', draftWaiting: true })
    expect(chipLabel(m)).toBe('Angel Wang · Arch · draft waiting')
  })
  it('maps Rise and Ivan, and says nothing about a draft that is not there', () => {
    expect(subjectMeta(subj(LANE_LABEL.risedtc, false)).seat).toBe('Rise')
    const i = subjectMeta(subj(LANE_LABEL.ivan, false))
    expect(chipLabel(i)).toBe('Angel Wang · Ivan')
  })
  it('the Draft it hand-off starts with today\'s quick-ask words', () => {
    expect(draftStarter(subjectMeta(subj('Ivan', true)))).toBe('Draft a reply to Angel ')
  })
})

describe('what leaves with a message', () => {
  it('one [attached: name] line per file, today\'s format', () => {
    expect(outgoing('  hi  ', [{ name: 'a.png' }, { name: 'b.pdf' }])).toBe('hi\n[attached: a.png]\n[attached: b.pdf]')
    expect(outgoing('hi', [])).toBe('hi')
  })
})

describe('chats', () => {
  const t = (id: string, at: string | null, extra: Partial<Thread> = {}) => ({ id, last_turn_at: at, turn_count: 3, last_status: 'done', ...extra } as Thread)
  it('groups by Warsaw day in order', () => {
    const now = Date.parse('2026-09-27T12:00:00Z')
    const g = chatsByDay([t('a', '2026-09-27T08:00:00Z'), t('b', '2026-09-26T21:00:00Z'), t('c', '2026-09-12T10:00:00Z'), t('d', null)], now)
    expect(g.map(x => [x.label, x.items.length])).toEqual([['Today', 1], ['Yesterday', 1], ['Sat 12 Sep', 1], ['Earlier', 1]])
  })
  it('turn counts, running, and a failed chat marked', () => {
    expect(chatTail({ turn_count: 1, last_status: 'done' })).toEqual({ text: '1 turn', failed: false })
    expect(chatTail({ turn_count: 3, last_status: 'running' })).toEqual({ text: 'running', failed: false })
    expect(chatTail({ turn_count: 1, last_status: 'error' })).toEqual({ text: '1 turn · failed', failed: true })
  })
  it('titles and bundles', () => {
    expect(shortTitle('a  b', 90)).toBe('a b')
    expect(shortTitle('x'.repeat(100), 10)).toHaveLength(10)
    expect(bundleLabel('[a] x\n[b] y\nfoot')).toBe('2 events')
    expect(bundleLabel('prose')).toBe('Feed rows')
  })
})

describe('status and steps', () => {
  it('working beats elsewhere beats failed; nothing at rest', () => {
    expect(statusOf({ busy: true, runningElsewhere: true, lastFailed: true })).toBe('working')
    expect(statusOf({ busy: false, runningElsewhere: true, lastFailed: true })).toBe('elsewhere')
    expect(statusOf({ busy: false, runningElsewhere: false, lastFailed: true })).toBe('failed')
    expect(statusOf({ busy: false, runningElsewhere: false, lastFailed: false })).toBe('idle')
  })
  it('times', () => {
    expect(secsSince(1000, 25_400)).toBe(24)
    expect(secsSince(null, 5)).toBe(0)
    expect(stepOffset(10_000, 1_000)).toBe('+9s')
    expect(stepOffset(undefined, 1)).toBeNull()
  })
  it('a hydrated step prints the broker\'s words, a streamed one today\'s summary', () => {
    expect(stepWords({ id: '1', tool: 'mcp', input: { detail: 'Searched your memory' } })).toBe('Searched your memory')
    expect(stepWords({ id: '2', tool: 'Read', input: { file_path: '/a/b/c/MEMORY.md' } })).toBe('Read c/MEMORY.md')
  })
  it('sources line', () => {
    expect(sourcesLine({ sources: [] })).toBeNull()
    expect(sourcesLine({ sources: [{ kind: 'memory', path: '/m/a.md' }, { kind: 'memory', path: '/m/b.md' }] })).toMatch(/^Read 2 memory files/)
  })
  it('first line and ids', () => {
    expect(firstLine('## Heading\nbody')).toBe('Heading')
    expect(uuidOrNull('33efc8cb-7c1e-4820-8049-14f683b0a813')).not.toBeNull()
    expect(uuidOrNull('nope')).toBeNull()
  })
})

describe('runner band', () => {
  const j = (id: string, status: RunnerJob['status']) => ({ id, status } as RunnerJob)
  it('every open job, then the newest finished, up to three', () => {
    expect(visibleJobs([j('a', 'done'), j('b', 'done'), j('c', 'done'), j('d', 'running')]).map(x => x.id)).toEqual(['b', 'c', 'd'])
  })
  it('running and waiting are different facts', () => {
    expect(runnerCount([j('a', 'queued'), j('b', 'done')])).toBe('1 waiting')
    expect(runnerCount([j('a', 'running'), j('b', 'queued')])).toBe('1 running')
    expect(runnerCount([j('a', 'done')])).toBe('1 recent')
  })
})
