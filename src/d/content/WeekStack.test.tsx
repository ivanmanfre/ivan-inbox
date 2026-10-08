// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { renderInFrame } from '../test-utils'
import type { ContentDraft } from '../../lib/content'

const lib = vi.hoisted(() => ({ approveDraft: vi.fn(), skipDraft: vi.fn(), setBoardVisible: vi.fn(), setScheduleDateAt: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...lib }))
const sa = vi.hoisted(() => ({ scheduleGuarded: vi.fn() }))
vi.mock('./writes', () => sa)

import { WeekStack } from './WeekStack'
import { buildNow, buildWeek, type Show } from './weekModel'
import { flushDecisions, resetDecisionsForTest, usePendingDecisions } from './decisions'
import type { WeekRead } from './useWeek'

const NOW = Date.parse('2026-09-29T10:00:00Z')
const H = 3_600_000
const at = (ms: number) => new Date(NOW + ms).toISOString()
const row = (o: Partial<ContentDraft>): ContentDraft => ({
  id: 'x', client_id: null, status: 'review', type: 'text', title: 'A post', topic: null, post_body: 'Body.',
  scheduled_at: null, published_at: null, source_post_id: null, image_urls: null, taxonomy: null,
  created_at: at(-H), updated_at: at(-H), board_visible: null, ...o,
} as ContentDraft)

const ROWS = [
  row({ id: 'i1', title: 'First Ivan draft', created_at: at(-H) }),
  row({ id: 'i2', title: 'Second Ivan draft', created_at: at(-2 * H) }),
  row({ id: 'r1', client_id: 'risedtc', title: 'Rise draft', created_at: at(-3 * H) }),
  row({ id: 'a1', client_id: 'arch', title: 'Arch post', scheduled_at: at(26 * H), board_visible: true, image_urls: ['https://x/a.jpg'] }),
  row({ id: 'long', title: 'Long one', created_at: at(-4 * H), post_body: 'Hook line here.\nSecond line.\nThird line.\nFourth line below the fold.' }),
]
const read: WeekRead = { rows: ROWS, source: 'live', at: at(0), loading: false, error: null, capped: null, settled: true, refresh: vi.fn() }

function Harness({ onOpen = vi.fn(), onChanged = vi.fn(), rows = ROWS }: { onOpen?: (id: string, l: string) => void; onChanged?: () => void; rows?: ContentDraft[] }) {
  const pending = usePendingDecisions()
  const [show, setShow] = useState<Show>('all')
  const week = buildWeek(rows, { now: NOW, show, pending })
  return <WeekStack week={week} read={{ ...read, rows }} show={show} setShow={setShow} now={NOW} openId={null} onOpen={onOpen}
    onChanged={onChanged} firstDay="2026-09-28" seatRows={() => rows} />
}

const card = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement | null
const key = (id: string) => card(id)?.querySelector('.cn-wc-key') as HTMLButtonElement | null

