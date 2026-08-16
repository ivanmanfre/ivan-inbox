# Phase 1 — IA audit + chat-port build contract

Run: `inbox-v2-revamp-2026-08-01` · auditor role: information-architecture + chat-port spec
Builds on `phase0-scope.md` — surface inventory and broker architecture there are load-bearing and are not re-derived here.

---

## PART 1 — IA AUDIT

### 1.0 What exists today

`src/App.tsx` Shell() owns one `Tab` union (`inbox|drafts|sends|ops|settings|today`), one `useState<Tab>`, a hash mini-router (`src/lib/route.ts`) that only recognizes those six names plus `#thread/<id>`, and a hand-forked desktop/mobile branch at `App.tsx:148-192`. `TabBar.tsx` renders exactly those six as fixed slots — no overflow, no "more" affordance, no scroll. Three tournament candidates (goal-run `agentops-inbox-content-hub-2026-07-31`) already answered "where does Content go" by forking this file wholesale:

| Candidate | Move | Tab count | Settings |
|---|---|---|---|
| **cand-a** | New `content` tab replaces `settings` slot | 6 (unchanged count) | Demoted to a gear button inside `ContentScreen`'s header (`SettingsPush.tsx`), reachable only from there or a salvaged `#settings` deep link |
| **cand-b** | `settings` slot becomes `studio`, a single scrolling hub (Agent + Content + Styles + Resources, Settings folded in as its last row) | 6 (unchanged count) | Folded into Studio, not removed |
| **cand-c** | No new tab. `drafts` → `WorkScreen` with a `[DMs \| Content \| Styles]` segmented control; `ops` → `[Cards \| Agent]` | 6 (unchanged count) | Untouched, stays its own tab |

All three keep 6 physical tab slots — none of them actually added a 7th. That is the tell: at 6/6 already full, every candidate's answer to "one more surface" was to **spend an existing slot**, not to grow the bar. Chat is a second surface with the same shape of demand (frequent, wants to be reachable in one tap, not nestable under something else without cost) arriving after the fact.

### 1.1 Judging the three candidates against a 7th surface (chat)

**cand-a — Content as a tab, Settings demoted.**
- *Cost paid*: Settings loses its dedicated slot and its own screen identity; it becomes a drill-in with a bespoke deep-link salvage hack (`Shell.tsx:56-65`, two special-cased hashes `#content`/`#settings` handled outside `parseHash` because `route.ts`'s `TABS` enum is out of this candidate's scope to touch). That hack is a tell: shared infra (`route.ts`) doesn't know about candidate-local tabs, so every candidate re-invents hash handling for its own addition, and none of them extend the shared parser.
- *Where it breaks at 7*: there is no more slot to spend. Chat would have to demote a *second* daily-use tab (Ops or Sends), or Content itself gets demoted the way Settings just was — but Content is a daily job, not an occasional settings visit, so demoting it repeats the exact mistake Settings just took. This model has a demote-something-each-time growth cost: linear tab pressure, one casualty per new surface, and no signal for which surface should be the next casualty.

