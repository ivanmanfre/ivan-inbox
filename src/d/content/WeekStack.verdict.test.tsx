// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { renderInFrame } from '../test-utils'
import type { ContentDraft } from '../../lib/content'

const lib = vi.hoisted(() => ({ setVerdict: vi.fn() }))
vi.mock('../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../lib/verdicts')>()), ...lib }))
vi.mock('./writes', () => ({ scheduleGuarded: vi.fn() }))

import { WeekStack } from './WeekStack'
import { buildNow } from './weekModel'
import { flushVerdicts, judge, resetVerdictsForTest, useJudged } from './verdictStore'
import type { WeekRead } from './useWeek'

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
  brain({ id: 'b1', title: 'Brain one', created_at: at(-H) }),
  brain({ id: 'b2', title: 'Brain two', created_at: at(-2 * H) }),
  row({ id: 'n1', title: 'Normal draft', created_at: at(-3 * H) }),
  brain({ id: 'br', client_id: 'risedtc', title: 'Rise brain', created_at: at(-4 * H) }),
  brain({ id: 'ba', client_id: 'arch', title: 'Arch brain', created_at: at(-5 * H) }),
]
const read = (rows: ContentDraft[]): WeekRead => ({ rows, source: 'live', at: at(0), loading: false, error: null, capped: null, settled: true, refresh: vi.fn() })

// The rows are state so a test can swap them under a live list (a refetch), the way the page does.
let setRowsNow: (r: ContentDraft[]) => void = () => {}
function Harness({ rows: first = ROWS, verdicts, onChanged = vi.fn() }: { rows?: ContentDraft[]; verdicts?: Map<string, 'keep' | 'drop'>; onChanged?: () => void }) {
  const [rows, setRows] = useState(first)
  setRowsNow = setRows
  const judged = useJudged()
  const week = buildNow(rows, { now: NOW, judged, verdicts })
  return <WeekStack week={week} read={read(rows)} show="all" setShow={vi.fn()} now={NOW} openId={null} onOpen={vi.fn()}
    onChanged={onChanged} firstDay="2026-09-28" seatRows={() => rows} nowView />
}

const card = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement | null
const strip = (id: string) => document.querySelector(`[data-strip-id="${id}"]`) as HTMLElement | null
const verb = (root: ParentNode | null, v: string) => root?.querySelector(`[data-verb="${v}"]`) as HTMLButtonElement | null
const slots = () => [...document.querySelectorAll<HTMLElement>('[data-card-id],[data-strip-id]')].map(e => e.dataset.cardId ?? e.dataset.stripId)
const saveOk = (id: string, v: string, o: { reasons?: string[] }) => Promise.resolve({ draft_id: id, verdict: v, reasons: o.reasons ?? [] })

