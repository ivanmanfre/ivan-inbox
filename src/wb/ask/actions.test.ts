import { describe, expect, it } from 'vitest'
import { parseActions } from './actions'

// Spec section 3: unknown kind, bad url, more than three items, malformed JSON
// -> the block is DROPPED and the message renders without pills, never an error
// to Ivan. Every case here also asserts the fence is gone from the body: a raw
// JSON block left in the prose would be the surface leaking its own contract.

const wrap = (json: string, prose = 'Two sends failed on the RISE seat.'): string =>
  `${prose}\n\n\`\`\`actions\n${json}\n\`\`\``

const noFence = (body: string) => {
  expect(body).not.toContain('```')
  expect(body).not.toContain('actions')
}

describe('parseActions', () => {
  it('renders three valid actions and keeps the prose', () => {
    const { body, actions } = parseActions(wrap(JSON.stringify([
      { label: 'Open the lane', kind: 'open', payload: { url: './#exp/brain-b/sends' } },
      { label: 'Make it a task', kind: 'task', payload: { title: 'Check the seat', body: 'before 09:00' } },
      { label: 'Fold these', kind: 'fold', payload: {} },
    ])))
    expect(actions).toHaveLength(3)
    expect(actions[0]).toEqual({ label: 'Open the lane', kind: 'open', payload: { url: './#exp/brain-b/sends' } })
    expect(actions[1].payload).toEqual({ title: 'Check the seat', body: 'before 09:00' })
    expect(actions[2].payload).toEqual({})
    expect(body).toBe('Two sends failed on the RISE seat.')
    noFence(body)
  })

  it('accepts an https url and a reply prompt', () => {
    const { actions } = parseActions(wrap(JSON.stringify([
      { label: 'The post', kind: 'open', payload: { url: 'https://www.linkedin.com/feed/' } },
      { label: 'Ask about it', kind: 'reply', payload: { prompt: 'Why did that seat stall?' } },
    ])))
    expect(actions.map(a => a.kind)).toEqual(['open', 'reply'])
  })

  it('drops the whole block on an unknown kind', () => {
    const { body, actions } = parseActions(wrap(JSON.stringify([
      { label: 'Open the lane', kind: 'open', payload: { url: '#exp/brain-b/sends' } },
      { label: 'Send it', kind: 'send', payload: {} },
    ])))
    expect(actions).toEqual([])
    noFence(body)
  })

  it('drops the whole block on a javascript: url', () => {
    const { body, actions } = parseActions(wrap(JSON.stringify([
      { label: 'Tap me', kind: 'open', payload: { url: 'javascript:alert(1)' } },
    ])))
    expect(actions).toEqual([])
    noFence(body)
  })

  it('drops the whole block on an http:// url', () => {
    const { body, actions } = parseActions(wrap(JSON.stringify([
      { label: 'Tap me', kind: 'open', payload: { url: 'http://example.com' } },
    ])))
    expect(actions).toEqual([])
    noFence(body)
  })

  it('drops the whole block at four items', () => {
    const four = Array.from({ length: 4 }, (_, i) => ({
      label: `Fold ${i}`, kind: 'fold', payload: {},
    }))
    const { body, actions } = parseActions(wrap(JSON.stringify(four)))
    expect(actions).toEqual([])
    noFence(body)
  })

  it('drops the whole block on broken JSON', () => {
    const { body, actions } = parseActions(wrap('[{"label":"x","kind":"fold",}]'))
    expect(actions).toEqual([])
    noFence(body)
  })

  it('drops the whole block when the JSON is not an array', () => {
    const { actions } = parseActions(wrap('{"label":"x","kind":"fold","payload":{}}'))
    expect(actions).toEqual([])
  })

  it('drops the whole block on an empty array', () => {
    const { actions } = parseActions(wrap('[]'))
    expect(actions).toEqual([])
  })

  it('drops the whole block on a label over forty characters', () => {
    const { actions } = parseActions(wrap(JSON.stringify([
      { label: 'x'.repeat(41), kind: 'fold', payload: {} },
    ])))
    expect(actions).toEqual([])
  })

  it('leaves a message with no block exactly as it was', () => {
    const text = 'Nothing needs you. 4 routine rows folded.'
    expect(parseActions(text)).toEqual({ body: text, actions: [] })
  })

  it('the LAST block wins when a second one follows', () => {
    const text = [
      'Head.',
      '```actions',
      JSON.stringify([{ label: 'First', kind: 'fold', payload: {} }]),
      '```',
      'Middle.',
      '```actions',
      JSON.stringify([{ label: 'Second', kind: 'reply', payload: { prompt: 'go on' } }]),
      '```',
    ].join('\n')
    const { body, actions } = parseActions(text)
    expect(actions).toHaveLength(1)
    expect(actions[0].label).toBe('Second')
    // Only the LAST fence is removed; the earlier one is prose the model wrote
    // and this parser does not silently rewrite prose.
    expect(body).toContain('Middle.')
    expect(body).not.toContain('Second')
  })
})

describe('payload lifted when absent', () => {
  it('reads a top-level prompt as the reply payload', () => {
    const text = 'x\n\n```actions\n[{"label":"Do it","kind":"reply","prompt":"go"}]\n```'
    const out = parseActions(text)
    expect(out.actions).toEqual([{ label: 'Do it', kind: 'reply', payload: { prompt: 'go' } }])
    expect(out.body).toBe('x')
  })
  it('still drops a present but wrong payload', () => {
    const text = '```actions\n[{"label":"Do it","kind":"reply","payload":{},"prompt":"go"}]\n```'
    expect(parseActions(text).actions).toEqual([])
  })
})