**cand-b — Studio absorbs everything into one hub tab.**
- *Cost paid*: Studio's internal state (`studioPushed`) has to be lifted to Shell just so the mobile tab bar can hide during an internal push (`Shell.tsx:163-167`) — the hub's own sub-navigation needs to borrow the outer shell's full-takeover convention, which means the hub is not really "one screen," it's a second router nested inside a tab, invisible to the outer one (no hash awareness of what's open inside Studio, per its own comment at `:44-51`).
- *Where it breaks at 7*: this model scales the best of the three, structurally — Chat is just one more row in Studio's scroll, or another internal push state, at zero tab-bar cost. The failure mode is different: **Studio becomes a junk drawer**. Once Agent, Content, Styles, Resources, Settings, and now Chat all share one tab, the operator has no way to tell "what's actually happening today" (Content needing review, Ops needing action) from "reference / rarely-touched" (Settings, Styles) without opening the hub and scanning. It optimizes tab-bar pressure by sacrificing at-a-glance surface — the exact problem `bucketDrafts`' triage lane exists to avoid on the content side (§1.3 below).

**cand-c — zero new tabs, existing tabs absorb via segments.**
- *Cost paid*: the segmented control pattern (`WorkScreen`'s `[DMs | Content | Styles]`) means two clicks to reach a segment that isn't the tab's default (`workSeg` state resets to `'dms'` on every entry via `onOpenDrafts`), and the desktop full-width/list-detail fork now depends on *which segment* is active (`isDtFull` computed from `tab === 'drafts' && workSeg !== 'dms'`, `Shell.tsx:139-140`) — a second axis of layout branching layered on top of the existing desktop/mobile one.
- *Where it breaks at 7*: this is the model most resistant to a 7th surface structurally (zero tabs spent, so nothing to run out of) but worst-fit *semantically* for Chat specifically. A segmented control says "these are alternate views of the same job" (DMs vs Content vs Styles are all "things I work on to fill the queue"). Chat is not an alternate view of Drafts or Ops — it's a different mode of interaction (conversational, session-based, wants scroll history and an input bar, not a list+detail split). Bolting Chat on as a fourth segment of `WorkScreen` would be the segmented-control equivalent of cand-b's junk drawer: technically zero-cost, semantically dishonest about what the surface is.

**Verdict on the three as pre-built answers**: none of them was designed with a second new surface in mind — each spent its full "one new thing" budget on Content alone. Extending any of them to also carry Chat either repeats their existing cost (cand-a: demote something else), inherits their existing scaling failure (cand-b: junk drawer, now worse), or forces a semantic mismatch onto their existing device (cand-c: segmented control pretending chat is a queue view).

### 1.2 Three IA models for 6 jobs + Content + Chat

These are structurally different dispatch mechanisms, not tab reorderings.

**Model 1 — "Two-tier bar": 5 fixed tabs + a persistent chat affordance outside the tab row.**
- *Skeleton*: Tab bar shrinks to the 5 highest-frequency jobs (`today, inbox, drafts, sends, ops`) by merging Content into Drafts as the pipeline view (see §1.3 — this is possible without a segmented control, see below) or by cand-a's move (Content replaces Settings). Chat is not a 6th tab at all: it is a floating action button (FAB) or a persistent header icon present on every screen, opening Chat as an overlay/sheet that pushes over the current tab (same "full takeover" convention `ThreadScreen` already uses on mobile, `App.tsx:179-185`). Settings drops to a gear in the nav header, reachable from anywhere, same on every tab.
- *Primary vs drilled-into*: the 5 tabs are primary. Chat and Settings are both "always-reachable, never-primary" — one gesture away but never occupying tab-bar real estate.
- *390px*: FAB bottom-right, thumb-reachable, does not compete with the tab bar underneath it; opening Chat is the same full-screen takeover pattern as an open thread, so it inherits an already-proven mobile affordance and needs no new CSS fork.
- *1440px*: Chat becomes a persistent right-hand rail (like `dt-detail` but for Chat instead of a thread) OR a summonable overlay — either way it does not need `dt-full` vs `dt-list/dt-detail` branching because it is not one of the tab bodies; it composes *on top of* whichever tab is showing.
- *Failure mode*: a FAB is a well-known mobile anti-pattern for anything used often — if Chat turns out to be a daily, high-frequency job (which "port the Claude Code connection into the inbox" strongly implies), burying it behind a floating icon under-serves it relative to Drafts or Ops, and Ivan will reach for a keyboard shortcut or a bookmark instead of the UI, defeating the point of building it in. This model is a good fit only if Chat proves to be *occasional* (a few turns a day), not a primary workspace.

**Model 2 — "Context switcher": tab bar becomes a 2-row or scrollable strip, all 8 jobs are peers.**
- *Skeleton*: Stop treating 6 as a hard ceiling. `TabBar.tsx` becomes horizontally scrollable (mobile) with `today/inbox/drafts/sends/ops/content/chat` as peers and `settings` moved to a header gear (the one demotion every model needs, since Settings is unambiguously the lowest-frequency job of the eight — Ivan visits it to flip push/chime/theme, not daily). Desktop gets a full vertical rail (more room than a bottom bar) so all 7 remaining tabs show without scrolling.
- *Primary vs drilled-into*: all 7 are primary and structurally equal — no hierarchy, no hub. Content and Chat are exactly as reachable as Inbox.
- *390px*: horizontal scroll-snap tab strip, active tab kept in view, small chevron affordance hints more tabs exist off-screen — a real cost (discoverability: a first-time or infrequent user may not know Chat/Content exist off the visible 5). Requires new CSS (`TabBar.tsx` currently has zero scroll handling) and a new interaction the app has never had.
- *1440px*: trivial — desktop already has room; a vertical rail with 7 icons is not crowded (`App.tsx:150` already special-cases 3 of 6 tabs as `dt-full`; a rail scales linearly with tab count, no branch explosion).
- *Failure mode*: mobile discoverability of anything past tab 5, and this is the model that scales worst to a *9th* surface later — an 8-item scroll-snap strip is already pushing it; nothing in this model says which future surface gets demoted next, so the same problem cand-a already hit (Settings demoted) recurs identically at 9, then 10.

**Model 3 — "Chat as the shell, not a tab": conversational surface wraps the app instead of living inside it.**
- *Skeleton*: Chat is not a peer of Inbox/Drafts/Sends — it's promoted to co-equal with the *whole tabbed app*. The top-level route becomes a 2-way switch (`app` vs `chat`), toggled from one persistent control (e.g. a segmented pill at the very top of the screen, above the tab bar, "Inbox ⇄ Chat"), and everything audited in phase0 (today/inbox/drafts/sends/ops/settings + content) stays exactly as-is *inside* the `app` side, untouched, while `chat` is a completely separate full-screen mode with its own layout (message list + composer, no tab bar underneath it at all).
- *Primary vs drilled-into*: neither is drilled into the other — they are siblings at the top of the tree, structurally like `App.tsx`'s existing `session ? <Shell/> : <LoginScreen/>` gate, just one level lower (`exp ? <ExpGate/> : <Shell/>` is already this exact pattern for tournament variants — Model 3 reuses that shape for Chat instead of inventing a new one).
- *390px*: full-screen either mode, one tap to flip — cheapest possible mobile cost, and it never touches the existing 6-tab bar's markup at all.
- *1440px*: could show side-by-side (chat rail + app pane) since desktop has the width, but does not have to — even a hard either/or toggle is defensible at this viewport given Chat's likely use (a focused conversational task, not a glanceable ambient panel).
- *Failure mode*: **an in-flight chat turn and the rest of the app cannot be visible simultaneously on mobile** (by design) — if Ivan is mid-conversation with Claude about a draft and wants to glance at the actual draft in Drafts, he must leave Chat to look, at which point continuity (state, not just the turn) has to survive the switch (see PART 2 "where does chat state live"). This model also makes Content's placement moot for this audit specifically — Content still needs a decision *inside* the `app` half, independent of where Chat goes.

**Recommendation**: **Model 3**, with Content folded into Drafts as the pipeline view (§1.3) rather than spent as its own tab — this keeps the existing 6-tab bar completely untouched (lowest risk to the audited, working screens), gives Chat a first-class, unshared surface sized for what a coding-agent conversation actually needs (scrollback, streaming text, tool cards — none of which fit gracefully in a tab body sized for list+detail), and requires zero change to `TabBar.tsx`. Model 1 is the fallback if Phase 2/3 usage data shows Chat is genuinely occasional rather than a daily workspace. Model 2 is not recommended — it inherits the open-ended "what gets demoted next" problem the existing three candidates already have, and adds real mobile-discoverability risk with no offsetting benefit over Model 3.

### 1.3 The duplicated desktop/mobile fork (phase0 finding, 4 files)

The fork is byte-near-identical across `App.tsx:148-192` and the three `cand-*/Shell.tsx` files (phase0-scope.md:64-77). None of the three candidates extracted it — each is a full copy-paste of `App.tsx`'s `Shell()` with its own tab union spliced in. That is a build-order finding, not a candidate defect: nothing in the tournament brief asked them to de-duplicate shared infra, and doing so mid-candidate would have made an apples-to-oranges comparison.

How each of the 3 proposed IA models handles it:
- **Model 1**: does not touch the fork at all — Chat is an overlay composed independently of `desktop ? … : …`, so it can be a single new component (`ChatOverlay.tsx`) mounted once outside the branch, in both the desktop and mobile returns, with its own internal responsive CSS. Zero risk to the existing fork; the fork itself stays exactly as duplicated as it is today (out of scope to fix under this model).
- **Model 2**: makes the fork *worse* — 7 tabs each need a `dt-full` vs `dt-list/dt-detail` decision, and a scroll-snap strip needs its own desktop-vs-mobile treatment (rail vs strip), so this model adds a second, tab-count-scaling fork on top of the existing viewport fork.
- **Model 3**: is the only one of the three that *forces* the fork question to be resolved, because Chat's own layout needs its own desktop/mobile decision (rail+overlay on desktop, full-screen toggle on mobile) that is structurally identical in shape to `useDesktop()`'s existing branch — this is the natural moment to extract a shared `<DesktopFrame>`/`<MobileFrame>` (or a single `layoutFor(tab, desktop)` function) that both the existing `app` half and the new `chat` half consume, collapsing 4 duplicated forks into 1. This is a build-order recommendation for Phase 3, not something Phase 1 executes.

**Recommendation stands**: whichever model wins the tournament, Phase 3 should extract the fork *before* wiring Chat's own responsive layout, not after — bolting Chat onto 4 already-duplicated copies guarantees a 5th.

### 1.4 The two content groupings — which is primary

`bucketDrafts` (`content.ts:100-128`) groups by **triage** — what needs Ivan right now, urgency order (`review`, `error`, `stuckScheduled`, `approvedUnscheduled`, `generating`, `scheduled`, `published`, `archived`, `unknown`). `groupByStage` (`content.ts:339-343`) groups by **lifecycle** — where a post sits in its pipeline top to bottom (`ideas → generating → review → approved → scheduled → published`, with `error`/`stuck` lifted out as an alert strip, documented at `:264-277`).

**Primary: `groupByStage` (lifecycle).** Reasoning:
1. It is the one Ivan explicitly asked for after using the triage-only board for a round: *"pretty shitty the way stages are… separate on our end on ideas, review, approved"* (quoted verbatim in the comment at `content.ts:270`). That is a direct, dated operator preference, not an inference.
2. Lifecycle is the natural read order for a **Content tab/section** specifically, because Content's job (distinct from Drafts' job) is "show me the whole pipeline," not "show me only what's on fire." Triage is what `bucketDrafts` already serves *elsewhere* — DraftsScreen's queue-card affordances (per D6/D7 in `content.ts:254-262`) are triage-shaped (only a `review`-status, Ivan-lane row gets a mutating button), and that logic should keep using `bucketDrafts` where it already lives.
3. `groupByStage` deliberately does **not** re-fork `approved` on `scheduled_at` the way `bucketDrafts` does (`content.ts:309-312`) — an approved-without-a-date row stays visibly inside the `approved` stage instead of disappearing into a separate `approvedUnscheduled` bucket, with `countUndated()` (`:348-350`) surfacing the same black-hole risk as a sub-line count instead of a whole section. That is exactly the "read top to bottom, no post falls out of the flow" property a lifecycle view for a Content surface needs.

**Can both coexist without confusing the operator?** Yes, but only if they are never both rendered as the *default* view of the *same* screen. The safe split, matching what already lives in the codebase: `bucketDrafts` stays the internal engine behind Drafts' triage-shaped queue-card actions (D6/D7 rule) and behind any alert-strip/badge count (draft counts on the tab bar, `App.tsx:72` and all three candidates' equivalents already sum off derived counts, not off a rendered board). `groupByStage` becomes the one thing a Content tab/section actually *renders* as its primary top-to-bottom board, with `error`/`stuck` pulled into a strip above it exactly as `ALERT_STAGES` already specifies (`content.ts:290`). If a future screen needs to show both at once (e.g. a "what's stuck" strip *inside* a lifecycle-ordered board — which is precisely what `content.ts` already recommends), that is additive layering of the alert strip on top of the lifecycle read, not two competing full-board renders fighting for the same screen real estate. The confusing failure mode to avoid is literally what cand-a's `ContentScreen` and cand-c's `WorkScreen` need to be checked against in Phase 4: if either renders a `bucketDrafts`-shaped board as Content's *primary* view, that contradicts Ivan's own stated preference and should be corrected in the winning direction's build, not carried forward as-is.

