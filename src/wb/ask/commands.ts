/* ==========================================================================
   The slash palette -- the vocabulary, and the matcher.

   Moved here in Phase 3 W6 (inbox-app-revamp-2026-09-05) from
   `src/exp/v2c/ChatPane.tsx`, the pre-revamp Ask pane, which is deleted with
   the stylesheets that drew it. Nothing in this file was a view: it is the
   command list, the reasons each command can be unavailable, and the
   token-wise matcher. `src/wb/ask/Palette.tsx` renders it.
   ========================================================================== */
import { CONTAINER_COMMANDS, CONTAINER_SKILLS } from '../../exp/v2c/chat/containerPalette'
import { CLAUDE_MODELS } from '../../lib/claude'
import type { ChatHandle } from '../../exp/v2c/useChat'

/** Where the caret lands after an insert command drops its template into the
    composer. A SENTINEL, never a drawn mark: `Palette.tsx` strips it before
    the text reaches the field. Written as an escape and exported from one
    place, because the two files that knew about it had spelled it two
    different ways (a literal here, `'\u2336'` there). */
export const INSERT_CURSOR = '\u2336'

// The container's own default is a real, working choice and the FIRST entry, not
// an "auto" fallback tucked at the bottom. Today it is also the only one that
// completes a turn -- the upstream takes no per-request model yet -- so burying
// it would be burying the working option.
const MODEL_OPTIONS: { id: string | null; label: string; note: string }[] = [
  { id: null, label: 'Claude default', note: 'Whatever Claude booted with' },
  ...CLAUDE_MODELS.map(m => ({ id: m.id as string, label: m.label, note: m.note })),
]

// ---------------------------------------------------------------------------
// The slash palette (phase 6 ask 7)
// ---------------------------------------------------------------------------
//
// What happened before this existed: nothing. A `/`-prefixed message was sent
// raw, indistinguishable from any other sentence, all the way to the model —
// traced end to end by the phase-6 scout through ChatPane → useChat.send →
// chat/transport → supabase/functions/inbox-claude, and the broker POSTs the
// whole string as one prompt argument to a FRESH Claude Code CLI invocation.
// Slash commands are an interactive-REPL affordance and there is no REPL on the
// other end, so `/clear` would simply have been read as the first line of a
// question.
//
// So the palette is entirely CLIENT-SIDE and every command short-circuits BEFORE
// send() — nothing here adds a network call, a dependency, or a server contract.
//
// The commands are wrappers around capabilities useChat exposes:
//   /model <id>  → chat.setWanted, the same setter the model menu calls
//   /retry       → chat.retry, already wired to the last turn's retry control
//   /stop        → chat.abort, already wired to the stop button while busy
//   /clear       → chat.reset — useChat gained a clean reset for this run
//                  (empties the transcript, forgets the server session, keeps
//                  the chosen model). Added under the revamp's explicit grant;
//                  the parity pass had omitted it because no reset existed.
// `/about <off-screen id>` stays absent (no path exists to reference a peer
// that is not open).
// Exported so the DOCKED pane (src/wb/ask/AskPane.tsx, S15 on the design
// system) runs the same palette rather than a second copy of the vocabulary.
// The list, the matcher and the reasons stay here, where the comments that
// explain why they are shaped this way live.
export type Command = {
  name: string
  // What it does when it CAN run, and what is true instead when it cannot. The
  // second string is why `hint` is a function: "Abort the turn in flight" on a
  // pane with nothing in flight is a lie about the button.
  hint: (busy: boolean, hasTurns: boolean) => string
  ready: (busy: boolean, hasTurns: boolean) => boolean
  run: (chat: ChatHandle) => void
  // Container entries (skills + slash commands the Railway CLI can expand)
  // INSERT their template into the composer instead of running client-side —
  // the turn is composed and sent by Ivan, never auto-fired by the palette.
  insert?: string
}

