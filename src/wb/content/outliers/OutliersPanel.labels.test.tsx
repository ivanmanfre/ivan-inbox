// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../../../d/test-utils'
import { OutliersPanel } from './OutliersPanel'
import type { OutlierRow, OutliersRead } from '../../../lib/outliers'

afterEach(cleanup)
it('injects labels on every visible catalogue row while keeping Use this independent', () => {
  const row = (post_id: string): OutlierRow => ({ platform: 'linkedin', post_id, author: 'Fixture author', text: 'Fixture post', url: null, published_at: '2026-09-21', week: '2026-09-21', lift: 3, baseline: 10, baseline_n: 20, likes: 30, reposts: 0, comments: 0, views: null, labels: null, personal: false, traits: [], traits_note: null, buyer: null, idea: null })
  const rows = [row('fixture-1'), row('fixture-2')]
  const read: OutliersRead = { kind: 'ready', data: { client: 'ivan', studies: { linkedin: null, x: null }, weeks: [{ week: '2026-09-21', n: 2 }], rows } }
  const use = vi.fn(), visible = vi.fn(), label = vi.fn()
  renderInFrame(<OutliersPanel read={read} stateOf={() => 'off'} onRetry={() => {}} onUse={use} onVisibleRows={visible} labelControl={r => <button type="button" onClick={() => label(r.post_id)}>Keep {r.post_id}</button>} />)
  expect(screen.getAllByRole('button', { name: /^Keep fixture-/ })).toHaveLength(2)
  expect(visible).toHaveBeenLastCalledWith(rows.map(r => ({ platform: r.platform, post_id: r.post_id })))
  fireEvent.click(screen.getByRole('button', { name: 'Keep fixture-1' }))
  expect(label).toHaveBeenCalledWith('fixture-1'); expect(use).not.toHaveBeenCalled()
  fireEvent.click(screen.getAllByRole('button', { name: 'Use this' })[1])
  expect(use).toHaveBeenCalledWith(rows[1])
})