---

## PART 2 — CHAT PORT SPEC (build contract)

Reference read: `claude-code-railway/web-ui/src/{App.tsx,components/ChatArea.tsx,ToolCallCard.tsx,ToolGroup.tsx,hooks/useWebSocket.ts,lib/{types.ts,streamRenderer.ts,markdown.ts,tool-summaries.ts}}`, `web-ui/server.js`, `main.py`.

### 2.0 A load-bearing correction to the phase0 premise

Phase0 states: *"Railway auto-resumes via an in-memory `CLIENT_SESSIONS` dict."* **That is true only of `POST /chat` (`main.py:617-770`).** I read `POST /chat/stream` (`main.py:773-866`) line by line, including the SSE generator: it never reads `request.session_id`, never touches `CLIENT_SESSIONS`, and never adds `--resume` to the CLI invocation, regardless of what the caller sends. Confirmed by grep across the full function body — the only `session` token in it is `start_new_session=True` (a Python subprocess flag, unrelated to Claude Code sessions). **Every call to `/chat/stream` starts a brand-new Claude Code CLI session.** The mission's locked instruction is still correct as an endpoint choice (`/chat/stream` primary, `/chat` fallback for the reasons phase0 gives — SSE UX, non-streaming as a degrade path) but the continuity story it implies does not hold on the primary path as the Railway server is written today. This is named here as a residual gap, matching phase0's own pattern of naming (not silently working around) discovered risk. §2.4 below specifies the client-visible behavior given this constraint; fixing Railway's `/chat/stream` to add `--resume` the way `/chat` already does is a one-line, low-risk change but touches a neighboring repo and is out of this run's scope per the same fence phase0 draws around the `.env.example` key leak.

