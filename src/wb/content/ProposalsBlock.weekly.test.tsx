// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Proposal } from '../../lib/proposals'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { ProposalsList } from './ProposalsBlock'

const old: Proposal = {
  id: 'old', client_id: 'ivan', kind: 'audn_recommendation', body: null,
  created_at: '2026-09-01T00:00:00Z', context: { audn: { title: 'Earlier idea', could_publish: 'A useful example.' } },
}
const fresh: Proposal = {
  ...old, id: 'fresh', context: { audn: { title: 'Upcoming idea', weekly: { week_start: '2026-09-21', slot: 'experiment', rank: 1 } } },
}

describe('weekly shortlist actions', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })
  const button = (scope: Element, label: string) => [...scope.querySelectorAll('button')].find(b => b.textContent === label)!
  const click = async (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

  it('keeps legacy evidence readable without exposing a second decision queue in archive mode', async () => {
    const approve = vi.fn(), drop = vi.fn()
    await act(async () => root.render(<ProposalsList rows={[old, fresh]} onApprove={approve} onDrop={drop} readOnly />))
    expect(host.textContent).toContain('Upcoming idea')
    expect(host.textContent).toContain('Earlier idea')
    for (const label of ['Send to ideas', 'Edit', 'Delete', 'Pass on this']) expect(button(host, label)).toBeUndefined()
    expect(approve).not.toHaveBeenCalled(); expect(drop).not.toHaveBeenCalled()
  })

  it('keeps an older edited row and dirty guard alive while its fold closes, then approves only changed fields', async () => {
    const dirty = vi.fn()
    const approve = vi.fn().mockResolvedValue({ text: 'In the idea bank.', already: false })
    await act(async () => root.render(<ProposalsList rows={[old, fresh]} onApprove={approve} onDrop={vi.fn()} onDirtyChange={dirty} />))
    const fold = host.querySelector<HTMLDetailsElement>('.a-prop-older')!
    expect(fold.open).toBe(false)
    fold.open = true
    await click(button(fold, 'Edit'))
    const title = fold.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(title, 'Revised earlier idea')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(dirty).toHaveBeenLastCalledWith(true)
    fold.open = false
    expect(fold.querySelector('textarea')).toBe(title)
    expect(title.value).toBe('Revised earlier idea')
    expect(dirty).toHaveBeenLastCalledWith(true)
    fold.open = true
    await click(button(fold, 'Send to ideas'))
    expect(approve).toHaveBeenCalledWith(old, { title: 'Revised earlier idea' })
    expect(fold.textContent).toContain('In the idea bank.')
    expect(dirty).toHaveBeenLastCalledWith(false)
    expect(host.querySelector('.a-prop-week')?.textContent).toContain('Upcoming idea')
  })

  it('requires and retains a pass reason, leaving the row visible on failure', async () => {
    const pass = vi.fn().mockRejectedValue(new Error('Decision could not be saved'))
    await act(async () => root.render(<ProposalsList rows={[fresh]} onApprove={vi.fn()} onDrop={pass} />))
    expect(button(host, 'Delete')).toBeUndefined()
    await click(button(host, 'Pass on this'))
    const reason = host.querySelector('textarea')!
    expect(reason).not.toBeNull()
    expect(button(host, 'Save reason').disabled).toBe(true)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, 'Already covered.')
      reason.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button(host, 'Save reason'))
    expect(pass).toHaveBeenCalledWith(fresh, 'Already covered.')
    expect(host.textContent).toContain('Decision could not be saved')
    expect(reason.value).toBe('Already covered.')
  })

  it('keeps weekly actions available after an approval refusal and lets cancel clear dirty state', async () => {
    const dirty = vi.fn()
    await act(async () => root.render(<ProposalsList rows={[fresh]} onApprove={async () => { throw new Error('Read-only account') }} onDrop={vi.fn()} onDirtyChange={dirty} />))
    await click(button(host, 'Send to ideas'))
    expect(host.textContent).toContain('Read-only account')
    expect(button(host, 'Send to ideas').disabled).toBe(false)
    await click(button(host, 'Edit'))
    await click(button(host, 'Cancel'))
    expect(host.querySelector('textarea')).toBeNull()
    expect(dirty).toHaveBeenLastCalledWith(false)
  })
})
