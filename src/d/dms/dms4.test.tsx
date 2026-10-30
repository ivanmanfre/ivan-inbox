// @vitest-environment jsdom
// DMs 4: inline autosave, ONE Later key with two write paths, the Signals grouping, the came-back
// tag and the All conversations status words. The lib writes are mocked; the rules are not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/inbox', async orig => {
  const real = await orig<typeof import('../../lib/inbox')>()
  return {
    ...real,
    approveDraft: vi.fn(async () => {}), saveDraftText: vi.fn(async () => {}), saveDraftEmail: vi.fn(async () => {}),
    snoozeDraft: vi.fn(async () => {}), unsnoozeDraft: vi.fn(async () => {}), restoreDraft: vi.fn(async () => true),
    discardLegs: vi.fn(async () => []), composeReply: vi.fn(async () => []), markThreadRead: vi.fn(async () => {}),
    dismissConfirmation: vi.fn(async () => true), restoreConfirmation: vi.fn(async () => true),
  }
})
vi.mock('../../lib/followUp', async orig => ({ ...(await orig<typeof import('../../lib/followUp')>()),
  fetchFollowUp: vi.fn(async () => null), setFollowUp: vi.fn(async () => {}), clearFollowUp: vi.fn(async () => {}) }))
vi.mock('../../lib/emailCompositionSave', async orig => ({ ...(await orig<typeof import('../../lib/emailCompositionSave')>()), saveEmailComposition: vi.fn() }))

vi.mock('../../lib/dmDraft', () => ({ requestDmDraft: vi.fn() }))
import { requestDmDraft } from '../../lib/dmDraft'
import * as lib from '../../lib/inbox'
import * as fu from '../../lib/followUp'
import { DISCARD_REASON, type Thread } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import type { CameBackCard } from '../../wb/dms/cameBackData'
import type { WarmCard } from '../../wb/dms/warmSignalsData'
import { DmAsks } from './asks'
import { NOW, drafted, iso, msg, owedNoDraft, threads, waiting } from './fixtures'
import { laterItems, laterPath } from './later'
import { cameTag, signalItems, warmWord } from './signals'
import { statusOf } from './status'
import { ThreadPane } from './Thread'
import { AUTOSAVE_MS } from './useAutosave'
import { useDmVerbs } from './verbs'
import { saveEmailComposition } from '../../lib/emailCompositionSave'

