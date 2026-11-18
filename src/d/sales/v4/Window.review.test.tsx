// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Window } from './Window'
import { reviewOf, reviewPattern, type CallRow, type CallReviewRaw } from '../../../lib/transcripts'
afterEach(cleanup)
// Invented people and words only (the repo is public).
const review = (over: Partial<CallReviewRaw> = {}): CallReviewRaw => ({
  v: 1, call_kind: 'first_discovery',
  items: [
    { id: 'booking_reason', label: 'What made you book the call?', status: 'answered', quote: 'Our referrals went quiet this spring' },
    { id: 'goal', label: 'What would client acquisition look like in 90 days?', status: 'missed', quote: null },
    { id: 'budget', label: 'What budget would this come from?', status: 'partial', quote: null },
  ],
  missed_follow_ups: [{ buyer_quote: 'I need to run it past my partner first', what_ivan_did: 'moved on', better_question: 'Can your partner join a call on Thursday?' }],
  next_step: { booked: false, when: null, everyone_who_decides: false, quote: 'Let me get back to you next month', note: 'left open' },
  next_call: ['Book the follow-up with the partner before hanging up.'],
  talk: { ivan_pct: 64, longest_run_words: 240, longest_run_at_pct: 41 },
  ...over,
})
const base: CallRow = { id: 'r', title: 'Meet', date: '2026-11-17T13:00:00Z', duration_minutes: 40, participants: ['Ivan', 'Ada'], summary: 'Summary', action_items: null, topics: null, follow_up_draft: null, follow_up_sent: false, source: null, meeting_type: null, brief: { next_step: 'Send the scan' }, talk_stats: { words: { Ivan: 64, Ada: 36 }, total: 100, ivan_pct: 64 } }
const open = (call_review: CallRow['call_review'], pattern = null as ReturnType<typeof reviewPattern>) =>
  render(<Window row={{ ...base, call_review }} at={1} of={1} onStep={vi.fn()} layout="desktop" pattern={pattern} />)

it('shows the unbooked next call, the skipped follow-up with its question, and what was not covered', () => {
  open(review())
  expect(screen.getByText('No next call booked').closest('[data-next-booked]')!.getAttribute('data-next-booked')).toBe('no')
  expect(screen.getByText(/not everyone who decides/)).toBeTruthy()
  expect(screen.getByText('“Let me get back to you next month”')).toBeTruthy()
  expect(screen.getByText('Ask: Can your partner join a call on Thursday?')).toBeTruthy()
  expect(screen.getByText('Not covered (1)').parentElement!.textContent).toContain('90 days')
  expect(screen.getByText('Only half answered (1)')).toBeTruthy()
  expect(screen.getByText(/240 words without a break, 41% into the call/)).toBeTruthy()
  expect(screen.getByText('What they answered (1)')).toBeTruthy()
  const text = document.body.textContent!
  expect(text.indexOf('Next step')).toBeLessThan(text.indexOf('After-call review'))
})

it('shows a booked call with its time and no warning', () => {
  open(review({ next_step: { booked: true, when: 'Tuesday 3pm', everyone_who_decides: true, quote: null, note: '' } }))
  expect(screen.getByText('Next call booked: Tuesday 3pm')).toBeTruthy()
  expect(screen.queryByText(/not everyone who decides/)).toBeNull()
})

it('shows nothing for no review, a skipped or failed one, or a call that was not a sales call', () => {
  for (const r of [null, undefined, { v: 1, status: 'skipped' }, { v: 1, status: 'failed' }, review({ call_kind: 'not_a_sales_call' }), { v: 2 } as CallReviewRaw]) {
    open(r as CallRow['call_review'])
    expect(screen.queryByText('After-call review')).toBeNull()
    cleanup()
  }
})

it('pattern counts booked next calls across reviewed sales calls only, newest first', () => {
  const row = (id: string, date: string, booked: boolean, kind = 'first_discovery', pct = 60): CallRow =>
    ({ ...base, id, date, talk_stats: { words: {}, total: 1, ivan_pct: pct }, call_review: review({ call_kind: kind, next_step: { booked, when: null, everyone_who_decides: null, quote: null, note: '' } }) })
  const rows = [row('a', '2026-11-10T10:00:00Z', false), row('b', '2026-11-12T10:00:00Z', true, 'first_discovery', 50), row('c', '2026-11-13T10:00:00Z', false, 'not_a_sales_call', 90), { ...base, id: 'd' }]
  expect(reviewPattern(rows)).toEqual({ n: 2, booked: 1, talkAvg: 55 })
  expect(reviewPattern(rows.slice(0, 1))).toBeNull()
  expect(reviewOf(rows[2])).toBeNull()
  open(review(), reviewPattern(rows))
  expect(screen.getByText('Last 2 sales calls: next call booked on 1 of 2. You talked 55% on average.')).toBeTruthy()
})
