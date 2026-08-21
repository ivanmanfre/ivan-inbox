import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { groupThreads, type InboxMessage } from '../../lib/inbox'
import { RestoreStrip } from './RestoreStrip'
import { buildCommands, keyRows, matchWbCommands, selectionNoun, type CommandCtx } from './commandSource'
import {
  clearSelection, getFocusId, getSelected, isSelected, registerRow, resetStore,
  rowState, selectRows, setFocus, setScope, toggleRow, type SelectedRow,
} from './commandStore'

// 🔴 Nothing in this file can reach the database. `renderToStaticMarkup` runs no
// effects and fires no events, so the restore control is asserted on the markup
// it draws, never by calling the write. The write itself, its guard and its
// round trip are proven in `src/lib/inbox.test.ts` (phase 4a).

const base: InboxMessage = {
  id: '1', prospect_id: 'p1', direction: 'outbound', message_text: 'the draft copy',
  message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
  read_at: null, created_at: '2026-08-20T10:00:00Z', send_blocked_at: null,
  send_blocked_reason: null, unipile_chat_id: null, ai_model: null,
  prospect_name: 'A', prospect_company: null,
  prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
  profile_photo_url: null, campaign_name: 'c', client_id: 'ivan',
  snoozed_until: null, snoozed_at: null,
}

const discarded = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  ...base,
  id: 'discarded',
  send_blocked_reason: 'discarded_in_inbox',
  send_blocked_at: '2026-08-20T11:00:00.000Z',
  ...over,
})

const threadOf = (rows: InboxMessage[]) => groupThreads(rows, new Set(), Date.parse('2026-08-20T12:00:00Z'))[0]

const row = (over: Partial<SelectedRow> = {}): SelectedRow =>
  ({ id: 'r1', kind: 'draft', label: 'A draft', caps: ['approve', 'skip', 'delete'], ...over })

function ctx(over: Partial<CommandCtx> = {}): CommandCtx {
  const noop = () => {}
  return {
    job: 'content',
    rows: [],
    focusId: null,
    selected: [],
    capCount: { approve: 0, skip: 0, delete: 0 },
    hasSearch: true,
    go: noop, move: noop, openFocused: noop, toggleFocused: noop, selectAll: noop,
    clearSelection: noop, focusSearch: noop, openSheet: noop, openPalette: noop,
    closeTop: noop, runBulk: noop, openRow: noop,
    ...over,
  }
}

// ---------------------------------------------------------------------------

describe('the command vocabulary never shrinks', () => {
  it('lists the same commands with nothing selected as with a full selection', () => {
    const empty = buildCommands(ctx())
    const full = buildCommands(ctx({
      selected: [row(), row({ id: 'r2' })],
      capCount: { approve: 2, skip: 2, delete: 2 },
    }))
    expect(empty.map(c => c.id)).toEqual(full.map(c => c.id))
  })

  it('every unavailable command carries a reason instead of disappearing', () => {
    const cmds = buildCommands(ctx())
    const off = cmds.filter(c => !c.ready)
    expect(off.length).toBeGreaterThan(0)
    for (const c of off) expect((c.reason ?? '').length).toBeGreaterThan(0)
  })

  it('lists the lane you are already on, dimmed, rather than dropping it', () => {
    const here = buildCommands(ctx({ job: 'content' })).find(c => c.id === 'go.content')
    expect(here).toBeDefined()
    expect(here?.ready).toBe(false)
    expect(here?.reason).toBe('you are on it')
  })

  it('refuses a bulk action that only some of the selection can take, and says the number', () => {
    const cmds = buildCommands(ctx({
      selected: [row(), row({ id: 'r2', caps: ['delete'] })],
      capCount: { approve: 1, skip: 1, delete: 2 },
    }))
    const skip = cmds.find(c => c.id === 'act.skip')
    expect(skip?.ready).toBe(false)
    expect(skip?.reason).toContain('only 1 of the 2')
    expect(cmds.find(c => c.id === 'act.delete')?.ready).toBe(true)
  })
})

describe('matchWbCommands', () => {
  const cmds = buildCommands(ctx())
  it('matches token-wise and in any order', () => {
    // The whole-string bug ChatPane measured: "row next" finds "Next row".
    expect(matchWbCommands('row next', cmds).map(c => c.id)).toContain('move.next')
  })
  it('an empty query is the whole vocabulary', () => {
    expect(matchWbCommands('', cmds).length).toBe(cmds.length)
  })
  it('a query that matches nothing returns nothing, so the palette can say so', () => {
    expect(matchWbCommands('zzqq', cmds)).toEqual([])
  })
})

describe('the shortcut sheet and the palette read one list', () => {
  const cmds = buildCommands(ctx({ rows: [], focusId: null }))
  it('every sheet row comes from the palette array and prints a key', () => {
    const sheet = keyRows(cmds)
    expect(sheet.length).toBeGreaterThan(0)
    for (const r of sheet) {
      expect(r.key).toBeTruthy()
      expect(cmds.some(c => c.id === r.id)).toBe(true)
    }
  })

  // 🔴 THE RULING, AS A TEST. No key runs an action: approve, skip, delete and
  // send stay on their buttons and in the palette, behind their confirms.
  it('no command in the Act group carries a key', () => {
    for (const c of cmds.filter(c => c.group === 'Act')) expect(c.key).toBeNull()
  })
  it('the only keys bound are navigation and selection', () => {
    const bound = new Set(keyRows(cmds).map(c => c.key))
    expect([...bound].sort()).toEqual(['/', '?', 'Enter', 'Esc', 'j', 'k', 'x', '⌘K'].sort())
  })
})

