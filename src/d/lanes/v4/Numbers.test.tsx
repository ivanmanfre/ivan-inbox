// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BandCtx } from '../bandCells'
import type { CcPayload } from '../../../lib/campaignControl'
import fixture from '../../../lib/cc-fixtures/capacity_reached.json'
import { seatAccept } from '../rates'
import { Numbers } from './Numbers'

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
afterEach(cleanup)
const p = fixture as unknown as CcPayload
const slot = <T,>(value: T) => ({ value, failed: null })

// Ivan 2026-11-04: rates move when the ICP filter changes, so the Accepted tile never shows a
// change against the previous window. The fixture's two windows differ, so the old pill rendered.
it('shows the accepted rate and its counts with no week-over-week pill', () => {
  const now = seatAccept(p, 'ivan', '7d'), prev = seatAccept(p, 'ivan', 'prev7d')
  expect(now?.pct != null && prev?.pct != null && now.pct !== prev.pct).toBe(true)
  const ctx = { d: { cc: slot(p), outcomes: slot([]) }, range: '7d' } as unknown as BandCtx
  const { container } = render(<Numbers seat="ivan" ctx={ctx} retry={() => {}} />)
  const tiles = [...container.querySelectorAll('.dl4-kpi')]
  expect(tiles.map(t => t.querySelector('small')!.textContent)).toEqual(['Invites, 7 days', 'Accepted ≤72h', 'Replied ≤72h', 'Conversations'])
  const accepted = tiles[1].querySelector('.dl4-kpi-sub')!.textContent!
  expect(accepted).toMatch(/^\d+ of \d+/)
  expect(accepted).not.toMatch(/pp|▲|▼/)
  expect(container.querySelector('.dl4-pill')).toBeNull()
})
