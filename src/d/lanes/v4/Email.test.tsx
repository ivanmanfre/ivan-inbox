// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { EmailStats } from '../../../lib/emailStats'
import { Email } from './Email'

const read = vi.fn<() => Promise<EmailStats>>()
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../lib/emailStats', async original => ({ ...(await original<typeof import('../../../lib/emailStats')>()), fetchEmailStats: () => read() }))
afterEach(() => { cleanup(); read.mockReset() })

const camp = (id: string, name: string, sent: number, bounced: number, replies: number) => ({ id, name, status: 1, daily_limit: 20, open_tracking: false, leads: sent, contacted: sent, sent, replies, auto_replies: 1, bounced, unsubscribed: 0, completed: 0, opportunities: 0 })

it('shows sends, bounces and replies from Instantly with the bounce rate', async () => {
  read.mockResolvedValue({ fetched_at: '2026-11-09T17:00:00Z', campaigns: [camp('a', 'Ivan | Warm engagers | Revenue audit', 44, 1, 1), camp('b', 'Ivan | Fresh agency owners | Cold audit v1', 39, 0, 1)],
    days: [{ date: '2026-11-08', sent: 0, replies: 0, auto_replies: 0 }, { date: '2026-11-09', sent: 20, replies: 1, auto_replies: 0 }],
    mailboxes: { day: '2026-11-09', count: 10, healthy: 10, min_health: 100, spam: 0, problems: [] } })
  render(<Email now={Date.parse('2026-11-09T17:00:00Z')} />)
  expect(await screen.findByText('83')).toBeTruthy()
  expect(screen.getByText('20 today · 20 in 7 days')).toBeTruthy()
  expect(screen.getByText('1.2% of sent')).toBeTruthy()
  expect(screen.getByText('2.4% of 83 reached')).toBeTruthy()
  expect(screen.getByText('Warm engagers | Revenue audit')).toBeTruthy()
  expect(screen.getByText(/44 sent · 44 leads in it · 1 replied · 1 bounced \(2.3%\) · 1 auto-reply$/)).toBeTruthy()
  expect(screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+$/)).toHaveLength(7)
  expect(screen.getByText(/10 mailboxes checked 2026-11-09/).textContent).toContain('open tracking is off')
})

it('says it could not read Instantly instead of showing zeros', async () => {
  read.mockRejectedValue(Error('Instantly answered 401.'))
  render(<Email now={Date.now()} />)
  expect(await screen.findByText(/Could not be read: Instantly answered 401/)).toBeTruthy()
})
