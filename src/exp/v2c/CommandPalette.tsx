/* ==========================================================================
   S22 the command palette and S23 the shortcut sheet, on `src/ds`.

   BOTH ARE STILL TWO RENDERINGS OF ONE ARRAY. They take the same `cmds` built
   by buildCommands(), so a key that exists in the palette exists in the sheet
   and neither can drift. Every rule the old file argued for is intact:

     · token-wise matching, not whole-string. "model haiku" against
       `/model claude-haiku-4-5` matched nothing under a whole-string rule.
     · the vocabulary NEVER shrinks. An unavailable command stays listed,
       dimmed, printing its reason. Running one is a no-op.
     · a query that matches nothing does not close the palette. It renders a
       sentence saying so and keeps the way back one key away.
     · every row prints its own shortcut, and a row no key runs says so in
       words rather than leaving the column blank.
     · the cursor space is ONE space: the find rows sit after every command, so
       the arrows and Enter reach a database row the way they reach a command.

   What the design system changes is the drawing. The rows are `CommandList`,
   whose key hints are real `Kbd` caps rather than a text column, the box is a
   `Dialog` (so the scrim, the escape and the exit transition are the app's own
   and not a third hand-rolled overlay), and the footer legend's two arrows are
   drawn marks. The keyboard handling below is byte for byte the old handler:
   the bindings live in CommandLayer and nothing about the close stack moved.
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react'
import { CommandList, Dialog, Icon, Input, Kbd, type CommandGroup, type CommandItem } from '../../ds'
import {
  GROUP_ORDER, keyRows, matchWbCommands, type WbCommand,
} from './commandSource'
import {
  CROSS_MIN, SURFACE_LABEL, laneName,
  type CrossHit, type CrossResults, type LaneCount,
} from '../../lib/crossSearch'
import type { ContentLane } from '../../lib/content'
import { CONTENT_LANES } from '../../lib/content'
import '../../wb/chrome/chrome.css'

export type FindState = CrossResults & {
  q: string
  busy: boolean
  /** Other lanes, as a COUNT only. Never a row. See lib/crossSearch.ts. */
  elsewhere: LaneCount[]
  setLane: (l: ContentLane) => void
}

// A key string ('⌘K', 'Esc', 'j') as the caps a reader can find on a keyboard.
// commandSource owns the strings; this only decides where one cap ends.
function caps(key: string | null): string[] | undefined {
  if (!key) return undefined
  return [key]
}

