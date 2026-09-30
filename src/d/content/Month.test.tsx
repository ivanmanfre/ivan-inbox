// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Month } from './Month'
afterEach(cleanup)
it('exposes an ordinary labelled calendar group and keeps month navigation usable', () => {
  render(<Month lane="ivan" setLane={vi.fn()} items={new Map()} rows={[]} onOpen={vi.fn()} onMove={vi.fn()} onArm={vi.fn()} onDay={vi.fn()} now={Date.parse('2026-09-30T12:00:00Z')} />)
  expect(screen.queryByRole('grid')).toBeNull()
  expect(screen.getByRole('group', { name: /September 2026/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  expect(screen.getByRole('group', { name: /October 2026/ })).toBeTruthy()
})
it('opens the full day on a phone instead of squeezing post titles into seven narrow columns', () => {
  const onDay = vi.fn(), onOpen = vi.fn()
  const day = '2026-09-30'
  const item = { id: 'one', title: 'Readable post', day, source: 'draft', stage: 'scheduled' } as import('./planModel').PlanItem
  render(<Month phone lane="ivan" setLane={vi.fn()} items={new Map([[day, [item, { ...item, id: 'two' }]]])} rows={[]} onOpen={onOpen} onMove={vi.fn()} onArm={vi.fn()} onDay={onDay} now={Date.parse('2026-09-30T12:00:00Z')} />)
  fireEvent.click(screen.getByRole('button', { name: '2 posts on 2026-09-30' }))
  expect(onDay).toHaveBeenCalledWith('ivan', [day])
  expect(onOpen).not.toHaveBeenCalled()
})
