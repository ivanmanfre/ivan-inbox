import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GROUP_ORDER, keyRows, matchWbCommands, type WbCommand, type WbGroup,
} from './commandSource'
import {
  CROSS_MIN, SURFACE_LABEL, laneName,
  type CrossHit, type CrossResults, type LaneCount,
} from '../../lib/crossSearch'
import type { ContentLane } from '../../lib/content'
import { CONTENT_LANES } from '../../lib/content'

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

// ---------------------------------------------------------------------------
// The find section (AI pass item 3)
// ---------------------------------------------------------------------------
//
// One key already opens this box, so crossing objects belongs INSIDE it rather
// than behind a second overlay with a second shortcut. Type two characters and
// the same query that filters the command list also asks the database for
// conversations, drafts and lead magnets on ONE lane.
//
// The lane is shown and switchable, and every row prints which surface it came
// from, because a list that mixed three objects without saying which is which
// would be a worse answer than three lists.
function FindRows({ find, cursorAt, base, onHover, onPick }: {
  find: FindState
  cursorAt: number
  base: number
  onHover: (i: number) => void
  onPick: (h: CrossHit) => void
}) {
  if (find.q.trim().length < CROSS_MIN) return null
  return (
    <div className="wb-cmdk-grp">
      <div className="wb-cmdk-grph wb-find-h">
        <span>Anything you have written, in</span>
        <span className="wb-find-lanes">
          {CONTENT_LANES.map(l => (
            <button
              type="button"
              key={l}
              className={`wb-find-lane${l === find.lane ? ' on' : ''}`}
              onMouseDown={e => { e.preventDefault(); find.setLane(l) }}
            >{laneName(l)}</button>
          ))}
        </span>
      </div>
      {find.busy && find.hits.length === 0 && (
        <div className="wb-cmdk-none">Looking…</div>
      )}
      {!find.busy && find.hits.length === 0 && (
        <div className="wb-cmdk-none">
          Nothing in {laneName(find.lane)} says “{find.q.trim()}”. Try another lane.
        </div>
      )}
      {find.hits.map((h, n) => {
        const i = base + n
        return (
          <button
            type="button"
            key={`${h.surface}:${h.id}`}
            id={`wb-cmdk-${i}`}
            role="option"
            aria-selected={i === cursorAt}
            className={`wb-cmdk-row wb-find-row${i === cursorAt ? ' on' : ''}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(h)}
          >
            <span className="wb-cmdk-t">{h.title}</span>
            <span className="wb-cmdk-h">{h.snippet || h.sub}</span>
            <span className="wb-cmdk-k wb-find-badge">{SURFACE_LABEL[h.surface]}</span>
          </button>
        )
      })}
      {/* The dead end, ended, without putting one lane's rows under another
          lane's name: a number and a way to go and look. */}
      {find.elsewhere.length > 0 && (
        <div className="wb-find-else">
          <span>Also written elsewhere:</span>
          {find.elsewhere.map(c => (
            <button
              type="button"
              key={c.lane}
              className="wb-find-lane"
              onMouseDown={e => { e.preventDefault(); find.setLane(c.lane) }}
            >{laneName(c.lane)} has {c.n}</button>
          ))}
        </div>
      )}
      {find.failed.length > 0 && (
        <div className="wb-cmdk-none">
          Could not reach {find.failed.join(' or ')} just now.
        </div>
      )}
    </div>
  )
}

export type FindState = CrossResults & {
  q: string
  busy: boolean
  /** Other lanes, as a COUNT only. Never a row. See lib/crossSearch.ts. */
  elsewhere: LaneCount[]
  setLane: (l: ContentLane) => void
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
  const field = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => matchWbCommands(q, cmds), [q, cmds])
  // The find rows sit AFTER every command in one cursor space, so ↑↓ and Enter
  // reach a database row exactly the way they reach a command. There is no
  // second keyboard model to learn and no second one to get out of step.
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
          placeholder="Find a command, or anything you have written"
          aria-label="Find a command, or anything you have written"
          role="combobox"
          aria-expanded
          aria-controls="wb-cmdk-list"
          aria-activedescendant={`wb-cmdk-${cursor}`}
          onChange={e => { setQ(e.target.value); onQuery?.(e.target.value) }}
          onKeyDown={onKey}
        />
        <div className="wb-cmdk-list" id="wb-cmdk-list" role="listbox" aria-label="Commands">
          {shown.length === 0 && hits.length === 0 && !find?.busy ? (
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
          {find && (
            <FindRows
              find={{ ...find, q }}
              cursorAt={cursor}
              base={shown.length}
              onHover={setCursor}
              onPick={pick}
            />
          )}
        </div>
        <div className="wb-cmdk-foot">
          <span>↑ ↓ to move</span>
          <span>Opens, never acts</span>
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
