// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { ContentDraft } from '../../../lib/content'
import { clearBoardState, setBoardState } from '../../../lib/clientBoardState'

// Write parity for the Brief 4 review desk (SPEC-content §5): the same verdict
// store, the same schedule / board writes, the reason as the drop's commit, and
// the seat's next step only once a verdict is SAVED. Every write is mocked.
const lib = vi.hoisted(() => ({ setVerdict: vi.fn(), scheduleGuarded: vi.fn(), setBoardVisible: vi.fn(), setScheduleDateAt: vi.fn(), deleteDraft: vi.fn(), deleteClientDraft: vi.fn(), saveDraftBody: vi.fn(), saveClientDraftBody: vi.fn() }))
vi.mock('../../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../../lib/verdicts')>()), setVerdict: lib.setVerdict }))
vi.mock('../writes', () => ({ scheduleGuarded: lib.scheduleGuarded }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), setBoardVisible: lib.setBoardVisible, setScheduleDateAt: lib.setScheduleDateAt, deleteDraft: lib.deleteDraft, deleteClientDraft: lib.deleteClientDraft, saveDraftBody: lib.saveDraftBody, saveClientDraftBody: lib.saveClientDraftBody }))
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

function Harness({ rows = ROWS, onOpen = vi.fn(), onEdit = vi.fn(), focusId = null, show = 'ivan', verdicts, boardRead }: { rows?: ContentDraft[]; onOpen?: () => void; onEdit?: () => void; focusId?: string | null; show?: Lane; verdicts?: ReadonlyMap<string, 'keep'>; boardRead?: { loading: boolean; error: string | null; loadedAt: string | null; refresh: () => void } }) {
  const judged = useJudged()
  const week = buildNow(rows, { now: NOW, judged, show, verdicts, includeBoard: true })
  const total = buildNow(rows, { now: NOW, judged, verdicts, includeBoard: true })
  return <ReviewDesk week={week} total={total} read={read(rows)} show={show} setShow={vi.fn()} now={NOW} openId={null} focusId={focusId}
    onOpen={onOpen} onEdit={onEdit} onChanged={vi.fn()} firstDay="2026-09-28" seatRows={() => rows} rows={rows}
    armed={new Set()} armedFailed={false} boardRead={boardRead} />
}
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }) })
const card = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement | null
const strip = (id: string) => document.querySelector(`[data-strip-id="${id}"]`) as HTMLElement | null
const verb = (root: ParentNode | null, v: string) => root?.querySelector(`[data-verb="${v}"]`) as HTMLButtonElement | null
const saveOk = (id: string, v: string, o: { reasons?: string[] }) => Promise.resolve({ draft_id: id, verdict: v, reasons: o.reasons ?? [] })

