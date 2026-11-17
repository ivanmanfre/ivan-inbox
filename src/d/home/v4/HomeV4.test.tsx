// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame, type TestReaders } from '../../test-utils'
import { parseDHash } from '../../route'
import type { Read } from '../model'
import type { OpsDraft } from '../../../lib/ops'
import type { NextPost } from '../../../lib/contentNext'

const st = vi.hoisted(() => ({ home: null as unknown, ops: null as unknown, next: null as unknown, refreshNext: vi.fn() }))
vi.mock('../Tasks',()=>({HomeTasks:()=> <section aria-label="Mocked tasks"/>}))
vi.mock('../reads',()=>({useHome:()=>st.home}))
vi.mock('../../../hooks/useOps',()=>({useOps:()=>st.ops}))
vi.mock('../../content/next/store',()=>({useNextPosts:()=>st.next,refreshNextPosts:st.refreshNext}))
vi.mock('../../x/XFlag',()=>({XFlag:()=> <section data-x-flag aria-label="X review"/>}))
import HomeV4 from './HomeV4'

const SEATS = ['ivan','risedtc','arch','swishdm','anna'] as const
const WAIT: Read<number> = { wait: true }
const home = (waiting: Partial<Record<(typeof SEATS)[number], Read<number>>> = {}, rest: Read<number> = WAIT) => ({
  now:Date.parse('2026-10-08T10:00:00Z'),
  lanes:Object.fromEntries(['cc','gov','pauses','attempts','ready'].map(k=>[k,{value:null,failed:null}])),
  content:Object.fromEntries(['ivan','risedtc','arch','swishdm'].map(k=>[k,{wait:true}])),
  drafts:Object.fromEntries(['ivan','risedtc','arch','swishdm'].map(k=>[k,{wait:true}])),
  waiting:Object.fromEntries(SEATS.map(k=>[k,waiting[k] ?? rest])),
  review:Object.fromEntries(['ivan','risedtc','arch','swishdm'].map(k=>[k,{wait:true}])),
  retry:{content:vi.fn(),drafts:vi.fn(),review:vi.fn(),lanes:vi.fn()},
})
const ops = (o: { drafts?: OpsDraft[]; loadedAt?: string | null; error?: string | null; saved?: boolean } = {}) =>
  ({ drafts:[], loading:o.loadedAt == null && !o.error, error:null, loadedAt:'2026-11-17T09:00:00Z', saved:false, refresh:vi.fn(), markDone:vi.fn(), ...o })
const row = (id: string, kind: OpsDraft['kind'], context: OpsDraft['context'] = {}, body = ''): OpsDraft =>
  ({ id, client_id:'ivan', kind, slack_channel:'', body, context, created_at:'2026-11-17T08:00:00Z', approved_at:null, sent_at:null, send_blocked_reason:null })
const post = (draft_id: string, slot_at: string, state: NextPost['state'], post_text = `Post ${draft_id}`): NextPost =>
  ({ queue_id:`q-${draft_id}`, draft_id, slot_at, state, origin:'autopilot', kept:false, fails:[], post_text, post_format:null, in_sync:true, urls:[], media_urls:[] })
const nextSnap = (o: { posts?: NextPost[]; loaded?: boolean; failed?: boolean } = {}) => ({ posts:[], loaded:true, failed:false, version:1, ...o })
const NONE_BOOKED = async () => ({ label:'none booked', title:null, start:null })
const ZERO: Read<number> = { v: 0 }

let slot: HTMLElement
beforeEach(() => {
  slot = document.createElement('div'); slot.setAttribute('data-title-slot',''); document.body.appendChild(slot)
  st.home = home(); st.ops = ops({ loadedAt:null }); st.next = nextSnap({ loaded:false })
})
afterEach(() => { cleanup(); slot.remove(); vi.useRealTimers(); vi.restoreAllMocks() })

