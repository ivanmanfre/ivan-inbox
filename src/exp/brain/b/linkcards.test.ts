import { describe, expect, it } from 'vitest'
import { linkCardFromResult, pendingLinkCard } from './linkcards'
import type { UnfurlResult } from '../../../lib/unfurl'

describe('pendingLinkCard', () => {
  it('marks youtube as 16:9 even before the fetch lands', () => {
    expect(pendingLinkCard('youtube')).toMatchObject({ state: 'loading', aspect: '16:9' })
  })
  it('has no aspect opinion for a generic link', () => {
    expect(pendingLinkCard('other').aspect).toBeNull()
  })
})

describe('linkCardFromResult — success shapes', () => {
  it('youtube: title + channel as sub, 16:9', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'youtube', url: 'https://youtu.be/x', title: 'How to ship faster',
      description: null, image: 'https://img/thumb.jpg', site: 'YouTube', author: 'Some Channel',
    }
    expect(linkCardFromResult('youtube', r)).toEqual({
      state: 'ready', kind: 'youtube', title: 'How to ship faster',
      sub: 'Some Channel', image: 'https://img/thumb.jpg', aspect: '16:9',
    })
  })

  it('linkedin: title + author as sub', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'linkedin', url: 'https://linkedin.com/posts/x', title: 'A post about pacing',
      description: null, image: null, site: 'LinkedIn', author: 'Mattan Danino',
    }
    const card = linkCardFromResult('linkedin', r)
    expect(card.title).toBe('A post about pacing')
    expect(card.sub).toBe('Mattan Danino')
    expect(card.aspect).toBeNull()
  })

  it('generic og: falls back to the site as sub', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'og', url: 'https://example.com/a', title: 'A page',
      description: null, image: null, site: 'example.com', author: null,
    }
    expect(linkCardFromResult('other', r).sub).toBe('example.com')
  })
})

describe('linkCardFromResult — failure shapes', () => {
  it('instagram gets the named honest sentence, never a generic one', () => {
    const r: UnfurlResult = { ok: false, url: 'https://instagram.com/p/x', reason: 'no_title' }
    const card = linkCardFromResult('instagram', r)
    expect(card.state).toBe('failed')
    expect(card.title).toBe('Instagram gave nothing back')
  })

  it('a signed-out failure says so rather than a generic message', () => {
    const r: UnfurlResult = { ok: false, url: 'https://youtube.com/x', reason: 'not_signed_in' }
    expect(linkCardFromResult('youtube', r).title).toBe('Sign in to preview this link')
  })

  it('any other failure reads as a plain no-preview card', () => {
    const r: UnfurlResult = { ok: false, url: 'https://example.com', reason: 'http_500' }
    expect(linkCardFromResult('other', r).title).toBe('No preview available')
  })
})
