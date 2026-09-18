/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dmsEmptyKind, hoverVerbFor, rowVerb, rowsScrollTop } from './InboxList'

// W2-5 (absorbs GAPS-3): a screen with 0 rows on it is not always genuinely
// empty. Only a host that has established the fetch resolved (`verifiedAt`
// not null) may claim "nothing waiting on you".
describe('dmsEmptyKind', () => {
  it('renders rows, not an empty state, when there are any', () => {
    expect(dmsEmptyKind(3, '', null)).toBe('none')
  })

  it('shows the row skeleton before the first fetch resolves, cold open', () => {
    expect(dmsEmptyKind(0, '', null)).toBe('loading')
  })

  it('shows the honest empty claim once verifiedAt is a real timestamp', () => {
    expect(dmsEmptyKind(0, '', '2026-09-08T10:00:00Z')).toBe('verified')
  })

  it('a search with no matches wins over the loading state', () => {
    expect(dmsEmptyKind(0, 'nobody', null)).toBe('search')
  })

  it('a search with no matches wins over the verified empty state too', () => {
    expect(dmsEmptyKind(0, 'nobody', '2026-09-08T10:00:00Z')).toBe('search')
  })
})

// R2 · The phone row's only affordance was `Discard`, 76x34, under the 44px
// floor, on six of eight live rows. A list is not where a draft is destroyed on
// a first tap. The fork below is the whole of that repair.
describe('rowVerb', () => {
  it('shows nothing on a row with no pending draft, either canvas', () => {
    expect(rowVerb({ mobile: true, pendingDraft: false, preRead: false })).toBe(null)
    expect(rowVerb({ mobile: false, pendingDraft: false, preRead: false })).toBe(null)
  })

  it('keeps the desktop hover Discard exactly as it was', () => {
    expect(rowVerb({ mobile: false, pendingDraft: true, preRead: false })).toBe('discard')
    expect(rowVerb({ mobile: false, pendingDraft: true, preRead: true })).toBe('discard')
  })

  it('never puts the destructive verb under the thumb', () => {
    expect(rowVerb({ mobile: true, pendingDraft: true, preRead: false })).not.toBe('discard')
    expect(rowVerb({ mobile: true, pendingDraft: true, preRead: true })).not.toBe('discard')
  })

  it('opens the thread instead, on the phone', () => {
    expect(rowVerb({ mobile: true, pendingDraft: true, preRead: false })).toBe('open')
  })

  it('leaves the one action slot to Sum up when the row already offers it', () => {
    expect(rowVerb({ mobile: true, pendingDraft: true, preRead: true })).toBe(null)
  })
})

// The capability the list registers for a pending-draft row. Read off the
// SHIPPED source rather than restated, because the rule it guards is a rule
// about what the bulk bar may ever offer: a conversation is answered one at a
// time, and the only thing a list may run in bulk is a discard, which sends
// nothing. An `approve` or `send` appearing here would be a one-tap send from a
// list.
describe('the list exposes no approve/send capability', () => {
  const src = readFileSync(join(process.cwd(), 'src/wb/dms/InboxList.tsx'), 'utf8')
  it("caps on a pending-draft row is ['discard'] and nothing else", () => {
    expect(src).toContain("caps={pendingDraft ? ['discard'] : []}")
    const caps = [...src.matchAll(/caps=\{([^}]*)\}/g)].map(m => m[1])
    expect(caps).toHaveLength(1)
    for (const c of caps) {
      expect(c).not.toMatch(/approve|send|promote/)
    }
  })
})

// R2b · A drag that locked sideways and then died under the 72px threshold
// fires no click, so the click-swallowing flag had nothing to clear it and the
// row's NEXT tap was eaten. The flag is a ref inside a mounted component, so the
// guard is on the SHIPPED source: the clear has to be at the start of a gesture,
// which is both late enough to swallow this gesture's click and early enough to
// let the next tap through.
describe('the swipe never eats the next tap', () => {
  const src = readFileSync(join(process.cwd(), 'src/wb/dms/InboxList.tsx'), 'utf8')
  const down = src.slice(src.indexOf('onPointerDown={e => {'), src.indexOf('onPointerMove={e => {'))

  it('clears the click-swallow flag when a new gesture starts', () => {
    expect(down).toContain('swiped.current = false')
  })

  it('does not clear it when the gesture ENDS, which would let the click through', () => {
    const reset = src.slice(src.indexOf('const reset = () => {'), src.indexOf('return ('))
    expect(reset).not.toContain('swiped.current')
  })
})

/* E3 · THE ROW NAMES ITS ONE VERB UNDER A POINTER (isaiahbjork/leads-data-table).
   The hovered row gives up its right-hand metadata for the single thing it is
   for. This is which thing — and the only NEW control it can ask for is `open`,
   which is what the row's own click has always done and never said. */
describe('hoverVerbFor', () => {
  it('is silent on every canvas without a fine pointer to hover with', () => {
    for (const pendingDraft of [true, false]) {
      for (const preRead of [true, false]) {
        expect(hoverVerbFor({ desktopHover: false, pendingDraft, preRead })).toBe(null)
      }
    }
  })

  it('keeps Discard as the pending-draft row\u2019s verb, which is what it already was', () => {
    expect(hoverVerbFor({ desktopHover: true, pendingDraft: true, preRead: false })).toBe('discard')
    expect(hoverVerbFor({ desktopHover: true, pendingDraft: true, preRead: true })).toBe('discard')
  })

  it('lets the Sum up the row already draws BE the verb, rather than adding a second', () => {
    expect(hoverVerbFor({ desktopHover: true, pendingDraft: false, preRead: true })).toBe('sumup')
  })

  it('names Open on a plain conversation', () => {
    expect(hoverVerbFor({ desktopHover: true, pendingDraft: false, preRead: false })).toBe('open')
  })

  it('never answers with anything that sends', () => {
    const answers = new Set<unknown>()
    for (const desktopHover of [true, false]) {
      for (const pendingDraft of [true, false]) {
        for (const preRead of [true, false]) {
          answers.add(hoverVerbFor({ desktopHover, pendingDraft, preRead }))
        }
      }
    }
    expect([...answers].sort()).toEqual([null, 'discard', 'open', 'sumup'].sort())
  })
})

// 2026-09-18: the scroller also holds the sections ABOVE the rows (Warm signals, Came back).
// Windowing off the scroller's own scrollTop unmounted the rows still on screen once that slot
// grew to ~700px: every chat went grey while scrolling. The window now measures from a marker
// where the rows start.
describe('rowsScrollTop', () => {
  const el = (top: number, scrollTop = 0) => ({ scrollTop, getBoundingClientRect: () => ({ top }) }) as unknown as HTMLElement
  it('is 0 while the rows have not reached the top of the scroller', () => {
    expect(rowsScrollTop(el(100, 600), el(800))).toBe(0)
  })
  it('counts only the distance scrolled INTO the rows, never the slot above them', () => {
    // scroller top at 100, rows marker now 500px above it: 500 into the rows, whatever scrollTop says
    expect(rowsScrollTop(el(100, 1200), el(-400))).toBe(500)
  })
  it('falls back to scrollTop with no marker', () => {
    expect(rowsScrollTop(el(100, 321), null)).toBe(321)
  })
})