type Layout = 'phone' | 'desktop'
type Saved = NonNullable<Parameters<typeof renderInFrame>[1]>['saved']
const show = (layout: Layout, readers: Partial<NonNullable<TestReaders>> = {}, saved?: Saved) =>
  renderInFrame(<HomeV4 layout={layout} route={parseDHash('#exp/d/home')} navigate={vi.fn()}/>,{layout,hash:'#exp/d/home',readers,frame:{titleSlot:slot},saved})
const reading = () => queue().querySelector('.hm4-q-wait')
const NEVER = () => new Promise<never>(() => {})
const queue = () => document.querySelector('[data-home-queue]') as HTMLElement
const h2s = () => [...document.querySelectorAll('h2')].map(e => e.textContent?.trim() ?? '')

for(const layout of ['phone','desktop'] as const)it(`renders all seats and safe destinations in ${layout} without inventing zeros`,()=>{
 show(layout)
 expect(document.querySelector('[data-layout-v4=home]')).toBeTruthy()
 for(const seat of ['ivan','risedtc','arch','swishdm'])expect(document.querySelector(`a[href="#exp/d/dms?seat=${seat}"]`)).toBeTruthy()
 // Posts to review per seat opens that seat's Review (review 2026-11-06 #36)
 for(const seat of ['ivan','risedtc','arch','swishdm'])expect(document.querySelector(`[data-tile="review"][data-seat="${seat}"] a[href="#exp/d/content/now?lane=${seat}"]`)).toBeTruthy()
 expect(document.querySelector('[data-count="0"]')).toBeNull()
 // R17: the tasks block is hidden only while its read has not finished.
 expect(document.querySelector('[aria-label="Mocked tasks"]')).toBeNull()
})

