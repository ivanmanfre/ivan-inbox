import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GROUP_ORDER, keyRows, matchWbCommands, type WbCommand, type WbGroup,
} from './commandSource'

// The ⌘K palette and the ? shortcut sheet. Two renderings of ONE array: both
// take the same `cmds` built by buildCommands(), so a key that exists in the
// palette exists in the sheet and neither can drift.
//
// WHAT THIS DELIBERATELY COPIES from ChatPane's slash palette, and why:
//
//   · token-wise matching, not whole-string. "model haiku" against
//     `/model claude-haiku-4-5` matched nothing under the old whole-string
//     rule, which closed that palette and let Enter fall through to the model.
//   · the vocabulary NEVER shrinks. An unavailable command is listed, dimmed
//     and prints its reason. Running one is a no-op.
//   · a query that matches nothing does not close the palette. It renders a
//     sentence saying so and keeps the way back (clear the query) one key away.
//
// WHAT IT ADDS: every row prints its own shortcut. Rows that no key runs print
// that in words rather than leaving the column empty, because a column that is
// blank on half the rows teaches the operator to stop reading it. The printed
// legend is the pattern MagnetWindow already uses, applied to the whole app.

function GroupRows({ group, cmds, cursor, onHover, onRun }: {
  group: WbGroup
  cmds: { c: WbCommand; i: number }[]
  cursor: number
  onHover: (i: number) => void
  onRun: (c: WbCommand) => void
}) {
  if (cmds.length === 0) return null
  return (
    <div className="wb-cmdk-grp">
      <div className="wb-cmdk-grph">{group}</div>
      {cmds.map(({ c, i }) => (
        <button
          type="button"
          key={c.id}
          id={`wb-cmdk-${i}`}
          role="option"
          aria-selected={i === cursor}
          aria-disabled={!c.ready}
          className={`wb-cmdk-row${c.ready ? '' : ' off'}${i === cursor ? ' on' : ''}`}
          onMouseEnter={() => onHover(i)}
          onClick={() => onRun(c)}
        >
          <span className="wb-cmdk-t">{c.title}</span>
          <span className="wb-cmdk-h">{c.ready ? c.hint : c.reason ?? 'not available here'}</span>
          <span className="wb-cmdk-k">{c.key ?? 'no key'}</span>
        </button>
      ))}
    </div>
  )
}

export function CommandPalette({ cmds, onClose }: {
  cmds: WbCommand[]
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const field = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => matchWbCommands(q, cmds), [q, cmds])

  // The cursor starts on the first command that can actually run. Landing it on
  // a dimmed row would make the first Enter a no-op, which reads as a broken
  // palette rather than as a refusal.
  useEffect(() => {
    const first = shown.findIndex(c => c.ready)
    setCursor(first < 0 ? 0 : first)
  }, [q, shown.length])

  useEffect(() => { field.current?.focus() }, [])

  // Keep the cursor row on screen while arrowing through 200 rows.
  useEffect(() => {
    document.getElementById(`wb-cmdk-${cursor}`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const run = (c: WbCommand) => {
    if (!c.ready) return
    onClose()
    c.run()
  }

  const onKey = (e: React.KeyboardEvent) => {
    // Every key below is handled INSIDE the field, so the global layer's guard
    // (nothing fires while a field has focus) stays true and this palette still
    // drives fully from the keyboard.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setCursor(i => (shown.length === 0 ? 0 : (i + 1) % shown.length))
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setCursor(i => (shown.length === 0 ? 0 : (i - 1 + shown.length) % shown.length))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const c = shown[cursor]
      if (c) run(c)
    }
  }

  const indexed = shown.map((c, i) => ({ c, i }))

  return (
    <div className="wb-cmdk-scrim" onMouseDown={onClose}>
      <div
        className="wb-cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={e => e.stopPropagation()}
      >
        <input
          ref={field}
          className="wb-cmdk-q"
          type="text"
          value={q}
          placeholder="Type to find a command, a lane or a row"
          aria-label="Find a command"
          role="combobox"
          aria-expanded
          aria-controls="wb-cmdk-list"
          aria-activedescendant={`wb-cmdk-${cursor}`}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="wb-cmdk-list" id="wb-cmdk-list" role="listbox" aria-label="Commands">
          {shown.length === 0 ? (
            // 🔴 The palette stays OPEN on no match. Closing here is the exact
            // behaviour ChatPane's comment was written about.
            <div className="wb-cmdk-none">
              Nothing is called “{q}”. Clear the box to see every command again.
            </div>
          ) : GROUP_ORDER.map(g => (
            <GroupRows
              key={g}
              group={g}
              cmds={indexed.filter(x => x.c.group === g)}
              cursor={cursor}
              onHover={setCursor}
              onRun={run}
            />
          ))}
        </div>
        <div className="wb-cmdk-foot">
          <span>↑ ↓ to move</span>
          <span>Enter to run</span>
          <span>Esc to close</span>
          <span>? for every key</span>
        </div>
      </div>
    </div>
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
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.focus() }, [])
  return (
    <div className="wb-keys-scrim" onMouseDown={onClose}>
      <div
        className="wb-keys"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        ref={box}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      >
        <div className="wb-keys-h">
          <span className="wb-keys-ttl">Keyboard</span>
          <button type="button" className="wb-keys-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="wb-keys-body">
          {GROUP_ORDER.map(g => {
            const gr = rows.filter(r => r.group === g)
            if (gr.length === 0) return null
            return (
              <div className="wb-keys-grp" key={g}>
                <div className="wb-keys-grph">{g}</div>
                {gr.map(r => (
                  <div className="wb-keys-row" key={r.id}>
                    <span className="wb-keys-k">{r.key}</span>
                    <span className="wb-keys-t">{r.title}</span>
                  </div>
                ))}
              </div>
            )
          })}
          {/* Stated, not implied: the keys that write are not here because they
              do not exist. Approve, skip and delete stay on their buttons and
              in the palette, behind the confirm each one already carries. */}
          <div className="wb-keys-note">
            No single key approves, skips, deletes or sends anything. Those run
            from a button or from the palette, and each one asks first.
          </div>
        </div>
      </div>
    </div>
  )
}