const H = 3_600_000, D = 24 * H
const pre: PreReadHandle = { get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false }
const ctx = { refresh: vi.fn(), patch: vi.fn(), dated: vi.fn() }
function Pane({ t }: { t: Thread }) {
  const verbs = useDmVerbs(ctx)
  return <ThreadPane t={t} all={[t]} phone={false} verbs={verbs} now={NOW} onBack={() => {}} onAsk={() => {}} onMenu={() => {}} staleN={0} pre={pre} reload={() => {}} />
}
const mount = (t: Thread) => renderInFrame(<DmAsks><Pane t={t} /></DmAsks>, { hash: '#exp/d/dms' })
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('inline draft edit', () => {
  it('reports approval as queued until the provider confirms delivery', async () => {
    const [t] = threads(drafted('queued', { prospect_name: 'Ada' }))
    mount(t)
    fireEvent.click(key('send'))
    fireEvent.click(key('confirm-send'))
    await waitFor(() => expect(screen.getByText('Queued to Ada.')).toBeTruthy())
    expect(screen.queryByText('Sent to Ada.')).toBeNull()
  })

  it('labels an InMail follow-up and separates its subject from the short message', () => {
    const [t] = threads(drafted('inmail', { prospect_name: 'Alicia', client_id: 'arch', channel: 'linkedin_inmail', message_type: 'inmail' }))
    t.draft!.message_text = 'Subject: Re: Ismail suggested we connect\n\nDid you see the examples?'
    mount(t)
    expect(screen.getByText('InMail to Alicia')).toBeTruthy()
    expect((screen.getByLabelText('InMail subject') as HTMLInputElement).value).toBe('Re: Ismail suggested we connect')
    expect((screen.getByLabelText('InMail subject') as HTMLInputElement).placeholder).toBe('Add an InMail subject')
    expect((screen.getByLabelText('The draft') as HTMLTextAreaElement).value).toBe('Did you see the examples?')
  })

  it('shows the fixed Open Profile subject without adding it to the body', async () => {
    const [t] = threads(drafted('open-profile', { prospect_name: 'Paul', client_id: 'ivan', channel: 'linkedin_inmail', message_type: 'dm', ai_model: 'template/ivan_openprofile_v3' }))
    mount(t)
    const subject = screen.getByLabelText('InMail subject') as HTMLInputElement
    expect(subject.value).toBe('your LinkedIn')
    expect(subject.readOnly).toBe(true)
    const body = screen.getByLabelText('The draft') as HTMLTextAreaElement
    expect(body.value).toBe(t.draft!.message_text)
    fireEvent.change(body, { target: { value: 'Updated InMail body' } })
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50)
    await waitFor(() => expect(lib.saveDraftText).toHaveBeenCalledWith(t.draft!.id, 'Updated InMail body'))
    expect(screen.queryByPlaceholderText('Add an email subject')).toBeNull()
  })

  it('starts an unanswered referred lead with context and folds the sent history', () => {
    const [t] = threads([
      msg({ prospect_id: 'referral', client_id: 'arch', ai_model: 'arch_referral_package_v1', sent_at: iso(H), message_text: 'Sent introduction' }),
      msg({ prospect_id: 'referral', client_id: 'arch', ai_model: 'arch_referral_followup_v1', message_text: 'Did you see the examples?' }),
    ])
    mount(t)
    const context = screen.getByRole('region', { name: 'Referral outreach package' })
    const sent = document.querySelector('.dm-referral-history') as HTMLDetailsElement
    expect(sent.open).toBe(false)
    expect(context.compareDocumentPosition(sent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((screen.getByLabelText('The draft') as HTMLTextAreaElement).value).toBe('Did you see the examples?')
    fireEvent.click(sent.querySelector('summary')!)
    expect(screen.getByText('Sent introduction')).toBeTruthy()
  })

  it('loads email copy that arrives after the same DM draft, without autosaving it', async () => {
    const [t] = threads(drafted('late-email', { client_id: 'arch', recipient_email: 'doug@outplay.com' }))
    const mirror = 'Subject: Re: ARCH. x Outplay\n\nDid the details cover what you wanted to know?'
    let refresh!: (next: Thread) => void
    function Live() { const [current, setCurrent] = useState(t); refresh = setCurrent; return <DmAsks><Pane t={current} /></DmAsks> }
    renderInFrame(<Live />, { hash: '#exp/d/dms' })
    act(() => refresh({ ...t, draft: { ...t.draft!, email_mirror_text: mirror } }))
    expect(screen.getByLabelText('The email that goes with it').textContent).toBe('Did the details cover what you wanted to know?')
    expect((screen.getByLabelText('Email subject') as HTMLInputElement).value).toBe('Re: ARCH. x Outplay')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50)
    expect(saveEmailComposition).not.toHaveBeenCalled()
    expect(lib.saveDraftText).not.toHaveBeenCalled()
  })

  it('preserves an operator email subject edit when the server refreshes the same draft', () => {
    const [t] = threads(drafted('edited-email', { client_id: 'arch', recipient_email: 'doug@outplay.com', email_mirror_text: 'Subject: Follow-up\n\nOriginal copy' }))
    let refresh!: (next: Thread) => void
    function Live() { const [current, setCurrent] = useState(t); refresh = setCurrent; return <DmAsks><Pane t={current} /></DmAsks> }
    renderInFrame(<Live />, { hash: '#exp/d/dms' })
    fireEvent.change(screen.getByLabelText('Email subject'), { target: { value: 'My edited subject' } })
    act(() => refresh({ ...t, draft: { ...t.draft!, email_mirror_text: 'Subject: Follow-up\n\nRefreshed server copy' } }))
    expect((screen.getByLabelText('Email subject') as HTMLInputElement).value).toBe('My edited subject')
    expect(screen.getByLabelText('The email that goes with it').textContent).toBe('Original copy')
  })

  it('the draft is a textarea with no Edit key; typing saves once after the pause, via the guarded save, and says Saved', async () => {
    const [t] = threads(drafted('a', { prospect_name: 'Ada' }))
    mount(t)
    expect(key('edit')).toBeNull()
    expect(key('save-edit')).toBeNull()
    const ta = document.querySelector('.dm-edit') as HTMLTextAreaElement
    expect(ta.value).toBe(t.draft!.message_text)
    fireEvent.change(ta, { target: { value: 'Happy to. New line' } })
    fireEvent.change(ta, { target: { value: 'Happy to. New line two' } })
    expect(lib.saveDraftText).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50)
    await waitFor(() => expect(lib.saveDraftText).toHaveBeenCalledTimes(1))
    expect(lib.saveDraftText).toHaveBeenCalledWith(t.draft!.id, 'Happy to. New line two')
    await waitFor(() => expect(document.querySelector('.dm-save')!.textContent).toBe('Saved'))
    expect(ctx.patch).toHaveBeenCalledWith([t.draft!.id], { message_text: 'Happy to. New line two' })
  })

  it('blur saves at once; a failed save says Not saved with Retry', async () => {
    vi.mocked(lib.saveDraftText).mockRejectedValueOnce({ message: 'network down' })
    const [t] = threads(drafted('b', { prospect_name: 'Bo' }))
    mount(t)
    const ta = document.querySelector('.dm-edit') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'Edited' } })
    fireEvent.blur(ta)
    await waitFor(() => expect(lib.saveDraftText).toHaveBeenCalledWith(t.draft!.id, 'Edited'))
    await waitFor(() => expect(document.querySelector('.dm-save')!.textContent).toContain('Not saved'))
    fireEvent.click(key('autosave-retry'))
    await waitFor(() => expect(lib.saveDraftText).toHaveBeenCalledTimes(2))
  })

  it('Send saves the text on screen before approval and drops the pending autosave', async () => {
    const [t] = threads(drafted('c', { prospect_name: 'Cy', unipile_chat_id: 'ch' }))
    mount(t)
    fireEvent.change(document.querySelector('.dm-edit')!, { target: { value: 'Final words' } })
    fireEvent.click(key('send'))
    fireEvent.click(await screen.findByText('Approve & send'))
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledWith(t.draft!.id, 'Final words', 'ch',
      expect.objectContaining({ id: t.draft!.id })))
    expect(lib.saveDraftText).toHaveBeenCalledWith(t.draft!.id, 'Final words')
    expect(vi.mocked(lib.saveDraftText).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(lib.approveDraft).mock.invocationCallOrder[0])
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50)
    expect(lib.saveDraftText).toHaveBeenCalledTimes(1)
  })
})

