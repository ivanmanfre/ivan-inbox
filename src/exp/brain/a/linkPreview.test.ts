import { describe, expect, it } from 'vitest'
import { mapLinkPreview } from './linkPreview'
import type { UnfurlResult } from '../../../lib/unfurl'

describe('mapLinkPreview', () => {
  it('maps a youtube ok result to a 16:9 card with the channel as sub', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'youtube', url: 'https://youtube.com/watch?v=1',
      title: 'A talk', description: null, image: 'https://img', site: 'YouTube', author: 'Some Channel',
    }
    const card = mapLinkPreview(r)
    expect(card).toEqual({ ok: true, kind: 'youtube', title: 'A talk', sub: 'Some Channel', image: 'https://img', ratio: '16:9' })
  })

  it('maps a linkedin ok result with the author as sub, no forced ratio', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'linkedin', url: 'https://linkedin.com/posts/x',
      title: 'A post', description: null, image: null, site: 'LinkedIn', author: 'Jane Doe',
    }
    expect(mapLinkPreview(r)).toEqual({ ok: true, kind: 'linkedin', title: 'A post', sub: 'Jane Doe', image: null, ratio: null })
  })

  it('gives instagram its own honest failure line regardless of reason', () => {
    const r: UnfurlResult = { ok: false, url: 'https://instagram.com/p/x', kind: 'instagram', reason: 'no_title' }
    expect(mapLinkPreview(r)).toEqual({ ok: false, kind: 'instagram', message: 'Instagram gave nothing back' })
  })

  it('maps a generic og failure to a named, non-generic message', () => {
    const r: UnfurlResult = { ok: false, url: 'https://example.com', kind: 'og', reason: 'no_preview' }
    expect(mapLinkPreview(r)).toEqual({ ok: false, kind: 'og', message: 'No preview available' })
  })

  it('falls back to a calm message for an unrecognised reason', () => {
    const r: UnfurlResult = { ok: false, url: 'https://example.com', reason: 'weird_new_reason' }
    expect(mapLinkPreview(r).ok).toBe(false)
    expect((mapLinkPreview(r) as { message: string }).message).toBe('Could not load a preview')
  })

  it('maps a generic og success using the site as sub', () => {
    const r: UnfurlResult = {
      ok: true, kind: 'og', url: 'https://example.com', title: 'A page',
      description: 'desc', image: null, site: 'example.com', author: null,
    }
    expect(mapLinkPreview(r)).toEqual({ ok: true, kind: 'og', title: 'A page', sub: 'example.com', image: null, ratio: null })
  })
})
