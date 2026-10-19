// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { ContentDraft } from '../../../lib/content'

// Write parity for the Brief 4 review desk (SPEC-content §5): the same verdict
// store, the same schedule / board writes, the reason as the drop's commit, and
// the seat's next step only once a verdict is SAVED. Every write is mocked.
const lib = vi.hoisted(() => ({ setVerdict: vi.fn(), scheduleGuarded: vi.fn(), setBoardVisible: vi.fn() }))
vi.mock('../../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../../lib/verdicts')>()), setVerdict: lib.setVerdict }))
vi.mock('../writes', () => ({ scheduleGuarded: lib.scheduleGuarded }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), setBoardVisible: lib.setBoardVisible }))
vi.mock('../../../lib/brainPage', async orig => ({ ...(await orig<typeof import('../../../lib/brainPage')>()), fetchDraftSources: vi.fn(() => Promise.resolve(new Map())) }))
vi.mock('../useEarlyReads', () => ({ useEarlyReads: () => new Map() }))

import { DESK_SEATS, ReviewDesk, deskModel, deskSeatOf, nextOf, pillOf } from './ReviewDesk'
import type { Lane } from '../model'
import { buildNow } from '../weekModel'
import { flushVerdicts, resetVerdictsForTest, useJudged } from '../verdictStore'
import { resetDecisionsForTest } from '../decisions'
import type { WeekRead } from '../useWeek'

const NOW = Date.parse('2026-09-29T10:00:00Z')
const H = 3_600_000
const at = (ms: number) => new Date(NOW + ms).toISOString()
const row = (o: Partial<ContentDraft>): ContentDraft => ({
  id: 'x', client_id: null, status: 'review', type: 'text', title: 'A post', topic: null, post_body: 'Body.',
  scheduled_at: null, published_at: null, source_post_id: null, image_urls: null, taxonomy: null,
  created_at: at(-H), updated_at: at(-H), board_visible: null, ...o,
} as ContentDraft)
const brain = (o: Partial<ContentDraft>) => row({ cb34_p2_member: true, ...o })
const ROWS = [
  brain({ id: 'b1', title: '[X outlier @kev] Brain one', post_body: 'Brain one\n\nMore.', created_at: at(-H) }),
  brain({ id: 'b2', title: 'Brain two', created_at: at(-2 * H) }),
  row({ id: 'n1', title: 'Normal draft', created_at: at(-3 * H) }),
  brain({ id: 'br', client_id: 'risedtc', title: 'Rise brain', created_at: at(-4 * H) }),
]
const read = (rows: ContentDraft[]): WeekRead => ({ rows, source: 'live', at: at(0), loading: false, error: null, capped: null, settled: true, refresh: vi.fn() })

function Harness({ rows = ROWS, onOpen = vi.fn(), onEdit = vi.fn(), focusId = null, show = 'ivan' }: { rows?: ContentDraft[]; onOpen?: () => void; onEdit?: () => void; focusId?: string | null; show?: Lane }) {
  const judged = useJudged()
  const week = buildNow(rows, { now: NOW, judged, show })
  const total = buildNow(rows, { now: NOW, judged })
  return <ReviewDesk week={week} total={total} read={read(rows)} show={show} setShow={vi.fn()} now={NOW} openId={null} focusId={focusId}
    onOpen={onOpen} onEdit={onEdit} onChanged={vi.fn()} firstDay="2026-09-28" seatRows={() => rows} rows={rows}
    armed={new Set()} armedFailed={false} />
}
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }) })
const card = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement | null
const strip = (id: string) => document.querySelector(`[data-strip-id="${id}"]`) as HTMLElement | null
const verb = (root: ParentNode | null, v: string) => root?.querySelector(`[data-verb="${v}"]`) as HTMLButtonElement | null
const saveOk = (id: string, v: string, o: { reasons?: string[] }) => Promise.resolve({ draft_id: id, verdict: v, reasons: o.reasons ?? [] })

