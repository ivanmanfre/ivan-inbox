// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CallsOnRecord } from './Calls'
import { buildArchive } from './archive'
afterEach(cleanup)
const props = { lists: buildArchive([]).lists, seg: 'all' as const, setSeg: vi.fn(), openId: null, onOpen: vi.fn(), onRetry: vi.fn() }
it('failed call reads never claim an empty archive or zero minute average', () => {
  render(<CallsOnRecord {...props} state="failed" />)
  expect(screen.getByText(/call archive did not load/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Read again' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: 'All ?' })).toBeTruthy()
  expect(document.querySelector('.sl-rt')?.textContent).toBe('?')
  expect(document.querySelector('.sl-rec')?.textContent).not.toMatch(/0m|All 0|Sales 0|Clients 0|Other 0/)
})
it('a successful empty archive alone may show zero', () => {
  render(<CallsOnRecord {...props} state="ok" />)
  expect(screen.getByRole('tab', { name: 'All 0' })).toBeTruthy()
  expect(screen.getByText('0m avg')).toBeTruthy()
})
