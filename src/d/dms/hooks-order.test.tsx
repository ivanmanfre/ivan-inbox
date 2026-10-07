// @vitest-environment jsdom
// Brief 4 DMs (skin section `dms`): T1 hook order, T8 contract selectors, the React unsaved guard,
// the new keys and the one-primary rule. The 09-09 incident (a hook after an early return blanked
// every thread tap) is the reason for T1: every container is re-rendered through its states as the
// SAME instance, and any React hook-order complaint fails the test. Lib writes are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/inbox', async orig => ({
  ...(await orig<typeof import('../../lib/inbox')>()),
  approveDraft: vi.fn(async () => {}), saveDraftText: vi.fn(async () => {}), saveDraftEmail: vi.fn(async () => {}),
  discardLegs: vi.fn(async () => []), composeReply: vi.fn(async () => []), markThreadRead: vi.fn(async () => {}),
  snoozeDraft: vi.fn(async () => {}), restoreDraft: vi.fn(async () => true), markSpam: vi.fn(async () => {}), deleteThread: vi.fn(async () => {}),
}))
vi.mock('../../lib/followUp', async orig => ({ ...(await orig<typeof import('../../lib/followUp')>()), fetchFollowUp: vi.fn(async () => null), setFollowUp: vi.fn(async () => {}) }))
vi.mock('../../lib/dmDraft', () => ({ requestDmDraft: vi.fn(async () => {}) }))
vi.mock('../../exp/v2c/chat/usePreRead', () => ({ usePreRead: () => ({ get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false }) }))
const data = vi.hoisted(() => ({ threads: [] as unknown[] }))
vi.mock('./useDmsData', () => {
  const side = () => ({ rows: [], failed: false, loaded: true })
  return {
    useDmsData: () => ({
      threads: data.threads, loading: false, error: null, loadedAt: '2026-09-27T09:00:00Z', fromCache: false, cachedAt: null,
      refreshList: () => {}, refreshAll: () => {}, patch: () => {}, solved: { setLocal: () => {} },
      cameBack: side(), dropCameBack: () => {}, reloadCame: () => {}, scanDays: new Map(), interestRanks: new Map(),
      warm: side(), dropWarm: () => {}, reloadWarm: () => {}, dated: side(), reloadDated: () => {}, upcoming: side(),
      agent: { cards: [], note: null, failed: false, loaded: true }, reloadAgent: () => {},
    }),
  }
})

import * as lib from '../../lib/inbox'
import type { Thread } from '../../lib/inbox'
import { __resetSkinForTests, type Section } from '../../ds/skin'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import { parseDHash } from '../route'
import { DmAsks } from './asks'
import { NOW, drafted, iso, msg, owedNoDraft, threads, waiting } from './fixtures'
import { ThreadPane } from './Thread'
import { useDmVerbs } from './verbs'
import DmsPage from './index'

const H = 3_600_000
const HOOK_ERR = /Rendered (more|fewer) hooks|change in the order of Hooks|#300|#310|An error occurred in the </
let logged: string[] = []
const pre: PreReadHandle = { get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false }
const ctx = { refresh: vi.fn(), patch: vi.fn(), dated: vi.fn() }

function Pane({ t, v4, phone = false }: { t: Thread; v4: boolean; phone?: boolean }) {
  const verbs = useDmVerbs(ctx)
  return <ThreadPane t={t} all={[t]} phone={phone} verbs={verbs} now={NOW} onBack={() => {}} onAsk={() => {}} onMenu={() => {}} staleN={0} pre={pre} reload={() => {}} v4={v4} />
}
const paneUi = (t: Thread, v4 = true, phone = false) => <DmAsks><Pane t={t} v4={v4} phone={phone} /></DmAsks>
// One mounted host whose child is swapped in place (renderInFrame's rerender would drop its providers).
let swap: (ui: ReactElement) => void = () => {}
function Host({ first }: { first: ReactElement }) { const [ui, setUi] = useState(first); swap = u => act(() => setUi(u)); return ui }
function mountSwap(first: ReactElement, opts: Parameters<typeof renderInFrame>[1]) {
  const r = renderInFrame(<Host first={first} />, opts)
  return { ...r, rerender: (ui: ReactElement) => swap(ui) }
}
// The band's slots, so the page's portalled tools (seat control, search) render in the test.
function slots() {
  const title = document.createElement('div'), tools = document.createElement('div')
  document.body.append(title, tools)
  return { titleSlot: title, toolsSlot: tools }
}
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement | null

