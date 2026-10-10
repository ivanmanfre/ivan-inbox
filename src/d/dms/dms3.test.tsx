// @vitest-environment jsdom
// DMs 3 (Ivan 09-27): calmer sections, Mark as solved, the folder dots, linked emails.
// The lib writes are mocked; the grouping and owed rules under them are the real ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/inbox', async orig => {
  const real = await orig<typeof import('../../lib/inbox')>()
  return { ...real, discardLegs: vi.fn(async () => []), restoreDraft: vi.fn(async () => true),
    dismissConfirmation: vi.fn(async () => true), restoreConfirmation: vi.fn(async () => true), markThreadRead: vi.fn(async () => {}) }
})
vi.mock('./solved', async orig => ({ ...(await orig<typeof import('./solved')>()), writeSolved: vi.fn(async () => {}) }))
vi.mock('../../lib/followUp', async orig => ({ ...(await orig<typeof import('../../lib/followUp')>()), fetchFollowUp: vi.fn(async () => null) }))

import * as lib from '../../lib/inbox'
import * as solvedMod from './solved'
import { groupThreads, isSettledBySolve, threadBucket, unansweredWaitSince, type Thread } from '../../lib/inbox'
import { countDmSeat } from '../counts/dmDrafts'
import { owedIds, withSolved } from '../counts/solved'
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

describe('engagements in the timeline (10-10)', () => {
  const ev = (at: string, title: string, over = {}) => ({ kind: 'reaction', at, detail: null, post_title: title, post_url: `https://www.linkedin.com/posts/${title}`, ...over })
  const t0 = () => threads([msg({ prospect_id: 'a', prospect_name: 'Auke de Geus', direction: 'outbound', sent_at: iso(30 * 3_600_000), created_at: iso(30 * 3_600_000), message_text: 'Hey Auke, still happy to send it' })])[0]
  it('shows each reaction as a visible, linked line between the messages, never a view', () => {
    render(<History t={t0()} cap={10} engagements={[ev(iso(2 * 3_600_000), 'Newer post'), ev(iso(10 * 3_600_000), 'Older post'), { kind: 'view', at: iso(5 * 3_600_000), detail: null }, { kind: 'scan_open', at: iso(4 * 3_600_000), detail: null }]} />)
    const lines = [...document.querySelectorAll('.dm-ev')]
    expect(lines).toHaveLength(2)
    expect(lines.map(l => l.textContent)).toEqual([expect.stringContaining('Reacted to your post: “Older post”'), expect.stringContaining('Reacted to your post: “Newer post”')])
    expect((lines[0].querySelector('a') as HTMLAnchorElement).href).toContain('Older%20post')
    // the message (30h ago) comes first, then the two reactions in date order
    const order = [...document.querySelectorAll('.dm-b, .dm-ev')].map(n => n.className.includes('dm-ev') ? 'ev' : 'msg')
    expect(order).toEqual(['msg', 'ev', 'ev'])
  })
  it('shows a comment with its text', () => {
    render(<History t={t0()} cap={10} engagements={[ev(iso(2 * 3_600_000), 'P', { kind: 'comment', detail: 'Great point' })]} />)
    expect(document.querySelector('.dm-ev')?.textContent).toContain('Commented on your post')
    expect(document.querySelector('.dm-ev q')?.textContent).toBe('Great point')
  })
})

