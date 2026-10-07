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

import { ReviewDesk, nextOf, pillOf } from './ReviewDesk'
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

function Harness({ rows = ROWS, onOpen = vi.fn(), onEdit = vi.fn() }: { rows?: ContentDraft[]; onOpen?: () => void; onEdit?: () => void }) {
  const judged = useJudged()
  const week = buildNow(rows, { now: NOW, judged })
  return <ReviewDesk week={week} total={week} read={read(rows)} show="all" setShow={vi.fn()} now={NOW} openId={null} focusId={null}
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
    renderInFrame(<Harness />)
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

describe('the card', () => {
  it('shows the hook without its internal tag; the tag lives in the ⋯ header', () => {
    renderInFrame(<Harness />)
    expect(card('b1')!.getAttribute('aria-label')).toBe('Ivan draft: Brain one')
    expect(card('b1')!.textContent).not.toContain('[X outlier')
  })
  it('one status pill per card from today\'s flags', () => {
    const week = buildNow([row({ id: 'p', status: 'error' }), row({ id: 'q' })], { now: NOW })
    const cards = week.groups.flatMap(g => g.cards)
    expect(pillOf(cards.find(c => c.r.id === 'p')!)).toEqual({ tone: 'bad', text: 'Error' })
    expect(pillOf(cards.find(c => c.r.id === 'q')!)).toEqual({ tone: 'info', text: 'Needs review' })
  })
  it('Arch cards that are not brain drafts have no decision key (view only)', () => {
    renderInFrame(<Harness rows={[row({ id: 'a1', client_id: 'arch', status: 'review' })]} />)
    const a = card('a1')!
    for (const v of ['card-keep', 'card-drop', 'card-approve', 'card-skip', 'card-board', 'card-schedule', 'card-date-it', 'card-edit']) expect(verb(a, v)).toBeNull()
    expect(verb(a, 'card-open')).toBeTruthy()
  })
})

describe('Arch picture', () => {
  it('an Arch card never offers a picture write; Ivan\'s does', () => {
    renderInFrame(<Harness rows={[row({ id: 'a1', client_id: 'arch', type: 'single_image' }), row({ id: 'i1', type: 'single_image' })]} />)
    expect(verb(card('a1'), 'picture-change')).toBeNull()
    expect(verb(card('a1'), 'picture-upload')).toBeNull()
    expect(verb(card('i1'), 'picture-change')).toBeTruthy()
  })
})