beforeEach(() => { Object.values(lib).forEach(f => f.mockReset()); sa.scheduleGuarded.mockReset(); resetDecisionsForTest() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('This week stack', () => {
  it('draws the day, then review, with the seat chips counting per seat', () => {
    renderInFrame(<Harness />)
    const heads = [...document.querySelectorAll('.cn-wk2-h b')].map(b => b.textContent)
    expect(heads).toEqual(['Tomorrow', 'In review'])
    expect(document.querySelector('[data-verb="show-ivan"]')!.textContent).toBe('Ivan3')
  })

  it('Approve is one tap: the card leaves, the next key takes focus, Undo brings it back and nothing is written', async () => {
    renderInFrame(<Harness />)
    fireEvent.click(key('i1')!)
    expect(document.querySelector('.d-confirm')).toBeNull()
    await waitFor(() => expect(card('i1')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(key('i2')))
    fireEvent.click(await screen.findByText('Undo'))
    await waitFor(() => expect(card('i1')).toBeTruthy())
    await flushDecisions()
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })

  it('an approve left alone is written by today’s approveDraft', async () => {
    lib.approveDraft.mockResolvedValue(undefined)
    const onChanged = vi.fn()
    renderInFrame(<Harness onChanged={onChanged} />)
    fireEvent.click(key('i2')!)
    await flushDecisions()
    expect(lib.approveDraft).toHaveBeenCalledWith('i2')
    expect(onChanged).toHaveBeenCalled()
  })

  it('Put on board asks first (it reaches Mattan), then writes, with Undo on the receipt', async () => {
    lib.setBoardVisible.mockResolvedValue(undefined)
    renderInFrame(<Harness />)
    expect(key('r1')!.textContent).toBe('Put on board')
    fireEvent.click(key('r1')!)
    await screen.findByText('Put this on Mattan’s board?')
    expect(lib.setBoardVisible).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-verb="confirm"]')!)
    await waitFor(() => expect(lib.setBoardVisible).toHaveBeenCalledWith('r1', true))
    fireEvent.click(await screen.findByText('Undo'))
    await waitFor(() => expect(lib.setBoardVisible).toHaveBeenLastCalledWith('r1', false))
  })

  it('an Arch card has a date control like the other lanes (2026-10-08)', () => {
    renderInFrame(<Harness />)
    expect(card('a1')!.querySelector('[data-verb="card-date"]')).toBeTruthy()
    expect(card('a1')!.textContent).not.toContain('View only')
  })

  it('the date control opens today’s move sheet and writes the day only (operator_set_schedule_date)', async () => {
    lib.setScheduleDateAt.mockResolvedValue('2026-10-02T07:00:00Z')
    renderInFrame(<Harness />)
    fireEvent.click(card('i1')!.querySelector('[data-verb="card-date"]')!)
    expect(await screen.findByText('Give it a date')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('option').find(o => o.textContent?.startsWith('Fri'))!)
    fireEvent.click(document.querySelector('[data-verb="move-day"]')!)
    await waitFor(() => expect(lib.setScheduleDateAt).toHaveBeenCalledTimes(1))
    expect(lib.setScheduleDateAt.mock.calls[0][0]).toBe('i1')
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })

  it('the Arch chip says Arch posts wait for Davorin’s approval', () => {
    renderInFrame(<Harness />)
    fireEvent.click(document.querySelector('[data-verb="show-arch"]')!)
    expect(screen.getByText(/only after Davorin approves them on his panel/)).toBeTruthy()
    expect(card('i1')).toBeNull()
    expect(card('a1')).toBeTruthy()
  })

  it('…see more opens the rest of the post in place, without opening it', () => {
    const onOpen = vi.fn()
    renderInFrame(<Harness onOpen={onOpen} />)
    expect(card('long')!.textContent).not.toContain('Fourth line')
    fireEvent.click(card('long')!.querySelector('[data-verb="see-more"]')!)
    expect(card('long')!.textContent).toContain('Fourth line')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a saved copy says so while it refreshes', () => {
    renderInFrame(<WeekStack week={buildWeek(ROWS, { now: NOW })} read={{ ...read, source: 'cache', at: '2026-09-29T08:14:00Z', settled: false }}
      show="all" setShow={vi.fn()} now={NOW} openId={null} onOpen={vi.fn()} onChanged={vi.fn()} firstDay="2026-09-28" seatRows={() => []} />)
    expect(screen.getByText(/Saved copy 10:14/).textContent).toContain('refreshing')
  })
})

// Now must not split the same decision stack into competing categories.
it('Now is one actionable stack with quiet missing-image tags, no QA score, and one-tap fix/open', () => {
  const rows = [row({ id: 'bad', status: 'error', title: 'Broken post' }), row({ id: 'pic', type: 'single_image', qa_score: '95', qa_verdict: 'pass' })]
  const onOpen = vi.fn()
  renderInFrame(<WeekStack week={buildWeek(rows, { now: NOW })} read={{ ...read, rows }} show="all" setShow={vi.fn()} now={NOW} openId={null} onOpen={onOpen} onChanged={vi.fn()} firstDay="2026-09-28" seatRows={() => rows} nowView />)
  expect(screen.queryByRole('tablist', { name: 'Filter the stack' })).toBeNull()
  expect(screen.queryByText(/QA 95/)).toBeNull()
  expect(screen.getByText('No image')).toBeTruthy()
  expect(document.querySelector('[data-verb="show-ivan"]')!.textContent).toBe('Ivan')
})

it('a Now day picker commits the chosen day directly, with no third Save tap', async () => {
  lib.setScheduleDateAt.mockResolvedValue('2026-10-02T07:00:00Z')
  renderInFrame(<WeekStack week={buildNow(ROWS, { now: NOW })} read={read} show="all" setShow={vi.fn()} now={NOW} openId={null} onOpen={vi.fn()} onChanged={vi.fn()} firstDay="2026-09-28" seatRows={() => ROWS} nowView />)
  fireEvent.click(card('i1')!.querySelector('[data-verb="card-date"]')!)
  fireEvent.click(screen.getAllByRole('option').find(o => o.textContent?.startsWith('Fri'))!)
  await waitFor(() => expect(lib.setScheduleDateAt).toHaveBeenCalledTimes(1))
  expect(lib.setScheduleDateAt.mock.calls[0][0]).toBe('i1')
  expect(sa.scheduleGuarded).not.toHaveBeenCalled()
})

it.each(['ivan', 'risedtc'] as const)('a red %s Now card Fix opens its guarded pipeline confirmation and Open opens the draft, with ARCH view only', async lane => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const rows = [row({ id: 'bad', client_id: lane === 'ivan' ? null : lane, status: 'error', title: 'Broken post' }), row({ id: 'abad', client_id: 'arch', status: 'error', title: 'Broken Arch post' })]
  const onOpen = vi.fn()
  renderInFrame(<WeekStack week={buildNow(rows, { now: NOW })} read={{ ...read, rows }} show="all" setShow={vi.fn()} now={NOW} openId={null} onOpen={onOpen} onChanged={vi.fn()} firstDay="2026-09-28" seatRows={() => rows} nowView />)
  expect(card('abad')!.querySelectorAll('.cn-wc-acts button')).toHaveLength(1)
  fireEvent.click(card('bad')!.querySelector('[data-verb="card-open"].cn-wc-key')!)
  expect(onOpen).toHaveBeenCalledWith('bad', lane)
  fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
  expect(await screen.findByText(/Run the pipeline again for this/)).toBeTruthy()
  expect(lib.approveDraft).not.toHaveBeenCalled()
})

it('shows a failed QA verdict before a review decision', () => {
  const rows = [row({ id: 'qa-warn', title: 'Check this one', qa_verdict: 'FAIL', qa_score: '38' })]
  renderInFrame(<WeekStack week={buildNow(rows, { now: NOW })} read={{ ...read, rows }} show="all" setShow={vi.fn()} now={NOW} openId={null} onOpen={vi.fn()} onChanged={vi.fn()} firstDay="2026-09-28" seatRows={() => rows} nowView />)
  expect(screen.getByText('QA fail 38')).toBeTruthy()
})