describe('ONE Later key', () => {
  it('laterPath: a draft snoozes, a draftless Rise/Arch thread follows up, Ivan draftless has none', () => {
    expect(laterPath(threads(drafted('d', { client_id: 'ivan' }))[0])).toBe('snooze')
    expect(laterPath(threads(owedNoDraft('e', { client_id: 'risedtc' }))[0])).toBe('followup')
    expect(laterPath(threads(waiting('f', { client_id: 'arch' }))[0])).toBe('followup')
    expect(laterPath(threads(owedNoDraft('g', { client_id: 'ivan' }))[0])).toBeNull()
  })

  it('with a draft: Later -> Tomorrow -> snoozeDraft; Undo unsnoozes', async () => {
    const [t] = threads(drafted('h', { prospect_name: 'Hal', client_id: 'arch' }))
    mount(t)
    fireEvent.click(key('later'))
    fireEvent.click(await waitFor(() => key('date-1d')))
    await waitFor(() => expect(lib.snoozeDraft).toHaveBeenCalledWith(t.draft!.id, expect.any(String)))
    expect(fu.setFollowUp).not.toHaveBeenCalled()
    fireEvent.click(await waitFor(() => key('undo')))
    await waitFor(() => expect(lib.unsnoozeDraft).toHaveBeenCalledWith(t.draft!.id))
  })

  it('without a draft (Rise): Later -> note + Next week -> setFollowUp with the note; Undo clears', async () => {
    const [t] = threads(owedNoDraft('i', { prospect_name: 'Ida', client_id: 'risedtc' }))
    mount(t)
    fireEvent.click(key('later'))
    await waitFor(() => key('date-1w'))
    fireEvent.change(document.querySelector('.dm-later-note textarea')!, { target: { value: 'back mid October' } })
    fireEvent.click(key('date-1w'))
    await waitFor(() => expect(fu.setFollowUp).toHaveBeenCalledWith('i', expect.any(String), 'back mid October'))
    expect(lib.snoozeDraft).not.toHaveBeenCalled()
    fireEvent.click(await waitFor(() => key('undo')))
    await waitFor(() => expect(fu.clearFollowUp).toHaveBeenCalledWith('i'))
  })

  it('the Later list merges pushed drafts and dated follow-ups, soonest first, one row a person', () => {
    const rows = [...drafted('p', { prospect_name: 'Pushed', client_id: 'arch' }), ...waiting('q', { prospect_name: 'Dated', client_id: 'arch' })]
    const ts = threads(rows).map(t => (t.prospect_id === 'p' ? { ...t, draftSnoozedUntil: iso(-5 * D) } : t))
    const by = new Map(ts.map(t => [t.prospect_id, t]))
    const items = laterItems(ts.filter(t => t.draftSnoozedUntil), [{ prospect_id: 'q', at: iso(-2 * D) }, { prospect_id: 'p', at: iso(-9 * D) }], by, 'arch')
    expect(items.map(i => `${i.t.prospect_name}:${i.kind}`)).toEqual(['Dated:followup', 'Pushed:draft'])
    expect(laterItems([], [{ prospect_id: 'q', at: iso(-2 * D) }], by, 'ivan')).toEqual([])
  })
})

