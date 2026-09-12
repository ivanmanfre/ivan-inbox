import { describe, expect, it } from 'vitest'
import { isSendChord } from './Composer'

// The repo has no DOM testing setup for this component (no jsdom environment,
// no @testing-library), so the decision is extracted as a pure function and
// tested directly on plain event-shaped objects rather than through a render.

describe('isSendChord', () => {
  it('fires on Cmd+Enter and Ctrl+Enter', () => {
    expect(isSendChord({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(true)
    expect(isSendChord({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(true)
    expect(isSendChord({ key: 'Enter', metaKey: true, ctrlKey: true })).toBe(true)
  })

  it('is false on plain Enter, which the design system composer already sends', () => {
    expect(isSendChord({ key: 'Enter', metaKey: false, ctrlKey: false })).toBe(false)
  })

  it('is false for any other key, chord or not', () => {
    expect(isSendChord({ key: 'a', metaKey: true, ctrlKey: false })).toBe(false)
    expect(isSendChord({ key: 'Shift', metaKey: true, ctrlKey: true })).toBe(false)
  })
})