beforeEach(() => {
  lib.setVerdict.mockReset(); resetVerdictsForTest()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { resetVerdictsForTest(); cleanup(); vi.unstubAllGlobals() })

describe('Review list: Keep / Drop', () => {
  it('a brain card to judge shows Drop and Keep and still offers a date; a normal card keeps Approve', () => {
    renderInFrame(<Harness />)
    const b = card('b1')!
    expect(verb(b, 'card-drop')!.textContent).toBe('Drop')
    expect(verb(b, 'card-keep')!.textContent).toBe('Keep')
    expect(verb(b, 'card-keep')!.classList.contains('cn-wc-key-d')).toBe(true)
    expect(verb(b, 'card-drop')!.classList.contains('cn-wc-key-d')).toBe(false)
    expect(verb(b, 'card-date')!.textContent).toBe('Add a date')
    expect(verb(b, 'card-open')).toBeTruthy()
    expect(verb(b, 'card-approve')).toBeNull()
    const n = card('n1')!
    expect(verb(n, 'card-approve')!.textContent).toBe('Approve')
    expect(verb(n, 'card-date')).toBeTruthy()
    expect(verb(n, 'card-drop')).toBeNull()
    expect(verb(n, 'card-keep')).toBeNull()
  })

  it('Rise and Arch brain cards get Keep and Drop too, with no Put on board key; Arch still has no date', () => {
    renderInFrame(<Harness />)
    for (const id of ['br', 'ba']) {
      expect(verb(card(id), 'card-keep')).toBeTruthy()
      expect(verb(card(id), 'card-drop')).toBeTruthy()
      expect(verb(card(id), 'card-board')).toBeNull()
    }
    expect(verb(card('ba'), 'card-date')).toBeNull()
  })

  it('says how many brain drafts wait for a verdict, and nothing when none do', () => {
    renderInFrame(<Harness />)
    const line = document.querySelector('.cn-judge-line')!
    expect(line.getAttribute('role')).toBe('status')
    expect(line.textContent).toBe('4 brain drafts to judge · Keep or Drop on each card')
    expect(line.querySelector('b')!.textContent).toBe('4')
    cleanup()
    renderInFrame(<Harness rows={[ROWS[2]]} />)
    expect(document.querySelector('.cn-judge-line')).toBeNull()
  })

  it('one tap on Drop: no confirm, the strip stands in the card place with 7 chips and Undo, nothing is written yet', () => {
    renderInFrame(<Harness />)
    const before = slots()
    fireEvent.click(verb(card('b1'), 'card-drop')!)
    expect(document.querySelector('.d-confirm')).toBeNull()
    expect(card('b1')).toBeNull()
    expect(slots()).toEqual(before)
    expect(strip('b1')!.querySelector('.cn-vs-what')!.textContent).toBe('Dropped')
    expect(strip('b1')!.querySelectorAll('[data-verb="verdict-reason"]')).toHaveLength(7)
    expect(verb(strip('b1'), 'verdict-undo')).toBeTruthy()
    expect(lib.setVerdict).not.toHaveBeenCalled()
    expect(document.querySelector('.cn-judge-line')!.textContent).toContain('3 brain drafts')
  })

  it('Keep on Ivan\'s seat reads "Kept · approved"; on Rise it reads "Kept"', () => {
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b2'), 'card-keep')!)
    expect(strip('b2')!.querySelector('.cn-vs-what')!.textContent).toBe('Kept · approved')
    fireEvent.click(verb(card('br'), 'card-keep')!)
    expect(strip('br')!.querySelector('.cn-vs-what')!.textContent).toBe('Kept')
  })

  it('the next card takes the focus, on its Keep key', async () => {
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b1'), 'card-drop')!)
    await waitFor(() => expect(document.activeElement).toBe(verb(card('b2'), 'card-keep')))
  })

  it('tapping a reason chip marks it', () => {
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b1'), 'card-drop')!)
    const chip = () => strip('b1')!.querySelector('[data-reason="generic"]')!
    expect(chip().getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip())
    expect(chip().getAttribute('aria-pressed')).toBe('true')
  })

  it('Undo brings the card back with its keys and nothing is written', async () => {
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b1'), 'card-drop')!)
    fireEvent.click(verb(strip('b1'), 'verdict-undo')!)
    expect(strip('b1')).toBeNull()
    expect(verb(card('b1'), 'card-keep')).toBeTruthy()
    await flushVerdicts()
    expect(lib.setVerdict).not.toHaveBeenCalled()
  })

  it('a Drop with a reason is written once; the strip folds away and the card does not come back', async () => {
    lib.setVerdict.mockImplementation(saveOk)
    const onChanged = vi.fn()
    renderInFrame(<Harness onChanged={onChanged} />)
    fireEvent.click(verb(card('b1'), 'card-drop')!)
    fireEvent.click(strip('b1')!.querySelector('[data-reason="too_long"]')!)
    await act(async () => { await flushVerdicts() })
    expect(lib.setVerdict).toHaveBeenCalledTimes(1)
    expect(lib.setVerdict.mock.calls[0][1]).toBe('drop')
    expect(lib.setVerdict.mock.calls[0][2].reasons).toEqual(['too_long'])
    await waitFor(() => expect(strip('b1')).toBeNull())
    expect(card('b1')).toBeNull()
    expect(onChanged).toHaveBeenCalled()
  })

  it('a Keep with a reason leaves a normal card with a Kept flag and no Keep or Drop keys', async () => {
    lib.setVerdict.mockImplementation(saveOk)
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('br'), 'card-keep')!)
    fireEvent.click(strip('br')!.querySelector('[data-reason="useful"]')!)
    await act(async () => { await flushVerdicts() })
    await waitFor(() => expect(strip('br')).toBeNull())
    const c = card('br')!
    expect([...c.querySelectorAll('.cn-wc-flag')].map(f => f.textContent)).toContain('Kept')
    expect(verb(c, 'card-keep')).toBeNull()
    expect(verb(c, 'card-drop')).toBeNull()
  })

  it('verdicts saved in the database hide a Dropped draft and flag a Kept one, with no keys', () => {
    renderInFrame(<Harness verdicts={new Map([['b1', 'drop'], ['b2', 'keep']])} />)
    expect(card('b1')).toBeNull()
    const k = card('b2')!
    expect(k.textContent).toContain('Kept')
    expect(verb(k, 'card-keep')).toBeNull()
    expect(document.querySelector('.cn-judge-line')!.textContent).toContain('2 brain drafts')
  })

  it('a failed write shows the error, Try again and Keep the card; Keep the card restores the keys', async () => {
    lib.setVerdict.mockRejectedValue(new Error('Could not reach the server.'))
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b1'), 'card-drop')!)
    await act(async () => { await flushVerdicts() })
    const s = strip('b1')!
    expect(s.dataset.phase).toBe('failed')
    expect(screen.getByRole('alert').textContent).toBe('Could not reach the server.')
    expect(verb(s, 'verdict-retry')!.textContent).toBe('Try again')
    fireEvent.click(verb(s, 'verdict-forget')!)
    expect(strip('b1')).toBeNull()
    expect(verb(card('b1'), 'card-keep')).toBeTruthy()
    expect(document.querySelector('.cn-judge-line')!.textContent).toContain('4 brain drafts')
  })

  it('the strip survives its row leaving the list, at the top of Drafts', () => {
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b2'), 'card-drop')!)
    expect(strip('b2')).toBeTruthy()
    // a refetch (or the brain visibility recheck) returns without the brain rows for a moment
    act(() => setRowsNow(ROWS.filter(r => r.id === 'n1')))
    expect(strip('b2')).toBeTruthy()
    expect(card('b1')).toBeNull()
    const drafts = document.querySelector('.cn-wk2-g[aria-label^="Drafts"]')!
    expect(drafts.firstElementChild!.tagName).toBe('H2')
    expect((drafts.children[1] as HTMLElement).dataset.stripId).toBe('b2')
    expect(card('n1')).toBeTruthy()
    // and back: still one strip, in its own slot
    act(() => setRowsNow(ROWS))
    expect(document.querySelectorAll('[data-strip-id="b2"]')).toHaveLength(1)
    expect(card('b2')).toBeNull()
  })

  it('open strips with no list left keep judged order in a Drafts group of their own', () => {
    renderInFrame(<Harness />)
    fireEvent.click(verb(card('b2'), 'card-drop')!)
    fireEvent.click(verb(card('b1'), 'card-keep')!)
    act(() => setRowsNow([]))
    expect(document.querySelector('.cn-wk2-empty')).toBeNull()
    expect(slots()).toEqual(['b2', 'b1'])
    expect(document.querySelector('.cn-wk2-g[aria-label="Drafts"] .cn-wk2-h b')!.textContent).toBe('Drafts')
  })

  it('Keep on an Ivan draft QA refused asks the override question first; Cancel leaves the card alone', async () => {
    renderInFrame(<Harness rows={[brain({ id: 'e1', status: 'error', title: 'Refused one' })]} />)
    fireEvent.click(verb(card('e1'), 'card-keep')!)
    await screen.findByText('Approve this draft anyway?')
    expect(screen.getByText(/QA refused this one/)).toBeTruthy()
    expect(strip('e1')).toBeNull()
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByText('Approve this draft anyway?')).toBeNull())
    expect(strip('e1')).toBeNull()
    expect(card('e1')).toBeTruthy()
    fireEvent.click(verb(card('e1'), 'card-keep')!)
    await screen.findByText('Approve this draft anyway?')
    fireEvent.click(document.querySelector('[data-verb="confirm"]')!)
    await waitFor(() => expect(strip('e1')).toBeTruthy())
  })

  it('Drop on an error draft needs no question', () => {
    renderInFrame(<Harness rows={[brain({ id: 'e1', status: 'error' })]} />)
    fireEvent.click(verb(card('e1'), 'card-drop')!)
    expect(document.querySelector('.d-confirm')).toBeNull()
    expect(strip('e1')).toBeTruthy()
  })

  it('a tap made elsewhere in the session shows its strip in the card place', () => {
    renderInFrame(<Harness />)
    act(() => { judge('b2', 'keep', { lane: 'ivan', title: 'Brain two' }) })
    expect(strip('b2')).toBeTruthy()
    expect(card('b2')).toBeNull()
  })
})
