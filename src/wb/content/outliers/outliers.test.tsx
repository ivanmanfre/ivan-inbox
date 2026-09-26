// @vitest-environment jsdom
//
// OutliersView mounted against a mocked supabase.rpc: the DOM contract the
// acceptance check reads, the filters, Use this -> On the board, and the
// failed state (visible, with a retry), never a silent blank.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: h.rpc } }))
vi.mock('../../../lib/swr', () => ({ readSwr: () => null, writeSwr: () => 'no-user' }))

import OutliersView from './index'
import type { OutlierRow } from '../../../lib/outliers'

const long = Array.from({ length: 12 }, (_, i) => `Line ${i} of a long post body that keeps going.`).join('\n')
function row(over: Partial<OutlierRow>): OutlierRow {
  return {
    platform: 'linkedin', post_id: '100', author: 'Ben Hemingway', text: `Had a call with a lead gen agency\n${long}`,
    url: 'https://www.linkedin.com/posts/ben_activity-100', published_at: '2026-09-22T07:13:52Z', week: '2026-09-21',
    lift: 3.94, baseline: 16, baseline_n: 59, likes: 63, reposts: 0, comments: 33, views: null, labels: null, personal: false,
    traits: [
      { key: 'a', words: 'single image', weight: 0.669 }, { key: 'b', words: 'contains a number', weight: -0.597 },
      { key: 'c', words: 'c', weight: 0.1 }, { key: 'd', words: 'd', weight: 0.1 }, { key: 'e', words: 'e', weight: 0.1 },
      { key: 'f', words: 'f', weight: 0.1 },
    ],
    traits_note: null, buyer: { judged: 20, icp7: 2, share: 0.1, state: 'read' }, idea: null, ...over,
  }
}
const payload = {
  ok: true, client: 'ivan', platform: 'all', week: null,
  studies: { linkedin: { study_id: 's', as_of: '2026-09-24T20:14:00Z', scored: 1931, authors: 31, outliers: 3 }, x: null },
  weeks: [{ week: '2026-09-21', n: 2 }, { week: '2026-09-14', n: 1 }],
  rows: [
    row({}),
    row({ post_id: '200', author: 'Paolo Trivellato', personal: true, buyer: { judged: 3, icp7: 1, share: 0.33, state: 'too_few' }, idea: { id: 'i1', status: 'pending' } }),
    row({ post_id: '300', week: '2026-09-14', published_at: '2026-09-15T00:00:00Z', buyer: null, text: 'Short one' }),
  ],
}

let host: HTMLDivElement
let root: Root
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const $ = (sel: string) => host.querySelector(sel) as HTMLElement | null
const $$ = (sel: string) => [...host.querySelectorAll(sel)] as HTMLElement[]
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click() })

