// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { ColumnBody, type ColumnProps } from './Column'
import { msg, threads, waiting } from './fixtures'
import { seatView } from './model'

afterEach(cleanup)
it.each([false, true])('shows a scheduled send on its own seat and opens its thread (v4=%s)', v4 => {
  const rows = threads([
    ...waiting('jonathan', { prospect_name: 'Jonathan Kiekbusch' }),
    msg({ prospect_id: 'jonathan', prospect_name: 'Jonathan Kiekbusch', message_text: 'Hey Jonathan, proposal here',
      send_blocked_at: '2026-10-11T21:26:00Z', send_blocked_reason: 'scheduled_in_inbox',
      draft_evidence: { scheduled_send: { at: '2026-10-12T07:00:00Z', timezone: 'Europe/Warsaw', state: 'scheduled' } } }),
    msg({ prospect_id: 'other', client_id: 'risedtc', prospect_name: 'Other seat', send_blocked_at: '2026-10-11T21:26:00Z', send_blocked_reason: 'scheduled_in_inbox' }),
    msg({ prospect_id: 'cancelled', prospect_name: 'Cancelled person', send_blocked_at: '2026-10-11T21:26:00Z', send_blocked_reason: 'scheduled_send_cancelled' }),
    msg({ prospect_id: 'sent', prospect_name: 'Sent person', sent_at: '2026-10-11T21:30:00Z', send_blocked_reason: 'scheduled_in_inbox' }),
  ])
  const open = vi.fn()
  const p = { seat: 'ivan', mode: 'conversations', view: seatView(rows, 'ivan'), matches: [], byId: new Map(rows.map(t => [t.prospect_id, t])),
    c: { selected: null, checked: new Set(), open, now: Date.parse('2026-10-11T22:00:00Z'), verbs: {}, busy: null, setBusy: vi.fn(), fail: vi.fn(), pre: { get: () => ({ s: 'none' }) }, more: vi.fn(), v4 },
    cameBack: { rows: [], loaded: true, failed: false }, warm: { rows: [], loaded: true, failed: false }, agent: { cards: [], loaded: true, failed: false, note: null },
    dated: [], upcoming: { rows: [], loaded: true, failed: false }, stale: [], scanDays: new Map(), toEmail: vi.fn(),
  } as unknown as ColumnProps
  renderInFrame(<ColumnBody {...p} />)
  const section = screen.getByText('Scheduled').closest('[data-d-scheduled]')!
  expect(section).toBeTruthy()
  const row = within(section as HTMLElement).getByRole('button', { name: /Jonathan Kiekbusch/ })
  expect(row).toHaveTextContent('12 Oct, 09:00 · Europe/Warsaw')
  expect(row).toHaveTextContent('Hey Jonathan, proposal here')
  expect(section).not.toHaveTextContent('Other seat')
  expect(section).not.toHaveTextContent('Cancelled person')
  expect(section).not.toHaveTextContent('Sent person')
  fireEvent.click(row)
  expect(open).toHaveBeenCalledWith(rows.find(t => t.prospect_id === 'jonathan'))
})