describe('selectionNoun names the object', () => {
  it('uses the row kind, singular and plural', () => {
    expect(selectionNoun([row()])).toBe('draft')
    expect(selectionNoun([row(), row({ id: 'b' })])).toBe('drafts')
    expect(selectionNoun([row({ kind: 'thread' })])).toBe('conversation')
    expect(selectionNoun([row({ kind: 'magnet' }), row({ id: 'b', kind: 'magnet' })])).toBe('lead magnets')
  })
  it('falls back to rows when the kinds are mixed rather than picking one', () => {
    expect(selectionNoun([row(), row({ id: 'b', kind: 'thread' })])).toBe('rows')
  })
})

describe('the selection store', () => {
  beforeEach(() => resetStore())

  it('toggles a row in and back out', () => {
    toggleRow(row())
    expect(isSelected('r1')).toBe(true)
    toggleRow(row())
    expect(isSelected('r1')).toBe(false)
  })

  it('select-all does not duplicate rows already picked', () => {
    toggleRow(row())
    selectRows([row(), row({ id: 'r2' })])
    expect(getSelected().map(r => r.id)).toEqual(['r1', 'r2'])
  })

  it('reports one scalar per row: bit 1 selected, bit 2 focused', () => {
    toggleRow(row())
    setFocus('r1')
    expect(rowState('r1')).toBe(3)
    expect(rowState('r2')).toBe(0)
  })

  // 🔴 The rule this store exists for. A selection that survived a tab change
  // would still say twelve while pointing at rows that are no longer on screen.
  it('a scope change drops the selection AND the focus', () => {
    setScope('content|Ivan|Errors|')
    toggleRow(row())
    setFocus('r1')
    setScope('content|Ivan|Archived|')
    expect(getSelected()).toEqual([])
    expect(getFocusId()).toBeNull()
  })

  it('re-setting the same scope leaves the selection alone', () => {
    setScope('content|Ivan|Errors|')
    toggleRow(row())
    setScope('content|Ivan|Errors|')
    expect(getSelected().length).toBe(1)
  })

  it('a row unregisters when it leaves the list', () => {
    const off = registerRow(row())
    off()
    clearSelection()
    expect(getSelected()).toEqual([])
  })
})

describe('the restore control is gated by canRestore', () => {
  it('offers the restore when the discard is the newest outbound event', () => {
    const t = threadOf([{ ...base, id: 'sent', sent_at: '2026-08-20T09:00:00+00:00' }, discarded()])
    const html = renderToStaticMarkup(<RestoreStrip thread={t} refresh={() => {}} />)
    expect(html).toContain('Bring it back')
    // The copy says what happens next. Restore is not approve.
    expect(html).toContain('Nothing is sent until you approve it')
  })

  it('draws no control at all while a hand-typed reply is still queued', () => {
    // The composeReply window: the manual reply is INSERTED first, so it is
    // older than the discard, and only the approved-and-unsent test catches it.
    const t = threadOf([
      { ...base, id: 'manual', approved_at: '2026-08-20T10:59:59Z', sent_at: null, created_at: '2026-08-20T10:59:59Z' },
      discarded(),
    ])
    const html = renderToStaticMarkup(<RestoreStrip thread={t} refresh={() => {}} />)
    expect(html).not.toContain('Bring it back')
    expect(html).toContain('already in the send queue')
  })

  it('draws no control once our own side has spoken after the ruling', () => {
    const t = threadOf([
      { ...base, id: 'after', sent_at: '2026-08-20T11:30:00+00:00' },
      discarded(),
    ])
    const html = renderToStaticMarkup(<RestoreStrip thread={t} refresh={() => {}} />)
    expect(html).not.toContain('Bring it back')
    expect(html).toContain('answer the same message twice')
  })

  it('an inbound reply after the discard does not withhold the control', () => {
    const t = threadOf([
      discarded(),
      { ...base, id: 'in', direction: 'inbound', created_at: '2026-08-20T11:30:00Z' },
    ])
    expect(renderToStaticMarkup(<RestoreStrip thread={t} refresh={() => {}} />)).toContain('Bring it back')
  })

  it('renders nothing at all on a thread with no discarded draft', () => {
    const t = threadOf([{ ...base, id: 'sent', sent_at: '2026-08-20T09:00:00+00:00' }])
    expect(renderToStaticMarkup(<RestoreStrip thread={t} refresh={() => {}} />)).toBe('')
  })

  it('refuses every block reason that is not our own discard', () => {
    for (const reason of ['send_failed_verified:x', 'geo_gate_v2:x', 'post_approval_race:outbound']) {
      const t = threadOf([discarded({ send_blocked_reason: reason })])
      expect(renderToStaticMarkup(<RestoreStrip thread={t} refresh={() => {}} />)).toBe('')
    }
  })
})
