// @vitest-environment jsdom
// Home tiles: honest states (… / ? + Retry), the next-week strip and floor, ready lane links, rate-limit words.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { LanesData } from '../lanes/useLanesData'
import type { ReadyRead } from '../lanes/glance/ready'
import { limitRead } from './model'
import type { HomeData } from './reads'
import { Drafts, Limit, NextWeek, Ready } from './Tiles'

afterEach(cleanup)
const NOW = Date.parse('2026-09-27T13:00:00Z')
const empty = { value: null, failed: null }
const lanes = (o: Partial<LanesData> = {}) => new Proxy(o, { get: (t, k) => (t as Record<string, unknown>)[k as string] ?? empty }) as LanesData
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((dow, i) => ({ key: `2026-09-${28 + i}`, dow, dm: '', n: 28 + i, posts: [1, 2, 0, 0, 0][i], stub: null, planned: false }))
const home = (o: Partial<HomeData> = {}): HomeData => ({
  now: NOW, lanes: lanes(),
  content: { ivan: { v: { n: 3, days, below: false } }, risedtc: { wait: true }, arch: { fail: 'boom' } },
  drafts: { ivan: { v: 2 }, risedtc: { wait: true }, arch: { fail: 'x' } },
  retry: { content: vi.fn(), drafts: vi.fn(), lanes: vi.fn() }, ...o,
})

describe('home tiles', () => {
  it('reading shows …, a failed read shows ? and a Retry that re-reads', () => {
    const h = home()
    renderInFrame(<><Drafts seat="risedtc" h={h} /><Drafts seat="arch" h={h} /></>, { hash: '#exp/d/home' })
    const [a, b] = [...document.querySelectorAll('[data-tile="drafts"]')] as HTMLElement[]
    expect(a.textContent).toBe('Drafts…')
    expect(b.querySelector('.hm-n')!.textContent).toBe('?')
    fireEvent.click(b.querySelector('[data-verb="retry"]')!)
    expect(h.retry.drafts).toHaveBeenCalled()
  })
  it('drafts tile opens that seat on DMs, a live number is lime', () => {
    renderInFrame(<Drafts seat="ivan" h={home()} />, { hash: '#exp/d/home' })
    expect(document.querySelector('a.hm-hit')!.getAttribute('href')).toBe('#exp/d/dms?seat=ivan')
    expect(document.querySelector('.hm-n.hm-on')!.textContent).toBe('2')
  })
  it('next week: filled cells for posts, a count only above one, Below 3 under the floor', () => {
    renderInFrame(<NextWeek seat="ivan" h={home({ content: { ivan: { v: { n: 2, days, below: true } }, risedtc: { wait: true }, arch: { wait: true } } })} />, { hash: '#exp/d/home' })
    const cells = [...document.querySelectorAll('.hm-strip i')]
    expect(cells.map(c => c.textContent)).toEqual(['M', '2', 'W', 'T', 'F'])
    expect(cells.map(c => c.classList.contains('hm-on'))).toEqual([true, true, false, false, false])
    expect(document.querySelector('.hm-flag')!.textContent).toBe('Below 3')
    expect(document.querySelector('a.hm-hit')!.getAttribute('href')).toBe('#exp/d/content?lane=ivan')
  })
  it('ready: total big, lanes with a number, each opening its campaign', () => {
    const ready: ReadyRead = { saturdayNy: false, lanes: [
      { seat: 'ivan', lane: 'engage', label: 'Warm engagers', n: 12, capped: false, campaignId: 'c1', off: null },
      { seat: 'ivan', lane: 'cold', label: 'Cold', n: 0, capped: false, campaignId: null, off: null },
    ] }
    renderInFrame(<Ready seat="ivan" h={home({ lanes: lanes({ ready: { value: ready, failed: null } }) })} />, { hash: '#exp/d/home' })
    expect(document.querySelector('.hm-n')!.textContent).toBe('12')
    const li = [...document.querySelectorAll('.hm-lanes a')]
    expect(li.map(a => a.textContent)).toEqual(['Warm engagers12'])
    expect(li[0].getAttribute('href')).toBe('#exp/d/lanes?sheet=campaign&c=c1')
  })
  it('rate limit: Limited · resumes + last try when a pause is ahead', () => {
    const d = lanes({
      cc: { value: { clients: [] } as never, failed: null },
      pauses: { value: { ivan: '2026-09-27T15:41:00Z' }, failed: null },
      attempts: { value: { ivan: { at: '2026-09-27T13:41:00Z', ok: false, error: 'X422' }, risedtc: null, arch: null }, failed: null },
    })
    renderInFrame(<Limit seat="ivan" h={home({ lanes: d })} />, { hash: '#exp/d/home' })
    expect(document.querySelector('.hm-word')!.textContent).toBe('Limited · resumes 17:41')
    expect(document.querySelector('.hm-sub')!.textContent).toBe('last try 15:41')
  })
})

describe('limitRead', () => {
  it('reading until both the monitor and the pause keys answered; failed only when both failed', () => {
    expect(limitRead(lanes(), 'ivan', NOW)).toEqual({ wait: true })
    expect('fail' in limitRead(lanes({ cc: { value: null, failed: 'a' }, pauses: { value: null, failed: 'b' } }), 'ivan', NOW)).toBe(true)
  })
  it('clear with no pause, no incident', () => {
    const r = limitRead(lanes({ cc: { value: { clients: [] } as never, failed: null }, pauses: { value: {}, failed: null } }), 'arch', NOW)
    expect(r).toEqual({ v: { limited: false, resumes: null, lastTry: null, refused: false } })
  })
})