export function CommandPalette({ cmds, find, onQuery, onPick, onClose }: {
  cmds: WbCommand[]
  find?: FindState
  onQuery?: (q: string) => void
  onPick?: (h: CrossHit) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const FIELD_ID = 'wb-cmdk-q'

  const shown = useMemo(() => matchWbCommands(q, cmds), [q, cmds])
  const hits = find && q.trim().length >= CROSS_MIN ? find.hits : []
  const total = shown.length + hits.length

  // The cursor starts on the first command that can actually run. Landing it on
  // a dimmed row would make the first Enter a no-op, which reads as a broken
  // palette rather than as a refusal.
  const firstReady = useMemo(() => {
    const i = shown.findIndex(c => c.ready)
    return i < 0 ? 0 : i
  }, [shown])
  useEffect(() => { setCursor(firstReady) }, [firstReady])

  // The field owns focus from the moment the dialog opens: every binding below
  // is handled inside it, which is what keeps the global layer's "nothing fires
  // while a field has focus" guard true.
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(FIELD_ID)?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  // Keep the cursor row on screen while arrowing through 200 rows.
  useEffect(() => {
    document.getElementById(`wb-cmdk-${cursor}`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const run = (c: WbCommand) => {
    if (!c.ready) return
    onClose()
    c.run()
  }

  const pick = (h: CrossHit) => {
    onClose()
    onPick?.(h)
  }

  const onKey = (e: React.KeyboardEvent) => {
    // Every key below is handled INSIDE the field, so the global layer's guard
    // (nothing fires while a field has focus) stays true and this palette still
    // drives fully from the keyboard.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setCursor(i => (total === 0 ? 0 : (i + 1) % total))
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setCursor(i => (total === 0 ? 0 : (i - 1 + total) % total))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (cursor >= shown.length) {
        const h = hits[cursor - shown.length]
        if (h) pick(h)
        return
      }
      const c = shown[cursor]
      if (c) run(c)
    }
  }

  const idOf = (i: number) => `wb-cmdk-${i}`
  const indexed = shown.map((c, i) => ({ c, i }))

  const groups: CommandGroup[] = GROUP_ORDER.map(g => ({
    id: g,
    label: g,
    items: indexed
      .filter(x => x.c.group === g)
      .map<CommandItem>(({ c, i }) => ({
        id: idOf(i),
        label: c.title,
        keys: caps(c.key),
        ready: c.ready,
        reason: c.ready ? c.hint : c.reason ?? 'not available here',
        onRun: () => run(c),
      })),
  })).filter(g => g.items.length > 0)

  // The find section. One key already opens this box, so crossing objects
  // belongs INSIDE it rather than behind a second overlay with a second
  // shortcut. Every row prints which surface it came from, because a list that
  // mixed three objects without saying which is which would be a worse answer
  // than three lists.
  if (find && q.trim().length >= CROSS_MIN) {
    const items: CommandItem[] = find.hits.map((h, n) => {
      const i = shown.length + n
      return {
        id: idOf(i),
        label: h.title,
        reason: h.snippet || h.sub,
        badge: <span className="a-find-badge ds-t-eyebrow">{SURFACE_LABEL[h.surface]}</span>,
        onRun: () => pick(h),
      }
    })
    groups.push({
      id: 'find',
      label: `Anything you have written, in ${laneName(find.lane)}`,
      items,
    })
  }

  const foot = (
    <>
      <span className="a-cmdk-legend">
        <Icon name="up" size={16} /><Icon name="down" size={16} /> to move
      </span>
      <span>Opens, never acts</span>
      <span><Kbd>Enter</Kbd> to run</span>
      <span><Kbd>Esc</Kbd> to close</span>
      <span><Kbd>?</Kbd> for every key</span>
    </>
  )

  return (
    <Dialog
      open
      onClose={onClose}
      size="wide"
      className="a-cmdk"
      foot={null}
    >
      <Input
        id={FIELD_ID}
        label="Find a command, or anything you have written"
        labelHidden
        icon="search"
        value={q}
        placeholder="Find a command, or anything you have written"
        role="combobox"
        aria-expanded
        aria-controls="wb-cmdk-list"
        aria-activedescendant={idOf(cursor)}
        onChange={e => { setQ(e.target.value); onQuery?.(e.target.value) }}
        onKeyDown={onKey}
      />
      {/* The lane switch: which lane the cross-object find is asking. */}
      {find && q.trim().length >= CROSS_MIN ? (
        <div className="a-find-lanes">
          {CONTENT_LANES.map(l => (
            <button
              type="button"
              key={l}
              className="a-find-lane"
              data-active={l === find.lane}
              onMouseDown={e => { e.preventDefault(); find.setLane(l) }}
            >{laneName(l)}</button>
          ))}
        </div>
      ) : null}
      <CommandList
        head={null}
        groups={groups}
        activeId={idOf(cursor)}
        className="a-cmdk-list"
        // 🔴 The palette stays OPEN on no match. Closing here is the exact
        // behaviour ChatPane's comment was written about.
        empty={find?.busy
          ? 'Looking...'
          : hits.length === 0 && find && q.trim().length >= CROSS_MIN
            ? `Nothing in ${laneName(find.lane)} says "${q.trim()}". Try another lane.`
            : `Nothing is called "${q}". Clear the box to see every command again.`}
        foot={foot}
      />
      {/* The dead end, ended, without putting one lane's rows under another
          lane's name: a number and a way to go and look. */}
      {find && find.elsewhere.length > 0 ? (
        <div className="a-find-else ds-t-meta">
          <span>Also written elsewhere:</span>
          {find.elsewhere.map(c => (
            <button
              type="button"
              key={c.lane}
              className="a-find-lane"
              onMouseDown={e => { e.preventDefault(); find.setLane(c.lane) }}
            >{laneName(c.lane)} has {c.n}</button>
          ))}
        </div>
      ) : null}
      {find && find.failed.length > 0 ? (
        <div className="a-find-else ds-t-meta">Could not reach {find.failed.join(' or ')} just now.</div>
      ) : null}
    </Dialog>
  )
}

// The ? sheet. Same array, filtered to the commands a key runs and grouped the
// same way. There is no second table of shortcuts in this app to fall out of
// step with the palette.
export function ShortcutSheet({ cmds, onClose }: {
  cmds: WbCommand[]
  onClose: () => void
}) {
  const rows = useMemo(() => keyRows(cmds), [cmds])
  return (
    <Dialog open onClose={onClose} title="Keyboard" className="a-keys" foot={null}>
      <div className="a-keys-body">
        {GROUP_ORDER.map(g => {
          const gr = rows.filter(r => r.group === g)
          if (gr.length === 0) return null
          return (
            <div className="a-keys-grp" key={g}>
              <div className="ds-t-eyebrow">{g}</div>
              {gr.map(r => (
                <div className="a-keys-row" key={r.id}>
                  <span className="a-keys-k"><Kbd>{r.key}</Kbd></span>
                  <span className="a-keys-t">{r.title}</span>
                </div>
              ))}
            </div>
          )
        })}
        {/* Stated, not implied: the keys that write are not here because they
            do not exist. Approve, skip and delete stay on their buttons and in
            the palette, behind the confirm each one already carries. */}
        <div className="a-keys-note ds-t-meta">
          No single key approves, skips, deletes or sends anything. Those run
          from a button or from the palette, and each one asks first.
        </div>
      </div>
    </Dialog>
  )
}
