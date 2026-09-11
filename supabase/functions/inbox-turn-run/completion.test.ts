import { describe, expect, it } from 'vitest'
import { planCompletion } from './completion.ts'

// Before the bot thread existed, index.ts computed the push decision and the
// notify() call inline, like this (quoted verbatim from the pre-change file):
//
//   const startedMs = row.started_at ? Date.parse(row.started_at) : Date.parse(row.created_at)
//   const elapsed = now.getTime() - startedMs
//   const worthTelling = (status === 'done' || status === 'error') &&
//     (row.client_gone_at != null || elapsed > PUSH_IF_SLOWER_THAN_MS)
//
//   let pushed = false
//   if (worthTelling) {
//     try {
//       const answer = typeof patch.answer === 'string' ? patch.answer : ''
//       const out = await notify(db, {
//         family: 'claude_turn',
//         source: 'inbox-turn-run',
//         dedupe_key: `turn:${turnId}`,
//         severity: status === 'error' ? 'attention' : 'info',
//         push: true,
//         title: String(row.prompt ?? 'Claude turn').slice(0, 60),
//         body: (status === 'error' ? (patch.error_detail as string | null) ?? 'The turn failed.' : answer).slice(0, 140),
//         url: `./#exp/brain-b/ask?thread=${row.thread_id}&turn=${turnId}`,
//       })
//       pushed = out.pushed
//     } catch (e) { ... }
//   }
//
// planCompletion() must reproduce that exact object for every operator row,
// and only that object, so the operator path is provably unchanged.

const TURN_ID = 'a1a1a1a1-0000-0000-0000-000000000001'
const THREAD_ID = 'b2b2b2b2-0000-0000-0000-000000000002'
const NOW_MS = Date.parse('2026-09-11T12:00:00.000Z')

describe('planCompletion', () => {
  it('operator row, client_gone_at set, status done: matches the original notify object exactly', () => {
    const row = {
      origin: 'operator',
      prompt: 'What changed today?',
      thread_id: THREAD_ID,
      started_at: '2026-09-11T11:59:55.000Z', // 5s ago: alone this would NOT be worth telling
      created_at: '2026-09-11T11:59:50.000Z',
      client_gone_at: '2026-09-11T11:59:58.000Z', // but the tab closed, so it is
    }
    const patch = { answer: 'Here is what changed.', error_detail: null }

    const result = planCompletion({ row, status: 'done', patch, turnId: TURN_ID, nowMs: NOW_MS })

    // Hand-built from the original lines above, for status='done'.
    expect(result.notify).toEqual({
      family: 'claude_turn',
      source: 'inbox-turn-run',
      dedupe_key: `turn:${TURN_ID}`,
      severity: 'info',
      push: true,
      title: 'What changed today?',
      body: 'Here is what changed.',
      url: `./#exp/brain-b/ask?thread=${THREAD_ID}&turn=${TURN_ID}`,
    })
    expect(result.foldGroupKey).toBeNull()
  })

  it('operator row, finished within 20s, no client_gone_at: not worth telling, notify null', () => {
    const row = {
      origin: 'operator',
      prompt: 'quick one',
      thread_id: THREAD_ID,
      started_at: '2026-09-11T11:59:45.000Z', // 15s before NOW_MS
      created_at: '2026-09-11T11:59:40.000Z',
      client_gone_at: null,
    }
    const patch = { answer: 'done', error_detail: null }

    const result = planCompletion({ row, status: 'done', patch, turnId: TURN_ID, nowMs: NOW_MS })

    expect(result.notify).toBeNull()
    expect(result.foldGroupKey).toBeNull()
  })

  it('bot row, status done: notify null, foldGroupKey bot:<id>', () => {
    const row = {
      origin: 'bot',
      prompt: 'bundle of 3 rows',
      thread_id: THREAD_ID,
      started_at: '2026-09-11T11:00:00.000Z',
      created_at: '2026-09-11T11:00:00.000Z',
      client_gone_at: '2026-09-11T11:05:00.000Z', // even if it would otherwise be worth telling
    }
    const patch = { answer: 'Nothing needs you.', error_detail: null }

    const result = planCompletion({ row, status: 'done', patch, turnId: TURN_ID, nowMs: NOW_MS })

    expect(result.notify).toBeNull()
    expect(result.foldGroupKey).toBe(`bot:${TURN_ID}`)
  })

  it('bot row, status error: notify null, foldGroupKey null (rows stay unread for the next tick)', () => {
    const row = {
      origin: 'bot',
      prompt: 'bundle of 3 rows',
      thread_id: THREAD_ID,
      started_at: '2026-09-11T11:00:00.000Z',
      created_at: '2026-09-11T11:00:00.000Z',
      client_gone_at: null,
    }
    const patch = { answer: null, error_detail: 'model not found' }

    const result = planCompletion({ row, status: 'error', patch, turnId: TURN_ID, nowMs: NOW_MS })

    expect(result.notify).toBeNull()
    expect(result.foldGroupKey).toBeNull()
  })

  it('operator row, status error: the error-shaped notify object', () => {
    const row = {
      origin: 'operator',
      prompt: 'run the thing',
      thread_id: THREAD_ID,
      started_at: '2026-09-11T11:00:00.000Z',
      created_at: '2026-09-11T11:00:00.000Z',
      client_gone_at: null,
    }
    const patch = { answer: null, error_detail: 'upstream 500' }

    const result = planCompletion({ row, status: 'error', patch, turnId: TURN_ID, nowMs: NOW_MS })

    expect(result.notify).toEqual({
      family: 'claude_turn',
      source: 'inbox-turn-run',
      dedupe_key: `turn:${TURN_ID}`,
      severity: 'attention',
      push: true,
      title: 'run the thing',
      body: 'upstream 500',
      url: `./#exp/brain-b/ask?thread=${THREAD_ID}&turn=${TURN_ID}`,
    })
    expect(result.foldGroupKey).toBeNull()
  })
})
