// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { PlanRead } from '../../../lib/contentPlan'
import riseFull from './fixtures/risedtc.json'
import ivanFx from './fixtures/ivan.json'
import archFx from './fixtures/arch.json'

const api = vi.hoisted(() => ({ setScheduleDateAt: vi.fn(), moveSlotWeek: vi.fn(), fetchDraftSources: vi.fn() }))
vi.mock('../../../lib/brainPage', async o => ({ ...await o<typeof import('../../../lib/brainPage')>(), fetchDraftSources: api.fetchDraftSources }))
vi.mock('../../../lib/content', async o => ({ ...await o<typeof import('../../../lib/content')>(), setScheduleDateAt: api.setScheduleDateAt }))
vi.mock('../../../lib/contentPlan', async o => ({ ...await o<typeof import('../../../lib/contentPlan')>(), moveSlotWeek: api.moveSlotWeek }))
import { itemsOf, weekWhy, type PlanItem } from './planBrain'
import { PlanPanel } from './PlanPanel'
import type { Lane } from '../model'

const rise = () => structuredClone(riseFull) as unknown as PlanRead
const ivan = () => structuredClone(ivanFx) as unknown as PlanRead
const arch = () => structuredClone(archFx) as unknown as PlanRead

const pick = (read: PlanRead, f: (i: PlanItem) => boolean) => itemsOf(read).find(f)!
const byTitle = (read: PlanRead, t: RegExp) => pick(read, i => t.test(i.title))

function show(read: PlanRead, item: PlanItem, extra: { onClose?: () => void; onChanged?: () => void; layout?: 'desktop' | 'phone' } = {}) {
  const onClose = extra.onClose ?? vi.fn()
  const onChanged = extra.onChanged ?? vi.fn()
  renderInFrame(<PlanPanel item={item} read={read} lane={read.account as Lane} onClose={onClose} onChanged={onChanged} />, { layout: extra.layout ?? 'desktop' })
  return { onClose, onChanged }
}
const heads = () => [...document.querySelectorAll('.pl2-pn-q h5')].map(h => h.textContent)
const section = (name: string) => [...document.querySelectorAll<HTMLElement>('.pl2-pn-q')].find(s => s.querySelector('h5')!.textContent === name)!
const keyNames = () => [...document.querySelectorAll<HTMLElement>('.pl2-pn-keys .cv2-k')].map(k => k.textContent)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  api.setScheduleDateAt.mockImplementation(async (_id: string, at: string) => at)
  api.moveSlotWeek.mockImplementation(async (_id: string, week: string) => ({ from_week: '2026-10-26', to_week: week }))
  api.fetchDraftSources.mockResolvedValue(new Map())
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

