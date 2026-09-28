// @vitest-environment jsdom
// DMs 4: inline autosave, ONE Later key with two write paths, the Signals grouping, the came-back
// tag and the All conversations status words. The lib writes are mocked; the rules are not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/inbox', async orig => {
  const real = await orig<typeof import('../../lib/inbox')>()
  return {
    ...real,
    approveDraft: vi.fn(async () => {}), saveDraftText: vi.fn(async () => {}), saveDraftEmail: vi.fn(async () => {}),
    snoozeDraft: vi.fn(async () => {}), unsnoozeDraft: vi.fn(async () => {}), restoreDraft: vi.fn(async () => true),
    discardLegs: vi.fn(async () => []), composeReply: vi.fn(async () => []), markThreadRead: vi.fn(async () => {}),
  }
})
vi.mock('../../lib/followUp', async orig => ({ ...(await orig<typeof import('../../lib/followUp')>()),
  fetchFollowUp: vi.fn(async () => null), setFollowUp: vi.fn(async () => {}), clearFollowUp: vi.fn(async () => {}) }))

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

const H = 3_600_000, D = 24 * H
const pre: PreReadHandle = { get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false }
const ctx = { refresh: vi.fn(), patch: vi.fn(), dated: vi.fn() }
function Pane({ t }: { t: Thread }) {
  const verbs = useDmVerbs(ctx)
  return <ThreadPane t={t} all={[t]} phone={false} verbs={verbs} now={NOW} onBack={() => {}} onAsk={() => {}} onDraftIt={() => {}} onMenu={() => {}} staleN={0} pre={pre} reload={() => {}} />
}
const mount = (t: Thread) => renderInFrame(<DmAsks><Pane t={t} /></DmAsks>, { hash: '#exp/d/dms' })
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('inline draft edit', () => {
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

  it('Send carries the text on screen and drops the pending autosave', async () => {
    const [t] = threads(drafted('c', { prospect_name: 'Cy', unipile_chat_id: 'ch' }))
    mount(t)
    fireEvent.change(document.querySelector('.dm-edit')!, { target: { value: 'Final words' } })
    fireEvent.click(key('send'))
    fireEvent.click(await screen.findByText('Approve & send'))
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledWith(t.draft!.id, 'Final words', 'ch'))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50)
    expect(lib.saveDraftText).not.toHaveBeenCalled()
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

  it.each(['The company notes do not establish this.', null])('keeps real or unreadable owner questions blocked: %s', why => {
    mount(held(why))
    expect(screen.queryByRole('textbox', { name: 'Write to Tetiana yourself' })).toBeNull()
    expect(screen.getByText('Confirm with Davorin')).toBeTruthy()
    expect(key('hold-note')).not.toBeNull()
    expect(key('compose-send')).toBeNull()
  })
})