for (const layout of ['phone','desktop'] as const) {
  it(`${layout}: two seats waiting and one booking show Replies waiting, then Bookings to confirm, then Lane numbers`, async () => {
    st.home = home({ ivan:{v:2}, arch:{v:1} }, ZERO)
    st.ops = ops({ drafts:[row('bk1','booking',{ prospect_name:'Dana', when_iso:'2026-11-18T09:00:00Z' })] })
    st.next = nextSnap()
    show(layout, { nextCall: NONE_BOOKED })
    await waitFor(() => expect(reading()).toBeNull())
    const hs = h2s()
    expect(hs.indexOf('Replies waiting')).toBeGreaterThanOrEqual(0)
    expect(hs.indexOf('Replies waiting')).toBeLessThan(hs.indexOf('Bookings to confirm'))
    expect(hs.indexOf('Bookings to confirm')).toBeLessThan(hs.indexOf('Lane numbers'))
    // the lane numbers sit after the queue, the seats under their heading
    const lanes = [...document.querySelectorAll('h2')].find(e => e.textContent === 'Lane numbers')!
    expect(queue().compareDocumentPosition(lanes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const seats = document.querySelector(layout === 'phone' ? '.hm4-matrix' : '.hm4-card')!
    expect(lanes.compareDocumentPosition(seats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const bk = queue().querySelector('[data-queue="bookings"] a[href="#exp/d/ops?card=bk1"]')!
    expect(bk.textContent).toContain('Dana'); expect(bk.textContent).toContain('Wed 18 Nov, 10:00')
    expect(queue().textContent).not.toContain('Nothing needs you.')
    // R17: no open tasks still keeps the tasks block (its Add row)
    expect(document.querySelector('[aria-label="Mocked tasks"]')).toBeTruthy()
    if (layout === 'desktop') expect(slot.textContent).toBe('4 things need you.')
  })
}

it('every read done and nothing waiting: the queue is one line, Nothing needs you.', async () => {
  st.home = home({}, ZERO); st.ops = ops(); st.next = nextSnap()
  show('desktop', { nextCall: NONE_BOOKED })
  await waitFor(() => expect(queue().textContent).toBe('Nothing needs you.'))
  expect(queue().querySelectorAll('h2')).toHaveLength(0)
  expect(slot.textContent).toBe('Nothing needs you.')
})

it('reads still out: the reading state, never Nothing needs you.', async () => {
  st.home = home({ ivan:WAIT }, ZERO); st.ops = ops(); st.next = nextSnap()
  show('desktop', { nextCall: NONE_BOOKED })
  await new Promise(r => setTimeout(r, 0))
  // announced: a status role with hidden words, the skeleton bar itself hidden from readers
  const wait = reading()!
  expect(wait.getAttribute('role')).toBe('status')
  expect(wait.querySelector('.ols-skeleton')).toBeTruthy()
  expect(wait.querySelector('.ols-sr')!.textContent).toBe('Reading what needs you')
  expect(document.body.textContent).not.toContain('Nothing needs you.')
  expect(slot.textContent).toBe('Home')
})

it('a read failed: what loaded shows, one line names what could not be read, the count says it is partial', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  st.home = home({ ivan:{v:2}, risedtc:{ fail:'the DM count could not be read' } }, ZERO)
  st.ops = ops({ loadedAt:null, error:'ops queue unavailable' })
  st.next = nextSnap({ failed:true })
  show('desktop', { nextCall: async () => { throw new Error('calendar down') } })
  await waitFor(() => expect(queue().textContent).toContain("Could not read: Rise replies, bookings, next call, today's posts."))
  expect(queue().querySelector('[data-queue="replies"] a[href="#exp/d/dms?seat=ivan"]')).toBeTruthy()
  expect(document.body.textContent).not.toContain('Nothing needs you.')
  expect(slot.textContent).toBe('At least 2 things need you.')
})

it('the failure line has a Retry that re-runs each failed read', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  st.home = home({ ivan:{v:2} }, ZERO)
  st.ops = ops({ loadedAt:null, error:'ops queue unavailable' })
  st.next = nextSnap({ failed:true })
  let fails = 0
  const dm = vi.fn(async (s: string) => { if (s === 'risedtc') { fails++; throw new Error('dm down') } return { drafts:0, needs:0 } })
  const nextCall = vi.fn(async () => { throw new Error('calendar down') })
  show('desktop', { dm, nextCall })
  await waitFor(() => expect(queue().textContent).toContain("Could not read: Rise replies, bookings, next call, today's posts."))
  const before = { dm: fails, call: nextCall.mock.calls.length }
  const retry = queue().querySelector('.hm4-q-note [data-verb="retry"]') as HTMLButtonElement
  expect(retry.textContent).toBe('Retry')
  fireEvent.click(retry)
  const o = st.ops as { refresh: ReturnType<typeof vi.fn> }
  expect(o.refresh).toHaveBeenCalledTimes(1)
  expect(st.refreshNext).toHaveBeenCalledTimes(1)
  await waitFor(() => { expect(fails).toBeGreaterThan(before.dm); expect(nextCall.mock.calls.length).toBeGreaterThan(before.call) })
})

it('a seat whose re-read failed after a value: the row stays, the line names the seat, never Nothing needs you.', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // useHome keeps showing the last value of a failed slice (reads.ts dr); the frame slice says failed.
  st.home = home({ ivan:{v:2} }, ZERO); st.ops = ops(); st.next = nextSnap()
  const calls: Record<string, number> = {}
  const dm = vi.fn(async (s: string) => {
    calls[s] = (calls[s] ?? 0) + 1
    if (calls[s] > 1 && (s === 'ivan' || s === 'arch')) throw new Error('timed out')
    return { drafts:0, needs: s === 'ivan' ? 2 : 0 }
  })
  show('desktop', { dm, nextCall: NONE_BOOKED })
  await waitFor(() => expect(slot.textContent).toBe('2 things need you.'))
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(queue().textContent).toContain('Could not read: Ivan replies, Arch replies.'))
  expect(queue().querySelector('[data-queue="replies"] a[href="#exp/d/dms?seat=ivan"]')).toBeTruthy()
  expect(document.body.textContent).not.toContain('Nothing needs you.')
  expect(slot.textContent).toBe('At least 2 things need you.')
})