describe('PlanPanel: the seven questions', () => {
  it('opens the saved original source beside the plan explanation without inventing a selection reason', async () => {
    const r = ivan()
    const item = byTitle(r, /60-second LinkedIn inbound/)
    item.brain!.brief = null
    item.evidence = []
    item.whyNow = null
    api.fetchDraftSources.mockResolvedValue(new Map([[item.draftId, {
      draft_id: item.draftId, source_ref: null, slot: null, source_text: null,
      detail: { kind: 'x_tracked_outlier', author_name: 'Kevin Jon', original_text: 'The original source passage, preserved in full.', url: 'https://x.com/thekevinjon/status/123', likes: 63, author_median: { n: 40, likes: 4.5 } },
      x: null, linkedin: null,
    }]]))
    show(r, item)
    expect(api.fetchDraftSources).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Original source'))
    await waitFor(() => expect(screen.getByText('The original source passage, preserved in full.')).toBeTruthy())
    expect(api.fetchDraftSources).toHaveBeenCalledWith([item.draftId])
    expect(screen.getByText('Kevin Jon')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the original ↗' }).getAttribute('href')).toBe('https://x.com/thekevinjon/status/123')
    expect(section('Why this post').textContent).toContain('No reason saved for this post.')
  })

  it('keeps the source error actionable and retries the bounded read', async () => {
    const r = ivan()
    const item = byTitle(r, /60-second LinkedIn inbound/)
    api.fetchDraftSources.mockRejectedValueOnce(new Error('Source read failed')).mockResolvedValueOnce(new Map())
    show(r, item)
    fireEvent.click(screen.getByText('Original source'))
    await waitFor(() => expect(screen.getByText(/Source read failed/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Source text not stored for this draft.')).toBeTruthy())
    expect(api.fetchDraftSources).toHaveBeenCalledTimes(2)
  })

  it('a waiting post asks six questions in order; How it did is only for published posts', () => {
    const r = rise()
    show(r, byTitle(r, /If a channel can't grow/))
    expect(heads()).toEqual(['Why this post', 'Why this week', 'Why this day', 'How it is written', 'Is it good', 'Will it do well'])
    cleanup()
    const r2 = rise()
    show(r2, pick(r2, i => i.st === 'published'))
    expect(heads()).toEqual(['Why this post', 'Why this week', 'Why this day', 'How it is written', 'Is it good', 'Will it do well', 'How it did'])
  })

  it('Why this week never repeats Why this post; it is the week mix', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    show(r, it)
    const post = section('Why this post').querySelector('p')!.textContent
    const week = section('Why this week').querySelector('p')!.textContent!
    expect(week).not.toBe(post)
    expect(week).toBe(weekWhy(itemsOf(r), it.week))
    expect(week).toMatch(/^(This week|Next week|The week after): /)
  })

  it('the meta line: day, time with zone, words, edited by hand', () => {
    const r = ivan()
    const it = byTitle(r, /LinkedIn impressions: how many clients/)
    show(r, it)
    expect(document.querySelector('.pl2-pn-meta')!.textContent).toBe(`Fri 16 Oct · ${document.querySelector('.pl2-pn-meta')!.textContent!.split(' · ')[1]} · ${it.brain!.words} words · edited by hand`)
    expect(document.querySelector('.pl2-pn-meta')!.textContent).toMatch(/^Fri 16 Oct · \d\d:\d\d Warsaw · /)
  })

  it('a planned slot says it has no day yet', () => {
    const r = rise()
    show(r, byTitle(r, /If a channel can't grow/))
    expect(section('Why this day').textContent).toContain('No day yet. It gets the first free weekday of its week when you approve it.')
    expect(document.querySelector('.pl2-pn-meta')!.textContent).toBe('No day yet · 185 words')
  })

  it('Will it do well shows the scale only when not flat, and never a helps or hurts list', () => {
    const r = rise()
    show(r, byTitle(r, /If a channel can't grow/))
    const s = section('Will it do well')
    expect(s.textContent).toContain('Bad sign.')
    expect(s.querySelector('.pl2-scale')).not.toBeNull()
    expect(document.body.textContent).not.toMatch(/Helps it|Holds it back|hurts/i)
    cleanup()
    const r2 = rise()
    const it = byTitle(r2, /If a channel can't grow/)
    it.brain!.read!.rate = it.brain!.read!.base
    show(r2, it)
    expect(section('Will it do well').textContent).toContain('Neutral.')
    expect(section('Will it do well').querySelector('.pl2-scale')).toBeNull()
  })

  it('no brain guess says so in plain words', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    it.brain!.read = null
    show(r, it)
    expect(section('Will it do well').textContent).toContain('No brain guess yet for this draft.')
  })

  it('the eight scores as bars, the weakest one marked', () => {
    const r = rise()
    show(r, byTitle(r, /If a channel can't grow/))
    const bars = [...section('Is it good').querySelectorAll<HTMLElement>('.pl2-bar')]
    expect(bars.map(b => b.querySelector('span')!.textContent)).toEqual(['Voice', 'Depth', 'Details', 'Opinion', 'Short', 'Hook', 'Facts', 'Sounds human'])
    const low = bars.filter(b => b.dataset.low === 'true')
    expect(low.map(b => b.querySelector('span')!.textContent)).toEqual(['Sounds human'])
    expect(section('Is it good').textContent).toContain('Low score: 55/80, even after a rewrite.')
    expect(section('Is it good').textContent).toContain('Some facts are not found in the call. It will not go out until fixed.')
  })

  it('a fact check with no claim count never prints a number for it', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    it.brain!.facts = { pass: true, failed: null, total: null }
    show(r, it)
    expect(section('Is it good').textContent).toContain('Facts match the call.')
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/)
  })

  it('a pending or non-English quote shows no quote; an English one is a quote', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    it.brain!.quote = 'We stop a channel when it cannot climb.'
    it.brain!.quote_pending = true
    show(r, it)
    expect(document.querySelector('.pl2-pn q, .pl2-pn blockquote')).toBeNull()
    cleanup()
    const a = arch()
    const ai = pick(a, i => i.kind === 'planned')
    ai.brain!.quote = 'Mislim da je to dobro, ali nije još gotovo.'
    show(a, ai)
    expect(document.querySelector('.pl2-pn blockquote')).toBeNull()
    cleanup()
    const r2 = rise()
    const it2 = byTitle(r2, /If a channel can't grow/)
    it2.brain!.quote = 'We stop a channel when it cannot climb.'
    show(r2, it2)
    expect(document.querySelector('.pl2-pn blockquote')!.textContent).toBe('We stop a channel when it cannot climb.')
  })

  it('a top post brief names the author and the ratio', () => {
    const r = ivan()
    show(r, byTitle(r, /60-second LinkedIn inbound/))
    expect(section('Why this post').textContent).toContain('A written draft based on a post by Monika Grycz that got 4.6x their normal views.')
    expect(document.body.textContent).not.toContain('Highest-ratio')
  })

  it('Rise photos read as picked in rotation; Ivan says why there is no photo', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    it.brain!.photo = { has: true, reason: null, rotation: true }
    show(r, it)
    expect(document.body.textContent).toContain("Mattan's photo, picked in rotation.")
    cleanup()
    const v = ivan()
    show(v, byTitle(v, /60-second LinkedIn inbound/))
    expect(document.body.textContent).toContain('No photo: none of your photos fits this post.')
  })

  it('a replaced slot says what it replaced and when', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    it.brain!.replaced = { title: 'Friends and family', on: '2026-10-12T05:20:00Z' }
    show(r, it)
    expect(section('Why this post').textContent).toContain("Replaced: 'Friends and family' failed the quality check on 12 Oct; the planner picked this one.")
  })

  it('the writer rule line follows the account: you for Ivan, Davorin for Arch, nothing for Rise', () => {
    const v = ivan()
    show(v, byTitle(v, /Why your LinkedIn messages get ignored/))
    expect(section('How it is written').textContent).toContain('Writer rule: open with something you did or saw.')
    cleanup()
    const a = arch()
    show(a, pick(a, i => i.kind === 'planned'))
    expect(section('How it is written').textContent).toContain('Writer rule: open with something Davorin did or saw.')
    cleanup()
    const r = rise()
    show(r, byTitle(r, /If a channel can't grow/))
    expect(document.body.textContent).not.toContain('Writer rule')
  })

  it('first lines: the start of the post, at most 260 characters', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    it.brain!.body_head = 'word '.repeat(100)
    show(r, it)
    const fl = document.querySelector('.pl2-pn-first')!.textContent!
    expect(fl.length).toBeLessThanOrEqual(261)
    expect(fl.endsWith('…')).toBe(true)
  })

  it('How it did: views next to a normal post, reactions, comments, viral, the Rise engaged line', () => {
    const r = rise()
    const it = pick(r, i => i.st === 'published')
    it.brain!.result = { views: 812, reactions: 14, comments: 3, viral: true, young: false, url: 'https://www.linkedin.com/feed/update/x', engaged: { brand: 3, total: 12, usual_pct: 9 } }
    show(r, it)
    const s = section('How it did')
    expect(s.textContent).toContain('812')
    expect(s.textContent).toContain('views (normal: 253)')
    expect(s.textContent).toContain('reactions')
    expect(s.textContent).toContain('Went viral.')
    expect(s.textContent).toContain('3 of 12 people who engaged run a brand (Rise normal: 9%).')
  })

  it('a young post says its numbers are still coming in', () => {
    const r = rise()
    show(r, pick(r, i => i.st === 'published'))
    expect(section('How it did').textContent).toContain('Numbers are still coming in.')
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/)
  })
})

describe('PlanPanel: keys', () => {
  it('waiting: Read and approve (ink), Open draft, Move day', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    show(r, it)
    expect(keyNames()).toEqual(['Read and approve', 'Open draft', 'Move day'])
    const ok = screen.getByRole('link', { name: 'Read and approve' })
    expect(ok.className).toContain('cv2-k-p')
    expect(ok.getAttribute('href')).toBe(`#exp/d/content/now?draft=${it.draftId}&lane=risedtc`)
    expect(screen.getByRole('link', { name: 'Open draft' }).getAttribute('href')).toBe(`#exp/d/content/calendar?draft=${it.draftId}&lane=risedtc`)
    // pinned at the bottom: the keys live in the sheet foot, outside the scrolling body
    expect(document.querySelector('.d-sheet-f .pl2-pn-keys')).not.toBeNull()
  })

  it('published: Open on LinkedIn only', () => {
    const r = ivan()
    const it = pick(r, i => i.st === 'published')
    show(r, it)
    expect(keyNames()).toEqual(['Open on LinkedIn'])
    expect(screen.getByRole('link', { name: 'Open on LinkedIn' }).getAttribute('href')).toBe(it.brain!.result!.url)
  })

  it('failed: Open draft only', () => {
    const r = rise()
    const it = byTitle(r, /If a channel can't grow/)
    it.st = 'failed'
    show(r, it)
    expect(keyNames()).toEqual(['Open draft'])
    expect(section('Is it good').textContent).toContain('Failed twice. The planner is picking a new topic for this slot.')
  })

  it('scheduled: Open draft and Move day', () => {
    const r = ivan()
    show(r, byTitle(r, /Why your LinkedIn messages get ignored/))
    expect(keyNames()).toEqual(['Open draft', 'Move day'])
  })

  it('a dated Rise post still waiting has no Move day: a date would schedule it on Mattan\'s board', () => {
    const r = rise()
    const it = pick(r, i => i.kind === 'post' && i.st === 'scheduled')
    it.st = 'review'
    show(r, it)
    expect(keyNames()).toEqual(['Read and approve', 'Open draft'])
  })
})

describe('PlanPanel: Move day', () => {
  it('a dated post moves to the picked day at the same local time; Undo puts the old time back', async () => {
    const r = ivan()
    const it = byTitle(r, /Why your LinkedIn messages get ignored/)
    const { onChanged } = show(r, it)
    fireEvent.click(screen.getByRole('button', { name: 'Move day' }))
    const picker = screen.getByRole('group', { name: 'Move day' })
    // two weeks of weekdays, no weekend (the post sits on a Thursday)
    expect(within(picker).getAllByRole('button', { name: /Oct/ }).length).toBe(10)
    expect(within(picker).queryByRole('button', { name: /^Sat|^Sun/ })).toBeNull()
    // the post's own day cannot be picked
    expect((within(picker).getByRole('button', { name: /Thu 15 Oct/ }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(within(picker).getByRole('button', { name: /Fri 16 Oct/ })) })
    expect(api.setScheduleDateAt).toHaveBeenCalledWith(it.draftId, '2026-10-16T08:45:00.000Z')
    expect(onChanged).toHaveBeenCalled()
    const toast = await screen.findByText(/Moved to Fri 16 Oct · 10:45 Warsaw\./)
    expect(toast).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })
    expect(api.setScheduleDateAt).toHaveBeenLastCalledWith(it.draftId, it.at)
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
  })

  it('a day already past cannot be picked', () => {
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
    const r = ivan()
    show(r, byTitle(r, /Why your LinkedIn messages get ignored/))
    fireEvent.click(screen.getByRole('button', { name: 'Move day' }))
    const picker = screen.getByRole('group', { name: 'Move day' })
    expect((within(picker).getByRole('button', { name: /Tue 13 Oct/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(picker).getByRole('button', { name: /Wed 14 Oct/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(picker).getByRole('button', { name: /Fri 16 Oct/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a planned slot moves its week, only to a week with room; Undo moves it back', async () => {
    const a = arch()
    a.weeks[1].filled = 2
    const it = pick(a, i => i.kind === 'planned')
    const { onChanged } = show(a, it)
    fireEvent.click(screen.getByRole('button', { name: 'Move day' }))
    const picker = screen.getByRole('group', { name: 'Move day' })
    const thisWeek = within(picker).getByRole('button', { name: /This week/ }) as HTMLButtonElement
    const next = within(picker).getByRole('button', { name: /Next week/ }) as HTMLButtonElement
    const after = within(picker).getByRole('button', { name: /Week after/ }) as HTMLButtonElement
    expect(thisWeek.disabled).toBe(true) // full: 3 of 3
    expect(after.disabled).toBe(true) // its own week
    expect(next.disabled).toBe(false)
    await act(async () => { fireEvent.click(next) })
    expect(api.moveSlotWeek).toHaveBeenCalledWith(it.slotId, '2026-10-19')
    expect(api.setScheduleDateAt).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalled()
    await screen.findByText(/Moved to the week of 19 Oct\./)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })
    expect(api.moveSlotWeek).toHaveBeenLastCalledWith(it.slotId, '2026-10-26')
  })

  it('when every other week is full the picker says so', () => {
    const a = arch()
    show(a, pick(a, i => i.kind === 'planned'))
    fireEvent.click(screen.getByRole('button', { name: 'Move day' }))
    expect(screen.getByText('Every other week of the plan is full, so it stays in its week.')).toBeTruthy()
    expect([...screen.getByRole('group', { name: 'Move day' }).querySelectorAll<HTMLButtonElement>('.pl2-mv-wk')].every(b => b.disabled)).toBe(true)
  })

  it('a refused move says so in plain words and changes nothing on screen', async () => {
    api.setScheduleDateAt.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'past_date' }))
    const r = ivan()
    const { onChanged } = show(r, byTitle(r, /Why your LinkedIn messages get ignored/))
    fireEvent.click(screen.getByRole('button', { name: 'Move day' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('group', { name: 'Move day' })).getByRole('button', { name: /Fri 16 Oct/ })) })
    expect(await screen.findByText('That time has already passed. Nothing changed.')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('—')
  })
})
