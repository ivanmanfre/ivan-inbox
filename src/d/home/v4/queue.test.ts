import { describe, expect, it } from 'vitest'
import { buildQueue, type QueueInput } from './queue'

const NOW = new Date('2026-11-17T10:00:00Z')

const input = (o: Partial<QueueInput>): QueueInput =>
  ({ waiting: {}, bookings: [], nextCall: null, posts: [], now: NOW, ...o })
const b = (id: string, who = `Who ${id}`, when = 'Tue 17 Nov, 15:00') => ({ id, who, when })
const p = (id: string, slot_at: string, post_text = `Post ${id}\nbody`, state = 'scheduled') => ({ id, slot_at, post_text, state })
const plus = (n: number, unit: 'h' | 'm') => new Date(NOW.getTime() + n * (unit === 'h' ? 3_600_000 : 60_000)).toISOString()

describe('buildQueue (brief cases)', () => {
  it('orders sections by money and drops empty ones', () => {
    const q = buildQueue(input({ waiting:{ivan:2, risedtc:0, arch:1}, bookings:[b('x')], nextCall:null, posts:[] }))
    expect(q.map(s => s.id)).toEqual(['replies','bookings']); expect(q[0].count).toBe(3); expect(q[0].items.map(i => i.label)).toEqual(['Ivan','Arch'])
  })
  it('a failed seat read is left out, never shown as zero', () => {
    expect(buildQueue(input({ waiting:{ivan:null, arch:1} }))[0].items.map(i => i.label)).toEqual(['Arch'])
  })
  it('the next call shows only inside 24 hours and warns inside 60 minutes', () => {
    expect(buildQueue(input({ nextCall:{title:'Demo', start:plus(25,'h')} })).some(s => s.id === 'call')).toBe(false)
    expect(buildQueue(input({ nextCall:{title:'Demo', start:plus(45,'m')} })).find(s => s.id === 'call')!.items[0].warn).toBe(true)
  })
  it('today is the Warsaw day', () => {
    // 23:30 UTC on the 17th is 00:30 on the 18th in Warsaw
    const q = buildQueue(input({ now:new Date('2026-11-17T23:40:00Z'), posts:[p('a','2026-11-18T08:00:00Z'), p('b','2026-11-17T22:00:00Z')] }))
    expect(q.find(s => s.id === 'today')!.items.map(i => i.key)).toEqual(['a'])
  })
  it('nothing waiting gives an empty queue', () => { expect(buildQueue(input({}))).toEqual([]) })
})