beforeEach(() => {
  lib.setVerdict.mockReset(); lib.scheduleGuarded.mockReset(); lib.setBoardVisible.mockReset()
  resetVerdictsForTest(); resetDecisionsForTest()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { resetVerdictsForTest(); resetDecisionsForTest(); cleanup(); vi.unstubAllGlobals() })

describe('the review desk: two-tap Drop, the reason is the commit', () => {
  it('d then 1 drops the focused card with "Invented a fact"; nothing is written before the reason', async () => {
    lib.setVerdict.mockImplementation(saveOk)
    renderInFrame(<Harness />)
    expect(card('b1')!.getAttribute('aria-current')).toBe('true')
    key('d')
    expect(card('b1')!.querySelector('.cv2-why')).toBeTruthy()
    await act(() => flushVerdicts())
    expect(lib.setVerdict).not.toHaveBeenCalled()
    key('1')
    expect(strip('b1')).toBeTruthy()
    await act(() => flushVerdicts())
    expect(lib.setVerdict).toHaveBeenCalledTimes(1)
    expect(lib.setVerdict.mock.calls[0][0]).toBe('b1')
    expect(lib.setVerdict.mock.calls[0][1]).toBe('drop')
    expect(lib.setVerdict.mock.calls[0][2].reasons).toEqual(['invented_fact'])
  })

  it('Esc after d writes nothing', async () => {
    renderInFrame(<Harness />)
    key('d'); key('Escape')
    expect(card('b1')!.querySelector('.cv2-why')).toBeNull()
    await act(() => flushVerdicts())
    expect(lib.setVerdict).not.toHaveBeenCalled()
  })

  it('Other takes a line and passes the note', async () => {
    lib.setVerdict.mockImplementation(saveOk)
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b1'), 'card-drop')!)
    fireEvent.click(card('b1')!.querySelector('[data-reason="other"]')!)
    const input = screen.getByLabelText('What was it?') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Too salesy' } })
    fireEvent.submit(input.closest('form')!)
    await act(() => flushVerdicts())
    expect(lib.setVerdict.mock.calls[0][2]).toMatchObject({ reasons: ['other'], note: 'Too salesy' })
  })

  it('z undoes the newest held verdict: nothing is written', async () => {
    renderInFrame(<Harness />)
    key('a')
    expect(strip('b1')).toBeTruthy()
    key('z')
    expect(strip('b1')).toBeNull()
    await act(() => flushVerdicts())
    expect(lib.setVerdict).not.toHaveBeenCalled()
  })

  it('a approves the focused brain card through the verdict store (keep)', async () => {
    lib.setVerdict.mockImplementation(saveOk)
    renderInFrame(<Harness />)
    key('a')
    await act(() => flushVerdicts())
    expect(lib.setVerdict).toHaveBeenCalledWith('b1', 'keep', expect.anything())
  })

  it('j / k walk the cards; e opens the editor; Enter opens the post', () => {
    const onEdit = vi.fn(), onOpen = vi.fn()
    renderInFrame(<Harness onEdit={onEdit} onOpen={onOpen} />)
    key('j')
    expect(card('b2')!.getAttribute('aria-current')).toBe('true')
    key('k')
    expect(card('b1')!.getAttribute('aria-current')).toBe('true')
    key('e'); expect(onEdit).toHaveBeenCalledWith('b1', 'ivan')
    key('Enter'); expect(onOpen).toHaveBeenCalledWith('b1', 'ivan')
  })
})

describe('the seat next step comes only after the verdict is saved', () => {
  it('Ivan: no Schedule while held or saving; Schedule after saved opens today\'s confirm', async () => {
    let done!: (v: unknown) => void
    lib.setVerdict.mockImplementation(() => new Promise(r => { done = r }))
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b1'), 'card-keep')!)
    expect(verb(strip('b1'), 'next-schedule')).toBeNull()
    const flushing = flushVerdicts()
    await waitFor(() => expect(strip('b1')!.dataset.phase).toBe('saving'))
    expect(verb(strip('b1'), 'next-schedule')).toBeNull()
    await act(async () => { done({ draft_id: 'b1', verdict: 'keep', reasons: [] }); await flushing })
    await waitFor(() => expect(strip('b1')!.dataset.phase).toBe('saved'))
    const next = verb(strip('b1'), 'next-schedule')!
    expect(next.textContent).toMatch(/^Schedule \w{3} \d+ · 10:45$/)
    fireEvent.click(next)
    await waitFor(() => expect(screen.getByText('Put this post on LinkedIn?')).toBeTruthy())
    expect(lib.scheduleGuarded).not.toHaveBeenCalled()
  })

  it('Rise: Put on Mattan\'s board after saved, behind today\'s board confirm', async () => {
    lib.setVerdict.mockImplementation(saveOk)
    renderInFrame(<Harness show="risedtc" />)
    fireEvent.click(verb(card('br'), 'card-keep')!)
    expect(verb(strip('br'), 'next-board')).toBeNull()
    await act(() => flushVerdicts())
    await waitFor(() => expect(strip('br')!.dataset.phase).toBe('saved'))
    fireEvent.click(verb(strip('br'), 'next-board')!)
    await waitFor(() => expect(screen.getByText('Put this on Mattan’s board?')).toBeTruthy())
    expect(lib.setBoardVisible).not.toHaveBeenCalled()
  })

  it('nextOf: Ivan approved → schedule; Rise kept off board → board; Arch kept → date; review → none', () => {
    const c = (o: Partial<ContentDraft>, lane: 'ivan' | 'risedtc' | 'arch', kept = false) => ({ r: row(o), lane, kept } as Parameters<typeof nextOf>[0])
    expect(nextOf(c({ status: 'approved' }, 'ivan'))).toBe('schedule')
    expect(nextOf(c({ status: 'review' }, 'ivan'))).toBeNull()
    expect(nextOf(c({ status: 'review', client_id: 'risedtc' }, 'risedtc', true))).toBe('board')
    expect(nextOf(c({ status: 'review', client_id: 'risedtc', board_visible: true }, 'risedtc', true))).toBeNull()
    expect(nextOf(c({ client_id: 'arch' }, 'arch', true))).toBe('date')
    expect(nextOf(c({ client_id: 'arch' }, 'arch'))).toBeNull()
  })
})

describe('the row', () => {
  it('No image narrows the heading and the list; the seat count never moves', () => {
    const rows = [
      row({ id: 'with-image', created_at: at(-10 * H), image_urls: ['https://s.test/image.jpg'] }),
      row({ id: 'without-image-new', created_at: at(-2 * H) }),
      row({ id: 'without-image-old', created_at: at(-5 * H) }),
      row({ id: 'approved-no-image', status: 'approved', created_at: at(-H) }),
    ]
    renderInFrame(<Harness rows={rows} />)
    const answer = () => document.querySelector('.cv2-answer')!.textContent!
    expect(answer()).toContain('3 Ivan’s drafts to decide. Newest 2h, oldest 10h.')
    expect(document.querySelector('[data-verb="show-ivan"] .cv2-n')?.textContent).toBe('3')
    expect(document.querySelector('[data-verb="quick-noimg"] .cv2-n')?.textContent).toBe('2')
    fireEvent.click(verb(document, 'quick-noimg')!)
    expect(answer()).toContain('2 of 3 Ivan’s drafts to decide have no image. Newest 2h, oldest 5h.')
    expect(document.querySelector('[data-verb="show-ivan"] .cv2-n')?.textContent).toBe('3')
    expect(card('with-image')).toBeNull()
    expect(card('without-image-new')).toBeTruthy()
    fireEvent.click(verb(document, 'quick-noimg')!)
    expect(answer()).toContain('3 Ivan’s drafts to decide. Newest 2h, oldest 10h.')
  })
  it('counts only drafts to decide; approved and needs-a-fix sit in their own folds with their own counts', () => {
    const rows = [
      row({ id: 'open', type: 'single_image' }), row({ id: 'approved', status: 'approved', type: 'single_image' }),
      row({ id: 'error', status: 'error' }), brain({ id: 'brain-error', status: 'error', image_urls: ['https://s.test/brain.jpg'] }), row({ id: 'planned', scheduled_at: at(H), image_urls: ['https://s.test/planned.jpg'] }),
      row({ id: 'rise', client_id: 'risedtc', image_urls: ['https://s.test/rise.jpg'] }), row({ id: 'arch', client_id: 'arch', image_urls: ['https://s.test/arch.jpg'] }),
    ]
    renderInFrame(<Harness rows={rows} />)
    expect(document.querySelector('[data-verb="show-ivan"] .cv2-n')?.textContent).toBe('3')
    expect(document.querySelector('[data-verb="show-risedtc"] .cv2-n')?.textContent).toBe('1')
    expect(document.querySelector('[data-verb="show-arch"] .cv2-n')?.textContent).toBe('1')
    expect(screen.getByText(/3 Ivan’s drafts to decide/)).toBeTruthy()
    // The list holds exactly the counted three: the judgeable brain error is one of them.
    expect([...document.querySelectorAll('.cv2-list[aria-label="Drafts to decide"] > [data-card-id]')].map(e => e.getAttribute('data-card-id')).sort()).toEqual(['brain-error', 'open', 'planned'])
    expect(card('approved')).toBeNull()
    expect(verb(document, 'wait-fold')?.textContent).toContain('1 approved')
    fireEvent.click(verb(document, 'wait-fold')!)
    expect(card('approved')).toBeTruthy()
    expect(card('error')).toBeNull()
    expect(verb(document, 'fix-fold')?.textContent).toContain('1 needs a fix')
    fireEvent.click(verb(document, 'fix-fold')!)
    expect(card('error')).toBeTruthy()
  })
  it('the hook shows without its internal tag; the row is named by its source and hook', () => {
    renderInFrame(<Harness />)
    expect(card('b1')!.getAttribute('aria-label')).toBe('Brain: Brain one')
    expect(card('b1')!.querySelector('.cv2-row-t')!.textContent).toBe('Brain one')
    expect(card('b1')!.textContent).not.toContain('[X outlier')
  })
  it('one status pill per card from today\'s flags', () => {
    const week = buildNow([row({ id: 'p', status: 'error' }), row({ id: 'q' })], { now: NOW })
    const cards = week.groups.flatMap(g => g.cards)
    expect(pillOf(cards.find(c => c.r.id === 'p')!)).toEqual({ tone: 'bad', text: 'Error' })
    expect(pillOf(cards.find(c => c.r.id === 'q')!)).toEqual({ tone: 'info', text: 'Needs review' })
  })
  it('Arch rows edit like the other lanes: Edit, the board key and the ⋯ menu on the row', () => {
    renderInFrame(<Harness show="arch" rows={[row({ id: 'a1', client_id: 'arch', status: 'review' })]} />)
    const a = card('a1')!
    expect(verb(a, 'card-edit')).toBeTruthy()
    expect(verb(a, 'card-board')).toBeTruthy()
    expect(verb(a, 'card-more')).toBeTruthy()
  })
  it('a tap on the row opens the post; a tap on a key does only that key', () => {
    const onOpen = vi.fn(), onEdit = vi.fn()
    renderInFrame(<Harness onOpen={onOpen} onEdit={onEdit} />)
    fireEvent.click(card('n1')!.querySelector('.cv2-row-t')!)
    expect(onOpen).toHaveBeenCalledWith('n1', 'ivan')
    onOpen.mockClear()
    fireEvent.click(verb(card('n1'), 'card-edit')!)
    expect(onEdit).toHaveBeenCalledWith('n1', 'ivan')
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('no All seat', () => {
  it('the seat switch is Ivan, Rise, Arch, SwishDM and nothing else', () => {
    renderInFrame(<Harness />)
    const tabs = [...document.querySelectorAll('[role="tablist"][aria-label="Seat"] [role="tab"]')]
    expect(tabs.map(t => t.getAttribute('data-verb'))).toEqual(['show-ivan', 'show-risedtc', 'show-arch', 'show-swishdm'])
    expect(verb(document, 'show-all')).toBeNull()
    expect(DESK_SEATS).toEqual(['ivan', 'risedtc', 'arch', 'swishdm'])
  })
  it('a remembered or linked "all" (or anything unknown) falls back to Ivan; a real seat is kept', () => {
    expect(deskSeatOf('all')).toBe('ivan')
    expect(deskSeatOf(null)).toBe('ivan')
    expect(deskSeatOf('rise')).toBe('ivan')
    expect(deskSeatOf('arch')).toBe('arch')
    expect(deskSeatOf('risedtc')).toBe('risedtc')
  })
  it('a seat shows only its own drafts', () => {
    renderInFrame(<Harness show="risedtc" />)
    expect(card('br')).toBeTruthy()
    expect(card('b1')).toBeNull()
    expect(screen.getByText(/1 Mattan’s draft to decide/)).toBeTruthy()
  })
})

describe('the source tag is the first thing on every row', () => {
  it('shows Personal beside the call source for personal stories only', () => {
    renderInFrame(<Harness show="risedtc" rows={[
      row({ id: 'med-spa', client_id: 'risedtc', source_label: 'Call', taxonomy: { pillar: 'personal', register: 'personal' } }),
      row({ id: 'roas', client_id: 'risedtc', source_label: 'Call', taxonomy: { pillar: 'authority' } }),
    ]} />)
    expect(card('med-spa')!.querySelector('[data-source="call"]')!.textContent).toBe('Call')
    expect(card('med-spa')!.querySelector('[data-pillar="personal"]')?.textContent).toBe('Personal')
    expect(card('roas')!.querySelector('[data-pillar="personal"]')).toBeNull()
  })

  it('first child of every row, in the source\'s own words', () => {
    const rows = [
      brain({ id: 's-brain', taxonomy: { source: 'content-brain', brain_brief: { slot: 'outlier' } } }),
      row({ id: 's-call', source_label: 'Call with Drew - My Mully, 14 Sep 2026', source_kind: 'call' } as Partial<ContentDraft>),
      row({ id: 's-x', taxonomy: { source: 'x_tracked_outlier' }, source_label: 'X outlier by @thekevinjon' }),
      row({ id: 's-news', source_label: 'Newsjack' }),
    ]
    renderInFrame(<Harness rows={rows} />)
    const first = (id: string) => card(id)!.querySelector('.cv2-row-main')!.firstElementChild as HTMLElement
    expect(first('s-brain').className).toContain('cv2-srctag')
    expect(first('s-brain').textContent).toBe('Brain · Outlier')
    expect(first('s-call').textContent).toBe('Call')
    expect(first('s-call').title).toBe('Source: Call with Drew - My Mully, 14 Sep 2026')
    expect(first('s-x').textContent).toBe('Outlier · @thekevinjon')
    expect(first('s-news').textContent).toBe('Newsjack')
  })
})

describe('one number everywhere', () => {
  it('the seat tab, the heading and the open post\'s queue are the same set, in the drawn order', () => {
    const rows = [
      ...ROWS,
      row({ id: 'fix1', status: 'error' }), row({ id: 'appr', status: 'approved' }),
      row({ id: 'dated', scheduled_at: at(30 * H) }),
    ]
    renderInFrame(<Harness rows={rows} />)
    const tab = Number(document.querySelector('[data-verb="show-ivan"] .cv2-n')!.textContent)
    const heading = Number(/^(\d+) /.exec(document.querySelector('.cv2-answer')!.textContent!)![1])
    const desk = deskModel(buildNow(rows, { now: NOW, show: 'ivan' }), NOW)
    const drawn = [...document.querySelectorAll('.cv2-list[aria-label="Drafts to decide"] > [data-card-id]')].map(e => e.getAttribute('data-card-id'))
    expect(tab).toBe(4)
    expect(heading).toBe(tab)
    expect(desk.queue.length).toBe(tab)
    expect(drawn).toEqual(desk.queue)
    // Dated first, then the newest.
    expect(desk.queue[0]).toBe('dated')
  })
  it('an approve takes the draft out of all three at once, and Undo puts it back in all three', () => {
    renderInFrame(<Harness />)
    const tab = () => document.querySelector('[data-verb="show-ivan"] .cv2-n')!.textContent
    expect(tab()).toBe('3')
    key('a')
    expect(tab()).toBe('2')
    expect(screen.getByText(/2 Ivan’s drafts to decide/)).toBeTruthy()
    key('z')
    expect(tab()).toBe('3')
  })
})

describe('the preview opens in place', () => {
  it('the chevron shows the post and its picture controls without opening the panel', () => {
    const onOpen = vi.fn()
    renderInFrame(<Harness onOpen={onOpen} rows={[row({ id: 'a1', client_id: 'arch', type: 'single_image' })]} show="arch" />)
    expect(verb(card('a1'), 'picture-change')).toBeNull()
    fireEvent.click(verb(card('a1'), 'row-preview')!)
    expect(verb(card('a1'), 'picture-change')).toBeTruthy()
    expect(verb(card('a1'), 'picture-upload')).toBeTruthy()
    expect(onOpen).not.toHaveBeenCalled()
    key('o')
    expect(verb(card('a1'), 'picture-change')).toBeNull()
  })
})


describe('Ideas landing reveals and selects the exact draft', () => {
  it('selects a draft far down the list', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => brain({ id: `landing-${i}`, created_at: at(-(i+1)*H) }))
    renderInFrame(<Harness rows={rows} focusId="landing-7" />)
    await waitFor(() => expect(card('landing-7')?.getAttribute('aria-current')).toBe('true'))
    expect(card('landing-0')?.getAttribute('aria-current')).not.toBe('true')
  })
  it('reveals a folded fix draft and keeps its selection after the effects settle', async () => {
    const rows = [...ROWS, row({ id: 'fix-landing', status: 'error' })]
    renderInFrame(<Harness rows={rows} focusId="fix-landing" />)
    await waitFor(() => expect(card('fix-landing')?.getAttribute('aria-current')).toBe('true'))
    expect(verb(document, 'fix-fold')?.getAttribute('aria-expanded')).toBe('true')
    expect(card('b1')?.getAttribute('aria-current')).not.toBe('true')
    expect(lib.setVerdict).not.toHaveBeenCalled()
  })
})