it('the board read failed after a good read: bookings are named, the last rows stay', async () => {
  st.home = home({}, ZERO)
  st.ops = ops({ error:'The ops read came back empty over a board that had cards.', drafts:[row('bk1','booking',{ prospect_name:'Dana', when_iso:'2026-11-18T09:00:00Z' })] })
  st.next = nextSnap()
  show('desktop', { nextCall: NONE_BOOKED })
  await waitFor(() => expect(queue().textContent).toContain('Could not read: bookings.'))
  expect(queue().querySelector('[data-queue="bookings"] a[href="#exp/d/ops?card=bk1"]')).toBeTruthy()
  expect(slot.textContent).toBe('At least 1 thing needs you.')
})

const ZERO_DMS = Object.fromEntries(SEATS.map(s => [`dms:${s}`, { value:{ drafts:0, needs:0 }, failed:false, at:1 }]))
const NONE_SAVED = { nextCall: { value:{ label:'none booked', title:null, start:null }, failed:false, at:1 } }
for (const [name, setup] of [
  ['the DM counts', () => ({ saved: ZERO_DMS, readers: { dm: NEVER, nextCall: NONE_BOOKED } })],
  ['the next call', () => ({ saved: NONE_SAVED, readers: { nextCall: NEVER } })],
  ['the board', () => { st.ops = ops({ saved:true }); return { saved: undefined, readers: { nextCall: NONE_BOOKED } } }],
] as const) it(`a saved copy of ${name} is still reading: zeros never say Nothing needs you.`, async () => {
  st.home = home({}, ZERO); st.ops = ops(); st.next = nextSnap()
  const { saved, readers } = setup()
  show('desktop', readers, saved)
  await new Promise(r => setTimeout(r, 20))
  expect(reading()).toBeTruthy()
  expect(document.body.textContent).not.toContain('Nothing needs you.')
  expect(slot.textContent).toBe('Home')
})

it('a saved board whose live read never answers is named after 12 s, never Nothing needs you.', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  st.home = home({}, ZERO); st.ops = ops({ saved:true }); st.next = nextSnap()
  show('desktop', { nextCall: NONE_BOOKED })
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(slot.textContent).toBe('Home')
  await act(async () => { await vi.advanceTimersByTimeAsync(12_100) })
  expect(queue().textContent).toContain('Could not read: bookings.')
  expect(document.body.textContent).not.toContain('Nothing needs you.')
})

it('a saved next call that already ended is no final count; the live read settles it', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-17T10:00:00Z'))
  st.home = home({}, ZERO); st.ops = ops(); st.next = nextSnap()
  let land!: (v: { label: string; title: string | null; start: string | null }) => void
  const nextCall = vi.fn(() => new Promise<{ label: string; title: string | null; start: string | null }>(r => { land = r }))
  show('desktop', { nextCall }, { nextCall: { value:{ label:'Tue 17 Nov, 09:00', title:'Old call', start:'2026-11-17T08:00:00Z' }, failed:false, at:1 } })
  await new Promise(r => setTimeout(r, 20))
  expect(reading()).toBeTruthy()
  expect(slot.textContent).toBe('Home')
  expect(document.body.textContent).not.toContain('Nothing needs you.')
  land({ label:'none booked', title:null, start:null })
  await waitFor(() => expect(slot.textContent).toBe('Nothing needs you.'))
  expect(queue().querySelector('[data-queue="call"]')).toBeNull()
})

it('a read failed and nothing else came back: no count, never Nothing needs you.', async () => {
  st.home = home({ arch:{ fail:'the DM count could not be read' } }, ZERO); st.ops = ops(); st.next = nextSnap()
  show('desktop', { nextCall: NONE_BOOKED })
  await waitFor(() => expect(queue().textContent).toBe('Could not read: Arch replies. Retry'))
  expect(queue().textContent).not.toContain('·')
  expect(slot.textContent).toBe('Could not read everything that needs you.')
})