beforeEach(() => {
  lib.setVerdict.mockReset(); lib.scheduleGuarded.mockReset(); lib.setBoardVisible.mockReset()
  lib.setScheduleDateAt.mockReset(); lib.deleteDraft.mockReset(); lib.deleteClientDraft.mockReset()
  resetVerdictsForTest(); resetDecisionsForTest()
  for (const client of ['risedtc', 'arch', 'swishdm']) clearBoardState(client)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { resetVerdictsForTest(); resetDecisionsForTest(); cleanup(); vi.unstubAllGlobals() })

describe('client posts stay accessible after promotion', () => {
  it('puts only this seat’s unpublished board posts below drafts, outside the review count', () => {
    const rows = [
      row({ id: 'draft', client_id: 'risedtc', title: 'Ready draft' }),
      row({ id: 'board', client_id: 'risedtc', title: 'Undated board post', board_visible: true }),
      row({ id: 'scheduled', client_id: 'risedtc', title: 'Dated board post', board_visible: true, status: 'scheduled', scheduled_at: '2030-10-22T14:00:00Z' }),
      row({ id: 'published', client_id: 'risedtc', board_visible: true, status: 'published', published_at: at(-H) }),
      row({ id: 'arch-board', client_id: 'arch', board_visible: true }),
    ]
    renderInFrame(<Harness show="risedtc" rows={rows} />)
    expect(screen.getByText(/1 Mattan’s draft to decide/)).toBeTruthy()
    const section = screen.getByRole('region', { name: 'On board' })
    expect([...section.querySelectorAll('[data-card-id]')].map(x => x.getAttribute('data-card-id'))).toEqual(['scheduled', 'board'])
    expect(document.querySelector('[aria-label="Drafts to decide"]')!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(verb(card('board'), 'card-board')).toBeNull()
    expect(verb(card('board'), 'card-board-date')?.textContent).toBe('Schedule')
    expect(verb(card('scheduled'), 'card-board-date')?.textContent).toBe('Change date')
    expect(card('published')).toBeNull()
    expect(card('arch-board')).toBeNull()
    expect(lib.setBoardVisible).not.toHaveBeenCalled()
    expect(lib.setScheduleDateAt).not.toHaveBeenCalled()
  })

  it('uses the synchronized date writer only after the operator picks and confirms a board date', async () => {
    lib.setScheduleDateAt.mockResolvedValue('2030-10-23T14:00:00.000Z')
    renderInFrame(<Harness show="risedtc" rows={[row({ id: 'board', client_id: 'risedtc', board_visible: true, status: 'scheduled', scheduled_at: '2030-10-22T14:00:00Z' })]} />)
    fireEvent.click(verb(card('board'), 'card-board-date')!)
    fireEvent.click(document.querySelector('[data-day="2030-10-23"]')!)
    expect(lib.setScheduleDateAt).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Schedule to post/ }))
    await waitFor(() => expect(lib.setScheduleDateAt).toHaveBeenCalledWith('board', '2030-10-23T14:00:00.000Z'))
    expect(lib.scheduleGuarded).not.toHaveBeenCalled()
    expect(lib.setBoardVisible).not.toHaveBeenCalled()
  })

  it('lets an overdue board post change date without putting it back in the draft queue', () => {
    renderInFrame(<Harness show="risedtc" rows={[row({ id: 'overdue', client_id: 'risedtc', board_visible: true, status: 'scheduled', scheduled_at: at(-24 * H) })]} />)
    const section = screen.getByRole('region', { name: 'On board' })
    expect(section.querySelector('[data-card-id="overdue"]')).toBeTruthy()
    expect(verb(card('overdue'), 'card-board-date')?.textContent).toBe('Change date')
    expect(lib.setScheduleDateAt).not.toHaveBeenCalled()
  })

  it.each(['arch', 'swishdm'] as const)('does not offer a date through a primary button or menu for held %s board posts', lane => {
    setBoardState(lane, [{ id: 'held-board', approval: null, approval_at: null, veto: 'post_removed', veto_at: at(0), note: null, note_by: null, note_at: null }])
    renderInFrame(<Harness show={lane} verdicts={new Map([['held-board', 'keep']])} rows={[brain({ id: 'held-board', client_id: lane, board_visible: true })]} />)
    expect(card('held-board')).toBeTruthy()
    expect(verb(card('held-board'), 'card-board-date')).toBeNull()
    expect(verb(card('held-board'), 'card-date-it')).toBeNull()
    fireEvent.click(card('held-board')!.querySelector('[aria-label="More for this draft"]')!)
    expect(screen.queryByRole('menuitem', { name: /Add a date|Move date/ })).toBeNull()
  })

  it('leaves a failed schedule open for correction and preserves the current date', async () => {
    lib.setScheduleDateAt.mockRejectedValue(new Error('The client removed this post.'))
    renderInFrame(<Harness show="risedtc" rows={[row({ id: 'board', client_id: 'risedtc', board_visible: true, status: 'scheduled', scheduled_at: '2030-10-22T14:00:00Z' })]} />)
    fireEvent.click(verb(card('board'), 'card-board-date')!)
    fireEvent.click(document.querySelector('[data-day="2030-10-23"]')!)
    fireEvent.click(screen.getByRole('button', { name: /^Schedule to post/ }))
    await waitFor(() => expect(screen.getByText('Not saved: The client removed this post.')).toBeTruthy())
    expect(screen.getByRole('button', { name: /^Schedule to post/ })).toBeTruthy()
    expect(card('board')!.textContent).toContain('Change date')
    expect(lib.setBoardVisible).not.toHaveBeenCalled()
  })

  it('shows a board read failure and retries instead of claiming the board is empty', () => {
    const refresh = vi.fn()
    renderInFrame(<Harness show="risedtc" rows={[]} boardRead={{ loading: false, error: 'Connection unavailable', loadedAt: null, refresh }} />)
    expect(screen.queryByText('No posts on the board yet.')).toBeNull()
    const section = screen.getByRole('region', { name: 'On board' })
    fireEvent.click(section.querySelector('button')!)
    expect(refresh).toHaveBeenCalledOnce()
    expect(lib.setScheduleDateAt).not.toHaveBeenCalled()
  })

  it('keeps the board section visible while reading and then explains an empty board', () => {
    renderInFrame(<Harness show="risedtc" rows={[]} boardRead={{ loading: true, error: null, loadedAt: null, refresh: vi.fn() }} />)
    expect(screen.getByRole('region', { name: 'On board' }).textContent).toContain('Reading')
    expect(screen.queryByText('No posts on the board yet.')).toBeNull()
    cleanup()
    renderInFrame(<Harness show="risedtc" rows={[]} boardRead={{ loading: false, error: null, loadedAt: at(0), refresh: vi.fn() }} />)
    expect(screen.getByText('No posts on the board yet.')).toBeTruthy()
  })

  it('offers Delete directly on a held row, cancels safely, then deletes only the confirmed draft', async () => {
    lib.deleteDraft.mockResolvedValue('deleted')
    renderInFrame(<Harness rows={[brain({ id: 'held-ivan', qa_verdict: 'QA_BLOCKED' })]} />)
    fireEvent.click(verb(document, 'fix-fold')!)
    fireEvent.click(verb(card('held-ivan'), 'card-delete')!)
    expect(lib.deleteDraft).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-verb="cancel"]')!)
    expect(lib.deleteDraft).not.toHaveBeenCalled()
    fireEvent.click(verb(card('held-ivan'), 'card-delete')!)
    fireEvent.click(document.querySelector('[data-verb="confirm"]')!)
    await waitFor(() => expect(lib.deleteDraft).toHaveBeenCalledWith('held-ivan', null))
    expect(lib.deleteClientDraft).not.toHaveBeenCalled()
  })

  it('keeps explicitly QA-held drafts out of the ready decision list and off the promotion controls', () => {
    renderInFrame(<Harness show="risedtc" rows={[
      row({ id: 'ready', client_id: 'risedtc', qa_verdict: 'LOCAL_REPLAY_PASS' }),
      row({ id: 'held', client_id: 'risedtc', qa_verdict: 'QA_HELD' }),
    ]} />)
    expect(screen.getByText(/1 Mattan’s draft to decide/)).toBeTruthy()
    expect(card('ready')).toBeTruthy()
    expect(card('held')).toBeNull()
    expect(screen.getByRole('region', { name: 'Needs a fix' }).compareDocumentPosition(screen.getByRole('region', { name: 'On board' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(verb(document, 'fix-fold')!)
    expect(card('held')).toBeTruthy()
    expect(verb(card('held'), 'card-board')).toBeNull()
  })
})

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
    // On the grid, Edit opens the post's text in place (Ivan 2026-10-30); it neither opens the post nor the editor.
    fireEvent.click(verb(card('n1'), 'card-edit')!)
    expect(card('n1')!.querySelector('textarea')).toBeTruthy()
    expect(onEdit).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })
  it('the grid card shows the whole post, an empty square without media, and the slide count of a carousel', () => {
    const long = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of the post.`).join('\n\n')
    renderInFrame(<Harness rows={[row({ id: 'g1', post_body: long }), row({ id: 'g2', type: 'carousel', image_urls: ['https://x/1.png', 'https://x/2.png', 'https://x/3.png'] })]} />)
    expect(card('g1')!.querySelector('.cv2-gp')!.textContent).toContain('Line 12 of the post.')
    expect(card('g1')!.querySelector('.cv2-li-empty')).toBeTruthy()
    expect(card('g2')!.querySelector('.cv2-li-empty')).toBeNull()
    expect(card('g2')!.querySelector('.cv2-li-count')!.textContent).toBe('1 / 3')
  })
  it('a click on the text edits in place; ⌘Enter saves with the loaded body as the compare base; Esc cancels', async () => {
    lib.saveDraftBody.mockResolvedValue(undefined)
    const onOpen = vi.fn()
    renderInFrame(<Harness onOpen={onOpen} rows={[row({ id: 'e1', post_body: 'Old text.' })]} />)
    fireEvent.click(card('e1')!.querySelector('.cv2-li-b p')!)
    expect(onOpen).not.toHaveBeenCalled()
    const ta = card('e1')!.querySelector('textarea')!
    expect(ta.value).toBe('Old text.')
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(card('e1')!.querySelector('textarea')).toBeNull()
    expect(lib.saveDraftBody).not.toHaveBeenCalled()
    fireEvent.click(card('e1')!.querySelector('.cv2-li-b p')!)
    const ta2 = card('e1')!.querySelector('textarea')!
    fireEvent.change(ta2, { target: { value: 'New text.' } })
    await act(async () => { fireEvent.keyDown(ta2, { key: 'Enter', metaKey: true }) })
    expect(lib.saveDraftBody.mock.calls.at(-1)!.filter((_, i) => i !== 2 && i !== 4)).toEqual(['e1', 'New text.', 'Old text.'])
    expect(card('e1')!.querySelector('textarea')).toBeNull()
  })
  it('a client draft saves through the client path', async () => {
    lib.saveClientDraftBody.mockResolvedValue(undefined)
    renderInFrame(<Harness show="arch" rows={[row({ id: 'c1', client_id: 'arch', status: 'review', post_body: 'Arch text.' })]} />)
    fireEvent.click(verb(card('c1'), 'card-edit')!)
    const ta = card('c1')!.querySelector('textarea')!
    fireEvent.change(ta, { target: { value: 'Arch text, fixed.' } })
    await act(async () => { fireEvent.click(verb(card('c1'), 'grid-save')!) })
    expect(lib.saveClientDraftBody.mock.calls.at(-1)!.filter((_, i) => i !== 2 && i !== 4)).toEqual(['c1', 'Arch text, fixed.', 'Arch text.'])
    expect(lib.saveDraftBody.mock.calls.some(x => x[0] === 'c1')).toBe(false)
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
