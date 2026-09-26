import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import {
  ALL_WEEKS, buyerLabel, filterRows, freshnessLines, groupByWeek, liftText, parseOutliers, platformCounts,
  sortRows, splitText, weekOptions,
  type OutlierRow, type OutliersPayload,
} from './outliers'

function row(over: Partial<OutlierRow> = {}): OutlierRow {
  return {
    platform: 'linkedin', post_id: '1', author: 'Ben Hemingway', text: 'First line\nSecond line', url: 'https://www.linkedin.com/posts/x',
    published_at: '2026-09-22T07:13:52Z', week: '2026-09-21', lift: 3.94, baseline: 16, baseline_n: 59,
    likes: 63, reposts: 0, comments: 33, views: null, labels: null, personal: false,
    traits: [{ key: 'format=single_image', words: 'single image', weight: 0.669 }], traits_note: null,
    buyer: { judged: 20, icp7: 2, share: 0.1, state: 'read' }, idea: null, ...over,
  }
}

const rows = [
  row({ post_id: '1', week: '2026-09-21', lift: 3.9, buyer: { judged: 20, icp7: 2, share: 0.1, state: 'read' } }),
  row({ post_id: '2', week: '2026-09-21', lift: 7.2, buyer: null }),
  row({ post_id: '3', week: '2026-09-14', lift: 4.1, buyer: { judged: 3, icp7: 3, share: 1, state: 'too_few' } }),
  row({ post_id: '4', week: '2026-09-14', lift: 3.1, platform: 'x', buyer: null, views: 12000 }),
  row({ post_id: '5', week: '2026-09-07', lift: 5.0, buyer: { judged: 30, icp7: 12, share: 0.4, state: 'read' } }),
]

const payload: OutliersPayload = {
  client: 'ivan',
  studies: { linkedin: { study_id: 's', as_of: '2026-09-24T20:14:00Z', scored: 1931, authors: 31, outliers: 98 }, x: null },
  weeks: [{ week: '2026-09-07', n: 1 }, { week: '2026-09-21', n: 2 }, { week: '2026-09-14', n: 2 }],
  rows,
}

describe('filter / sort / weeks', () => {
  it('filters by platform and week', () => {
    expect(filterRows(rows, 'x', ALL_WEEKS).map(r => r.post_id)).toEqual(['4'])
    expect(filterRows(rows, 'linkedin', '2026-09-14').map(r => r.post_id)).toEqual(['3'])
    expect(filterRows(rows, 'all', ALL_WEEKS)).toHaveLength(5)
  })

  it('sorts by lift, highest first', () => {
    expect(sortRows(rows, 'lift').map(r => r.post_id)).toEqual(['2', '5', '3', '1', '4'])
  })

  it('sorts by buyer share with rows lacking a read share last (too few and unscraped alike)', () => {
    const ids = sortRows(rows, 'buyer').map(r => r.post_id)
    expect(ids.slice(0, 2)).toEqual(['5', '1'])
    // the rest have no read share: ordered among themselves by lift
    expect(ids.slice(2)).toEqual(['2', '3', '4'])
  })

  it('groups newest week first, sorted inside each week', () => {
    const g = groupByWeek(rows, 'lift')
    expect(g.map(([w]) => w)).toEqual(['2026-09-21', '2026-09-14', '2026-09-07'])
    expect(g[0][1].map(r => r.post_id)).toEqual(['2', '1'])
  })

  it('lists the RPC weeks newest first, counted for the platform in view', () => {
    expect(weekOptions(payload, 'all')).toEqual([
      { week: '2026-09-21', n: 2 }, { week: '2026-09-14', n: 2 }, { week: '2026-09-07', n: 1 },
    ])
    expect(weekOptions(payload, 'x').map(w => w.n)).toEqual([0, 1, 0])
  })

  it('counts platforms inside the picked week', () => {
    expect(platformCounts(rows, ALL_WEEKS)).toEqual({ all: 5, linkedin: 4, x: 1 })
    expect(platformCounts(rows, '2026-09-14')).toEqual({ all: 2, linkedin: 1, x: 1 })
  })
})

describe('buyer label', () => {
  it('reads a share with its n', () => {
    expect(buyerLabel(rows[0])).toEqual({ kind: 'read', share: 0.1, line: '10% ICP 7+', icp: 2, n: 20 })
  })
  it('says too few to read with n when fewer than 5 were judged', () => {
    expect(buyerLabel(rows[2])).toEqual({ kind: 'few', line: 'Too few to read', n: 3 })
    expect(buyerLabel(row({ buyer: { judged: 4, icp7: 1, share: 0.25, state: 'read' } })).kind).toBe('few')
  })
  it('names an unread post plainly, per platform', () => {
    expect(buyerLabel(rows[1]).line).toBe('Commenters not read yet')
    expect(buyerLabel(rows[3]).line).toBe('Commenters not read on X yet')
  })
  it('never words the figure as an effect of the post', () => {
    for (const r of rows) expect(buyerLabel(r).line).not.toMatch(/caus|drive|generat|produc/i)
  })
})

describe('shape + text', () => {
  it('a payload without rows is a failed read, never an empty one', () => {
    expect(parseOutliers(null).kind).toBe('failed')
    expect(parseOutliers({ ok: true }).kind).toBe('failed')
    const ok = parseOutliers({ ok: true, client: 'ivan', rows: [{ ...rows[0], traits: null }], weeks: [], studies: { linkedin: null, x: null } })
    expect(ok.kind === 'ready' && ok.data.rows[0].traits).toEqual([])
  })
  it('splits the first line off as the title', () => {
    expect(splitText('Hook line\r\n\nBody')).toEqual(['Hook line', 'Body'])
    expect(splitText(null)).toEqual(['', ''])
  })
  it('prints lift at one decimal under 10', () => {
    expect(liftText(3.94)).toBe('3.9')
    expect(liftText(12.4)).toBe('12')
  })
  it('says when X has no study yet', () => {
    expect(freshnessLines(payload)[1]).toEqual({ platform: 'X', line: 'arrives with the first weekly run' })
    expect(freshnessLines(payload)[0].line).toBe('read Sep 24, 1,931 posts from 31 authors')
  })
})

describe('the stale RISE-only read is gone', () => {
  it('no file under src/ names the old outliers RPC', () => {
    const stale = ['operator', 'market', 'outliers'].join('_')
    const root = join(__dirname, '..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx|css|js|mjs)$/.test(name) && readFileSync(p, 'utf8').includes(stale)) hits.push(p)
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