for (const layout of ['phone','desktop'] as const) it(`${layout}: never renders the X flag`, () => {
  show(layout)
  expect(document.querySelector('[data-x-flag]')).toBeNull()
})

it("Anna's link lives only in her replies item; with no Anna replies Home has no Anna link", async () => {
  st.home = home({ anna:{v:3} }, ZERO); st.ops = ops(); st.next = nextSnap()
  const { unmount } = show('desktop', { nextCall: NONE_BOOKED })
  await waitFor(() => expect(queue().querySelector('[data-queue="replies"] a[href="#exp/d/lanes?seat=anna"]')).toBeTruthy())
  const annaText = [...document.querySelectorAll('body *')].filter(e => /Anna.s LinkedIn invitations and replies/.test(e.textContent ?? '') && !e.closest('[data-queue="replies"]') && !e.querySelector('[data-queue="replies"]'))
  expect(annaText).toHaveLength(0)
  expect(document.querySelectorAll('a[href="#exp/d/lanes?seat=anna"]')).toHaveLength(1)
  unmount()
  st.home = home({}, ZERO)
  show('phone', { nextCall: NONE_BOOKED })
  await waitFor(() => expect(queue().textContent).toBe('Nothing needs you.'))
  expect(document.querySelector('a[href="#exp/d/lanes?seat=anna"]')).toBeNull()
  expect(document.body.textContent).not.toMatch(/Anna.s LinkedIn invitations and replies/)
})

it('the next call and the posts going out today, in plain words', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-17T10:00:00Z'))
  st.home = home({}, ZERO); st.ops = ops()
  st.next = nextSnap({ posts:[post('d2','2026-11-17T15:00:00Z','checking','Second post'), post('d1','2026-11-17T08:30:00Z','held','First post'), post('d3','2026-11-18T08:30:00Z','ready')] })
  show('desktop', { nextCall: async () => ({ label:'Tue 17 Nov, 13:00', title:null, start:'2026-11-17T12:00:00Z' }) })
  await waitFor(() => expect(queue().querySelector('[data-queue="call"]')).toBeTruthy())
  const call = queue().querySelector('[data-queue="call"] a[href="#exp/d/sales"]')!
  expect(call.textContent).toContain('Call'); expect(call.textContent).toContain('Tue 17 Nov, 13:00')
  const today = [...queue().querySelectorAll('[data-queue="today"] a')]
  expect(today.map(a => a.getAttribute('href'))).toEqual(['#exp/d/content/now?focus=d1', '#exp/d/content/now?focus=d2'])
  expect(today[0].textContent).toContain('09:30 · held')
  expect(today[1].textContent).toContain('16:00 · being re-checked')
  expect(slot.textContent).toBe('3 things need you.')
})

it('open tasks keep the Tasks column', () => {
  st.home = home({}, ZERO); st.ops = ops({ drafts:[row('t1','task',{},'Call Basile')] }); st.next = nextSnap()
  show('desktop', { nextCall: NONE_BOOKED })
  expect(document.querySelector('[aria-label="Mocked tasks"]')).toBeTruthy()
})

it('R17: the tasks block shows once its read finished, with or without tasks, and when the read failed', () => {
  st.home = home({}, ZERO); st.next = nextSnap()
  st.ops = ops()
  const { unmount } = show('desktop', { nextCall: NONE_BOOKED })
  expect(document.querySelector('[aria-label="Mocked tasks"]')).toBeTruthy()
  unmount()
  st.ops = ops({ loadedAt:null, error:'ops queue unavailable' })
  show('desktop', { nextCall: NONE_BOOKED })
  expect(document.querySelector('[aria-label="Mocked tasks"]')).toBeTruthy()
})
