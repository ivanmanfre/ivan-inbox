import { describe, expect, it } from 'vitest'
import { chatLink } from './CopyChatLink'

describe('chatLink', () => {
  it('passes an https profile url through untouched', () => {
    expect(chatLink('https://www.linkedin.com/in/evanmthomas'))
      .toBe('https://www.linkedin.com/in/evanmthomas')
  })

  // Live rows carry both schemes (`http://www.linkedin.com/in/evanvandyke` is a real one).
  // Ivan pastes this into a message to Mattan, so it should not be the insecure form.
  it('upgrades the http rows the importer left behind', () => {
    expect(chatLink('http://www.linkedin.com/in/evanvandyke'))
      .toBe('https://www.linkedin.com/in/evanvandyke')
  })

  // The urn form is what enrichment stores when it never resolved a vanity slug. It is
  // still a working profile url, so it must not be filtered out.
  it('keeps the urn-shaped profile urls', () => {
    expect(chatLink('https://www.linkedin.com/in/ACoAABSpsQUBEQGLwbz-Ok6b6PjxHhxNWsNUksc'))
      .toBe('https://www.linkedin.com/in/ACoAABSpsQUBEQGLwbz-Ok6b6PjxHhxNWsNUksc')
  })

  // Nothing to copy renders no chip at all, rather than a button that copies ''.
  it('is null for missing, empty and whitespace-only urls', () => {
    expect(chatLink(null)).toBeNull()
    expect(chatLink(undefined)).toBeNull()
    expect(chatLink('')).toBeNull()
    expect(chatLink('   ')).toBeNull()
  })
})
