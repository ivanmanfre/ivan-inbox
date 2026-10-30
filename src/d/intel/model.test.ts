import { describe, expect, it } from 'vitest'
import { ago, clock, length, sortSources, tabOf, watchUrl, type IntelSource } from './model'

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
})
