import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BulkBar, CAP_BUTTONS, CAP_ORDER, capCountOf, type BulkState } from './BulkBar'
import { buildCommands, type CommandCtx } from './commandSource'
import type { RowCap, SelectedRow } from './commandStore'

// 🔴 WHY THIS FILE EXISTS. The p4b/p4c merge widened `RowCap` from three members
// to five, and the compiler caught only some of the damage. Every
// `Record<RowCap, X>` failed `tsc -b` until it was completed, which is the good
// case. What it did NOT catch: a bare array literal such as
// `['approve', 'skip', 'delete']`, an `if/else if` chain that falls through to
// delete for a cap it was never taught, and a `toEqual` on a count map. Each of
// those compiles clean while quietly dropping a capability, and the failure mode
// is a button that never draws or, worse, a cap that lands in the wrong branch
// of the write loop.
//
// So the union is written out ONCE here, held to the type by the compiler, and
// every runtime list and every cap-keyed map is checked against it.

// Adding a sixth member to RowCap without adding it here fails `tsc -b`, so this
// object cannot fall behind the union. `Object.keys` then hands the runtime the
// same list the type carries.
const ALL_CAPS: Record<RowCap, true> = {
  approve: true,
  skip: true,
  promote: true,
  delete: true,
  discard: true,
}

const CAPS = Object.keys(ALL_CAPS) as RowCap[]

const row = (cap: RowCap, over: Partial<SelectedRow> = {}): SelectedRow => ({
  id: `r-${cap}`,
  kind: cap === 'discard' ? 'thread' : 'draft',
  label: 'A row',
  caps: [cap],
  lane: cap === 'promote' ? 'risedtc' : 'ivan',
  ...over,
})

const IDLE_STATE: BulkState = { busy: false, done: 0, total: 0, errors: [], note: null }

function ctx(over: Partial<CommandCtx> = {}): CommandCtx {
  const noop = () => {}
  return {
    job: 'content',
    rows: [],
    focusId: null,
    selected: [],
    capCount: { approve: 0, skip: 0, promote: 0, delete: 0, discard: 0 },
    hasSearch: true,
    go: noop, move: noop, openFocused: noop, toggleFocused: noop, selectAll: noop,
    clearSelection: noop, focusSearch: noop, openSheet: noop, openPalette: noop,
    closeTop: noop, runBulk: noop, openRow: noop,
    ...over,
  }
}

describe('every RowCap reaches every cap-keyed map and list', () => {
  it('CAP_ORDER carries every cap, once', () => {
    expect([...CAP_ORDER].sort()).toEqual([...CAPS].sort())
    expect(new Set(CAP_ORDER).size).toBe(CAP_ORDER.length)
  })

  it('CAP_BUTTONS is CAP_ORDER minus promote, and that omission is the ruling', () => {
    // Promote renders on a row of its own, above the action group, for the
    // measured reason recorded in BulkBar.tsx. Every OTHER cap has to be in the
    // button group or it has no way to be run from the bar at all.
    expect([...CAP_BUTTONS].sort()).toEqual(CAPS.filter(c => c !== 'promote').sort())
  })

  it('capCountOf answers for every cap, including the ones the selection cannot take', () => {
    const counts = capCountOf([row('approve')])
    expect(Object.keys(counts).sort()).toEqual([...CAPS].sort())
    for (const cap of CAPS) expect(typeof counts[cap]).toBe('number')
  })

  it('the command source names, hints and refuses every cap, with no hole printed as undefined', () => {
    // With one row selected and no cap available, every act row takes the
    // `have === 0` refusal, which is the branch that reads CAP_PAST. A missing
    // entry in CAP_VERB, CAP_HINT or CAP_PAST surfaces as the literal string
    // "undefined" in the palette rather than as a compile error at this call.
    const cmds = buildCommands(ctx({ selected: [row('approve')] }))
    for (const cap of CAPS) {
      const c = cmds.find(x => x.id === `act.${cap}`)
      expect(c, `no palette command for cap ${cap}`).toBeDefined()
      expect(c?.title ?? '').not.toContain('undefined')
      expect((c?.hint ?? '').length).toBeGreaterThan(0)
      expect(c?.reason ?? '').not.toContain('undefined')
    }
  })

  it('the bar draws a labelled control for every cap a row can carry', () => {
    for (const cap of CAPS) {
      const html = renderToStaticMarkup(
        <BulkBar
          rows={[row(cap)]}
          state={IDLE_STATE}
          onRun={() => {}}
          onDismiss={() => {}}
          onSelectAll={() => {}}
          onClear={() => {}}
          rowCount={1}
        />,
      )
      // A cap missing from VERB renders its button as "undefined 1"; a cap
      // missing from both CAP_BUTTONS and the client row renders no button at
      // all and the bar prints its "nothing can be changed in bulk" refusal
      // over a selection that can, in fact, be acted on.
      expect(html, `cap ${cap} draws no button`).toContain('wb-bulk-b')
      expect(html, `cap ${cap} has no verb`).not.toContain('undefined')
      expect(html, `cap ${cap} falls into the no-writes refusal`)
        .not.toContain('Nothing on this tab can be changed in bulk')
    }
  })
})

describe('the two branches of this merge never meet on one selection', () => {
  // promote is a content draft on a client board; discard is a pending DM draft
  // on a conversation. The caps are written by the row, in two files that cannot
  // both fire for the same row: ContentList.tsx's Card emits approve/skip/
  // promote/delete for kind 'draft' and never discard, and InboxScreen.tsx's
  // thread row emits ['discard'] or [] for kind 'thread' and never promote.
  // This pins the consequence the bar depends on.
  it('a promote selection offers no discard, and a discard selection offers no promote', () => {
    const promoteOnly = capCountOf([row('promote'), row('promote', { id: 'p2' })])
    expect(promoteOnly.discard).toBe(0)
    const discardOnly = capCountOf([row('discard'), row('discard', { id: 'd2' })])
    expect(discardOnly.promote).toBe(0)
  })

  it('a conversation row can never reach approve, because a bulk approve is a bulk send', () => {
    const counts = capCountOf([row('discard', { kind: 'thread' })])
    expect(counts.approve).toBe(0)
    const html = renderToStaticMarkup(
      <BulkBar
        rows={[row('discard', { kind: 'thread' })]}
        state={IDLE_STATE}
        onRun={() => {}}
        onDismiss={() => {}}
        onSelectAll={() => {}}
        onClear={() => {}}
        rowCount={1}
      />,
    )
    expect(html).toContain('Discard')
    expect(html).not.toContain('Approve')
  })
})