describe('waiting footer after a sent came-back follow-up (10-10)', () => {
  it('does not claim the ladder sends the next step', async () => {
    const { WaitingBanner, hasSentCamebackFollowup } = await import('./Banners')
    const sent = threads([msg({ prospect_id: 'a', direction: 'outbound', sent_at: iso(3_600_000), created_at: iso(3_600_000), ai_model: 'ivan_cameback_followup_v1' })])[0]
    expect(hasSentCamebackFollowup(sent)).toBe(true)
    render(<WaitingBanner t={sent} />)
    expect(document.body.textContent).toContain('No more scripted messages after the follow-up. A new reaction gets a draft here.')
    expect(document.body.textContent).not.toContain('the ladder sends')
    cleanup()
    const plain = threads([msg({ prospect_id: 'b', direction: 'outbound', sent_at: iso(3_600_000), created_at: iso(3_600_000) })])[0]
    render(<WaitingBanner t={plain} />)
    expect(document.body.textContent).toContain('the ladder sends the next step')
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
  return <ThreadPane t={t} all={[t]} phone={false} verbs={verbs} now={NOW} onBack={() => {}} onAsk={() => {}} onMenu={() => {}} staleN={0} pre={pre} reload={() => {}} />
}
const mount = (t: Thread) => renderInFrame(<DmAsks><Pane t={t} /></DmAsks>, { hash: '#exp/d/dms' })

describe('Mark as solved', () => {
  it.each(['reply_retry_pending', 'owner_confirmation'])('lets a draftless %s hold be solved and retires it before saving', async reason => {
    const pid = `held-${reason}`
    const rows = [
      ...waiting(pid, { client_id: 'arch', prospect_name: 'Dawoon' }, 3),
      msg({ prospect_id: pid, client_id: 'arch', prospect_name: 'Dawoon', direction: 'inbound',
        sent_at: iso(2 * 3_600_000), created_at: iso(2 * 3_600_000), message_text: '👍' }),
      msg({ prospect_id: pid, client_id: 'arch', prospect_name: 'Dawoon', message_text: '',
        created_at: iso(3_600_000), send_blocked_at: iso(3_600_000), send_blocked_reason: reason }),
    ]
    const [t] = threads(rows)
    expect(t.draft).toBeNull()
    expect(t.ownerConfirmation?.send_blocked_reason).toBe(reason)
    mount(t)
    fireEvent.click(key('solved')!)
    await waitFor(() => expect(solvedMod.writeSolved).toHaveBeenCalledWith(pid, { solved_at: iso(0) }))
    expect(lib.dismissConfirmation).toHaveBeenCalledWith(t.ownerConfirmation!.id, reason, iso(0))
    expect(vi.mocked(lib.dismissConfirmation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(solvedMod.writeSolved).mock.invocationCallOrder[0])
    expect(lib.discardLegs).not.toHaveBeenCalled()
    expect(threadBucket({ ...t, solvedAt: iso(0) }, NOW)).toBe('waiting')
    expect(owedIds([{ ...t, solvedAt: iso(0) }])).toEqual([pid])
    const reopened = threads([...rows, msg({ prospect_id: pid, client_id: 'arch', prospect_name: 'Dawoon', direction: 'inbound',
      sent_at: iso(-60_000), created_at: iso(-60_000), message_text: 'One more question' })])[0]
    expect(threadBucket({ ...reopened, solvedAt: iso(0) }, NOW + 60_000)).toBe('answer')
    fireEvent.click(key('undo')!)
    await waitFor(() => expect(lib.restoreConfirmation).toHaveBeenCalledWith(t.ownerConfirmation!.id, reason, iso(0), t.ownerConfirmation!.send_blocked_at))
    await waitFor(() => expect(solvedMod.writeSolved).toHaveBeenLastCalledWith(pid, { solved_at: null }))
  })

  it('does not save a solve when the retry hold changed before it could be retired', async () => {
    const [t] = threads([...owedNoDraft('changed', { client_id: 'arch', prospect_name: 'Changed' }), msg({
      prospect_id: 'changed', client_id: 'arch', message_text: '', created_at: iso(60_000),
      send_blocked_at: iso(60_000), send_blocked_reason: 'reply_retry_pending',
    })])
    vi.mocked(lib.dismissConfirmation).mockResolvedValueOnce(false)
    mount(t)
    fireEvent.click(key('solved')!)
    await waitFor(() => expect(lib.dismissConfirmation).toHaveBeenCalled())
    expect(solvedMod.writeSolved).not.toHaveBeenCalled()
  })

  it('restores a retired retry hold when the solve stamp fails', async () => {
    const [t] = threads([...owedNoDraft('failed', { client_id: 'arch', prospect_name: 'Failed' }), msg({
      prospect_id: 'failed', client_id: 'arch', message_text: '', created_at: iso(60_000),
      send_blocked_at: iso(60_000), send_blocked_reason: 'reply_retry_pending',
    })])
    vi.mocked(solvedMod.writeSolved).mockRejectedValueOnce(new Error('write failed'))
    mount(t)
    fireEvent.click(key('solved')!)
    await waitFor(() => expect(lib.restoreConfirmation).toHaveBeenCalledWith(t.ownerConfirmation!.id, 'reply_retry_pending', iso(0), t.ownerConfirmation!.send_blocked_at))
    expect(ctx.patch).not.toHaveBeenCalled()
    expect(screen.queryByText('Marked Failed as solved.')).toBeNull()
  })
  it('on a draft thread: discards every leg (plain, no ask), THEN one PATCH {solved_at, needs_manual_reply:false}; Undo restores all', async () => {
    const rows = drafted('s', { prospect_name: 'Sam' })
    const [t0] = groupThreads(rows, new Set(['s']), NOW)
    mount(t0)
    fireEvent.click(key('solved')!)
    await waitFor(() => expect(lib.discardLegs).toHaveBeenCalledWith([t0.draft], null))
    await waitFor(() => expect(solvedMod.writeSolved).toHaveBeenCalled())
    const [pid, body] = vi.mocked(solvedMod.writeSolved).mock.calls[0]
    expect(pid).toBe('s')
    expect(body.needs_manual_reply).toBe(false)
    expect(Date.parse(body.solved_at!)).toBe(NOW)
    expect(vi.mocked(lib.discardLegs).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(solvedMod.writeSolved).mock.invocationCallOrder[0])
    expect(await screen.findByText('Marked Sam as solved.')).toBeTruthy()
    fireEvent.click(key('undo')!)
    await waitFor(() => expect(lib.restoreDraft).toHaveBeenCalledWith(t0.draft!.id))
    await waitFor(() => expect(solvedMod.writeSolved).toHaveBeenLastCalledWith('s', { solved_at: null, needs_manual_reply: true }))
  })

  it('on an owed thread with NO draft: only the stamp (flag untouched when not raised); Undo puts the old stamp back', async () => {
    const [t] = threads(owedNoDraft('n', { prospect_name: 'Nod' }))
    mount(t)
    fireEvent.click(key('solved')!)
    await waitFor(() => expect(solvedMod.writeSolved).toHaveBeenCalled())
    expect(lib.discardLegs).not.toHaveBeenCalled()
    expect(Object.keys(vi.mocked(solvedMod.writeSolved).mock.calls[0][1])).toEqual(['solved_at'])
    fireEvent.click(await waitFor(() => key('undo')!))
    await waitFor(() => expect(solvedMod.writeSolved).toHaveBeenLastCalledWith('n', { solved_at: null }))
  })

  it('writes nothing more when every leg refused (already approved)', async () => {
    const [t] = threads(drafted('r', { prospect_name: 'Ray' }))
    vi.mocked(lib.discardLegs).mockResolvedValueOnce([{ leg: t.draft!, error: null }])
    mount(t)
    fireEvent.click(key('solved')!)
    await waitFor(() => expect(lib.discardLegs).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(50)
    expect(solvedMod.writeSolved).not.toHaveBeenCalled()
  })

  it('settle/return rule: solved_at at or after the last owed inbound settles it; a newer inbound brings it back', () => {
    const rows = owedNoDraft('b', { prospect_name: 'Bo' }, 30)
    const [t] = threads(rows)
    expect(threadBucket(t, NOW)).toBe('answer')
    // PostgREST shape ('+00:00') vs the inbound's 'Z': compared as instants, not strings
    const solvedPg = new Date(NOW - 60_000).toISOString().replace('Z', '+00:00')
    const settled = withSolved([t], new Map([['b', solvedPg]]))[0]
    expect(threadBucket(settled, NOW)).toBe('waiting')
    expect(unansweredWaitSince(settled)).toBeNull()
    expect(countDmSeat([settled], 'ivan', NOW).needs).toBe(0)
    expect(seatView([settled], 'ivan', NOW).nodraft).toHaveLength(0)
    const older = withSolved([t], new Map([['b', iso(40 * 3_600_000)]]))[0]
    expect(threadBucket(older, NOW)).toBe('answer')
    const again = threads([...rows, msg({ prospect_id: 'b', prospect_name: 'Bo', direction: 'inbound', sent_at: iso(1000), created_at: iso(1000), message_text: 'One more question: price?' })])
    expect(threadBucket(withSolved(again, new Map([['b', solvedPg]]))[0], NOW)).toBe('answer')
    expect(isSettledBySolve(null, iso(1000))).toBe(false)
  })

  it('owedIds lists owed threads by the message rule even when already solved (so the read keeps seeing them)', () => {
    const ts = threads([...owedNoDraft('o', { prospect_name: 'O' }), ...waiting('w', { prospect_name: 'W' })])
    expect(owedIds(withSolved(ts, new Map([['o', iso(1000)]])))).toEqual(['o'])
  })

  it('the discard rule still settles a solved draft thread after its stamp is gone', () => {
    const rows = drafted('d', { prospect_name: 'Di' })
    const solvedRows = [...rows.slice(0, 2), { ...rows[2], send_blocked_reason: 'discarded_in_inbox', send_blocked_at: iso(60_000) }]
    expect(threadBucket(threads(solvedRows)[0], NOW)).toBe('waiting')
  })

  it('is offered on an owed thread with no draft, never on a filed pitch', () => {
    mount(threads(owedNoDraft('n', { prospect_name: 'Nod' }))[0])
    expect(key('solved')).not.toBeNull()
    cleanup()
    mount(threads(owedNoDraft('p', { prospect_name: 'Pitch', client_id: 'risedtc', prospect_skip_reason: 'inbound_vendor_pitch' }))[0])
    expect(key('solved')).toBeNull()
  })
})
