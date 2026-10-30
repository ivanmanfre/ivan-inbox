// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDHash } from '../route'
import { renderInFrame } from '../test-utils'

// A controllable fake of the three reads and the row writes the Intel page makes.
type Res = { data?: unknown; error: { message: string } | null }
const h = vi.hoisted(() => ({
  keeps: [] as unknown[],
  drops: [] as unknown[],
  sources: [] as unknown[],
  updates: [] as { table: string; patch: Record<string, unknown>; settle: (r: Res) => void }[],
  readGate: null as null | Promise<void>,
}))

vi.mock('../../lib/supabase', () => {
  const read = (rows: () => unknown[]) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'or', 'eq', 'gte', 'order']) q[m] = () => q
    q.limit = () => (h.readGate ?? Promise.resolve()).then(() => ({ data: rows(), error: null }))
    return q
  }
  return {
    supabase: {
      from: (table: string) => ({
        select: () => {
          if (table === 'intel_sources') return (h.readGate ?? Promise.resolve()).then(() => ({ data: h.sources, error: null }))
          let isDrop = false
          const q = read(() => (isDrop ? h.drops : h.keeps))
          q.eq = (_c: string, v: string) => { if (v === 'drop') isDrop = true; return q }
          return q
        },
        update: (patch: Record<string, unknown>) => ({
          eq: () => new Promise<Res>(settle => h.updates.push({ table, patch, settle })),
        }),
      }),
    },
  }
})

const { default: IntelPage } = await import('./index')

const recent = new Date(Date.now() - 2 * 86400000).toISOString()
const keep = { id: 'k1', source_id: 'yt:a', source_name: 'Hamel', url: 'https://www.youtube.com/watch?v=x', title: 'T', published_at: recent, duration_sec: 600, found_via: 'source', verdict: 'keep', score: 50, headline: 'Flip-rate check', what_new: 'w', applies_to: 'LLM judges', try_this: 't', watch_from_sec: 60, drop_reason: null, ivan_verdict: null, created_at: recent }

function page() {
  return renderInFrame(<IntelPage layout="desktop" route={parseDHash('#exp/d/intel')} navigate={() => {}} />, { hash: '#exp/d/intel' })
}

afterEach(() => cleanup())
beforeEach(() => {
  h.keeps = [{ ...keep }]
  h.drops = []
  h.sources = []
  h.updates = []
  h.readGate = null
})

describe('Intel page writes', () => {
  it('two failed taps restore what the server last accepted (unrated)', async () => {
    page()
    const useful = await screen.findByRole('button', { name: 'Useful' })
    fireEvent.click(useful)               // -> useful (in flight)
    fireEvent.click(useful)               // -> null (queued behind it)
    await waitFor(() => expect(h.updates.length).toBe(1))
    await act(async () => { h.updates[0].settle({ error: { message: 'boom' } }) })
    await waitFor(() => expect(h.updates.length).toBe(2))
    await act(async () => { h.updates[1].settle({ error: { message: 'boom' } }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Useful' }).getAttribute('aria-pressed')).toBe('false'))
  })

  it('a refresh that read before a tap does not revert the tap', async () => {
    page()
    const useful = await screen.findByRole('button', { name: 'Useful' })
    let open!: () => void
    h.readGate = new Promise<void>(r => { open = r })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })   // refresh starts, reads unrated
    fireEvent.click(useful)
    await waitFor(() => expect(h.updates.length).toBe(1))
    await act(async () => { h.updates[0].settle({ error: null }) })
    await act(async () => { open() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Useful' }).getAttribute('aria-pressed')).toBe('true'))
  })

  it('offers the rescue only while the video can still reach For you', async () => {
    const old = new Date(Date.now() - 25 * 86400000).toISOString()
    h.keeps = []
    h.drops = [
      { ...keep, id: 'd1', verdict: 'drop', headline: null, title: 'Fresh drop', drop_reason: 'basic' },
      { ...keep, id: 'd2', verdict: 'drop', headline: null, title: 'Old drop', drop_reason: 'basic', published_at: old },
    ]
    renderInFrame(<IntelPage layout="desktop" route={parseDHash('#exp/d/intel?tab=dropped')} navigate={() => {}} />)
    await screen.findByText('Fresh drop')
    expect(screen.getAllByRole('button', { name: 'Useful after all' })).toHaveLength(1)
  })

  it('a failed Undo after a refresh keeps what the server holds (Noise)', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Noise' }))
    await waitFor(() => expect(h.updates.length).toBe(1))
    await act(async () => { h.updates[0].settle({ error: null }) })
    h.keeps = [{ ...keep, ivan_verdict: 'noise' }]
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })   // clean refresh: server says noise
    await waitFor(() => expect(screen.queryByText('Flip-rate check')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(h.updates.length).toBe(2))
    await act(async () => { h.updates[1].settle({ error: { message: 'boom' } }) })
    await waitFor(() => expect(screen.queryByText('Flip-rate check')).toBeNull())
  })
})
