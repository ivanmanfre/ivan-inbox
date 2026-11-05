// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { EmailLists } from '../../lib/emailLists'

const read = vi.fn<() => Promise<EmailLists>>()
vi.mock('../../lib/emailLists', async orig => ({ ...(await orig<typeof import('../../lib/emailLists')>()), fetchEmailLists: () => read() }))
const { EmailListsPage } = await import('./EmailLists')
const { splitLists, clientReal } = await import('../../lib/emailLists')

const DATA: EmailLists = {
  at: '2026-11-05T15:00:00Z',
  swishdm_nurture_armed: false,
  clients: [
    { client: 'ivan', label: 'Ivan', lists: [
      { key: 'profile_audit', kind: 'signup', name: 'Profile audit report', real: 2, hidden: 1, last30: 0, last_at: '2026-09-27T05:08:50Z', sent: 2, unsub: 0 },
      { key: 'seq:agent_ready_letter', kind: 'nurture', name: 'Agent-Ready Letter', real: 2, hidden: 1, last30: 0, last_at: '2026-07-21T01:56:29Z', sent: 2, unsub: 1, bounced: 0 },
      { key: 'seq:calculator', kind: 'nurture', name: 'Calculator nurture', real: 0, hidden: 0, last30: 0, last_at: null, sent: 0, unsub: 0 },
      { key: 'letter', kind: 'broadcast', name: 'Weekly letter (broadcasts)', issues: 7, last_sent: '2026-05-22T13:00:57Z', last_recipients: 3 },
    ] },
    { client: 'swishdm', label: 'SwishDM', lists: [
      { key: 'swishdm_req:ai-search-report', kind: 'request', name: 'AI search report requests', real: 1, hidden: 0, last30: 1, last_at: '2026-11-05T10:00:00Z', qualifying: 1, reports_sent: 1, enrolled: 1 },
      { key: 'seq:swishdm_ai_search_report', kind: 'nurture', name: 'SwishDM report follow-up', real: 1, hidden: 0, last30: 1, sent: 0, unsub: 0, steps: 3, live_steps: 2, step1_active: false },
    ] },
    { client: 'rise', label: 'RISE (Mattan)', lists: [
      { key: 'seq:client_risedtc_kit', kind: 'nurture', name: 'Rise kit', real: 1, hidden: 3, last30: 0, last_at: '2026-08-15T03:29:48Z', sent: 1, unsub: 0 },
    ] },
    { client: 'arch', label: 'ARCH (Davorin)', lists: [
      { key: 'arch_newsletter', kind: 'signup', name: 'ARCH newsletter sign-ups', real: 0, hidden: 0, last30: 0, last_at: null },
    ] },
  ],
}

afterEach(() => { cleanup(); read.mockReset() })

describe('Sales > Email', () => {
  it('folds never-used sequences and sums real sign-ups only', () => {
    const { shown, unused } = splitLists(DATA.clients[0])
    expect(shown.map(l => l.key)).toEqual(['profile_audit', 'seq:agent_ready_letter', 'letter'])
    expect(unused.map(l => l.key)).toEqual(['seq:calculator'])
    expect(clientReal(DATA.clients[0])).toEqual({ real: 4, last30: 0 })
  })

  it('draws one block per client, the hidden count, the off switch and ARCH empty', async () => {
    read.mockResolvedValue(DATA)
    const { container } = renderInFrame(<EmailListsPage navigate={() => {}} layout="phone" />)
    await waitFor(() => expect(container.querySelectorAll('[data-email-client]').length).toBe(4))
    const ivan = container.querySelector('[data-email-client="ivan"]')!
    expect(ivan.textContent).toContain('4 real sign-ups')
    expect(ivan.textContent).toContain('1 test or own left out')
    expect(ivan.textContent).toContain('1 more sequence never used: Calculator nurture.')
    expect(container.querySelector('[data-email-list="seq:swishdm_ai_search_report"]')!.textContent).toContain('Off · waiting for your send')
    expect(container.querySelector('[data-email-client="arch"]')!.textContent).toContain('No list yet.')
    expect(container.querySelector('[data-email-client="rise"]')!.textContent).toContain('1 real sign-up ·')
    // a report requester in the nurture counts once, and steps 2-3 live with step 1 off still reads Off
    expect(container.querySelector('[data-email-client="swishdm"]')!.textContent).toContain('1 real sign-up ·')
    // ARCH reports no sent/unsub numbers, so none are drawn
    expect(container.querySelector('[data-email-client="arch"]')!.textContent).not.toContain('emails sent')
  })

  it('a failed read says so and never shows an empty list', async () => {
    read.mockRejectedValue(new Error('operator_denied'))
    const { container } = renderInFrame(<EmailListsPage navigate={() => {}} layout="desktop" />)
    await waitFor(() => expect(container.textContent).toContain('Could not read the email lists.'))
    expect(container.querySelectorAll('[data-email-client]').length).toBe(0)
  })
})
