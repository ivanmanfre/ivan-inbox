# Phase 6 — peer-close reflow verification + slash-command gap map

Follow-up scout on `inbox-visual-rebuild-2026-08-02`, candidate `faithful` (`exp/vis-faithful` @ `22168ef`,
worktree `wt-faithful`, dev server on :5431). Two independent checks: does the work column and its objects
actually reclaim width when the Claude peer closes, and what happens today when a chat message starts with
`/`.

Session note: `.session.json` had expired (`expires_at` ~2h in the past); refreshed via
`node scripts/dev-login.mjs` before any measurement below.

---

## CHECK 1 — peer-close reflow

### Method

Playwright, session-injected via `localStorage['sb-bjbvqvzbzczjbatgmccb-auth-token']`, viewports 1440×900 and
1680×1000, routes `#exp/v2/content` and `#exp/v2/sends`. On a non-mobile canvas the Claude peer is docked by
default (`Shell.tsx:100-102`), so "open" is the fresh-load state and "closed" is after clicking `.wb-pane-x`
(`ChatPane.tsx:159`) with 600ms settle. **Caveat that cost one re-run:** a hash-only `page.goto()` between
routes is a same-document navigation in Chromium — it does not remount the SPA, so a peer closed on one
route leaked into the next route's "open" reading. Fixed by forcing `page.reload()` after each hash change.
Raw numbers: `reflow-measurements.json` in this directory. Screenshots: `reflow-<route>-open.png` /
`-closed.png` (1440×900) and `reflow-<route>-1680x1000-{open,closed}.png`.

### The column itself: reclaims full width on both routes

`layout.ts:119` (`planWorkbench`) has a rule that isn't obvious from the per-job branch above it: **when the
shown-peer list is empty, `work` is forced to `'wide'` regardless of job** — this is the documented A1 fix
("no empty second region"). Confirmed live:

| route | viewport | work column: open → closed | growth |
|---|---|---|---|
| content | 1440×900 | 620px → 1240px | 100% |
| content | 1680×1000 | 740px → 1480px | 100% |
| sends | 1440×900 | 620px → 1240px | 100% |
| sends | 1680×1000 | 740px → 1480px | 100% |

So the premise of Ivan's complaint — "does the column even reclaim the width" — is **not** the defect. It
does, on both routes, every time.

### sends: every major object stretches with it — PASS

`.nav` (title), `.ov-hero` (the 3-tile Accept/Governor/Runway KPI row, `styles.css:345` grid
`repeat(3,1fr)`), and `.ov-duo` (the funnel + per-lane governor column, `styles.css:371` grid `1fr`/`1fr 1fr`)
all grew ~100% in lockstep with the column at both viewports (620→1240 and 740→1480). Visual confirmation in
`reflow-sends-closed.png`: title, KPI cards, funnel bar and volume/pipeline cards all run edge-to-edge with
no dead margin. The one element that does NOT stretch is `.sc-spark` (the per-day connections/DM
sparkline strip inside a KPI tile) — 230px→234px at 1440 (0.6% growth), 290px→294px at 1680. Its
`max-width` computes to `none`; it simply has a fixed number of fixed-width day-bars and no reason to fill
the row. Not a defect — it's a decorative sub-element, not one of the "main objects" the column growth
should redistribute to.

**Sends verdict: no fluid-object failure.** The route's structural blocks are all genuinely responsive.

### content: the column reclaims width, its children do not — FAIL

Every top-level child of `.rows.ct-rows` (`.wb-chartcard`/Pipeline card, `.ct-alert`, `.ct-subtle`,
`.ct-filters`, and by the same rule every `StageSection`) is deliberately capped:

```
/* styles.css:31-36 */
.wb.dt .wb-solo .nav, ... , .wb.dt .wb-solo .rows > *{max-width:860px;margin-left:auto;margin-right:auto}
```

