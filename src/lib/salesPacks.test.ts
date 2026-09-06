import { beforeEach, describe, expect, it, vi } from 'vitest'
// The real source of Today's fetcher, as text: nextCall.ts keeps COLS private,
// and reading the file is the only way to compare against the thing that ships
// rather than against a copy of it in this file.
import nextCallSource from './nextCall.ts?raw'

// THE SALES READ LAYER, PINNED.
//
// Three things here are claims the surface makes and cannot check for itself:
//
//  1. The list read does NOT pull the bodies. The largest card on disk is ~52 KB;
//     a `select('*')` that slipped in would ship the whole dossier set on every
//     mount of the section and nothing on screen would look different.
//  2. The week read is a SIBLING of Today's fetcher, not a fork of it. Its column
//     list is a hand copy (nextCall keeps COLS private), so this reads the real
//     source file and asserts the two are identical — the only way a column added
//     to Today and forgotten here fails loudly instead of silently.
//  3. `is_test` is filtered in JS, never with `.eq('is_test', false)`, because
//     every Google-Calendar row leaves the column NULL and the server-side form
//     would drop them all.

type Step = {
  table: string
  op: 'select'
  cols: string
  filters: Record<string, unknown>
  order: Array<[string, boolean | undefined]>
  limit?: number
  single?: boolean
}

let steps: Step[] = []
let result: { data: unknown; error: unknown } = { data: [], error: null }

function builder(table: string) {
  return {
    select(cols: string) {
      const step: Step = { table, op: 'select', cols, filters: {}, order: [] }
      steps.push(step)
      const chain = {
        eq(k: string, v: unknown) { step.filters[`eq:${k}`] = v; return chain },
        gte(k: string, v: unknown) { step.filters[`gte:${k}`] = v; return chain },
        lte(k: string, v: unknown) { step.filters[`lte:${k}`] = v; return chain },
        order(k: string, o?: { ascending?: boolean }) { step.order.push([k, o?.ascending]); return chain },
        limit(n: number) { step.limit = n; return chain },
        maybeSingle() {
          step.single = true
          const d = result.data
          return Promise.resolve({ data: Array.isArray(d) ? (d[0] ?? null) : d, error: result.error })
        },
        then(res: (v: unknown) => unknown) { return Promise.resolve(result).then(res) },
      }
      return chain
    },
  }
}

const channels: Array<{ topic: string; binds: number; removed: boolean }> = []

vi.mock('./supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    channel(topic: string) {
      const rec = { topic, binds: 0, removed: false }
      channels.push(rec)
      const ch = {
        __rec: rec,
        on() { rec.binds += 1; return ch },
        subscribe() { return ch },
      }
      return ch
    },
    removeChannel(ch: { __rec: { removed: boolean } }) { ch.__rec.removed = true },
  },
}))

const {
  COMPARE_URL, PACK_KINDS, WEEK_EVENT_COLS,
  fetchPackBody, fetchPackIndex, fetchWeekEvents, subscribePacks,
} = await import('./salesPacks')

beforeEach(() => {
  steps = []
  channels.length = 0
  result = { data: [], error: null }
})

describe('fetchPackIndex', () => {
  it('reads every column except the body, in prospect then kind order', async () => {
    await fetchPackIndex()
    expect(steps).toHaveLength(1)
    const s = steps[0]
    expect(s.table).toBe('sales_packs')
    // The one assertion that matters: no body, and no star that would smuggle it in.
    expect(s.cols).not.toContain('body')
    expect(s.cols).not.toContain('*')
    for (const c of ['id', 'prospect_slug', 'kind', 'title', 'mime', 'source_path', 'source_mtime', 'call_at', 'meta', 'updated_at']) {
      expect(s.cols).toContain(c)
    }
    expect(s.order).toEqual([['prospect_slug', true], ['kind', true]])
  })

  it('gives a row with a null meta an object, so the list can read meta.name without a guard', async () => {
    result = { data: [{ id: '1', prospect_slug: 'ada-analytical', kind: 'card', meta: null }], error: null }
    const rows = await fetchPackIndex()
    expect(rows[0].meta).toEqual({})
  })

  it('throws the PostgREST error rather than returning an empty list that reads as "no packs"', async () => {
    result = { data: null, error: { message: 'permission denied for table sales_packs' } }
    await expect(fetchPackIndex()).rejects.toBeTruthy()
  })
})