describe('buildQueue (details)', () => {
  it('all four sections come back in money order with their titles', () => {
    const q = buildQueue(input({ waiting:{anna:1}, bookings:[b('x')], nextCall:{title:'Demo', start:plus(3,'h')}, posts:[p('a', plus(1,'h'))] }))
    expect(q.map(s => [s.id, s.title, s.count])).toEqual([
      ['replies', 'Replies waiting', 1], ['bookings', 'Bookings to confirm', 1], ['call', 'Next call', 1], ['today', 'Going out today', 1],
    ])
  })

  it('replies run Ivan, Rise, Arch, SwishDM, Anna whatever order the record has, with the waiting count', () => {
    const r = buildQueue(input({ waiting:{anna:4, swishdm:1, arch:2, risedtc:5, ivan:3} }))[0]
    expect(r.items.map(i => [i.key, i.label, i.meta])).toEqual([
      ['ivan','Ivan','3 waiting'], ['risedtc','Rise','5 waiting'], ['arch','Arch','2 waiting'], ['swishdm','SwishDM','1 waiting'], ['anna','Anna','4 waiting'],
    ])
    expect(r.count).toBe(15)
  })

  it('each seat links to its DMs, Anna to her Lanes column', () => {
    const items = buildQueue(input({ waiting:{ivan:1, risedtc:1, anna:1} }))[0].items
    expect(items.map(i => i.href)).toEqual(['#exp/d/dms?seat=ivan', '#exp/d/dms?seat=risedtc', '#exp/d/lanes?seat=anna'])
  })

  it('a seat this app does not know is ignored', () => {
    expect(buildQueue(input({ waiting:{ ghost: 4 } }))).toEqual([])
  })

  it('bookings: one item each, linked to its Ops card', () => {
    const s = buildQueue(input({ bookings:[b('x1','Dana','Wed 18 Nov, 10:00'), b('x2','Lee')] }))[0]
    expect(s.id).toBe('bookings'); expect(s.count).toBe(2)
    expect(s.items[0]).toEqual({ key:'x1', label:'Dana', meta:'Wed 18 Nov, 10:00', href:'#exp/d/ops?card=x1' })
  })

  it('the next call links to Sales, shows its Warsaw time, and does not warn past 60 minutes', () => {
    const s = buildQueue(input({ nextCall:{title:'Demo', start:'2026-11-17T14:00:00Z'} })).find(x => x.id === 'call')!
    expect(s.items).toEqual([{ key:'call', label:'Demo', meta:'Tue 17 Nov, 15:00', href:'#exp/d/sales', warn:false }])
    expect(s.count).toBe(1)
  })

  it('the call edges: 24 hours and 60 minutes are inside', () => {
    const at = (n: number, u: 'h' | 'm') => buildQueue(input({ nextCall:{title:'Demo', start:plus(n,u)} })).find(x => x.id === 'call')
    expect(at(24,'h')).toBeDefined()
    expect(at(60,'m')!.items[0].warn).toBe(true)
    expect(at(61,'m')!.items[0].warn).toBe(false)
  })

  it('a call with an unreadable start is left out', () => {
    expect(buildQueue(input({ nextCall:{title:'Demo', start:'not a date'} }))).toEqual([])
  })

  it('today: earliest first, first line cut at 80 characters, Warsaw time and state', () => {
    const long = 'x'.repeat(100)
    const s = buildQueue(input({ posts:[p('late','2026-11-17T16:00:00Z','Second\nmore','scheduled'), p('early','2026-11-17T07:30:00Z',`${long}\nrest`,'publishing')] }))[0]
    expect(s.id).toBe('today'); expect(s.count).toBe(2)
    expect(s.items.map(i => i.key)).toEqual(['early','late'])
    expect(s.items[0].label).toBe('x'.repeat(80))
    expect(s.items[0].meta).toBe('08:30 · publishing')
    expect(s.items[1].label).toBe('Second')
    expect(s.items[0].href).toBe('#exp/d/content/now?focus=early')
  })

  it('today: Warsaw day after the March clock change (fixed +1 would fail)', () => {
    // 22:30 UTC on 29 Mar is 00:30 on 30 Mar in Warsaw (summer time, +2)
    const q = buildQueue(input({ now:new Date('2026-03-29T22:30:00Z'), posts:[p('in','2026-03-30T06:00:00Z'), p('out','2026-03-29T21:30:00Z')] }))
    const s = q.find(x => x.id === 'today')!
    expect(s.items.map(i => i.key)).toEqual(['in'])
    expect(s.items[0].meta).toBe('08:00 · scheduled')
  })

  it('today: Warsaw day across the October clock change (fixed +1 would fail)', () => {
    // 22:30 UTC on 24 Oct is 00:30 on 25 Oct in Warsaw (still +2); the clocks go back at 01:00 UTC on the 25th
    const q = buildQueue(input({ now:new Date('2026-10-24T22:30:00Z'), posts:[p('in','2026-10-25T10:00:00Z'), p('out','2026-10-24T21:30:00Z')] }))
    const s = q.find(x => x.id === 'today')!
    expect(s.items.map(i => i.key)).toEqual(['in'])
    expect(s.items[0].meta).toBe('11:00 · scheduled')
  })
})
