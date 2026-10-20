// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { ColumnBody, type ColumnProps } from './Column'
import { seatView } from './model'
import type { OwnerEngagerCard } from './ownerEngagers'
import { dismissOwnerEngager } from './ownerEngagers'

vi.mock('./ownerEngagers', async orig => ({ ...(await orig<typeof import('./ownerEngagers')>()), dismissOwnerEngager: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const owner: OwnerEngagerCard = { tenant: 'risedtc', profile_id: 'owner-id', name: 'New owner', headline: 'Founder at Example', linkedin_url: 'https://www.linkedin.com/in/new-owner', icp_score: 9, why: 'Owns a skincare brand', n_engagements: 1, last_signal_at: '2026-10-20T09:00:00Z', signals: [{ kind: 'reaction', at: '2026-10-20T09:00:00Z', detail: null, post_title: 'A specific post', post_url: 'https://www.linkedin.com/posts/example' }] }
function mount(seat = 'risedtc', v4 = true, failed = false) {
  const drop = vi.fn(), fail = vi.fn()
  const p = { seat, mode: 'conversations', view: seatView([], seat as 'risedtc'), matches: [], byId: new Map(),
    c: { selected: null, checked: new Set(), open: vi.fn(), now: Date.now(), verbs: {}, busy: null, setBusy: vi.fn(), fail, pre: { get: () => ({ s: 'none' }) }, more: vi.fn(), v4 },
    cameBack: { rows: [], loaded: true, failed: false }, warm: { rows: [], loaded: true, failed: false }, agent: { cards: [], loaded: true, failed: false, note: null },
    ownerEngagers: { rows: [owner], loaded: true, failed }, dropOwnerEngager: drop,
    dated: [], upcoming: { rows: [], loaded: true, failed: false }, stale: [], scanDays: new Map(), toEmail: vi.fn(),
  } as unknown as ColumnProps
  renderInFrame(<ColumnBody {...p} />)
  return { drop, fail }
}
it.each([false, true])('shows the owner and the actual post with profile and dismiss actions (v4=%s)', v4 => {
  mount('risedtc', v4)
  expect(screen.getByText('New owner')).toBeTruthy()
  expect(screen.getByText(/A specific post/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open profile' }).getAttribute('href')).toBe(owner.linkedin_url)
  expect(document.querySelector('[data-d-row="owner-id"]')).toBeNull()
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
})
it('keeps an owner on its own seat', () => { mount('arch'); expect(screen.queryByText('New owner')).toBeNull() })
it('keeps the row and reports failure when dismiss fails', async () => {
  vi.mocked(dismissOwnerEngager).mockRejectedValueOnce(new Error('offline'))
  const { drop, fail } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => expect(fail).toHaveBeenCalled())
  expect(drop).not.toHaveBeenCalled()
  expect(screen.getByText('New owner')).toBeTruthy()
})
it('removes the row after the dismiss is saved', async () => {
  vi.mocked(dismissOwnerEngager).mockResolvedValueOnce(true)
  const { drop } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => expect(drop).toHaveBeenCalledWith(owner))
})
it('reports a failed owner read beside the other signals', () => { mount('risedtc', true, true); expect(screen.getByText('Could not read new post engagers.')).toBeTruthy() })