The CLI's own `stream-json` line shapes are confirmed from `server.js`'s SDK consumption of the identical `--output-format stream-json` flag (`server.js:949-986`, same flag main.py's `chat_stream` passes at `main.py:808`): `{"type":"system","subtype":"init","session_id":…,"model":…}` once at the start; `{"type":"assistant","message":{"content":[{"type":"text","text":…} | {"type":"tool_use","name":…,"input":…}]}}` per turn chunk; `{"type":"result","cost_usd":…,"duration_ms":…}` at the end. FastAPI's generator (`main.py:839-843`) pipes these lines through verbatim as SSE `data:` frames, plus its own synthetic `{"type":"done","returncode":…}` after the process exits, and `{"type":"error","message":…}` on an exception.

### 2.1 SSE frame protocol — Railway → edge function → browser

The edge function does not need to invent a new wire format from scratch; it re-emits Railway's stream-json lines as SSE, normalized into a small named set so the client never has to branch on CLI internals (`sdkMsg.message.content[n].type`) directly:

| SSE `event:` | Payload | Source |
|---|---|---|
| `session` | `{ sessionId, model }` | Railway's `type:"system", subtype:"init"` line |
| `text` | `{ delta }` | one per `type:"assistant"` block where `block.type==="text"` |
| `tool_use` | `{ id, tool, input }` | one per `type:"assistant"` block where `block.type==="tool_use"`; `id` synthesized client-side as `${turnIndex}:${blockIndex}` since the CLI stream doesn't guarantee a stable tool-call id in this shape |
| `done` | `{ costUsd, durationMs }` | Railway's `type:"result"` line |
| `error` | `{ message }` | Railway's synthetic `type:"error"` line, OR the edge function's own catch (upstream 5xx/timeout — see §2.6) |
| `aborted` | `{}` | edge function only, emitted when it detects the client disconnected (§2.3) — Railway itself has no `aborted` frame on this path, unlike the WS reference (`server.js` sends a real `aborted` because the WS abort message reaches a live SDK query object; the HTTP/SSE path has no equivalent signal channel back into the subprocess once the request is accepted, so the edge function synthesizes it purely for client-side state cleanliness) |

Plain SSE (`text/event-stream`, `data: <json>\n\n` per Railway's own framing) — no WebSocket, because the locked constraint (bare `fetch()`, no `functions.invoke()`) already rules out anything that isn't a normal HTTP request/response, and Deno edge functions support a streamed `Response` body natively without needing a socket upgrade.

### 2.2 Client → edge function request

```
POST /functions/v1/inbox-claude
Authorization: Bearer <supabase access_token>
apikey: <VITE_SUPABASE_ANON_KEY>
Content-Type: application/json

{ "prompt": string, "sessionId": string | null }
```

That is the entire request body. No `workspace`, no `client_id`, no `working_directory`, no `permission_mode`, no `allowed_tools` — all of those are fixed server-side inside the edge function per the phase0 fence (§ "Instance scoping is a refusal, not a default"). `sessionId` is accepted from the client purely so a future Railway fix (§2.0) can be adopted without a client-side contract change; today the edge function may pass it through to `/chat/stream`'s request body knowing it is ignored, or omit it — either is correct, since the field does nothing on the current server.

### 2.3 Client state machine for a turn

`idle → sending → streaming → (tool-use is a sub-state of streaming, not a separate top-level state) → done | error | aborted → idle`

- **idle**: composer enabled, no in-flight request.
- **sending**: composer disabled/shows a stop affordance, `fetch()` issued with an `AbortController`, waiting on the first SSE byte. A client-side timer (not the server's) flips a "taking a while" indicator after ~4s — matches the reference's cold-start-latency awareness (`server.js` logs `first_token_latency_warm`) without needing that telemetry client-side.
- **streaming**: first `text` or `tool_use` event received. Message bubble renders incrementally; `tool_use` events append inline tool cards into the same turn without ending the streaming state (Railway can emit text, then a tool call, then more text, in one turn — the reference's `assistantTextAccum` pattern confirms multiple text blocks accumulate before `result`).
- **done**: `done` event received → append final message to history, re-enable composer, state → idle.
- **error**: `error` event, or the `fetch()` itself rejects/returns non-2xx before any SSE frame arrives → render an inline error bubble with a retry affordance, state → idle. Do not clear the composer's draft text on error (mirrors the reference's "Send now: flush keeps what was said" comment, `ChatArea.tsx:1457`).
- **aborted**: user taps stop → `abortController.abort()`. Fetch's abort is what actually cancels the in-flight HTTP request to the edge function; whether it cancels Railway's subprocess depends on the edge function propagating the disconnect (below). State → idle immediately client-side; do not wait for a server acknowledgment, since one may never arrive.

**How abort actually works through a Deno function**: browser `AbortController.abort()` closes the underlying fetch, which closes the TCP connection to the edge function. Inside the Deno function, the request's `req.signal` fires an `abort` event when that happens — the function must listen for it explicitly and, on fire, cancel its own outbound `fetch()` to Railway (pass the *same* `AbortSignal`, or a linked one, as that fetch's `signal` option) so the upstream connection to `/chat/stream` also drops. Whether that reaches all the way down to `os.killpg()` on Railway's subprocess (`main.py:847-860`) depends on FastAPI/uvicorn detecting the dropped client connection on *its* side of the SSE response and cancelling the `generate()` async generator — that is existing Railway behavior (a dropped SSE client already triggers the `finally` block's process-group kill per the comment at `main.py:848-849`), not something this run's edge function needs to implement, only chain correctly (don't swallow the abort into a fire-and-forget upstream call).

