import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyLink, clearUnfurlCache, detectLinks, unfurl } from './unfurl'

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'jwt' } } }) } },
}))

beforeEach(() => { clearUnfurlCache() })
afterEach(() => { vi.unstubAllGlobals() })

describe('detectLinks', () => {
  it('finds a link in prose and leaves the sentence punctuation behind', () => {
    expect(detectLinks('look at https://youtu.be/abc123xyz, then tell me.')).toEqual([
      { url: 'https://youtu.be/abc123xyz', kind: 'youtube' },
    ])
    expect(detectLinks('(https://www.linkedin.com/posts/x_y-activity-123/)')).toEqual([
      { url: 'https://www.linkedin.com/posts/x_y-activity-123/', kind: 'linkedin' },
    ])
  })

  it('keeps first-seen order and drops repeats', () => {
    const out = detectLinks('https://a.example.com/one https://b.example.com/two https://a.example.com/one')
    expect(out.map(l => l.url)).toEqual(['https://a.example.com/one', 'https://b.example.com/two'])
  })

  it('classifies the three surfaces Ivan actually pastes, and nothing else', () => {
    expect(classifyLink('https://www.youtube.com/watch?v=x')).toBe('youtube')
    expect(classifyLink('https://m.youtube.com/watch?v=x')).toBe('youtube')
    expect(classifyLink('https://youtu.be/x')).toBe('youtube')
    expect(classifyLink('https://linkedin.com/in/ivanmanfredi')).toBe('linkedin')
    expect(classifyLink('https://www.instagram.com/p/abc/')).toBe('instagram')
    expect(classifyLink('https://ivanmanfredi.com/scan/x')).toBe('other')
    // A host that merely CONTAINS the name is not the site.
    expect(classifyLink('https://youtube.com.evil.example/x')).toBe('other')
    expect(classifyLink('not a url at all')).toBe('other')
  })

  it('is empty on prose with no links', () => {
    expect(detectLinks('no links here')).toEqual([])
  })
})

describe('unfurl', () => {
  const stub = (status: number, body: unknown) => {
    const calls: unknown[] = []
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)))
      return Promise.resolve(new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
      }))
    }))
    return calls
  }

  it('sends the unfurl mode to the same broker function and shapes the reply', async () => {
    const calls = stub(200, {
      ok: true, kind: 'youtube', url: 'https://youtu.be/x', title: 'A talk',
      description: 'about a thing', image: 'https://img/x.jpg', site: 'YouTube', author: 'Someone',
    })
    const out = await unfurl('https://youtu.be/x')
    expect(calls[0]).toEqual({ unfurl: 'https://youtu.be/x' })
    expect(out).toEqual({
      ok: true, kind: 'youtube', url: 'https://youtu.be/x', title: 'A talk',
      description: 'about a thing', image: 'https://img/x.jpg', site: 'YouTube', author: 'Someone',
    })
  })

  it('caches a success by url and does not ask twice', async () => {
    const calls = stub(200, { ok: true, kind: 'og', title: 'T' })
    await unfurl('https://example.com/a')
    await unfurl('https://example.com/a')
    expect(calls).toHaveLength(1)
  })

  it('does NOT cache a failure, so a cold broker is retryable', async () => {
    const first = stub(502, { error: 'upstream_unreachable' })
    const bad = await unfurl('https://example.com/b')
    expect(bad).toEqual({ ok: false, url: 'https://example.com/b', reason: 'upstream_unreachable' })
    expect(first).toHaveLength(1)
    const second = stub(200, { ok: true, kind: 'og', title: 'T' })
    const good = await unfurl('https://example.com/b')
    expect(good.ok).toBe(true)
    expect(second).toHaveLength(1)
  })

  it('never throws when the network does', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await unfurl('https://example.com/c')).toEqual({
      ok: false, url: 'https://example.com/c', reason: 'offline',
    })
  })

  it('refuses a preview with no title rather than rendering an empty card', async () => {
    // The broker already refuses to invent an Instagram title; this is the
    // second lock on the same rule.
    stub(200, { ok: true, kind: 'instagram', title: '   ' })
    expect(await unfurl('https://www.instagram.com/p/x/')).toEqual({
      ok: false, url: 'https://www.instagram.com/p/x/', reason: 'no_title',
    })
  })

  it('passes the broker its own named refusal through', async () => {
    stub(200, { ok: false, kind: 'instagram', reason: 'blocked' })
    expect(await unfurl('https://www.instagram.com/p/y/')).toEqual({
      ok: false, url: 'https://www.instagram.com/p/y/', kind: 'instagram', reason: 'blocked',
    })
  })

  it('does not call out at all for something that is not an http url', async () => {
    const calls = stub(200, { ok: true, title: 'T' })
    expect(await unfurl('mailto:im@ivanmanfredi.com')).toEqual({
      ok: false, url: 'mailto:im@ivanmanfredi.com', reason: 'not_a_url',
    })
    expect(calls).toHaveLength(0)
  })
})