const skin = (on: Section[]) => __resetSkinForTests(new Set(on))
beforeEach(() => {
  logged = []
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); vi.clearAllMocks()
  for (const k of ['error', 'warn'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')) })
  localStorage.clear()
})
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); skin([])
  expect(logged.filter(l => HOOK_ERR.test(l))).toEqual([])
})

// Every thread state the dock matrix (SPEC-dms §2.5) can reach.
function states(): [string, Thread][] {
  const [d] = threads(drafted('p1', { prospect_name: 'Ada Draft', client_id: 'risedtc' }))
  const [n] = threads(owedNoDraft('p1', { prospect_name: 'Ada Draft', client_id: 'risedtc' }))
  const [w] = threads(waiting('p1', { prospect_name: 'Ada Draft', client_id: 'risedtc' }))
  const hold = msg({ prospect_id: 'p1', client_id: 'risedtc', direction: 'outbound', ai_model: 'owner_confirmation', send_blocked_reason: 'reply_retry_pending', created_at: iso(2 * H) })
  const email = msg({ prospect_id: 'p1', client_id: 'arch', direction: 'inbound', channel: 'email', sent_at: iso(3 * H), created_at: iso(3 * H), message_text: 'By email', recipient_email: 'a@b.co' } as never)
  const [e] = threads([...owedNoDraft('p1', { prospect_name: 'Ada Draft', client_id: 'arch' }), email])
  return [
    ['draft', d], ['no-draft owed', n], ['waiting', w],
    ['spam', { ...d, spam: true } as Thread],
    ['owner hold pending', { ...n, ownerConfirmation: hold } as unknown as Thread],
    ['not connected', { ...n, stage: 'engaged' } as Thread],
    ['email reply', e],
    ['two legs', { ...d, companionDraft: { ...d.draft!, id: 'leg2', channel: 'email', recipient_email: 'x@y.co', message_text: 'Email leg' } } as Thread],
    ['stale', { ...d, draftStale: true } as Thread],
    ['snoozed', { ...d, draftSnoozedUntil: iso(-48 * H) } as Thread],
    ['empty history', { ...n, messages: [] } as Thread],
    ['draft again', d],
  ]
}

describe('T1 · hook order: one ThreadPane instance through every state', () => {
  it('v4 on: every state re-renders the same pane with no hook complaint', () => {
    const st = states()
    const r = mountSwap(paneUi(st[0][1]), { hash: '#exp/d/dms' })
    for (const [, t] of st) { r.rerender(paneUi(t)); expect(document.querySelector('section.dm-pane')).not.toBeNull() }
  })
  it('the flag flips under a live pane (v4 -> legacy -> v4) without remounting hooks badly', () => {
    const [, t] = states()[0]
    const r = mountSwap(paneUi(t, true), { hash: '#exp/d/dms' })
    expect(document.querySelector('.dx-pane')).not.toBeNull()
    r.rerender(paneUi(t, false)); expect(document.querySelector('.dx-pane')).toBeNull()
    r.rerender(paneUi(t, true)); expect(document.querySelector('.dx-pane')).not.toBeNull()
  })
  it('phone v4 through the same states', () => {
    const st = states()
    const r = mountSwap(paneUi(st[0][1], true, true), { hash: '#exp/d/dms', layout: 'phone' })
    for (const [, t] of st) r.rerender(paneUi(t, true, true))
    expect(document.querySelectorAll('section.dm-pane [data-verb="back"]')).toHaveLength(1)
  })
})

function page(layout: 'desktop' | 'phone', hash: string, navigate = vi.fn()) {
  const route = parseDHash(hash)
  const ui = (h = hash) => <DmsPage layout={layout} route={parseDHash(h)} navigate={navigate} />
  const r = mountSwap(ui(), { hash, layout, frame: layout === 'desktop' ? slots() : {} })
  return { r, rerender: (h: string) => r.rerender(ui(h)), navigate, route }
}