### 2.4 Session continuity, given §2.0

Because `/chat/stream` cannot resume, "session continuity" for v1 means: **within one open chat surface (one mount of the chat UI, one browser tab), the client keeps its own transcript in memory and replays it is not required or attempted — each turn is a fresh Railway CLI session, and the client-held `sessionId` from the `session` SSE event is display-only** (shown small, e.g. "session `a1b2…`" for debugging/support, not used to request continuation). This is an honest v1, not a workaround: pretending to resume when the server silently doesn't would be worse (a user references "what we discussed two messages ago" and gets a response with no memory of it). The chat UI's own transcript (rendered message history) is the *only* continuity Ivan experiences turn-to-turn within a session — which is sufficient for reading back what was said, just not for Claude's own tool-use context (each turn's Claude process starts cold, in the fixed workspace, with no memory of prior turns' file reads/edits).

**Cold start**: `CLIENT_SESSIONS` is in-memory on Railway (`main.py:56`) and is explicitly cleared on `/admin/restart`-style paths (`main.py:553`) and implicitly lost on any redeploy or crash-restart. Since `/chat/stream` never reads it anyway, cold start has zero additional effect on the streaming path beyond the already-fresh-every-turn behavior above. If a future Railway fix adds resume to `/chat/stream`, cold start becomes relevant again exactly as it is for `/chat` today: a `session_id` the client held from before the restart will fail to resume, and the existing `/chat` retry logic already degrades gracefully (`main.py:734-751`, "No conversation found" → drop and start fresh) — the client should treat a resume failure the same way regardless: silently start a new session, never surface it as an error.

