// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderInFrame } from '../test-utils'
import { groupThreads } from '../../lib/inbox'
import { msg, NOW } from './fixtures'
import { ThreadPane } from './Thread'
import type { DmVerbs } from './verbs'
import { menuItems } from './Menu'

// These tests exercise LinkedIn controls; the unrelated rich-email editor is not mounted.
vi.mock('./RichEmailEditor', () => ({ RichEmailEditor: () => null }))
vi.mock('../../lib/inbox', async orig => ({ ...(await orig<typeof import('../../lib/inbox')>()), markThreadRead: vi.fn(async () => {}) }))
afterEach(cleanup)

it('shows Anna’s manual composer and offers a reviewable draft while omitting calendar and schedule controls', async () => {
  const [t] = groupThreads([msg({ prospect_id: 'anna-ui', client_id: 'anna', prospect_name: 'Taylor', direction: 'inbound', message_text: 'Tell me more.', sent_at: '2026-09-27T08:00:00Z' })], new Set(), NOW)
  const compose = vi.fn(async () => true)
  const items = menuItems(t, 0).flatMap(g => g.items)
  expect(items.some(item => item.act === 'agent')).toBe(false)
  expect(items.find(item => item.act === 'copy-chat')?.hint).toBe('for Anna')
  renderInFrame(<ThreadPane v4 t={t} all={[t]} phone={false} verbs={{ compose } as unknown as DmVerbs} now={NOW} onBack={() => {}} onAsk={() => {}} onMenu={() => {}} staleN={0} pre={{ get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false }} reload={() => {}} />)
  expect(document.querySelector('[data-verb="draft-it"]')).toBeTruthy()
  expect(document.querySelector('[data-verb="schedule-send"]')).toBeNull()
  expect(screen.getByText('Write your reply below, or use Draft it to prepare a reply for review.', { exact: false })).toBeTruthy()
  const input = document.querySelector('.dm-comp textarea')!
  expect(input).toBeTruthy()
  fireEvent.change(input, { target: { value: 'Here are the details.' } })
  fireEvent.click(document.querySelector('[data-verb="compose-send"]')!)
  await waitFor(() => expect(compose).toHaveBeenCalledWith(t, 'Here are the details.', undefined, undefined))
})