function seedPage() {
  data.threads = [
    ...threads(drafted('a', { prospect_name: 'Ada Lovelace', client_id: 'risedtc' }, 5)),
    ...threads(owedNoDraft('b', { prospect_name: 'Ben Owed', client_id: 'risedtc' }, 30)),
    ...threads(waiting('c', { prospect_name: 'Cy Waiting', client_id: 'risedtc' }, 10)),
  ]
}

describe('T8 · contract selectors with v4 on (desktop + phone)', () => {
  it('desktop: list, rows, seat tabs, folders, pane, history, draft editor, composer, Close x1', async () => {
    skin(['dms', 'tokens', 'type', 'motion', 'shell']); seedPage()
    page('desktop', '#exp/d/dms?seat=risedtc&thread=a')
    await waitFor(() => expect(document.querySelector('section.dm-pane[aria-label="Conversation with Ada Lovelace"]')).not.toBeNull())
    expect(document.querySelector('.dm-page.dm-desk[data-v4-guard]')).not.toBeNull()
    expect(document.querySelector('.dm-list[data-seat="risedtc"]')).not.toBeNull()
    const row = document.querySelector('.dm-list [data-d-row="a"]')!
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('aria-current')).toBe('true')
    const nameText = Array.from(row.querySelector('.dm-n')!.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()
    expect(nameText).toBe('Ada Lovelace')
    expect(document.querySelectorAll('.dm-sq[data-pick]')).toHaveLength(3)
    expect(document.querySelectorAll('.dm-fd[role="tab"]')).toHaveLength(3)
    expect(document.querySelectorAll('section.dm-pane [data-verb="close"]')).toHaveLength(1)
    expect(document.querySelector('[data-d-thread-who]')?.textContent).toBe('Ada Lovelace')
    expect(document.querySelector('.dm-hist [data-msg] .dm-bub')).not.toBeNull()
    expect(document.querySelector('[data-draft] .dm-edit[data-autosave]')).not.toBeNull()
    expect(document.querySelector('.dm-save')).not.toBeNull()
    expect(document.querySelector('.dm-comp textarea')?.getAttribute('aria-label')).toBe('Write to Ada yourself')
    expect(document.querySelector('.dm-qmore[data-verb="row-more"]')).not.toBeNull()
    expect(document.querySelector('[data-sec="coming"]')).not.toBeNull()
  })
  it('phone: list, then the thread takeover with exactly one Back', async () => {
    skin(['dms', 'tokens', 'type', 'motion', 'shell']); seedPage()
    const p = page('phone', '#exp/d/dms?seat=risedtc')
    await waitFor(() => expect(document.querySelector('.dm-list [data-d-row="a"]')).not.toBeNull())
    expect(document.querySelector('.dm-page.dm-phone[data-v4-guard]')).not.toBeNull()
    p.rerender('#exp/d/dms?seat=risedtc&thread=a')
    await waitFor(() => expect(document.querySelector('.dm-phone-thread')).not.toBeNull())
    expect(document.querySelectorAll('section.dm-pane [data-verb="back"]')).toHaveLength(1)
    p.rerender('#exp/d/dms?seat=risedtc&folder=spam'); p.rerender('#exp/d/dms?seat=risedtc&folder=email'); p.rerender('#exp/d/dms?seat=ivan')
  })
  it('flag off: none of the v4 markup renders (legacy DOM)', async () => {
    skin([]); seedPage()
    page('desktop', '#exp/d/dms?seat=risedtc&thread=a')
    await waitFor(() => expect(document.querySelector('section.dm-pane')).not.toBeNull())
    expect(document.querySelector('[data-v4-guard],.dx-row,.dx-pane,.dx-seats,.dx-card')).toBeNull()
    expect(document.querySelector('.dm-sqs')).not.toBeNull()
  })
})

