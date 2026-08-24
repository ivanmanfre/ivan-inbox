import { describe, expect, it } from 'vitest'
import { chatLink } from './CopyChatLink'

// Evan T.'s real pair on 2026-08-24: the chat Mattan has to open by hand, and the profile
// that used to be the only thing the app could offer.
const EVAN_CHAT = '2-YjU4NGNhZmYtNmIxYy00MTMzLWIzMGQtMTIxNmMxMGUyYzQ3XzEwMA=='
const EVAN_PROFILE = 'https://www.linkedin.com/in/evanmthomas'

describe('chatLink', () => {
  it('builds the LinkedIn messaging thread URL when a conversation id exists', () => {
    expect(chatLink(EVAN_CHAT, EVAN_PROFILE)).toEqual({
      href: `https://www.linkedin.com/messaging/thread/${EVAN_CHAT}/`,
      isChat: true,
    })
  })

  // The whole point of the second pass: the chat WINS. A profile link handed over while
  // it looks like a chat link is the failure this replaces.
  it('prefers the chat over the profile, never the other way round', () => {
    expect(chatLink(EVAN_CHAT, EVAN_PROFILE)?.href).not.toBe(EVAN_PROFILE)
  })

  // 1,647 inbox rows are invite-only — no LinkedIn chat exists yet to link to.
  it('falls back to the profile, and says it is a fallback', () => {
    expect(chatLink(null, EVAN_PROFILE)).toEqual({ href: EVAN_PROFILE, isChat: false })
    expect(chatLink('   ', EVAN_PROFILE)?.isChat).toBe(false)
  })

  // Live rows carry both schemes (`http://www.linkedin.com/in/evanvandyke` is a real one).
  it('upgrades the http profile rows the importer left behind', () => {
    expect(chatLink(null, 'http://www.linkedin.com/in/evanvandyke')?.href)
      .toBe('https://www.linkedin.com/in/evanvandyke')
  })

  // Nothing to copy renders no chip at all, rather than one that copies ''.
  it('is null when there is neither a chat nor a profile', () => {
    expect(chatLink(null, null)).toBeNull()
    expect(chatLink(undefined, undefined)).toBeNull()
    expect(chatLink('', '   ')).toBeNull()
  })
})