const card = (p: Partial<CameBackCard> & { prospect_id: string }): CameBackCard => ({
  tenant: 'ivan', name: 'Auke de Geus', headline: null, company: 'Ecom', title: null, country: null, icp_score: 7, stage: 'dm_sent', campaign: null,
  linkedin_url: null, dm_count: 2, last_out_at: iso(6 * D), last_out_model: null, last_out_text: null, last_signal_at: iso(2 * D + H),
  n_views: 1, n_engagements: 0, signals: [], ...p,
} as CameBackCard)

describe('came back = a tag on the name; Signals = one list', () => {
  it('labels a delayed first profile visit without claiming a return', () => {
    const first = card({ prospect_id: 'first', signals: [{ kind: 'view', at: iso(2 * D), detail: null, profile_return: false }] })
    expect(cameTag(first, NOW).text).toBe('viewed profile · 2d')
    expect(signalItems('ivan', [], [], [first], new Map())[0].label).toBe('viewed profile')
  })
  it('keeps the return label when a profile return also carries a post comment', () => {
    const returned = card({ prospect_id: 'return', n_engagements: 1, signals: [
      { kind: 'view', at: iso(2 * D), detail: null, profile_return: true },
      { kind: 'comment', at: iso(D), detail: 'Useful' },
    ] })
    expect(cameTag(returned, NOW).text).toBe('came back · 2d')
    expect(cameTag(returned, NOW).title).toContain('viewed the profile again')
  })
  it('cameTag says came back and how long ago, and its tooltip what they came back to', () => {
    const tag = cameTag(card({ prospect_id: 'x' }), NOW)
    expect(tag.text).toBe('came back · 2d')
    expect(tag.title).toMatch(/viewed the profile/)
    expect(tag.title).toMatch(/Message 2 went out/)
    expect(cameTag(card({ prospect_id: 'y', last_signal_at: iso(2 * H) }), NOW).text).toBe('came back · today')
  })

  it('Signals holds warm cards (labelled by kind) and came-back people with no conversation; a conversation keeps only the tag', () => {
    const ts = threads([...waiting('conv', { client_id: 'ivan' }), msg({ prospect_id: 'echo', direction: 'outbound', sent_at: iso(3 * D) })])
    const by = new Map(ts.map(t => [t.prospect_id, t]))
    const warm = [{ prospect_id: 'w1', signal_source: 'profile_view', trigger_type: 'profile_view' }, { prospect_id: 'w2', signal_source: 'commented_own_post', trigger_type: null }] as WarmCard[]
    const came = [card({ prospect_id: 'conv' }), card({ prospect_id: 'echo' }), card({ prospect_id: 'nothread' }), card({ prospect_id: 'rise', tenant: 'risedtc' as CameBackCard['tenant'] })]
    const iv = signalItems('ivan', warm, [], came, by)
    expect(iv.map(i => `${i.pid}:${i.label}`)).toEqual(['w1:viewed your profile', 'w2:commented on your post', 'echo:came back', 'nothread:came back'])
    const rise = signalItems('risedtc', warm, [], came, by)
    expect(rise.map(i => i.pid)).toEqual(['rise'])
    // db/298: a RISE profile viewer's warm card lands on RISE's list only
    const riseWarm = { ...warm[0], prospect_id: 'rw', tenant: 'risedtc', signal_kind: 'new_invite' }
    expect(signalItems('risedtc', [riseWarm], [], [], by).map(i => `${i.pid}:${i.label}`)).toEqual(['rw:viewed the profile'])
    expect(signalItems('ivan', [riseWarm], [], [], by)).toEqual([])
    expect(warmWord({ signal_source: 'profile_view', trigger_type: null, signal_kind: 'next_touch', tenant: 'arch' })).toBe('viewed, no reply yet')
    expect(warmWord({ signal_source: 'reacted', trigger_type: null })).toBe('engaged two posts')
  })
})

