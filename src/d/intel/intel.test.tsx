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
const keep = { id: 'k1', source_id: 'yt:a', source_name: 'Hamel', url: 'https://www.youtube.com/watch?v=x', title: 'T', published_at: recent, duration_sec: 600, found_via: 'source', verdict: 'keep', score: 50, headline: 'Flip-rate check', what_new: 'w', applies_to: 'LLM judges', try_this: 't', watch_from_sec: 60, drop_reason: null, ivan_verdict: null, ivan_seen_at: null, created_at: recent }

function page(hash = '#exp/d/intel') {
  return renderInFrame(<IntelPage layout="desktop" route={parseDHash(hash)} navigate={() => {}} />, { hash })
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
    h.keeps = [{ ...keep, ivan_seen_at: recent }]
    page('#exp/d/intel?tab=seen')
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
    h.keeps = [{ ...keep, ivan_seen_at: recent }]
    page('#exp/d/intel?tab=seen')
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
      { ...keep, id: 'd2', verdict: 'drop', headline: null, title: 'Old drop', drop_reason: 'basic', published_at: old, created_at: old },
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
  it('Done takes a card out of For you, into Seen, and the write stamps it', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('Flip-rate check')).toBeNull())
    await waitFor(() => expect(h.updates.length).toBe(1))
    expect(h.updates[0].patch.ivan_seen_at).toEqual(expect.any(String))
    expect(h.updates[0].patch.ivan_verdict).toBeNull()
    await act(async () => { h.updates[0].settle({ error: null }) })
    cleanup()
    h.keeps = [{ ...keep, ivan_seen_at: recent }]
    page('#exp/d/intel?tab=seen')
    expect(await screen.findByText('Flip-rate check')).toBeTruthy()
  })

  it('Useful from For you saves the verdict and marks the card seen in one write', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Useful' }))
    await waitFor(() => expect(h.updates.length).toBe(1))
    expect(h.updates[0].patch).toMatchObject({ ivan_verdict: 'useful', ivan_seen_at: expect.any(String) })
    await waitFor(() => expect(screen.queryByText('Flip-rate check')).toBeNull())
  })

  it('shows no "from mm:ss" chip when kind is not youtube', async () => {
    h.keeps = [{ ...keep, kind: 'github', url: 'https://github.com/a/b', watch_from_sec: 60, duration_sec: null, meta: { stars: 143 } }]
    const { container } = page()
    await screen.findByText('Flip-rate check')
    expect(container.textContent).not.toMatch(/from \d/)
  })

  it('renders a text tile with no thumbnail box for github, blog, reddit, kyle', async () => {
    const mk = (id: string, kind: string, meta: unknown, extra = {}) => ({ ...keep, id, kind, meta, title: 'Title ' + kind, headline: 'Line ' + kind, url: 'https://example.com/' + id, duration_sec: null, watch_from_sec: null, ...extra })
    h.keeps = [mk('g', 'github', { stars: 143 }), mk('b', 'blog', { chars: 9900 }), mk('r', 'reddit', { comments: 27 }), mk('c', 'kyle', { minutes: 50 })]
    const { container } = page()
    await screen.findByText('Line github')
    expect(container.querySelectorAll('.it-tile')).toHaveLength(4)
    expect(container.querySelector('.it-thumb')).toBeNull()
    expect(container.querySelector('.it-nothumb')).toBeNull()
    for (const t of ['GitHub', 'Blog', 'Reddit', 'Kyle call']) expect(screen.getAllByText(t).length).toBeGreaterThan(0)
    expect(screen.getByText('\u2605 143')).toBeTruthy()
    expect(screen.getByText('~9 min read')).toBeTruthy()
    expect(screen.getByText('27 comments')).toBeTruthy()
    expect(container.textContent).not.toMatch(/undefined|NaN/)
    // the Why fold and buttons are the same
    expect(screen.getAllByRole('button', { name: /Why/ })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: 'Done' })).toHaveLength(4)
  })

  it('labels the open link by kind', async () => {
    h.keeps = [{ ...keep, id: 'g', kind: 'github', title: 'Repo', url: 'https://github.com/a/b', headline: 'H', duration_sec: null }]
    page()
    const a = await screen.findByRole('link', { name: 'Open on GitHub' })
    expect(a.getAttribute('href')).toBe('https://github.com/a/b')
  })

  it('an unknown kind renders as a text tile labelled by the kind', async () => {
    h.keeps = [{ ...keep, id: 'x', kind: 'newsletter', url: 'https://example.com/x', duration_sec: null }]
    const { container } = page()
    await screen.findByText('newsletter')
    expect(container.querySelector('.it-thumb')).toBeNull()
  })

  it('a row with kind missing renders as youtube', async () => {
    const { container } = page()
    await screen.findByText('Flip-rate check')
    expect(container.querySelector('.it-thumb')).not.toBeNull()
    expect(container.textContent).toMatch(/from 1:00/)
  })

  it('Sources tab shows the kind of each source', async () => {
    h.sources = [
      { id: 's1', name: 'Hamel', url: 'https://youtube.com/@h', topic: null, status: 'core', added_by: 'ivan', note: null, items_judged: 3, items_kept: 1, last_kept_at: null, kind: 'youtube' },
      { id: 's2', name: 'ai-repos', url: 'https://github.com', topic: null, status: 'core', added_by: 'ivan', note: null, items_judged: 3, items_kept: 1, last_kept_at: null, kind: 'github' },
      { id: 's3', name: 'Old', url: 'https://x.com', topic: null, status: 'core', added_by: 'ivan', note: null, items_judged: 0, items_kept: 0, last_kept_at: null },
    ]
    page('#exp/d/intel?tab=sources')
    await screen.findByText('ai-repos')
    expect(screen.getByRole('button', { name: /Sources/ })).toBeTruthy()
    expect(screen.getAllByText('GitHub')).toHaveLength(1)
    expect(screen.getAllByText('YouTube')).toHaveLength(2)   // explicit youtube + missing kind
  })
})
