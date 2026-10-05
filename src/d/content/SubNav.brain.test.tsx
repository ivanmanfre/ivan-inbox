// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { SubNav, contentRedirect, subOf } from './SubNav'

afterEach(cleanup)
// Run 51: Content Brain is the first of five phone tabs; the places that left the daily row stay under More.
it('puts Content Brain first in five phone tabs while More reaches sources and history', () => {
  renderInFrame(<SubNav on="results" lane="risedtc" />, { layout: 'phone' })
  const tabs = within(screen.getByRole('navigation', { name: 'Content places' })).getAllByRole('link')
  expect(tabs).toHaveLength(5)
  expect(tabs[0].textContent).toBe('Content Brain')
  expect(tabs[0].getAttribute('href')).toBe('#exp/d/content/brain?lane=risedtc')
  expect(tabs.some(a => a.textContent === 'Results')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'More in Content' }))
  expect(screen.getByRole('link', { name: 'Patterns and benchmarks' }).getAttribute('href')).toBe('#exp/d/content/brain?lane=risedtc&view=patterns')
  expect(screen.getByRole('link', { name: 'Research library' }).getAttribute('href')).toBe('#exp/d/content/strategy?lane=risedtc&section=research')
  expect(screen.getByRole('link', { name: 'Outliers' }).getAttribute('href')).toBe('#exp/d/content/inputs?lane=risedtc')
  expect(screen.getByRole('link', { name: 'Results' }).getAttribute('href')).toBe('#exp/d/content/results?lane=risedtc')
  expect(screen.getByRole('link', { name: 'Saved weekly plans' }).getAttribute('href')).toBe('#exp/d/content/strategy?lane=risedtc&section=this-week')
})
it('preserves Brain bookmarks and the selected client without redirecting to Review', () => {
  const query = new URLSearchParams('lane=arch')
  expect(subOf('brain', query)).toBe('brain')
  expect(contentRedirect('brain', query)).toBeNull()
})