### 2.5 Tool-use rendering — minimal honest version

The reference's `ToolCallCard.tsx` + `ToolGroup.tsx` + `tool-summaries.ts` (per-tool icon/label/preview map for `Read/Edit/Write/MultiEdit/Bash/Glob/Grep/WebFetch/WebSearch/Task/TodoWrite`) is the right shape to port, not the right weight — `ToolGroup.tsx` (80 lines) exists to visually collapse *consecutive* tool calls into one expandable strip, which matters in a coding-agent transcript with dozens of file reads in a row; that's plausible here too (Ivan asking Claude to look at inbox code will trigger the same kind of multi-Read burst) so the group-collapse behavior is worth keeping. What's cut: no output panel inside the card (the reference shows tool *output* too, `ToolCallCard.tsx:48-53` — Railway's stream-json `assistant` blocks only carry `tool_use`, not `tool_result`, in what `/chat/stream` forwards, so there is nothing to show there without a second round-trip the mission doesn't call for); no syntax-aware input formatting beyond a `JSON.stringify(parsed, null, 2)` pretty-print (already how the reference does it, `ToolCallCard.tsx:10-18` — that's plain JS, zero dependency cost, keep as-is).

Minimal version: one collapsed-by-default row per tool call — icon (reuse the reference's emoji-per-tool map verbatim, it's data not a dependency) + tool name + one-line truncated preview (file path / command / query, same `summarizeTool()` logic, ported as a plain function) — tap to expand only the formatted input JSON. No output, no live "running" spinner distinct from the turn's overall streaming state (the tool call already visually exists inside a `streaming` bubble).

### 2.6 Streaming render without a markdown stack

