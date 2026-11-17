// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { renderInFrame, type TestReaders } from '../../test-utils'
import { parseDHash } from '../../route'
import type { Read } from '../model'
import type { OpsDraft } from '../../../lib/ops'
import type { NextPost } from '../../../lib/contentNext'

const st = vi.hoisted(() => ({ home: null as unknown, ops: null as unknown, next: null as unknown }))
vi.mock('../Tasks',()=>({HomeTasks:()=> <section aria-label="Mocked tasks"/>}))
vi.mock('../reads',()=>({useHome:()=>st.home}))
vi.mock('../../../hooks/useOps',()=>({useOps:()=>st.ops}))
vi.mock('../../content/next/store',()=>({useNextPosts:()=>st.next}))
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
const ops = (o: { drafts?: OpsDraft[]; loadedAt?: string | null; error?: string | null } = {}) =>
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
const show = (layout: Layout, readers: Partial<NonNullable<TestReaders>> = {}) =>
  renderInFrame(<HomeV4 layout={layout} route={parseDHash('#exp/d/home')} navigate={vi.fn()}/>,{layout,hash:'#exp/d/home',readers,frame:{titleSlot:slot}})
const queue = () => document.querySelector('[data-home-queue]') as HTMLElement
const h2s = () => [...document.querySelectorAll('h2')].map(e => e.textContent?.trim() ?? '')

for(const layout of ['phone','desktop'] as const)it(`renders all seats and safe destinations in ${layout} without inventing zeros`,()=>{
 show(layout)
 expect(document.querySelector('[data-layout-v4=home]')).toBeTruthy()
 for(const seat of ['ivan','risedtc','arch','swishdm'])expect(document.querySelector(`a[href="#exp/d/dms?seat=${seat}"]`)).toBeTruthy()
 // Posts to review per seat opens that seat's Review (review 2026-11-06 #36)
 for(const seat of ['ivan','risedtc','arch','swishdm'])expect(document.querySelector(`[data-tile="review"][data-seat="${seat}"] a[href="#exp/d/content/now?lane=${seat}"]`)).toBeTruthy()
 expect(document.querySelector('[data-count="0"]')).toBeNull()
 // Tasks still reading: the column stays (its own reading line), it only goes once the read says there is nothing open.
 expect(document.querySelector('[aria-label="Mocked tasks"]')).toBeTruthy()
})

for (const layout of ['phone','desktop'] as const) {
  it(`${layout}: two seats waiting and one booking show Replies waiting, then Bookings to confirm, then Lane numbers`, async () => {
    st.home = home({ ivan:{v:2}, arch:{v:1} }, ZERO)
    st.ops = ops({ drafts:[row('bk1','booking',{ prospect_name:'Dana', when_iso:'2026-11-18T09:00:00Z' })] })
    st.next = nextSnap()
    show(layout, { nextCall: NONE_BOOKED })
    await waitFor(() => expect(queue().querySelector('[aria-label="Reading what needs you"]')).toBeNull())
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
    // no open tasks: the empty Tasks column is gone
    expect(document.querySelector('[aria-label="Mocked tasks"]')).toBeNull()
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
  expect(queue().querySelector('[aria-label="Reading what needs you"] .ols-skeleton')).toBeTruthy()
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

it('a read failed and nothing else came back: no count, never Nothing needs you.', async () => {
  st.home = home({ arch:{ fail:'the DM count could not be read' } }, ZERO); st.ops = ops(); st.next = nextSnap()
  show('desktop', { nextCall: NONE_BOOKED })
  await waitFor(() => expect(queue().textContent).toBe('Could not read: Arch replies.'))
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
