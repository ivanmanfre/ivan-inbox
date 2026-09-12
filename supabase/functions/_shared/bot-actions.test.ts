// Unit for the server's copy of the action-block grammar. Vitest, not deno
// test: vitest.config.ts includes supabase/**/*.test.ts and the repo's other
// edge-function units (inbox-bot-tick/bundle.test.ts,
// inbox-turn-run/completion.test.ts) are written this way, so a Deno.test-only
// file would be run by nothing here.
//
// What these pin is the one question the phone hangs on: does this bot answer
// carry a pill only Ivan can tap? `fold`-only and an empty array are quiet, and
// a block the model got wrong is quiet too, because a dropped block renders no
// pills on the client and a push for a message with no pills is the defect.
import { describe, expect, it } from 'vitest'
import { isActionable, parseActions, pushBodyFrom, pushTitleFrom } from './bot-actions.ts'

function block(json: string): string {
  return `Two lanes moved.\n\n\`\`\`actions\n${json}\n\`\`\``
}

describe('parseActions + isActionable', () => {
  it('a fold-only block is parsed and is NOT actionable', () => {
    const out = parseActions(block('[{"label":"Fold these rows","kind":"fold","payload":{}}]'))
    expect(out.actions).toHaveLength(1)
    expect(out.body).toBe('Two lanes moved.')
    expect(isActionable(out.actions)).toBe(false)
  })

  it('an empty array is not actionable', () => {
    // Length 0 is outside 1..MAX_ACTIONS, so the block drops and there are no
    // actions at all; either way the answer is quiet.
    const out = parseActions(block('[]'))
    expect(out.actions).toEqual([])
    expect(isActionable(out.actions)).toBe(false)
  })

  it('no block at all is not actionable and the body is the whole answer', () => {
    const out = parseActions('Nothing needs you. I folded 9 routine rows.')
    expect(out.actions).toEqual([])
    expect(out.body).toBe('Nothing needs you. I folded 9 routine rows.')
    expect(isActionable(out.actions)).toBe(false)
  })

  it('one open pill is actionable', () => {
    const out = parseActions(block('[{"label":"Open the lane","kind":"open","payload":{"url":"./#exp/brain-b/sends"}}]'))
    expect(out.actions).toEqual([
      { label: 'Open the lane', kind: 'open', payload: { url: './#exp/brain-b/sends' } },
    ])
    expect(isActionable(out.actions)).toBe(true)
  })

  it('a task pill is actionable, a reply pill is not (D11: the bot asking permission never rings)', () => {
    const task = parseActions(block('[{"label":"Name the price","kind":"task","payload":{"title":"Name Botpresso price"}}]'))
    expect(isActionable(task.actions)).toBe(true)
    const reply = parseActions(block('[{"label":"Tell me to send it","kind":"reply","prompt":"send it"}]'))
    expect(reply.actions).toEqual([
      { label: 'Tell me to send it', kind: 'reply', payload: { prompt: 'send it' } },
    ])
    expect(isActionable(reply.actions)).toBe(false)
  })

  it('a fold beside an open is actionable: one real pill is enough', () => {
    const out = parseActions(block(
      '[{"label":"Fold these rows","kind":"fold","payload":{}},' +
      '{"label":"Open the thread","kind":"open","payload":{"url":"./#exp/brain-b/dms"}}]',
    ))
    expect(out.actions).toHaveLength(2)
    expect(isActionable(out.actions)).toBe(true)
  })

  it('an invalid block yields no actions, all or nothing, and the block still leaves the body', () => {
    const badJson = parseActions(block('[{"label":"Open the lane", "kind":'))
    expect(badJson.actions).toEqual([])
    expect(badJson.body).toBe('Two lanes moved.')

    // One bad entry drops the good one with it.
    const oneBad = parseActions(block(
      '[{"label":"Open the lane","kind":"open","payload":{"url":"./#exp/brain-b/sends"}},' +
      '{"label":"Nope","kind":"open","payload":{"url":"javascript:alert(1)"}}]',
    ))
    expect(oneBad.actions).toEqual([])
    expect(isActionable(oneBad.actions)).toBe(false)

    // Four is a menu, not a decision.
    const four = parseActions(block(
      '[' + Array.from({ length: 4 }, (_, i) =>
        `{"label":"Open ${i}","kind":"open","payload":{"url":"./#exp/brain-b/sends"}}`).join(',') + ']',
    ))
    expect(four.actions).toEqual([])
  })

  it('urls: https, ./#, /# and bare # pass; another scheme and the Today fallback do not', () => {
    const open = (url: string) =>
      parseActions(block(`[{"label":"Open it","kind":"open","payload":{"url":${JSON.stringify(url)}}}]`)).actions
    expect(open('https://www.linkedin.com/in/someone')).toHaveLength(1)
    expect(open('./#exp/brain-b/sends')).toHaveLength(1)
    expect(open('/#exp/brain-b/sends')).toHaveLength(1)
    expect(open('#exp/brain-b/sends')).toHaveLength(1)
    expect(open('http://example.com')).toEqual([])
    expect(open('javascript:alert(1)')).toEqual([])
    expect(open('mailto:ivan@example.com')).toEqual([])
    expect(open('/exp/brain-b/sends')).toEqual([]) // no hash: not a route this app navigates
    // The client's parser reads this exact hash as its own fallback and drops
    // the whole block, so the server must not ring for it either.
    expect(open('./#exp/brain-b/today')).toEqual([])
  })
})

describe('pushTitleFrom / pushBodyFrom', () => {
  it('strips markdown emphasis off the first prose line', () => {
    expect(pushTitleFrom('**Lead scoring:** 3 rows need you')).toBe('Lead scoring: 3 rows need you')
    expect(pushTitleFrom('- `outreach` stalled at 12 sends')).toBe('outreach stalled at 12 sends')
    expect(pushTitleFrom('## Mattan seat under floor')).toBe('Mattan seat under floor')
  })

  it('skips empty and markdown-only leading lines', () => {
    expect(pushTitleFrom('\n\n**  **\nAlan rebooked for Thursday')).toBe('Alan rebooked for Thursday')
  })

  it('is empty when there is no prose, so the caller can fall back', () => {
    expect(pushTitleFrom('')).toBe('')
    expect(pushTitleFrom('\n   \n')).toBe('')
  })

  it('cuts the title at 60 chars on a word', () => {
    const long = 'Mattan seat sent eleven yesterday against a floor of twenty and the pool is empty'
    const title = pushTitleFrom(long)
    expect(title.length).toBeLessThanOrEqual(60)
    expect(long.startsWith(title)).toBe(true)
    expect(title.endsWith(' ')).toBe(false)
    // A word boundary, not a chop: the cut point is a space in the original.
    expect(long[title.length]).toBe(' ')
  })

  it('the body is everything after the title line, collapsed, cut at 140', () => {
    const answer = 'Mattan seat under floor\n\n- sent 11 against 20\n- pool is empty\n\nI am leaving the cold lane alone.'
    expect(pushBodyFrom(answer)).toBe('sent 11 against 20 pool is empty I am leaving the cold lane alone.')
    expect(pushBodyFrom('One line only')).toBe('')
    expect(pushBodyFrom('head\n' + 'x'.repeat(300)).length).toBe(140)
  })
})