This is a documented, intentional readability fix (comment at `styles.css:26-30`: "a 1,240px-wide message
row is its own defect... the width becomes MARGIN at a real measure") — not an oversight. Measured growth
against the column:

| element | viewport | open → closed | column grew by | element grew by | % of column's growth |
|---|---|---|---|---|---|
| `.wb-chartcard` (Pipeline card) | 1440×900 | 587px → 860px | 620px | 273px | **44%** |
| `.wb-chartcard` | 1680×1000 | 707px → 860px | 740px | 153px | **21%** |

Both are well under the 80% bar. `computed max-width: 860px` on both.

**But the more interesting finding is that the cap is not even applying its own centering.** The base rule
sets `margin-left:auto;margin-right:auto` so a capped block should sit centered, with dead space split
evenly on both sides. Live-measured (`scripts/_verify_margins.mjs`, run against the closed state at
1440×900, column width 1240):

| child | margin-left | margin-right | left gap from column edge | right gap from column edge |
|---|---|---|---|---|
| `.ct-subtle.ct-warn` | 16px | 16px | 16 | **364** |
| (unlabeled — inherits base rule only) | 190px | 190px | 190 | 190 ✓ centered |
| `.ct-alert` | 16px | 16px | 16 | **364** |
| `.wb-chartcard` | 16px | 16px | 16 | **364** |
| `.ct-subtle` | 16px | 16px | 16 | **364** |
| `.ct-filters` | 0px | 0px | 0 | **380** |

The reason: `faithful.css` loads *after* `styles.css` (deliberately, per its own header comment, "so it is
the last word inside `.wb`") and gives several of these classes their own fixed margin —
e.g. `.wb.wb.wb .wb-chartcard{margin:14px var(--gut) 0}` (`faithful.css:1129`, 3-value shorthand =
`margin-left/right: var(--gut)`, a fixed gutter, not `auto`). That fixed margin wins on specificity and
clobbers the base spine's centering. Net effect, visually confirmed in `reflow-content-closed.png`: the
Pipeline card, the red alert bar, the filter chips, and the stage sections all hug the left edge at their
860px cap and dump the *entire* reclaimed 364–380px as one dead strip on the right — not even the "capped
but centered" compromise the base spine intended, but a lopsided one. One element (a plain div with no
candidate-specific class) DOES center correctly, proving the base rule still works when nothing overrides
it — this is an inconsistency introduced by the candidate's own CSS, not a missing feature.

**Content verdict: the column reclaims width; every visible object inside it (chart card, alert strip,
filter bar, stage sections) is capped at 860px and, due to a margin override in `faithful.css`, sits
left-anchored rather than even centered — so above ~892px of column width (860 + 2×16 gutter) growth
becomes a widening dead strip on the right, worst at 1680px (620px of dead space).** This is very likely
what Ivan is seeing when he says "the rest of objects don't accommodate" on Content specifically — it's
subtler than "doesn't reflow" (it does reflow, and the 860px cap itself may be a deliberate keep), but the
asymmetric non-centering reads as broken regardless of whether the cap is kept.

---

## CHECK 2 — the slash-command gap

### What happens today when a message starts with `/`

Nothing, anywhere in the stack, treats a leading `/` as special. Traced the full path:

1. **Composer** — `ChatPane.tsx:266-274`: a plain `<input className="cfield">`. `onChange` sets raw `text`
   state; Enter (no shift) or the send button call `send(text)` (`ChatPane.tsx:91-95`) unconditionally.
   `grep -rn "slash\|startsWith('/')"` across `src/exp/v2c/**/*.{ts,tsx}` (excluding tests) returns nothing.
2. **`useChat.send`** (`useChat.ts:77-165`) trims the string and forwards it verbatim as `prompt` to
   whatever transport `getTransport()` returns — no branching on content.
3. **Transport** (`chat/transport.ts:117-143` → `src/lib/claude.ts:159-176` `sendToClaude`) does a bare
   `fetch` to `POST /functions/v1/inbox-claude` with `{ prompt, context, model }` as JSON. `prompt` is
   passed through unexamined.
4. **The broker itself is in this repo** (`supabase/functions/inbox-claude/index.ts`) — no need to infer
   what's server-side. `index.ts:198` trims the prompt, checks it's non-empty and under
   `MAX_PROMPT_CHARS` (12,000), and at `index.ts:257-262` builds
   `upstreamBody.prompt = context ? \`${context}\n\n---\n\n${prompt}\` : prompt`, POSTed to the Railway
   container's `/chat/stream`. No slash parsing, no command table, nothing keyed on the first character —
   the whole string (context + the user's line, `/` included) becomes one prompt argument to a **fresh
   Claude Code CLI invocation** (`index.ts:39-41`: the upstream "never reads session_id... every streamed
   turn is a fresh CLI session"). Slash-commands are a Claude Code *interactive REPL* affordance; this path
   drives the CLI via a scripted prompt argument, not a REPL reading stdin, so even if the literal string
   `/clear` reached the container, there is no REPL loop on the other end to intercept it — it would just be
   read as the first line of the user's prompt text, same as any other sentence starting with a slash
   (e.g. a Ivan asking about a URL path).

**Conclusion: a `/`-prefixed message today is sent raw, indistinguishable from any other sentence, all the
way to the model.** Nothing fails, nothing errors, nothing recognizes it — it just gets answered (or
misread) as literal text.

### Existing command/palette/autocomplete affordances

None, for typed `/` input. The pane does have one non-slash affordance that looks similar in shape: the
model picker is a persistent button (`wb-modelbtn`, `ChatPane.tsx:149-153`) that opens a dropdown menu
(`.wb-modelmenu`, `ChatPane.tsx:162-182`) listing `MODEL_OPTIONS` with a checkmark on the active one. That
dropdown's rendering pattern (an absolutely-positioned list above/near the composer, closed on selection) is
the one existing precedent a `/`-palette could reuse — but it's triggered by a button click, never by typing
`/` into the input.

### What a minimal client-side `/` palette would need

- **A static command registry** — e.g. a new `chat/commands.ts` exporting
  `{ name: string; describe: string; run: (chat: ChatHandle) => void }[]`, parallel to how `MODEL_OPTIONS`
  is already a static array driving a menu (`ChatPane.tsx:15-18`).
- **A filtered dropdown above the composer** — intercept in the `<input>`'s existing `onChange`
  (`ChatPane.tsx:270`): when `text.startsWith('/')`, filter the registry by the substring after `/` and
  render a list using the same overlay pattern `.wb-modelmenu` already establishes.
- **Insertion/dispatch semantics** — two different things depending on the command:
  - *Local commands* (model switch, clear, retry, stop) never reach `chat.send` at all — the palette's
    `onSelect` calls the registry entry's `run(chat)` directly and clears the input, short-circuiting
    before `send()` (`ChatPane.tsx:91`) is ever invoked.
  - *Prompt-templating commands* (none identified below need this) would instead replace `text` with an
    expanded string and let the normal send path carry it.
- **Escape/close handling** — same as the model menu already does on selection (`setModels(false)`,
  `ChatPane.tsx:168`); a palette needs the analogous `setPaletteOpen(false)` plus probably Escape-to-close
  and arrow-key navigation, neither of which the model menu currently has either (it's click-only) — so
  this part has no existing precedent to lean on.

### Commands that make sense from what the pane can already do locally

| command | backed by existing capability? | evidence |
|---|---|---|
| `/model <name>` | **Yes, fully.** | `chat.setWanted(m.id)` already exists and is wired to the model menu (`useChat.ts:65` `setWanted`; `ChatPane.tsx:168` `onClick={() => { chat.setWanted(m.id); setModels(false) }}`). A slash command would just call the same setter. |
| `/retry` | **Yes, fully.** | `chat.retry` already exists (`useChat.ts:173-185`) and is already wired to a UI affordance (`ChatPane.tsx:229` `onRetry={i === chat.turns.length - 1 ? chat.retry : undefined}` on the last turn). A command is a keyboard alias for a click that already works. |
| `/stop` | **Yes, fully.** | `chat.abort` exists (`useChat.ts:169-171`) and is wired to the stop button (`ChatPane.tsx:276` `<div className="csend wb-stop" onClick={chat.abort}>`), live only while `chat.busy`. |
| `/clear` or `/new` | **No — needs a small new capability.** | `useChat.ts` has no reset path today: `turns` only grows (`useChat.ts:87,150`, both `setTurns(t => [...t, ...])`) or has its tail popped by `retry` (`useChat.ts:178-183`, which only drops the last failed exchange, not the whole transcript). A working `/clear` needs a new `reset()` in `useChat` that does `setTurns([]); setSessionId(null); setModel(null)` — trivial to add, but it doesn't exist yet, so this command can't be "just UI wiring" the way the three above are. |
| `/about <id>` (reference a draft/thread NOT currently open as a peer) | **No — partially covered, real gap for the off-screen case.** | The `about`/`aboutContext` pipeline (`ChatPane.tsx:67-83` props, `useChat.ts:36-46` `buildContext`) already auto-attaches "The operator is looking at: X" on every turn *while that peer is open* (`ChatPane.tsx:94`: `chat.send(prompt, aboutContext ?? about ?? undefined)`) — so no command is needed for the common case. It's only a gap if Ivan wants to ask about something that isn't the currently-open peer, which today has no path at all (typed or otherwise). |

Net: 3 of the 5 plausible commands (`/model`, `/retry`, `/stop`) are pure keyboard-shortcut wrappers around
capability `useChat`/`ChatPane` already has; 2 (`/clear`, `/about <off-screen id>`) would need new state
logic, not just a palette UI.

---

## Files touched by this scout (read-only — nothing in the worktree or repo was changed)

- Reflow: `src/exp/v2c/layout.ts`, `Shell.tsx`, `ChatPane.tsx`, `styles.css`, `faithful.css`
  (`wt-faithful/src/exp/v2c/*`)
- Slash: `src/exp/v2c/ChatPane.tsx`, `useChat.ts`, `chat/transport.ts`, `src/lib/claude.ts`,
  `supabase/functions/inbox-claude/index.ts` (`wt-faithful/src/exp/v2c/*`, `wt-faithful/src/lib/claude.ts`,
  `wt-faithful/supabase/functions/inbox-claude/index.ts`)
- Evidence: `reflow-measurements.json`, `reflow-content-open.png`, `reflow-content-closed.png`,
  `reflow-sends-open.png`, `reflow-sends-closed.png`, `reflow-content-1680x1000-{open,closed}.png`,
  `reflow-sends-1680x1000-{open,closed}.png` (all in this directory)
