// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { SubNav, contentRedirect, subOf } from './SubNav'

afterEach(cleanup)
it('keeps Calendar first and five phone tabs while More reaches the scoped Brain area', () => {
  renderInFrame(<SubNav on="results" lane="risedtc" />, { layout: 'phone' })
  const tabs = within(screen.getByRole('navigation', { name: 'Content places' })).getAllByRole('link')
  expect(tabs).toHaveLength(5)
  expect(tabs[0].textContent).toBe('Calendar')
  expect(tabs.some(a => a.textContent === 'Brain')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'More in Content' }))
  expect(screen.getByRole('link', { name: 'Brain' }).getAttribute('href')).toBe('#exp/d/content/brain?lane=risedtc')
})
it('preserves Brain bookmarks and the selected client without redirecting to Review', () => {
  const query = new URLSearchParams('lane=arch')
  expect(subOf('brain', query)).toBe('brain')
  expect(contentRedirect('brain', query)).toBeNull()
})