export const COMMANDS: Command[] = [
  ...MODEL_OPTIONS.map(m => ({
    name: `/model ${m.id ?? 'default'}`,
    hint: () => m.label,
    ready: () => true,
    run: (chat: ChatHandle) => chat.setWanted(m.id),
  })),
  {
    name: '/retry',
    hint: (_b, hasTurns) => (hasTurns ? 'Re-send the last turn' : 'nothing to retry yet'),
    ready: (busy, hasTurns) => !busy && hasTurns,
    run: chat => chat.retry(),
  },
  {
    name: '/stop',
    hint: busy => (busy ? 'Abort the turn in flight' : 'nothing is running'),
    ready: busy => busy,
    run: chat => chat.abort(),
  },
  {
    name: '/clear',
    hint: (_b, hasTurns) => (hasTurns ? 'Start a fresh thread (keeps your model choice)' : 'nothing to clear yet'),
    ready: (_b, hasTurns) => hasTurns,
    run: chat => chat.reset(),
  },
  // ---- what the CONTAINER can run (feedback item 5: "missing like all the
  // cmds and skills i see from here"). Probed, not copied from the local Mac
  // (containerPalette.ts documents the probe method + date): the deployed
  // container has 9 skills the local repo lacks and vice versa. Picking one
  // INSERTS its template — the `run` is a no-op fallback that never fires
  // because runCommand branches on `insert` first.
  ...CONTAINER_COMMANDS.map((c): Command => ({
    name: c.name,
    hint: () => c.desc || 'container command',
    ready: () => true,
    run: () => {},
    insert: c.insert,
  })),
  ...CONTAINER_SKILLS.map((s): Command => ({
    name: `/skill ${s.name}`,
    hint: () => s.desc || 'container skill',
    ready: () => true,
    run: () => {},
    insert: s.insert,
  })),
]

/**
 * Which commands a given composer string offers.
 *
 * Only a `/` at POSITION 0 opens the palette (`text[0] === '/'`), so a question
 * that happens to contain a URL path never triggers it. Returns [] for anything
 * else, which is what closes the palette — there is no second source of truth
 * about whether it is open.
 *
 * 🔴 The vocabulary NEVER shrinks. The first build filtered unavailable commands
 * out of the list, and the measurement caught what that costs: with no turns on
 * the pane, typing `/retry` matched nothing, the palette closed, and Enter went
 * back to sending the literal string "/retry" to the model — the exact behaviour
 * this ask exists to end. A palette that hides its own vocabulary teaches
 * nothing and silently re-opens the hole. Unavailable commands are listed,
 * dimmed, and say why; running one is a no-op (chat.retry and chat.abort both
 * already guard internally) that clears the composer.
 */
export function matchCommands(text: string): Command[] {
  if (text[0] !== '/') return []
  const q = text.slice(1).toLowerCase().trim()
  if (q === '') return COMMANDS
  // Token-wise, not whole-string: "/model haiku" must find
  // `/model claude-haiku-4-5` even though the contiguous substring
  // "model haiku" appears in no command name. The live-transport probe caught
  // the old whole-string match returning ZERO commands for exactly that input —
  // which closed the palette and let Enter send the literal "/model haiku" to
  // the model, the fall-through this palette exists to end.
  const tokens = q.split(/\s+/)
  return COMMANDS.filter(c => {
    // An insert entry whose template is ALREADY in the composer stops
    // matching: otherwise Enter re-runs the insertion forever and the bare
    // command ("/gsd:help") could never be sent. Once the text covers the
    // template, the palette's job is done and Enter means send.
    if (c.insert) {
      const done = c.insert.replace(INSERT_CURSOR, '').trimEnd().toLowerCase()
      if (text.trim().toLowerCase().startsWith(done)) return false
    }
    const name = c.name.slice(1).toLowerCase()
    return tokens.every(t => name.includes(t))
  })
}