describe('All conversations status words', () => {
  it('maps each thread to one word from today\'s rules', () => {
    const w = (rows: ReturnType<typeof waiting>) => threads(rows)[0]
    expect(statusOf(w(drafted('a', {})), NOW).word).toBe('needs you')
    expect(statusOf(w(waiting('b', {})), NOW).word).toBe('waiting on them')
    const pushed = { ...w(drafted('c', {})), draftSnoozedUntil: '2026-10-02T06:00:00Z' }
    expect(statusOf(pushed, NOW).kind).toBe('later')
    expect(statusOf(w(waiting('d', {})), NOW, '2026-10-05T06:00:00Z').word).toMatch(/^later · /)
    expect(statusOf(w(owedNoDraft('e', {}, 20 * 24)), NOW).word).toBe('older')
    const solved = { ...w(owedNoDraft('f', {})), solvedAt: iso(H) }
    expect(statusOf(solved, NOW).word).toBe('solved')
    const disc = w([...owedNoDraft('g', {}), msg({ prospect_id: 'g', send_blocked_reason: DISCARD_REASON, send_blocked_at: iso(2 * H), created_at: iso(3 * H) })])
    expect(statusOf(disc, NOW).word).toBe('discarded')
    const signoff = w([...waiting('h', {}), msg({ prospect_id: 'h', direction: 'inbound', message_text: 'Thanks!', created_at: iso(H) })])
    expect(statusOf(signoff, NOW).word).toBe('replied')
    const ooo = w([...waiting('i', {}), msg({ prospect_id: 'i', direction: 'inbound', message_text: 'I am out of office until Monday', created_at: iso(H) })])
    expect(statusOf(ooo, NOW).word).toBe('auto-reply')
  })
})


