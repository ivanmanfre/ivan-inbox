// @vitest-environment jsdom
// DMs 3 (Ivan 09-27): calmer sections, Mark as solved, the folder dots, linked emails.
// The lib writes are mocked; the grouping and owed rules under them are the real ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/inbox', async orig => {
  const real = await orig<typeof import('../../lib/inbox')>()
  return { ...real, discardLegs: vi.fn(async () => []), restoreDraft: vi.fn(async () => true), markThreadRead: vi.fn(async () => {}) }
})
vi.mock('./solved', async orig => ({ ...(await orig<typeof import('./solved')>()), setNeedsManualReply: vi.fn(async () => {}) }))
vi.mock('../../lib/followUp', async orig => ({ ...(await orig<typeof import('../../lib/followUp')>()), fetchFollowUp: vi.fn(async () => null) }))

import * as lib from '../../lib/inbox'
import * as solvedMod from './solved'
import { groupThreads, threadBucket, type Thread } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import { DmAsks } from './asks'
import { Folders } from './Chrome'
import { NOW, drafted, iso, msg, owedNoDraft, threads, waiting } from './fixtures'
import { History, emailAddrLine } from './History'
import { seatView, needsCount } from './model'
import { Section, useFolds } from './Section'
import { ThreadPane } from './Thread'
import { useDmVerbs } from './verbs'

const pre: PreReadHandle = { get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false }
const ctx = { refresh: vi.fn(), patch: vi.fn() }
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement | null

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); vi.clearAllMocks(); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

function Box({ n, foldable, defaultOpen }: { n: number; foldable?: boolean; defaultOpen?: boolean }) {
  const folds = useFolds()
  return <Section id="s" label="Sent, waiting on them" n={n} folds={folds} foldable={foldable} defaultOpen={defaultOpen}
    rows={Array.from({ length: n }, (_, i) => <div key={i} className="r">row {i}</div>)} />
}

describe('sections', () => {
  it('shows the latest 5, then "Show all N" opens the rest', () => {
    render(<Box n={8} />)
    expect(document.querySelectorAll('.r')).toHaveLength(5)
    fireEvent.click(screen.getByText('Show all 8'))
    expect(document.querySelectorAll('.r')).toHaveLength(8)
    expect(screen.getByText('Show the latest 5')).toBeTruthy()
  })

  it('a rare section starts folded to one line with its count, and the choice is remembered', () => {
    render(<Box n={3} foldable defaultOpen={false} />)
    expect(document.querySelectorAll('.r')).toHaveLength(0)
    expect(key('fold-s')!.textContent).toContain('3')
    fireEvent.click(key('fold-s')!)
    expect(document.querySelectorAll('.r')).toHaveLength(3)
    cleanup()
    render(<Box n={3} foldable defaultOpen={false} />)
    expect(document.querySelectorAll('.r')).toHaveLength(3)
  })

  it('Needs you has no fold key', () => {
    render(<Box n={2} />)
    expect(key('fold-s')).toBeNull()
  })
})

describe('email-only people', () => {
  it('stay in the Email folder only; an owed one still counts in Needs you (pointer line)', () => {
    const rows = [
      msg({ prospect_id: 'e', prospect_name: 'Mail Only', channel: 'email', message_type: 'email', direction: 'outbound', sent_at: iso(40 * 3_600_000), created_at: iso(40 * 3_600_000) }),
      msg({ prospect_id: 'e', prospect_name: 'Mail Only', channel: 'email', message_type: 'email_reply', direction: 'inbound', sent_at: iso(3_600_000), created_at: iso(3_600_000), message_text: 'Can we talk next week?' }),
      ...owedNoDraft('li', { prospect_name: 'On LinkedIn' }),
    ]
    const v = seatView(threads(rows), 'ivan', NOW)
    expect(v.nodraft.map(t => t.prospect_id)).toEqual(['li'])
    expect(v.email.map(t => t.prospect_id)).toEqual(['e'])
    expect(v.emailOwed.map(t => t.prospect_id)).toEqual(['e'])
    expect(needsCount(v)).toBe(2)
  })

  it('a DM thread with an email leg keeps both in one timeline, the email tagged with its address', () => {
    const rows = [
      ...waiting('p', { prospect_name: 'Ofir', client_id: 'arch' }, 30),
      msg({ prospect_id: 'p', prospect_name: 'Ofir', client_id: 'arch', channel: 'email', message_type: 'email', direction: 'outbound', recipient_email: 'ofir@x.com', sent_at: iso(20 * 3_600_000), created_at: iso(20 * 3_600_000), message_text: 'Hi Ofir, following up from LinkedIn.' }),
      msg({ prospect_id: 'p', prospect_name: 'Ofir', client_id: 'arch', channel: 'email', message_type: 'email_reply', direction: 'inbound', recipient_email: 'ofir@x.com', sent_at: iso(2 * 3_600_000), created_at: iso(2 * 3_600_000), message_text: 'Thanks, lets talk Tuesday.' }),
    ]
    const [t] = threads(rows)
    const v = seatView([t], 'arch', NOW)
    expect(v.email).toHaveLength(1)
    expect(threadBucket(t, NOW)).toBe('answer')
    expect(v.nodraft.map(x => x.prospect_id)).toEqual(['p'])
    render(<History t={t} cap={10} />)
    const mails = [...document.querySelectorAll('[data-channel="email"]')]
    expect(mails).toHaveLength(2)
    expect(mails[0].textContent).toContain('To ofir@x.com')
    expect(mails[1].textContent).toContain('From ofir@x.com')
    expect(document.querySelectorAll('.dm-h-whole').length).toBe(4)
    expect(emailAddrLine(rows[0])).toBeNull()
  })
})

