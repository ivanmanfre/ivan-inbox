import { describe, expect, it } from 'vitest'
import { footLine } from './AskThread'
import { shortTitle, threadLabel } from './ThreadMenu'

// No DOM testing setup in this repo (no jsdom, no @testing-library — see
// Composer.test.ts), so the two strings this pass MOVED are extracted as pure
// functions and checked directly. What they say is the whole point of the
// change: the footer stopped being two boxed pills and the head's subtitle
// stopped being the model.

describe('footLine: the answer footer is one line, not two pills', () => {
  it('joins what was read and what it was grounded on, sentence-cased', () => {
    expect(footLine('read 1 memory file', 'grounded on 2026-09-05'))
      .toBe('Read 1 memory file · grounded on 2026-09-05')
  })

  it('says only what is true when one half is missing', () => {
    expect(footLine('read 3 memory files', null)).toBe('Read 3 memory files')
    expect(footLine(null, 'grounded on 2026-09-05')).toBe('Grounded on 2026-09-05')
  })

  it('is empty when there is nothing true to say, so the footer renders nothing', () => {
    expect(footLine(null, null)).toBe('')
  })
})

describe('threadLabel: the head says WHICH THREAD, never the model', () => {
  it('names Claude’s own thread rather than titling it', () => {
    expect(threadLabel({ isBot: true, threadId: 'b', title: 'Bot bundle 09-12' }))
      .toBe("Claude's thread")
  })

  it('says New thread before a thread exists', () => {
    expect(threadLabel({ threadId: null, title: null })).toBe('New thread')
  })

  it('falls back to This thread rather than inventing a name', () => {
    expect(threadLabel({ threadId: 't1', title: null })).toBe('This thread')
    expect(threadLabel({ threadId: 't1', title: '   ' })).toBe('This thread')
  })

  it('cuts a long title instead of letting the head truncate at 380px', () => {
    const label = threadLabel({ threadId: 't1', title: 'What is waiting on me right now, across every lane?' })
    expect(label.length).toBeLessThanOrEqual(22)
    expect(label.endsWith('…')).toBe(true)
  })
})

describe('shortTitle', () => {
  it('leaves a short title alone and collapses its whitespace', () => {
    expect(shortTitle('What broke   today?')).toBe('What broke today?')
  })

  it('never leaves a dangling separator before the ellipsis', () => {
    expect(shortTitle('Ten letters, and then some more', 14)).toBe('Ten letters…')
  })
})