describe('manual reply after drafting fails', () => {
  function held(why: string | null) {
    return threads([...owedNoDraft('tetiana', { client_id: 'arch', prospect_name: 'Tetiana Klimonova' }), msg({
      prospect_id: 'tetiana', client_id: 'arch', prospect_name: 'Tetiana Klimonova', message_text: '',
      created_at: iso(0), send_blocked_at: iso(0), send_blocked_reason: 'owner_confirmation',
      context_gap: { question: 'The reply pipeline failed 3 times on this thread. Write this one by hand.', why, chat_url: null },
    })])[0]
  }

  it('lets the operator type after the retry ceiling, then confirms before queueing', async () => {
    const t = held('Retry ceiling reached: Request failed with status code 503')
    mount(t)
    expect(screen.getByText('Write this reply yourself')).toBeTruthy()
    expect(screen.queryByText('Confirm with Davorin')).toBeNull()
    expect(key('hold-note')).toBeNull()
    expect(key('ask-owner-link')).toBeNull()
    const box = screen.getByRole('textbox', { name: 'Write to Tetiana yourself' })
    fireEvent.change(box, { target: { value: 'Thanks for letting me know.' } })
    expect((box as HTMLTextAreaElement).value).toBe('Thanks for letting me know.')
    expect(lib.composeReply).not.toHaveBeenCalled()
    fireEvent.click(key('compose-send'))
    expect(await screen.findByText('Send this to Tetiana Klimonova?')).toBeTruthy()
    expect(lib.composeReply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Send it'))
    await waitFor(() => expect(lib.composeReply).toHaveBeenCalledWith(t, 'Thanks for letting me know.'))
  })

  it('Release hold retires the owner question without a confirm, patches it out, and offers Undo', async () => {
    const t = held('The company notes do not establish this.')
    const hold = t.ownerConfirmation!
    mount(t)
    fireEvent.click(key('hold-release'))
    await waitFor(() => expect(lib.dismissConfirmation).toHaveBeenCalledWith(hold.id, 'owner_confirmation', expect.any(String)))
    expect(screen.queryByText('Discard this internal question?')).toBeNull()
    expect(ctx.patch).toHaveBeenCalledWith([hold.id], expect.objectContaining({ send_blocked_reason: 'owner_confirmation_superseded' }))
    expect(await screen.findByText('Hold released on Tetiana Klimonova.')).toBeTruthy()
    const at = vi.mocked(lib.dismissConfirmation).mock.calls[0][2]
    fireEvent.click(key('undo'))
    await waitFor(() => expect(lib.restoreConfirmation).toHaveBeenCalledWith(hold.id, 'owner_confirmation', at, hold.send_blocked_at))
  })

  // Ivan 10-21 (Barak Zuman): an open internal question locked the reply box, and a retry hold
  // showed no button at all. His own hand reply is never blocked; sending it retires the question.
  it.each([
    ['owner_confirmation', 'The company notes do not establish this.'],
    ['owner_confirmation', null],
    ['reply_retry_pending', 'Proposes a fixed slot from the online calendar.'],
  ] as const)('lets him reply by hand over a %s hold (%s), and the send retires it', async (reason, why) => {
    const t = held(why)
    const hold = { ...t.ownerConfirmation!, send_blocked_reason: reason }
    const th = { ...t, ownerConfirmation: hold, messages: t.messages.map(m => m.id === hold.id ? hold : m) }
    mount(th)
    expect(screen.queryByText(/Reply paused while an internal fact is confirmed/)).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Write to Tetiana yourself' }), { target: { value: 'All good, send me the day.' } })
    fireEvent.click(key('compose-send'))
    fireEvent.click(await screen.findByText('Send it'))
    await waitFor(() => expect(lib.composeReply).toHaveBeenCalledWith(th, 'All good, send me the day.'))
    await waitFor(() => expect(lib.dismissConfirmation).toHaveBeenCalledWith(hold.id, reason))
  })
})


describe('Draft it runs in the thread', () => {
  it('shows loading, prevents repeated clicks, and offers an inline retry on failure', async () => {
    let reject!: (reason: Error) => void
    vi.mocked(requestDmDraft).mockImplementation(() => new Promise((_resolve, no) => { reject = no }))
    const [t] = threads(owedNoDraft('draft-click', { client_id: 'arch', prospect_name: 'Tetiana' }))
    mount(t)
    fireEvent.click(key('draft-it'))
    expect(screen.getByText('Drafting…')).toBeTruthy()
    expect((key('draft-it') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(key('draft-it'))
    expect(requestDmDraft).toHaveBeenCalledTimes(1)
    expect(requestDmDraft).toHaveBeenCalledWith(t)
    reject(new Error('The drafting service is busy. Try again.'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The drafting service is busy. Try again.'))
    expect((key('draft-it') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('Draft it')).toBeTruthy()
  })
})