beforeEach(() => {
  h.rpc.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

async function mount(lane = 'ivan') {
  await act(async () => { root.render(<OutliersView lane={lane} />) })
  await flush()
}

describe('OutliersView', () => {
  it('reads operator_outliers once for the lane, platform all, week null', async () => {
    h.rpc.mockResolvedValue({ data: payload, error: null })
    await mount('risedtc')
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('operator_outliers', { p_gate: 'clientops', p_client: 'risedtc', p_platform: 'all', p_week: null })
  })

  it('renders the DOM contract on every card', async () => {
    h.rpc.mockResolvedValue({ data: payload, error: null })
    await mount()
    expect($('[data-outliers-view]')).not.toBeNull()
    const cards = $$('[data-outlier-card]')
    expect(cards).toHaveLength(3)
    for (const c of cards) {
      expect(c.dataset.platform).toBe('linkedin')
      expect(c.dataset.postId).toBeTruthy()
      expect(c.querySelector('[data-author]')?.textContent).toBeTruthy()
      expect(c.querySelector('[data-text]')?.textContent).toBeTruthy()
      expect(c.querySelector('[data-lift]')).not.toBeNull()
      const a = c.querySelector('a[data-post-link]') as HTMLAnchorElement
      expect(a.getAttribute('href')).toMatch(/^https:\/\/www\.linkedin\.com\//)
      expect(a.target).toBe('_blank')
      expect(a.rel).toBe('noopener')
      expect(c.querySelector('[data-use-this]')).not.toBeNull()
    }
  })

  it('shows lift, the median and its n, the personal chip, and too few to read with n', async () => {
    h.rpc.mockResolvedValue({ data: payload, error: null })
    await mount()
    const first = $('[data-post-id="100"]')!
    expect(first.textContent).toContain('3.9x')
    expect(first.textContent).toContain('own median 16')
    expect(first.textContent).toContain('over 59 posts')
    expect(first.textContent).toContain('10% ICP 7+')
    const personal = $('[data-post-id="200"]')!
    expect(personal.textContent).toContain('Personal')
    expect(personal.textContent).toContain('too few to read · n 3')
    expect($('[data-post-id="300"]')!.textContent).toContain('Commenters not read yet')
  })

  it('an idea from the RPC paints as On the board; Use this turns into On the board', async () => {
    h.rpc.mockImplementation(async (fn: string) => fn === 'operator_outliers'
      ? { data: payload, error: null } : { data: { ok: true, created: true, id: 'new-id' }, error: null })
    await mount()
    expect($('[data-post-id="200"] [data-use-this]')!.textContent).toBe('On the board')
    const btn = $('[data-post-id="100"] [data-use-this]')!
    expect(btn.textContent).toBe('Use this')
    await click(btn)
    await flush()
    expect(h.rpc).toHaveBeenCalledWith('operator_outlier_use', { p_gate: 'clientops', p_client: 'ivan', p_platform: 'linkedin', p_post_id: '100' })
    expect($('[data-post-id="100"] [data-use-this]')!.textContent).toBe('On the board')
    expect(($('[data-post-id="100"] [data-use-this]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a failed Use this says so and offers the tap again', async () => {
    h.rpc.mockImplementation(async (fn: string) => fn === 'operator_outliers'
      ? { data: payload, error: null } : { data: null, error: { message: 'nope' } })
    await mount()
    await click($('[data-post-id="100"] [data-use-this]'))
    await flush()
    expect($('[data-post-id="100"] [data-use-this]')!.textContent).toBe('Try again')
    expect($('[data-post-id="100"]')!.textContent).toContain('Did not reach the board')
  })

  it('filters to X and says X arrives with the first weekly run', async () => {
    h.rpc.mockResolvedValue({ data: payload, error: null })
    await mount()
    const x = $$('[aria-label="Platform"] [role="tab"]').find(b => b.textContent?.startsWith('X'))!
    await click(x)
    expect($$('[data-outlier-card]')).toHaveLength(0)
    expect(host.textContent).toContain('X arrives with the first weekly run')
  })

  it('picks a week and shows only it', async () => {
    h.rpc.mockResolvedValue({ data: payload, error: null })
    await mount()
    const wk = $$('.ol-chip-w').find(b => b.textContent?.startsWith('Sep 14'))!
    await click(wk)
    expect($$('[data-outlier-card]').map(c => c.dataset.postId)).toEqual(['300'])
  })

  it('clamps a long body and expands it', async () => {
    h.rpc.mockResolvedValue({ data: payload, error: null })
    await mount()
    const card = $('[data-post-id="100"]')!
    expect(card.querySelector('.ol-body')!.hasAttribute('data-clamped')).toBe(true)
    await click(card.querySelector('.ol-more'))
    expect(card.querySelector('.ol-body')!.hasAttribute('data-clamped')).toBe(false)
    expect(card.querySelectorAll('.ol-traits .ol-t:not(.ol-t-more)')).toHaveLength(6)
  })

  it('a failed read is visible with a retry that reads again', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied for function operator_outliers' } })
    await mount()
    expect($('[role="alert"]')!.textContent).toContain('Outliers did not load')
    expect(host.textContent).toContain('permission denied')
    h.rpc.mockResolvedValueOnce({ data: payload, error: null })
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Try again')!)
    await flush()
    expect($$('[data-outlier-card]')).toHaveLength(3)
  })

  it('shows a loading skeleton before the read lands', async () => {
    h.rpc.mockReturnValue(new Promise(() => {}))
    await act(async () => { root.render(<OutliersView lane="ivan" />) })
    expect($('[aria-busy="true"]')).not.toBeNull()
  })

  it('UI copy carries no em dash and no causal wording', async () => {
    h.rpc.mockResolvedValue({ data: payload, error: null })
    await mount()
    for (const d of $$('details')) d.setAttribute('open', '')
    const copy = [...host.querySelectorAll('[data-outliers-view] *')]
      .filter(el => !el.closest('[data-text]'))
      .map(el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '))
      .join(' ')
    expect(copy).not.toContain('—')
    expect(copy).not.toMatch(/\bcaused?\b|\bdrives?\b|\bgenerates?\b|produced a buyer/i)
  })
})
