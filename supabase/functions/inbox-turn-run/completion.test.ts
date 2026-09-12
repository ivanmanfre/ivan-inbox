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
//
// 2026-09-12: `botPushMuted` was added as a required argument (db/065). Every
// assertion below is unchanged; the operator path does not read it, and passing
// `false` is what the webhook passes for a thread nobody muted. The bot push
// itself is pinned in the second describe block.

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

    const result = planCompletion({ row, status: 'done', patch, turnId: TURN_ID, nowMs: NOW_MS, botPushMuted: false })

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
    expect(result.supersede).toBe(false)
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

    const result = planCompletion({ row, status: 'done', patch, turnId: TURN_ID, nowMs: NOW_MS, botPushMuted: false })

    expect(result.notify).toBeNull()
    expect(result.foldGroupKey).toBeNull()
    expect(result.supersede).toBe(false)
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

    const result = planCompletion({ row, status: 'done', patch, turnId: TURN_ID, nowMs: NOW_MS, botPushMuted: false })

    expect(result.notify).toBeNull()
    expect(result.foldGroupKey).toBe(`bot:${TURN_ID}`)
    expect(result.supersede).toBe(false)
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

    const result = planCompletion({ row, status: 'error', patch, turnId: TURN_ID, nowMs: NOW_MS, botPushMuted: false })

    expect(result.notify).toBeNull()
    expect(result.foldGroupKey).toBeNull()
    expect(result.supersede).toBe(false)
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

    const result = planCompletion({ row, status: 'error', patch, turnId: TURN_ID, nowMs: NOW_MS, botPushMuted: false })

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
    expect(result.supersede).toBe(false)
  })
})

// --------------------------------------------------------------------------
// The bot push (inbox-agent-drawer 2026-09-12, mission 2.3, decisions D4-D6).
//
// The question these pin is when Ivan's real phone rings. There are exactly
// three ways it must not: the bundle carried no pill he can tap, he muted the
// family, or the turn failed.
// --------------------------------------------------------------------------
const BOT_ROW = {
  origin: 'bot',
  prompt: 'bundle of 3 rows',
  thread_id: THREAD_ID,
  started_at: '2026-09-11T11:00:00.000Z',
  created_at: '2026-09-11T11:00:00.000Z',
  client_gone_at: null,
}

const ACTIONABLE_ANSWER = [
  '**Mattan seat under floor:** eleven sends against a floor of twenty.',
  '',
  'I am leaving the cold lane alone.',
  '',
  '```actions',
  '[{"label":"Open the sends lane","kind":"open","payload":{"url":"./#exp/brain-b/sends"}}]',
  '```',
].join('\n')

describe('planCompletion: the bot push', () => {
  it('actionable and unmuted: the family bot notify object, exact fields', () => {
    const result = planCompletion({
      row: BOT_ROW,
      status: 'done',
      patch: { answer: ACTIONABLE_ANSWER, error_detail: null },
      turnId: TURN_ID,
      nowMs: NOW_MS,
      botPushMuted: false,
    })

    expect(result.notify).toEqual({
      family: 'bot',
      source: 'inbox-turn-run',
      dedupe_key: null,
      severity: 'attention',
      push: true,
      title: 'Mattan seat under floor: eleven sends against a floor of',
      body: 'I am leaving the cold lane alone.',
      url: `./#exp/brain-b/ask?thread=${THREAD_ID}&turn=${TURN_ID}`,
      group_key: 'bot',
    })
    // The fold still happens: the rows the bot read are read whether or not it
    // also rang the phone.
    expect(result.foldGroupKey).toBe(`bot:${TURN_ID}`)
    expect(result.supersede).toBe(true)
  })

  it('actionable but muted: silent, and the fold still happens', () => {
    const result = planCompletion({
      row: BOT_ROW,
      status: 'done',
      patch: { answer: ACTIONABLE_ANSWER, error_detail: null },
      turnId: TURN_ID,
      nowMs: NOW_MS,
      botPushMuted: true,
    })
    expect(result.notify).toBeNull()
    expect(result.supersede).toBe(false)
    expect(result.foldGroupKey).toBe(`bot:${TURN_ID}`)
  })

  it('quiet bundles stay silent: fold-only, an empty array, no block, a broken block', () => {
    const quiet = [
      'Nothing needs you. I folded 9 routine rows.\n\n```actions\n[{"label":"Fold these rows","kind":"fold","payload":{}}]\n```',
      'Nothing needs you.\n\n```actions\n[]\n```',
      'Nothing needs you. I folded 9 routine rows.',
      'Two lanes moved.\n\n```actions\n[{"label":"Open it","kind":"open","payload":{"url":"javascript:alert(1)"}}]\n```',
    ]
    for (const answer of quiet) {
      const result = planCompletion({
        row: BOT_ROW,
        status: 'done',
        patch: { answer, error_detail: null },
        turnId: TURN_ID,
        nowMs: NOW_MS,
        botPushMuted: false,
      })
      expect(result.notify).toBeNull()
      expect(result.supersede).toBe(false)
      expect(result.foldGroupKey).toBe(`bot:${TURN_ID}`)
    }
  })

  it('a bot turn that errored never pushes, even with a pill in the partial answer', () => {
    const result = planCompletion({
      row: BOT_ROW,
      status: 'error',
      patch: { answer: ACTIONABLE_ANSWER, error_detail: 'upstream 500' },
      turnId: TURN_ID,
      nowMs: NOW_MS,
      botPushMuted: false,
    })
    expect(result.notify).toBeNull()
    expect(result.supersede).toBe(false)
    expect(result.foldGroupKey).toBeNull()
  })

  it('falls back to a title when the answer is only an actions block', () => {
    const result = planCompletion({
      row: BOT_ROW,
      status: 'done',
      patch: {
        answer: '```actions\n[{"label":"Name the price","kind":"task","payload":{"title":"Name Botpresso price"}}]\n```',
        error_detail: null,
      },
      turnId: TURN_ID,
      nowMs: NOW_MS,
      botPushMuted: false,
    })
    expect(result.notify?.title).toBe('Claude needs you')
    expect(result.notify?.body).toBe('')
    expect(result.supersede).toBe(true)
  })
})
