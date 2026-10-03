// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'

const store = vi.hoisted(() => ({ undoVerdict: vi.fn(), giveReason: vi.fn(), retryVerdict: vi.fn(), forgetVerdict: vi.fn() }))
vi.mock('./verdictStore', async orig => ({ ...(await orig<typeof import('./verdictStore')>()), ...store }))
const lib = vi.hoisted(() => ({ readVerdicts: vi.fn() }))
vi.mock('../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../lib/verdicts')>()), ...lib }))

import { VerdictStrip } from './VerdictStrip'
import { useVerdicts } from './useVerdicts'
import type { Judged } from './verdictStore'

const entry = (o: Partial<Judged> = {}): Judged => ({
  id: 'd1', verdict: 'drop', lane: 'ivan', title: 'Poland is probably the last country I would have expected', phase: 'held', reasons: [], note: null,
  reasonSaving: false, error: null, saved: null, collapsed: false, invocation: 'inv', at: Date.now(), ...o,
})
const savedRow = {
  verdict_id: 'v1', draft_id: 'd1', client_id: 'ivan' as const, verdict: 'keep' as const, reasons: [], note: null, how_made: 'brain' as const,
  draft_action: 'approved' as const, source: 'app' as const, decided_at: '2026-10-03T10:00:00Z', updated_at: null,
}
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null
const chips = () => [...document.querySelectorAll<HTMLButtonElement>('[data-verb="verdict-reason"]')]

beforeEach(() => { Object.values(store).forEach(f => f.mockReset()); lib.readVerdicts.mockReset() })
afterEach(() => cleanup())

describe('VerdictStrip', () => {
  it('names the verdict in plain words: Approved on Ivan, Approved · board unchanged on Rise and Arch, Dropped', () => {
    const word = (verdict: 'keep' | 'drop', lane: 'ivan' | 'risedtc' | 'arch') => {
      const { unmount } = render(<VerdictStrip e={entry({ verdict, lane })} />)
      const t = q('.cn-vs-what')!.textContent
      unmount()
      return t
    }
    expect([word('keep', 'ivan'), word('keep', 'risedtc'), word('keep', 'arch'), word('drop', 'ivan')]).toEqual(['Approved', 'Approved · board unchanged', 'Approved · board unchanged', 'Dropped'])
  })

  it('says "Approved after your edit" when the saved row says edited, on any lane', () => {
    for (const lane of ['ivan', 'risedtc'] as const) {
      const { unmount } = render(<VerdictStrip e={entry({ verdict: 'keep', lane, phase: 'saved', saved: { ...savedRow, verdict: 'edited', client_id: lane } })} />)
      expect(q('.cn-vs-what')!.textContent).toBe('Approved after your edit')
      unmount()
    }
  })

  it('held: the word, the title, Undo with its draining bar; Undo calls the store', () => {
    render(<VerdictStrip e={entry({ verdict: 'keep' })} />)
    expect(q('.cn-vs-what')!.textContent).toBe('Approved')
    expect(q('.cn-vs-what')!.classList.contains('cn-vs-keep')).toBe(true)
    expect(q('.cn-vs-ttl')!.textContent).toContain('Poland')
    const undo = q('[data-verb="verdict-undo"]')!
    expect(undo.textContent).toBe('Undo')
    expect(undo.querySelector('.cn-vs-drain')).toBeTruthy()
    expect((undo.querySelector('.cn-vs-drain') as HTMLElement).style.animationDuration).toBe('5000ms')
    fireEvent.click(undo)
    expect(store.undoVerdict).toHaveBeenCalledWith('d1')
  })

  it('Drop asks "Why? One tap" with seven reasons and Skip last; Approve is the line only, no chips', () => {
    const { rerender } = render(<VerdictStrip e={entry()} />)
    expect(screen.getByText('Why? One tap')).toBeTruthy()
    expect(chips().map(c => c.textContent)).toEqual(['Invented a fact', 'Not my voice', 'Generic', 'Wrong topic', 'Too long', 'Said it already', 'Other', 'Skip'])
    expect(chips().at(-1)!.dataset.reason).toBe('skip')
    expect(q('.cn-vs-what')!.classList.contains('cn-vs-keep')).toBe(false)
    rerender(<VerdictStrip e={entry({ verdict: 'keep' })} />)
    expect(chips()).toHaveLength(0)
    expect(q('.cn-vs-why')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Why keep it|Why\?/)
    rerender(<VerdictStrip e={entry({ verdict: 'keep', phase: 'saved' })} />)
    expect(chips()).toHaveLength(0)
  })

  it('Skip calls giveReason with skip', () => {
    render(<VerdictStrip e={entry()} />)
    fireEvent.click(chips().find(c => c.dataset.reason === 'skip')!)
    expect(store.giveReason).toHaveBeenCalledWith('d1', 'skip')
    expect(q('input')).toBeNull()
  })

  it('a chip calls giveReason with its slug and shows pressed once chosen', () => {
    const { rerender } = render(<VerdictStrip e={entry()} />)
    fireEvent.click(chips().find(c => c.dataset.reason === 'generic')!)
    expect(store.giveReason).toHaveBeenCalledWith('d1', 'generic')
    rerender(<VerdictStrip e={entry({ reasons: ['generic'] })} />)
    expect(chips().filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.dataset.reason)).toEqual(['generic'])
  })

  it('Other reveals a 500-character note box; Save sends the note', () => {
    render(<VerdictStrip e={entry()} />)
    expect(q('input')).toBeNull()
    fireEvent.click(chips().find(c => c.dataset.reason === 'other')!)
    expect(store.giveReason).not.toHaveBeenCalled()
    const input = q('input') as HTMLInputElement
    expect(input.maxLength).toBe(500)
    expect(input.placeholder).toBe('What was it?')
    fireEvent.change(input, { target: { value: 'Too salesy' } })
    fireEvent.click(q('[data-verb="verdict-note-save"]')!)
    expect(store.giveReason).toHaveBeenCalledWith('d1', 'other', 'Too salesy')
  })

  it('saving and saved say so; saved has a Close that puts the strip away', () => {
    const { rerender } = render(<VerdictStrip e={entry({ phase: 'saving' })} />)
    expect(screen.getByText('Saving…')).toBeTruthy()
    expect(q('[data-verb="verdict-undo"]')).toBeNull()
    rerender(<VerdictStrip e={entry({ phase: 'saved' })} />)
    expect(screen.getByText('Saved')).toBeTruthy()
    const x = q('[data-verb="verdict-close"]')!
    expect(x.getAttribute('aria-label')).toBe('Close')
    fireEvent.click(x)
    expect(store.forgetVerdict).toHaveBeenCalledWith('d1')
  })

  it('failed: the error in an alert, Try again and Keep the card, no reasons', () => {
    render(<VerdictStrip e={entry({ phase: 'failed', error: 'Network down' })} />)
    expect(screen.getByRole('alert').textContent).toBe('Network down')
    expect(chips()).toHaveLength(0)
    fireEvent.click(q('[data-verb="verdict-retry"]')!)
    expect(store.retryVerdict).toHaveBeenCalledWith('d1')
    fireEvent.click(q('[data-verb="verdict-forget"]')!)
    expect(store.forgetVerdict).toHaveBeenCalledWith('d1')
    expect(q('[data-verb="verdict-forget"]')!.textContent).toBe('Keep the card')
  })

  it('a reason that did not save is a muted alert with Try again for the same reason', () => {
    render(<VerdictStrip e={entry({ phase: 'saved', reasons: ['too_long'], note: 'n', error: 'The reason was not saved: Timeout' })} />)
    expect(screen.getByRole('alert').textContent).toContain('The reason was not saved')
    fireEvent.click(q('[data-verb="verdict-reason-retry"]')!)
    expect(store.giveReason).toHaveBeenCalledWith('d1', 'too_long', 'n')
  })

  it('no copy has an em dash or en dash', () => {
    render(<VerdictStrip e={entry({ phase: 'saved' })} />)
    expect(q('.cn-vs')!.textContent).not.toMatch(/[—–]/)
  })
})