**Decision: no `marked`, `dompurify`, `highlight.js`, `katex`, or `mermaid`.** The reference ships all five (`web-ui/package.json`) for a general-purpose coding-agent UI that has to handle arbitrary rendered documents, math, and diagrams across every possible client project. This inbox's chat is scoped narrowly (per phase0's fixed workspace, no cross-tenant reach) to Ivan talking to Claude about *this one app* — Claude's replies will be prose + occasional code snippets + occasional lists, essentially never LaTeX or Mermaid. Justifying the cut:
- `katex`/`mermaid` are the heaviest (mermaid alone is a large, DOM-heavy rendering engine) for a use case (math notation, flowcharts) that doesn't come up talking about an inbox app's TypeScript/SQL. Cut outright, not deferred — if it's ever needed, add it then, don't carry the weight speculatively (this matches the project's own `surgical-edits` "no speculative code" discipline).
- `marked` + `dompurify` together exist to turn arbitrary markdown into sanitized HTML. Full CommonMark support (tables, footnotes, nested lists, HTML passthrough) is more than a chat transcript needs; the actual reason `dompurify` is there is that `marked`'s output is raw HTML injected via `dangerouslySetInnerHTML` — a self-inflicted risk this port doesn't have to take on. A **hand-rolled, allowlist renderer working directly against React elements** (no HTML string, no `dangerouslySetInnerHTML`, no sanitizer needed because nothing is ever parsed as HTML) covers what actually appears in practice: paragraphs (blank-line-separated), fenced code blocks (```lang…```→`<pre><code>`), inline code (`` `x` ``→`<code>`), bold/italic (`**`/`*`), and bare-URL autolinking. That's a ~100-150 line pure function, testable exactly like the existing `content.ts` pure-function suite (`vitest.config.ts` — node env, no rendering tests needed since it emits data structures, not DOM).
- `highlight.js` (syntax coloring) is cut for the same reason mermaid is: it's real weight (language grammars) for a benefit (colored code) that a monospace block with the app's existing severity/accent palette already delivers legibly without it. Code blocks render as `<pre>` in a fixed-width font — **the one deliberate, scoped exception to the app's "no monospace anywhere" house rule** (`styles.css:471`), justified exactly the way a terminal emulator's own text is exempt from a UI font system: code needs alignment-preserving width, prose doesn't, and this exception applies to literally nothing else in the app.
- The streaming *pacing* trick from `streamRenderer.ts` (rAF-batched adaptive char-flush so long replies don't visibly dribble for 10s after the server already finished) is worth porting as-is — it's ~50 lines, zero dependencies, framework-agnostic, and solves a real perceived-latency problem the SSE `text` events will have regardless of markdown approach.

**Net new dependency count: zero.** Only `react` + `@supabase/supabase-js`, per the mission's own target.

### 2.7 Where chat state lives (tab-switch survival)

Model 3's architecture (§1.2) already implies the answer: Chat is a sibling of the tabbed `Shell`, not a tab body, so it must not be state owned *inside* whichever tab happens to be mounted. Chat's transcript, current turn's streaming buffer, `AbortController` ref, and `sessionId` live in **one hook (`useChat()`) mounted once at the top level** (same altitude as `useInbox()`/`useOps()` in today's `Shell()`, i.e. inside the top-level component that never unmounts across a tab switch or an `app ⇄ chat` toggle) rather than inside a `ChatScreen` component that mounts/unmounts with navigation. This is the same lesson `content.ts`'s realtime-channel rule already encodes for a different reason (`useId()`-namespaced topics so multiple mounts don't collide, `useOps.ts:8-15`) — here the requirement is the mirror image: *one* mount, kept alive, specifically so a switch away and back doesn't tear down an in-flight `fetch()` or lose buffered text. If Chat's *view* (the scrollback UI) unmounts while a turn is in flight, the underlying `fetch()` keeps running (it's owned by the hook, not the view) and SSE events keep updating hook state; re-mounting the view just re-subscribes to already-current state, no data lost, no double-request.

### 2.8 File list to create

| File | Purpose |
|---|---|
| `supabase/functions/inbox-claude/index.ts` | The edge function: verify JWT, allowlist Ivan's user id, hold `RAILWAY_CLAUDE_API_KEY` as a secret, build the fixed-workspace request, call Railway `/chat/stream` (SSE) with `/chat` as non-streaming fallback, re-emit normalized SSE frames (§2.1), propagate client abort (§2.3) |
| `src/lib/chat.ts` | Client data layer: `sendChatTurn(prompt, { signal }) → AsyncGenerator<ChatEvent>` — bare-`fetch()` SSE reader (no `EventSource`, since `EventSource` can't send an `Authorization` header — the same reason `today.ts` already mandates bare fetch, `today.ts:6-8`), parses `data:` lines into the typed frames from §2.1 |
| `src/lib/chatEvents.ts` | The `ChatEvent` union type (`session\|text\|tool_use\|done\|error\|aborted`) — mirrors the reference's `ServerMessage` union (`types.ts:122-132`) minus everything voice/WS-specific that doesn't apply here |
| `src/lib/chatRenderer.ts` | The dependency-free markdown-subset parser (§2.6) — pure function, input string → array of typed inline nodes, unit-testable like `content.ts` |
| `src/lib/streamRenderer.ts` | Port of the reference's rAF char-pacing (`streamRenderer.ts`, ~65 lines, verbatim algorithm, zero deps) |
| `src/hooks/useChat.ts` | Top-level-mounted turn state machine (§2.3, §2.7): transcript array, current streaming buffer, `AbortController` ref, `send()`/`abort()` |
| `src/components/ChatOverlay.tsx` (Model 3: `src/screens/ChatScreen.tsx` if the tournament lands on a different model) | The chat surface itself: message list + composer + stop/retry affordances; consumes `useChat()`, renders via `chatRenderer.ts` output, mounts `ToolCallCard`/`ToolGroup` for tool-use turns |
| `src/components/ChatMessage.tsx` | One transcript bubble (user or assistant), renders parsed nodes from `chatRenderer.ts` + inline `ToolCallCard`s for any `tool_use` events attached to that turn |
| `src/components/ToolCallCard.tsx` | Minimal port of the reference card (§2.5): icon/label/preview row, tap-to-expand JSON input, no output panel |
| `src/components/ToolGroup.tsx` | Collapses consecutive `ToolCallCard`s in one turn into one expandable strip, ported from reference shape |
| `src/lib/toolSummaries.ts` | Pure `summarizeTool(name, inputJson) → {icon,label,preview}` map, ported verbatim from reference `tool-summaries.ts` (plain data, no dependency) |

### 2.9 Edge function contract (`inbox-claude`)

**Request**: `POST`, body `{ prompt: string, sessionId: string | null }`, headers `Authorization: Bearer <jwt>` + `apikey: <anon key>` (Supabase's own edge-function gateway requires `apikey` regardless of the function's own auth logic; that is separate from the JWT check below).

**Auth checks, in order**:
1. **Missing/malformed `Authorization` header** → `401`, `{ error: 'unauthorized' }`. No Railway call attempted.
2. **JWT present but `supabase.auth.getUser(token)` fails or returns no user** (expired/invalid/anon-key-as-bearer) → `401`, `{ error: 'unauthorized' }`.
3. **Valid user, but `user.id` does not match the allowlisted single id** (held as a secret, not hardcoded — matches phase0's "single-id allowlist held as a secret, not in code") → `403`, `{ error: 'forbidden' }`.
4. **Missing/empty `prompt`** → `400`, `{ error: 'prompt required' }`. (Basic input validation, not a security gate — still checked before spending an upstream call.)

Only after all four pass does the function call Railway.

**Response shapes**:
- **Anon** (check 1 or 2): `401` JSON, connection closed immediately, no SSE stream opened at all — the browser never sees a partial stream from an unauthorized caller.
- **Wrong user** (check 3): `403` JSON, same — closed before any upstream call.
- **Upstream 5xx** (Railway itself errors, e.g. `500`/`502`/`504` before or during the SSE response): if the failure happens *before* Railway starts streaming (a non-2xx status on the initial response), the edge function returns a normal (non-streamed) `502` with `{ error: 'upstream unavailable' }` — do not open an SSE stream just to immediately error into it. If Railway had already started streaming and then the connection drops mid-stream, the edge function emits one final `error` SSE frame (§2.1) into the stream already in progress, then closes it — the client's state machine treats that identically to any other `error` frame (§2.3).
- **Upstream timeout**: Railway's own `/chat` path has a hardcoded 900s subprocess timeout (`main.py:717`, `900,  # 15 minute timeout`) and the mission's own proxy trap notes jobs over 900s die outright (existing, unrelated proxy, but the number is a useful ceiling to mirror). `/chat/stream`'s SSE generator has no explicit timeout in the code read — it streams for as long as the subprocess runs, bounded only by the client connection staying open. The edge function should apply its **own** upper bound well under Railway's implicit ceiling (recommend 600s) via `AbortSignal.timeout(600_000)` on its outbound fetch to Railway, so a hung upstream doesn't hold a Deno function invocation open indefinitely (Supabase edge functions have their own wall-clock limits independent of this). On that self-imposed timeout firing: same handling as upstream 5xx — pre-stream, return a synchronous `504`; mid-stream, emit a final `error` frame and close.

**What it explicitly never does**, restated from phase0 because it's the load-bearing control this whole function exists to enforce: never reads `working_directory` or `client_id` from the request body even if a caller sends them (they are ignored, not merely unused — the function's own Railway request body is built from a fixed template, per phase0's "refusal, not a default" framing); calls only `/chat/stream` and `/chat`, nothing else on Railway's surface (no `/clients`, `/workspace/*`, `/skills/*`).
