import { describe, expect, it } from 'vitest'
import { mapLinkPreview } from './linkpreview'
import type { UnfurlResult } from '../../../lib/unfurl'

describe('mapLinkPreview', () => {
  it('maps a youtube result to a 16:9 card with the channel as subtitle', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'youtube', url: 'https://youtube.com/watch?v=1',
      title: 'A talk', description: null, image: 'https://img', site: null, author: 'Some Channel',
    }
    expect(mapLinkPreview(r)).toEqual({
      kind: 'youtube', title: 'A talk', subtitle: 'Some Channel', image: 'https://img', ratio: '16:9',
    })
  })

  it('maps a linkedin result with no forced ratio', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'linkedin', url: 'u', title: 'A post', description: null,
      image: null, site: null, author: 'Jane Doe',
    }
    expect(mapLinkPreview(r).ratio).toBeNull()
    expect(mapLinkPreview(r).subtitle).toBe('Jane Doe')
  })

  it('maps a generic OG result reading site as subtitle', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'og', url: 'u', title: 'A page', description: null,
      image: null, site: 'example.com', author: null,
    }
    expect(mapLinkPreview(r)).toEqual({
      kind: 'og', title: 'A page', subtitle: 'example.com', image: null, ratio: null,
    })
  })

  it('renders the named Instagram-blocked state, never a blank card', () => {
    const r: UnfurlResult = { ok: false, url: 'u', kind: 'instagram', reason: 'no_title' }
    expect(mapLinkPreview(r)).toEqual({
      kind: 'blocked', title: 'Instagram gave nothing back', subtitle: null, image: null, ratio: null,
    })
  })

  it('renders a generic no-preview state for any other failure', () => {
    const r: UnfurlResult = { ok: false, url: 'u', reason: 'not_signed_in' }
    expect(mapLinkPreview(r).title).toBe('No preview available')
  })
})