describe('fetchPackBody', () => {
  it('asks for one row by slug and kind, and this time the body comes with it', async () => {
    result = { data: [{ id: '1', prospect_slug: 'ada-analytical', kind: 'call_sheet', meta: {}, body: '# Sheet' }], error: null }
    const row = await fetchPackBody('ada-analytical', 'call_sheet')
    expect(row?.body).toBe('# Sheet')
    const s = steps[0]
    expect(s.cols).toContain('body')
    expect(s.filters['eq:prospect_slug']).toBe('ada-analytical')
    expect(s.filters['eq:kind']).toBe('call_sheet')
    expect(s.single).toBe(true)
  })

  it('returns null for a pack that was never published', async () => {
    result = { data: [], error: null }
    expect(await fetchPackBody('ada-analytical', 'audience_audit')).toBeNull()
  })
})

describe('fetchWeekEvents', () => {
  it('ranges on start_time at BOTH ends, so a call belongs to the day it starts on', async () => {
    const from = new Date('2026-09-07T00:00:00.000Z')
    const to = new Date('2026-09-20T23:59:59.000Z')
    await fetchWeekEvents(from, to)
    const s = steps[0]
    expect(s.table).toBe('calendar_events')
    expect(s.filters['gte:start_time']).toBe(from.toISOString())
    expect(s.filters['lte:start_time']).toBe(to.toISOString())
    expect(s.filters['eq:is_all_day']).toBe(false)
    // NOT a server-side is_test filter: that drops every NULL, which is every
    // Google-Calendar row.
    expect(s.filters['eq:is_test']).toBeUndefined()
    expect(s.order).toEqual([['start_time', true]])
  })

  it('drops only is_test === true, and keeps the NULLs Google Calendar writes', async () => {
    result = {
      data: [
        { id: 'a', is_test: null },
        { id: 'b', is_test: true },
        { id: 'c', is_test: false },
      ],
      error: null,
    }
    const rows = await fetchWeekEvents(new Date(0), new Date(1))
    expect(rows.map(r => r.id)).toEqual(['a', 'c'])
  })

  it('uses the same column list Today reads, character for character', () => {
    // `const COLS = '...' + '...'` — join the string literals of that one statement.
    const decl = nextCallSource.match(/const COLS =([\s\S]*?)\n\n/)
    expect(decl).toBeTruthy()
    const joined = [...(decl?.[1] ?? '').matchAll(/'([^']*)'/g)].map(m => m[1]).join('')
    expect(joined).not.toBe('')
    expect(WEEK_EVENT_COLS).toBe(joined)
  })
})

describe('subscribePacks', () => {
  it('takes a FRESH topic per subscriber, so a second mount cannot rebind a live channel', () => {
    const offA = subscribePacks(() => {})
    const offB = subscribePacks(() => {})
    expect(channels).toHaveLength(2)
    expect(channels[0].topic).not.toBe(channels[1].topic)
    expect(channels.every(c => c.topic.startsWith('sales_packs:'))).toBe(true)
    expect(channels.every(c => c.binds === 1)).toBe(true)
    offA(); offB()
    expect(channels.every(c => c.removed)).toBe(true)
  })
})

describe('the tab contract', () => {
  it('offers the five real documents in reading order, and never the extra bucket', () => {
    expect(PACK_KINDS).toEqual(['card', 'call_sheet', 'audience_audit', 'asset_ideas', 'prospect'])
    expect(PACK_KINDS).not.toContain('extra')
  })

  it('points the compare tab at the public page, over https', () => {
    expect(COMPARE_URL).toBe('https://inboundonsteroids.com/compare')
  })
})
