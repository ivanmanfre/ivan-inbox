// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Window } from './Window'
import type { CallRow } from '../../../lib/transcripts'
afterEach(cleanup)
const base: CallRow = { id: 'r', title: 'Meet', date: '2026-11-17T13:00:00Z', duration_minutes: 40, participants: ['Ivan', 'Ada'], summary: 'Summary text', action_items: null, topics: null, follow_up_draft: null, follow_up_sent: false, source: null, meeting_type: null, brief: { next_step: 'Send the scan' } }
const open = (brief: CallRow['brief']) => render(<Window row={{ ...base, brief }} at={1} of={1} onStep={vi.fn()} layout="desktop" />)

it('lists each point he made more than once, with how many times, after Next step', () => {
  open({ next_step: 'Send the scan', repeated_points: [{ point: 'Month two and three bring the most volume', times: 3 }, { point: 'Outreach leads while the account is small', times: 3 }] })
  const head = screen.getByText('Said more than once')
  const lines = [...head.parentElement!.querySelectorAll('li')].map(li => li.textContent)
  expect(lines).toEqual(['3 times: Month two and three bring the most volume', '3 times: Outreach leads while the account is small'])
  const text = document.body.textContent!
  expect(text.indexOf('Next step')).toBeLessThan(text.indexOf('Said more than once'))
})

it('shows no such section when the list is empty or the key is missing', () => {
  for (const brief of [{ next_step: 'Send the scan', repeated_points: [] }, { next_step: 'Send the scan' }, null]) {
    open(brief)
    expect(screen.queryByText('Said more than once')).toBeNull()
    cleanup()
  }
})