describe('useVerdicts', () => {
  const v = (id: string, verdict: 'keep' | 'edited' | 'drop') => ({ verdict_id: `v-${id}`, draft_id: id, client_id: 'ivan', verdict, reasons: [], note: null, how_made: 'brain', draft_action: 'deleted', source: 'app', decided_at: '', updated_at: null })

  it('reads the last 45 days on mount and maps by draft id', async () => {
    lib.readVerdicts.mockResolvedValue([v('a', 'drop'), v('b', 'keep')])
    const { result } = renderHook(() => useVerdicts())
    await act(async () => {})
    expect(result.current.loaded).toBe(true)
    expect([...result.current.map].map(([id, x]) => [id, x.verdict])).toEqual([['a', 'drop'], ['b', 'keep']])
    const since = Date.parse(lib.readVerdicts.mock.calls[0][0])
    expect(Math.round((Date.now() - since) / 86_400_000)).toBe(45)
  })

  it('re-reads on wb-rows-changed, debounced 400 ms, and on focus', async () => {
    vi.useFakeTimers()
    try {
      lib.readVerdicts.mockResolvedValue([])
      renderHook(() => useVerdicts())
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(lib.readVerdicts).toHaveBeenCalledTimes(1)
      act(() => { window.dispatchEvent(new Event('wb-rows-changed')); window.dispatchEvent(new Event('wb-rows-changed')) })
      await act(async () => { await vi.advanceTimersByTimeAsync(399) })
      expect(lib.readVerdicts).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(lib.readVerdicts).toHaveBeenCalledTimes(2)
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(lib.readVerdicts).toHaveBeenCalledTimes(3)
    } finally { vi.useRealTimers() }
  })

  it('a failed read keeps the last good map and says why', async () => {
    lib.readVerdicts.mockResolvedValueOnce([v('a', 'drop')])
    const { result } = renderHook(() => useVerdicts())
    await act(async () => {})
    lib.readVerdicts.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(result.current.error).toBe('offline')
    expect(result.current.loaded).toBe(true)
    expect(result.current.map.get('a')?.verdict).toBe('drop')
  })
})
