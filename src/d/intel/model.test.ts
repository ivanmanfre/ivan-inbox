import { describe, expect, it } from 'vitest'
import { ago, clock, inDropped, inFeed, inSeen, kindLabel, length, metaChip, openLabel, sortSources, tabOf, watchUrl, type IntelItem, type IntelSource } from './model'

describe('intel model', () => {
  it('formats clock times', () => {
    expect(clock(754)).toBe('12:34')
    expect(clock(3725)).toBe('1:02:05')
    expect(clock(0)).toBe('0:00')
  })

  it('formats lengths', () => {
    expect(length(1440)).toBe('24 min')
    expect(length(6102)).toBe('1 h 42')
    expect(length(null)).toBeNull()
  })

  it('opens the video at the useful part', () => {
    expect(watchUrl('https://www.youtube.com/watch?v=abc', 754)).toBe('https://www.youtube.com/watch?v=abc&t=754s')
    expect(watchUrl('https://www.youtube.com/watch?v=abc', null)).toBe('https://www.youtube.com/watch?v=abc')
  })

  it('reads relative age', () => {
    const now = Date.parse('2026-10-30T12:00:00Z')
    expect(ago('2026-10-30T10:00:00Z', now)).toBe('2h ago')
    expect(ago('2026-10-27T12:00:00Z', now)).toBe('3d ago')
    expect(ago(null, now)).toBe('')
  })

  it('reads the tab from the query', () => {
    expect(tabOf(new URLSearchParams('tab=sources'))).toBe('sources')
    expect(tabOf(new URLSearchParams('tab=junk'))).toBe('feed')
  })

  it('puts trial sources first', () => {
    const s = (name: string, status: IntelSource['status']) => ({ id: name, name, url: '', topic: null, status, added_by: 'ivan', note: null, items_judged: 0, items_kept: 0, last_kept_at: null }) as IntelSource
    expect(sortSources([s('b', 'core'), s('a', 'dropped'), s('c', 'trial')]).map(x => x.name)).toEqual(['c', 'b', 'a'])
  })

  it('keeps For you recent and honours Ivan\'s taps', () => {
    const now = Date.parse('2026-10-30T12:00:00Z')
    const it_ = (o: Partial<IntelItem>) => ({ verdict: 'keep', ivan_verdict: null, ivan_seen_at: null, published_at: '2026-10-25T00:00:00Z', created_at: '2026-10-29T00:00:00Z', ...o }) as IntelItem
    expect(inFeed(it_({}), now)).toBe(true)
    expect(inFeed(it_({ published_at: '2026-10-02T00:00:00Z', created_at: '2026-10-03T00:00:00Z' }), now)).toBe(false)
    expect(inFeed(it_({ published_at: '2026-10-08T00:00:00Z', created_at: '2026-10-29T00:00:00Z' }), now)).toBe(true)
    expect(inFeed(it_({ published_at: '2026-10-02T00:00:00Z', created_at: '2026-10-20T00:00:00Z' }), now)).toBe(false)
    expect(inFeed(it_({ ivan_verdict: 'noise' }), now)).toBe(false)
    expect(inFeed(it_({ verdict: 'drop', ivan_verdict: 'useful' }), now)).toBe(true)
    expect(inFeed(it_({ verdict: 'drop' }), now)).toBe(false)
    expect(inFeed(it_({ published_at: null }), now)).toBe(false)
    expect(inFeed(it_({ ivan_seen_at: '2026-10-29T00:00:00Z' }), now)).toBe(false)
    expect(inSeen(it_({ ivan_seen_at: '2026-10-29T00:00:00Z' }), now)).toBe(true)
    expect(inSeen(it_({ ivan_seen_at: '2026-10-29T00:00:00Z', ivan_verdict: 'noise' }), now)).toBe(false)
    expect(inSeen(it_({}), now)).toBe(false)
    expect(inDropped(it_({ verdict: 'drop' }), now)).toBe(true)
    expect(inDropped(it_({ verdict: 'drop', ivan_verdict: 'useful' }), now)).toBe(false)
    expect(inDropped(it_({ verdict: 'drop', created_at: '2026-10-01T00:00:00Z' }), now)).toBe(false)
  })

  it('adds no t= to a non-YouTube url', () => {
    const gh = { kind: 'github', url: 'https://github.com/a/b', watch_from_sec: 90 } as IntelItem
    expect(watchUrl(gh)).toBe(gh.url)
    expect(watchUrl({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=abc', watch_from_sec: 90 } as IntelItem)).toBe('https://www.youtube.com/watch?v=abc&t=90s')
  })

  it('labels the open link by kind', () => {
    expect(openLabel('github')).toBe('Open on GitHub')
    expect(openLabel('blog')).toBe('Open the post')
    expect(openLabel('reddit')).toBe('Open the thread')
    expect(openLabel('kyle')).toBe('Open the call notes')
    expect(openLabel('youtube')).toBe('Open on YouTube')
    expect(kindLabel('kyle')).toBe('Kyle call')
    expect(kindLabel('podcast')).toBe('Podcast')
    expect(kindLabel('weird')).toBe('weird')
  })

  it('metaChip gives stars, comments, read time, call date', () => {
    const i = (o: Partial<IntelItem>) => ({ published_at: '2026-11-10T15:00:00Z', duration_sec: 1440, meta: null, ...o }) as IntelItem
    expect(metaChip(i({ kind: 'github', meta: { stars: 143, window: 'week', created_at: 'x' } }))).toBe('\u2605 143')
    expect(metaChip(i({ kind: 'reddit', meta: { comments: 27, subreddit: 'x' } }))).toBe('27 comments')
    expect(metaChip(i({ kind: 'blog', meta: { chars: 9900 } }))).toBe('~9 min read')
    expect(metaChip(i({ kind: 'kyle', meta: { minutes: 50, call_type: null } }))).toBe('Nov 10')
    expect(metaChip(i({ kind: 'youtube' }))).toBe('24 min')
    expect(metaChip(i({ kind: 'github', meta: null }))).toBeNull()
    expect(metaChip(i({ kind: 'blog', meta: {} }))).toBeNull()
    expect(metaChip(i({ kind: 'kyle', published_at: null }))).toBeNull()
  })
})