describe('folder dots', () => {
  const mailThread = (read: boolean) => groupThreads([
    msg({ prospect_id: 'm', channel: 'email', message_type: 'email_reply', direction: 'inbound', read_at: read ? iso(1000) : null, sent_at: iso(3_600_000), created_at: iso(3_600_000) }),
  ], new Set(), NOW)
  const views = (ts: Thread[]) => ({ ivan: seatView(ts, 'ivan', NOW), risedtc: seatView([], 'risedtc', NOW), arch: seatView([], 'arch', NOW) })

  it('a lime dot on Email while an email thread is unread, none once read', () => {
    render(<Folders folder={null} setFolder={() => {}} views={views(mailThread(false))} />)
    expect(document.querySelector('[role="tab"][data-unread="true"] .dm-fdot')).toBeTruthy()
    cleanup()
    render(<Folders folder={null} setFolder={() => {}} views={views(mailThread(true))} />)
    expect(document.querySelector('.dm-fdot')).toBeNull()
  })
})

function Pane({ t }: { t: Thread }) {
  const verbs = useDmVerbs(ctx)
  return <ThreadPane t={t} all={[t]} phone={false} verbs={verbs} now={NOW} onBack={() => {}} onAsk={() => {}} onDraftIt={() => {}} onMenu={() => {}} staleN={0} pre={pre} reload={() => {}} />
}
const mount = (t: Thread) => renderInFrame(<DmAsks><Pane t={t} /></DmAsks>, { hash: '#exp/d/dms' })

describe('Mark as solved', () => {
  it('discards every leg (plain, no ask) then lowers the reply flag on this prospect; Undo restores both', async () => {
    const rows = drafted('s', { prospect_name: 'Sam' })
    const [t0] = groupThreads(rows, new Set(['s']), NOW)
    expect(t0.needsManualReply).toBe(true)
    mount(t0)
    fireEvent.click(key('solved')!)
    await waitFor(() => expect(lib.discardLegs).toHaveBeenCalledWith([t0.draft], null))
    await waitFor(() => expect(solvedMod.setNeedsManualReply).toHaveBeenCalledWith('s', false))
    expect(vi.mocked(lib.discardLegs).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(solvedMod.setNeedsManualReply).mock.invocationCallOrder[0])
    expect(await screen.findByText('Marked Sam as solved.')).toBeTruthy()
    fireEvent.click(key('undo')!)
    await waitFor(() => expect(lib.restoreDraft).toHaveBeenCalledWith(t0.draft!.id))
    await waitFor(() => expect(solvedMod.setNeedsManualReply).toHaveBeenLastCalledWith('s', true))
  })

  it('does not touch the flag when every leg refused (already approved)', async () => {
    const [t] = threads(drafted('r', { prospect_name: 'Ray' }))
    vi.mocked(lib.discardLegs).mockResolvedValueOnce([{ leg: t.draft!, error: null }])
    mount(t)
    fireEvent.click(key('solved')!)
    await waitFor(() => expect(lib.discardLegs).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(50)
    expect(solvedMod.setNeedsManualReply).not.toHaveBeenCalled()
  })

  it('the discard rule takes the thread out of Needs you; a NEW inbound brings it back', () => {
    const rows = drafted('b', { prospect_name: 'Bo' })
    const draft = rows[2]
    const solvedRows = [...rows.slice(0, 2), { ...draft, send_blocked_reason: 'discarded_in_inbox', send_blocked_at: iso(60_000) }]
    expect(threadBucket(threads(solvedRows)[0], NOW)).toBe('waiting')
    const again = [...solvedRows, msg({ prospect_id: 'b', prospect_name: 'Bo', direction: 'inbound', sent_at: iso(1000), created_at: iso(1000), message_text: 'One more question: price?' })]
    expect(threadBucket(threads(again)[0], NOW)).toBe('answer')
  })

  it('is not offered on an owed thread with no draft', () => {
    mount(threads(owedNoDraft('n', { prospect_name: 'Nod' }))[0])
    expect(key('solved')).toBeNull()
  })
})
