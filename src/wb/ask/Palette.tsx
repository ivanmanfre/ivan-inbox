/* ==========================================================================
   src/wb/ask/Palette.tsx: S15-25 to S15-32, the slash palette, on the design
   system's own `CommandList`.

   The VOCABULARY is not rebuilt here. `COMMANDS` and `matchCommands` are
   imported from `src/exp/v2c/ChatPane.tsx`, where they were written and where
   the long comments explaining their two hard-won rules live:

   - only a `/` at position 0 opens it, so a question carrying a URL path never
     does;
   - the list NEVER shrinks. An unavailable command stays listed, dimmed, and
     says why, because filtering it out closed the palette and let Enter send
     the literal "/retry" to the model, which is the hole the palette exists to
     close.

   What is new is only the drawing: `CommandList` already has the dimmed row
   with its reason and the `Kbd` caps, so this file is a mapping and a cursor.

   THE PALETTE IS DESKTOP-ONLY, on purpose. The ledger records in writing that
   no slash support exists in the phone composer (S30's header), and the phone
   has no arrow keys to move a cursor with. The docked pane passes this in; the
   phone passes nothing, and the composer is the same component either way.
   ========================================================================== */
import { useState } from 'react'
import { CommandList, Icon, Kbd, type CommandItem } from '../../ds'
import { INSERT_CURSOR, matchCommands, type Command } from './commands'
import type { ChatHandle } from '../../exp/v2c/useChat'
import type { ComposerExtras } from './Composer'
import './ask.css'

/** The marker `containerPalette.ts` puts in a template where typing continues.
 * It is DATA, never drawn: it is stripped as the template lands in the field,
 * and the caret is naturally at the end. Written as an escape so a grep for a
 * typed glyph in this folder keeps reading zero. */

/** The three groups the vocabulary already falls into: what this pane can do
 * about the turn, which model answers, and what the container can run. */
function groupOf(c: Command): { id: string; label: string } {
  if (c.insert) return { id: 'container', label: 'What the container can run' }
  if (c.name.startsWith('/model')) return { id: 'model', label: 'Which model answers' }
  return { id: 'turn', label: 'This turn' }
}

export function usePalette(chat: ChatHandle, text: string, setText: (v: string) => void): ComposerExtras {
  const [cursor, setCursor] = useState(0)
  const cmds = matchCommands(text)
  const hasTurns = chat.turns.length > 0
  const open = cmds.length > 0
  const active = cmds[Math.min(cursor, cmds.length - 1)]

  // A command NEVER reaches send(): it runs locally and clears the composer.
  // A container entry COMPOSES instead — its template lands in the field and
  // the operator finishes the thought before Enter.
  const run = (c: Command) => {
    if (c.insert) { setText(c.insert.replace(INSERT_CURSOR, '')); setCursor(0); return }
    c.run(chat)
    setText('')
    setCursor(0)
  }

  const groups = (() => {
    const out: { id: string; label: string; items: CommandItem[] }[] = []
    for (const c of cmds) {
      const g = groupOf(c)
      let band = out.find(b => b.id === g.id)
      if (!band) { band = { ...g, items: [] }; out.push(band) }
      const ready = c.ready(chat.busy, hasTurns)
      band.items.push({
        id: c.name,
        label: c.name,
        ready,
        reason: ready ? undefined : c.hint(chat.busy, hasTurns),
        badge: ready ? c.hint(chat.busy, hasTurns) : undefined,
        // Pointer down, not click: the field keeps focus, so the palette does
        // not close under the pointer before the press lands.
        onRun: () => run(c),
      })
    }
    return out
  })()

  const overlay = open
    ? (
      <div className="a-brain-palette">
        <CommandList
          groups={groups}
          activeId={active?.name}
          foot={
            <span>
              <Kbd><Icon name="up" size={16} /></Kbd>
              <Kbd><Icon name="down" size={16} /></Kbd> to move ·{' '}
              <Kbd><Icon name="enter" size={16} /></Kbd> to run ·{' '}
              <Kbd>esc</Kbd> to cancel
            </span>
          }
        />
      </div>
    )
    // The warning the palette earns by never shrinking: an unknown slash string
    // says what Enter will do with it before Enter does it.
    : text[0] === '/'
      ? (
        <div className="a-brain-palette" data-nomatch>
          <span className="a-brain-note">
            No palette match. <Kbd><Icon name="enter" size={16} /></Kbd> sends this to Claude as written.
          </span>
        </div>
      )
      : undefined

  return {
    overlay,
    onKeyDown: e => {
      if (!open) return false
      if (e.key === 'ArrowDown') { setCursor(c => (c + 1) % cmds.length); return true }
      if (e.key === 'ArrowUp') { setCursor(c => (c - 1 + cmds.length) % cmds.length); return true }
      if (e.key === 'Enter' && !e.shiftKey) { if (active) run(active); return true }
      if (e.key === 'Escape') { setText(''); setCursor(0); return true }
      return false
    },
    // The send BUTTON obeys the palette too. Without this the one path that
    // still sent a literal "/model haiku" to the model would be the button.
    interceptSend: () => { if (open && active) { run(active); return true } return false },
  }
}
