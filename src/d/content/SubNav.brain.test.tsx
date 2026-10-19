// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { SubNav, contentRedirect, subOf } from './SubNav'

afterEach(cleanup)
it('puts Plan first in five phone tabs while More reaches sources and history', () => {
  renderInFrame(<SubNav on="results" lane="risedtc" />, { layout: 'phone' })
  const tabs = within(screen.getByRole('navigation', { name: 'Content places' })).getAllByRole('link')
  expect(tabs).toHaveLength(5)
  expect(tabs[0].textContent).toBe('Plan')
  expect(tabs[0].getAttribute('href')).toBe('#exp/d/content/plan?lane=risedtc')
  expect(tabs.some(a => a.textContent === 'Results')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'More in Content' }))
  expect(screen.getByRole('link', { name: 'Patterns and benchmarks' }).getAttribute('href')).toBe('#exp/d/content/brain?lane=risedtc&view=patterns')
  expect(screen.getByRole('link', { name: 'Research library' }).getAttribute('href')).toBe('#exp/d/content/strategy?lane=risedtc&section=research')
  expect(screen.getByRole('link', { name: 'Outliers' }).getAttribute('href')).toBe('#exp/d/content/inputs?lane=risedtc')
  expect(screen.getByRole('link', { name: 'Results' }).getAttribute('href')).toBe('#exp/d/content/results?lane=risedtc')
  expect(screen.getByRole('link', { name: 'Saved weekly plans' }).getAttribute('href')).toBe('#exp/d/content/strategy?lane=risedtc&section=this-week')
})
it('sends daily Brain bookmarks to Plan with their client and draft, while keeping patterns', () => {
  const query = new URLSearchParams('lane=arch&draft=d-1')
  expect(subOf('brain', query)).toBe('plan')
  expect(contentRedirect('brain', query)).toBe('#exp/d/content/plan?lane=arch&draft=d-1&insights=1')
  const patterns = new URLSearchParams('lane=arch&view=patterns')
  expect(subOf('brain', patterns)).toBe('brain')
  expect(contentRedirect('brain', patterns)).toBeNull()
})
