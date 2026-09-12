/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bulkVerbsFor } from './BulkBar'
import { rangeIds } from './commandStore'
import type { RowCap, SelectedRow } from './commandStore'

const row = (id: string, caps: RowCap[], kind: SelectedRow['kind'] = 'draft'): SelectedRow =>
  ({ id, kind, label: id, caps })

// E3 · WHICH VERBS A MIXED SELECTION ALLOWS. Rule 2 of the bar — an action runs
// on every selected row or none — used to be true in three places and testable
// in none of them.
describe('bulkVerbsFor', () => {
  it('offers nothing for an empty selection', () => {
    expect(bulkVerbsFor([])).toEqual([])
  })

  it('offers only what a row actually wrote onto itself', () => {
    const verbs = bulkVerbsFor([row('a', ['discard'])])
    expect(verbs.map(v => v.cap)).toEqual(['discard'])
    expect(verbs[0].enabled).toBe(true)
    expect(verbs[0].reason).toBe(null)
  })

  it('refuses a verb only SOME of the selection can take, and says the numbers', () => {
    const verbs = bulkVerbsFor([row('a', ['approve', 'delete']), row('b', ['delete'])])
    const approve = verbs.find(v => v.cap === 'approve')!
    expect(approve.enabled).toBe(false)
    expect(approve.have).toBe(1)
    expect(approve.total).toBe(2)
    expect(approve.reason).toContain('1 of the 2')
    expect(approve.reason).toContain('every selected row or none')
    // The one they share stays live.
    expect(verbs.find(v => v.cap === 'delete')!.enabled).toBe(true)
  })

  it('never invents a verb no selected row carries', () => {
    const verbs = bulkVerbsFor([row('a', []), row('b', [])])
    expect(verbs).toEqual([])
  })

  it('walks CAP_ORDER, so the bar cannot draw two selections in two orders', () => {
    const verbs = bulkVerbsFor([row('a', ['delete', 'approve', 'skip'])])
    expect(verbs.map(v => v.cap)).toEqual(['approve', 'skip', 'delete'])
  })
})

/* 🔴 THE RULE THAT DECIDES E3: nothing on a row, a hover verb or the bulk bar
   may send or approve. The bar is shared across surfaces, so the guard is on
   what the DMs and Sales rows can ever PUT INTO it — a capability is written by
   the row and by nothing else, and these are the only two shapes those two
   surfaces produce. */
describe('the DMs and Sales selections can never reach approve or send', () => {
  const dmsSrc = readFileSync(join(process.cwd(), 'src/wb/dms/InboxList.tsx'), 'utf8')
  const salesSrc = readFileSync(join(process.cwd(), 'src/wb/sales/index.tsx'), 'utf8')

  it('a conversation selection offers discard and nothing else, however it is mixed', () => {
    const pending = row('m1', ['discard'], 'thread')
    const plain = row('m2', [], 'thread')
    for (const sel of [[pending], [plain], [pending, plain], [plain, pending, pending]]) {
      const caps = bulkVerbsFor(sel).map(v => v.cap)
      expect(caps.every(c => c === 'discard')).toBe(true)
      expect(caps).not.toContain('approve')
      expect(caps).not.toContain('promote')
    }
  })

  it('a mixed conversation selection cannot RUN the one verb it shows', () => {
    // Two rows, one of which has no capability: the discard is drawn refused
    // rather than applied to the subset. A bulk action that silently skips rows
    // is how an operator learns to distrust the count.
    const verbs = bulkVerbsFor([row('m1', ['discard'], 'thread'), row('m2', [], 'thread')])
    expect(verbs.find(v => v.cap === 'discard')!.enabled).toBe(false)
  })

  it('the DMs list writes exactly one caps site and it names no send', () => {
    const caps = [...dmsSrc.matchAll(/caps=\{([^}]*)\}/g)].map(m => m[1])
    expect(caps).toHaveLength(1)
    expect(caps[0]).toBe("pendingDraft ? ['discard'] : []")
  })

  it('no handler wired by either surface names a send or an approve', () => {
    // The handler names, not the prose: comments on both files discuss approve
    // precisely because it is the thing being refused.
    const handlers = (src: string) => [
      ...src.matchAll(/onClick=\{(?:e =>|\(\) =>)?([^}]*)\}/g),
    ].map(m => m[1]).join(' ')
    for (const src of [dmsSrc, salesSrc]) {
      expect(handlers(src)).not.toMatch(/approve|Approve|send|Send|promote|approved_at|sent_at/)
    }
  })

  it('neither surface imports a write that sends or approves', () => {
    for (const src of [dmsSrc, salesSrc]) {
      const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from/g)].map(m => m[1]).join(' ')
      expect(imports).not.toMatch(/approve|send|Send|dispatch/)
    }
  })

  it('the Sales rows register no capability at all — they are calendar rows', () => {
    // A Sales row is a WeekEvent plus an optional pack slug; it carries no
    // prospect id, so none of queue / skip / snooze / add-to-lane can be wired
    // to it without inventing a resolver. It therefore mounts no selection mark
    // and puts nothing into the bar. See DECISIONS D11.3.
    expect(salesSrc).not.toContain('RowSelect')
    expect(salesSrc).not.toContain('caps=')
  })
})

// E3 · the run a Shift+click covers. Pure: the order is the DOM's.
describe('rangeIds', () => {
  const order = ['a', 'b', 'c', 'd', 'e']

  it('covers both ends, in either direction', () => {
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('is one row when there is no anchor yet', () => {
    expect(rangeIds(order, null, 'c')).toEqual(['c'])
  })

  it('refuses an anchor that has scrolled out of a windowed list', () => {
    // The whole point: DMs renders ~15 of ~1,354 rows. A range measured from an
    // anchor the list can no longer find would run from index 0 and select
    // every row above the pointer.
    expect(rangeIds(order, 'gone', 'c')).toEqual(['c'])
  })

  it('is one row when the anchor IS the row clicked', () => {
    expect(rangeIds(order, 'c', 'c')).toEqual(['c'])
  })
})