describe('the React unsaved guard (SPEC-dms §3.4)', () => {
  it('a typed reply asks before another thread opens; Cancel keeps him on it, OK goes', async () => {
    skin(['dms', 'tokens', 'type', 'motion', 'shell']); seedPage()
    const p = page('desktop', '#exp/d/dms?seat=risedtc&thread=b')
    await waitFor(() => expect(document.querySelector('section.dm-pane[aria-label="Conversation with Ben Owed"]')).not.toBeNull())
    fireEvent.change(document.querySelector('.dm-comp textarea')!, { target: { value: 'my own words' } })
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    fireEvent.click(document.querySelector('.dm-list [data-d-row="a"]')!)
    expect(ask).toHaveBeenCalledWith('Discard the unsaved reply or draft changes and continue?')
    expect(p.navigate).not.toHaveBeenCalled()
    ask.mockReturnValueOnce(true)
    fireEvent.click(document.querySelector('.dm-list [data-d-row="a"]')!)
    expect(p.navigate).toHaveBeenCalledTimes(1)
  })
  it('a clean thread never asks; flag off never asks (the bridge owns it there)', async () => {
    skin(['dms', 'tokens', 'type', 'motion', 'shell']); seedPage()
    const p = page('desktop', '#exp/d/dms?seat=risedtc&thread=b')
    await waitFor(() => expect(document.querySelector('section.dm-pane')).not.toBeNull())
    const ask = vi.spyOn(window, 'confirm')
    fireEvent.click(document.querySelector('.dm-list [data-d-row="a"]')!)
    expect(ask).not.toHaveBeenCalled(); expect(p.navigate).toHaveBeenCalledTimes(1)
    cleanup(); skin([])
    const q = page('desktop', '#exp/d/dms?seat=risedtc&thread=b')
    await waitFor(() => expect(document.querySelector('section.dm-pane')).not.toBeNull())
    fireEvent.change(document.querySelector('.dm-comp textarea')!, { target: { value: 'x' } })
    fireEvent.click(document.querySelector('.dm-list [data-d-row="a"]')!)
    expect(ask).not.toHaveBeenCalled(); expect(q.navigate).toHaveBeenCalledTimes(1)
  })
})

describe('new keys and the one-primary rule', () => {
  it('1 / 2 / 3 pick a seat under v4 only; e focuses the draft editor', async () => {
    skin(['dms', 'tokens', 'type', 'motion', 'shell']); seedPage()
    const p = page('desktop', '#exp/d/dms?seat=risedtc&thread=a')
    await waitFor(() => expect(document.querySelector('.dm-edit')).not.toBeNull())
    fireEvent.keyDown(document.body, { key: '3' })
    expect(p.navigate).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('d.dms.seat.v1')).toBe('arch')
    fireEvent.keyDown(document.body, { key: 'e' })
    expect(document.activeElement).toBe(document.querySelector('.dm-edit'))
    cleanup(); skin([])
    const q = page('desktop', '#exp/d/dms?seat=risedtc&thread=a')
    await waitFor(() => expect(document.querySelector('.dm-edit')).not.toBeNull())
    fireEvent.keyDown(document.body, { key: '3' })
    expect(q.navigate).not.toHaveBeenCalled()
  })
  it('cmd+enter in the draft opens the SAME send confirm; Cancel sends nothing', async () => {
    const [t] = threads(drafted('a', { prospect_name: 'Ada Lovelace', client_id: 'risedtc' }))
    renderInFrame(paneUi(t), { hash: '#exp/d/dms' })
    fireEvent.keyDown(document.querySelector('.dm-edit')!, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(key('confirm-send')).not.toBeNull())
    fireEvent.click(key('cancel')!)
    await act(async () => { await Promise.resolve() })
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })
  it('Send is primary on a fresh draft, outlined when stale or when his own words are in the composer', () => {
    const [t] = threads(drafted('a', { prospect_name: 'Ada Lovelace', client_id: 'risedtc' }))
    const r = mountSwap(paneUi(t), { hash: '#exp/d/dms' })
    const send = () => document.querySelector('.dx-keys [data-verb="send"]')!
    expect(send().classList.contains('d-key-p')).toBe(true)
    r.rerender(paneUi({ ...t, draftStale: true } as Thread))
    expect(send().classList.contains('d-key-p')).toBe(false)
    expect(document.querySelectorAll('.dx-keys .d-key-p')).toHaveLength(0)
    r.rerender(paneUi(t))
    fireEvent.change(document.querySelector('.dm-comp textarea')!, { target: { value: 'mine' } })
    expect(send().classList.contains('d-key-p')).toBe(false)
    expect(document.querySelectorAll('.dm-comp [data-verb="compose-send"].d-key-p')).toHaveLength(1)
  })
})
