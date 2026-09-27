import { INSERT_CURSOR, matchCommands, type Command } from '../../wb/ask/commands'
import type { ChatHandle } from '../../exp/v2c/useChat'

// Today's slash vocabulary (wb/ask/commands: /model, /retry, /stop, /clear and
// the container's own commands and skills), drawn as a D list above the field.
// A command runs locally and never reaches send(); an insert composes.

export function runCommand(c: Command, chat: ChatHandle, setText: (v: string) => void): void {
  if (c.insert) { setText(c.insert.replace(INSERT_CURSOR, '')); return }
  c.run(chat)
  setText('')
}

export function slashKey(e: React.KeyboardEvent, cmds: Command[], cursor: number, setCursor: (n: number) => void, pick: (c: Command) => void, close: () => void): boolean {
  if (cmds.length === 0) return false
  if (e.key === 'ArrowDown') { setCursor((cursor + 1) % cmds.length); return true }
  if (e.key === 'ArrowUp') { setCursor((cursor - 1 + cmds.length) % cmds.length); return true }
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { pick(cmds[Math.min(cursor, cmds.length - 1)]); return true }
  if (e.key === 'Escape') { close(); return true }
  return false
}

export function Slash({ text, chat, cursor, pick }: { text: string; chat: ChatHandle; cursor: number; pick: (c: Command) => void }) {
  const cmds = matchCommands(text)
  if (text[0] !== '/') return null
  const hasTurns = chat.turns.length > 0
  if (cmds.length === 0) {
    return <div className="dcl-slash"><div className="dcl-dim dcl-pad">No command matches. Enter sends this to Claude as a message.</div></div>
  }
  return (
    <div className="dcl-slash" role="listbox" aria-label="Commands">
      {cmds.slice(0, 40).map((c, i) => {
        const ready = c.ready(chat.busy, hasTurns)
        return (
          <button type="button" key={c.name} role="option" aria-selected={i === cursor}
            className={`dcl-cmd${i === cursor ? ' dcl-on' : ''}${ready ? '' : ' dcl-off'}`}
            onMouseDown={e => { e.preventDefault(); pick(c) }}>
            <b>{c.name}</b><span>{c.hint(chat.busy, hasTurns)}</span>
          </button>
        )
      })}
      <div className="dcl-slash-f">↑ ↓ to move · Enter to run · Esc to close</div>
    </div>
  )
}
