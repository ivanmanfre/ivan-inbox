# Phase 4 — the Claude tab works

Goal-run `inbox-faithful-revamp-2026-08-02`. Part (a) and (b) — the Railway fix and the broker arming —
were executed in the main loop (T3-EXTERNAL guardrail), 2026-08-02 ~18:15-18:45Z. Part (c), the pane
correctness pass, is appended below by the Phase 4c builder.

## (a) The Railway `/chat/stream` one-token fix

**Breakage re-confirmed live BEFORE touching anything** (guardrail step 1):

- `POST /chat/stream` → `data: {"type": "done", "returncode": 1}` and nothing else
  (evidence: `phase4-prefix-stream.txt`)
- `POST /chat` (control) → `{"session_id":"a1f9b598-…","result":"OK\n","success":true}` — working
  (evidence: `phase4-prefix-chat.txt`)

Identical to the 2026-08-01 diagnosis (`memory/inbox-claude-brain-and-voice-2026-08-01.md`): no sign
anyone else had fixed it, so the voted fix applied.

**The diff** — repo `claude-code-railway`, commit `3ea8208` on its `main` (its deploy branch; the
service builds from GitHub). One file, one inserted line at `main.py:807`:

```python
cmd = [
    "claude",
    "-p",
    "--verbose",  # --print + --output-format=stream-json is illegal without it; the CLI exits 1
    "--permission-mode", request.permission_mode,
    ...
```

Nothing else changed on the multi-client service. **Rollback line:**
`cd ~/Desktop/claude-code-railway && git revert --no-edit 3ea8208 && git push origin main`

**Post-deploy verification** (deploy took ~2 min; polled every 60s):

| check | result | evidence |
|---|---|---|
| `/chat/stream` full turn | 9 SSE lines, `"type":"result" … "result":"OK"`, ends `{"type": "done", "returncode": 0}` | `phase4-postfix-stream-fullturn.txt` |
| `/chat` no-model default | `"result":"OK\n","success":true` | `phase4-postfix-chat-default.txt` |
| `/chat` allowlisted model (`claude-haiku-4-5`) | `"result":"OK\n","success":true` | `phase4-postfix-chat-model.txt` |

## (b) Arming the broker

- Before: Supabase edge-fn secrets had `RAILWAY_CLAUDE_URL` set, `RAILWAY_CLAUDE_API_KEY` absent —
  and `inbox-claude/index.ts:275` only sends `X-API-Key` when the secret exists, so every upstream call
  401'd by construction.
- Armed: `supabase secrets set RAILWAY_CLAUDE_API_KEY=<the Railway service's own existing API_KEY>` —
  an existing credential copied between two server-side envs. It appears in no browser bundle, no repo,
  no client-side artifact. (Its digest matches `RAILWAY_PROXY_API_KEY` — the same shared service key
  already in use elsewhere in the stack.)
- **Real end-to-end turn through the edge fn** (user JWT + anon apikey, prompt "Reply with exactly:
  BROKER OK"): 9 SSE lines, `"result":"BROKER OK"`, `returncode: 0`. Evidence: `phase4-broker-turn.txt`.

**Telemetry.** This path does not route through the Anthropic proxy, so `client_api_usage` (the
proxy-first canon's table) is not the surface that records it. The Railway box syncs
`~/.claude/projects/*.jsonl` → `claude_usage_sessions` every 15 min (`entrypoint.sh:755-764`). The
turn's row landed on the next sync:

```
session_id 5a18df72-745b-42d3-bb1a-e7437c818950 · source railway · primary_model claude-opus-4-7
first_user_message "Reply with exactly: BROKER OK" · input 6 / output 10 / cache_write 62,151 tokens
estimated_cost $1.1662 · last_synced_at 2026-08-02T18:43:12Z
```

⚠ Cost note for the record: a single trivial turn wrote a 62k-token cache at ~$1.17 — the known
cache-write-never-read cost trap from the 08-01 run (`--resume` fix measured but out of grant) is now
LIVE ECONOMICS on every pane turn, not a hypothetical. Worth its own decision soon.

## Known blocker routed to Phase 4c

The broker's CORS allowlist is hardcoded to the prod origin (`https://ivanmanfre.github.io`) —
`http://localhost:5431` is rejected at preflight (phase0-errors-hover.md, reproduced 2 console errors +
1 failed request per send). The pane on :5431 cannot complete a turn until the dev origin is
allowlisted (T2, smallest diff) or the gate capture runs against the prod origin.

## (c) Pane correctness pass — appended by the Phase 4c builder

Executed in the main loop (the dispatched agents died to the account session limit; commits are the
recovery path). Commits `25abe31` (CORS) and `121a138` (the pane fixes).

### The CORS blocker dies

`inbox-claude`'s allowlist already carried four localhost dev ports; `http://localhost:5431` joins them
(same list `inbox-stt` ships). Deployed; preflight verified allowing BOTH `http://localhost:5431` and
`https://ivanmanfre.github.io`. The 2-errors-per-send class is gone: **0 console errors through a full
send** (measured, `_orch-pane-turn2.mjs`).

### Why the pane STILL hung after arming — three stacked breakages, found by live instrumentation

The transport chain was written in February against an endpoint that had been dead since `df6801e`, so
none of it had ever parsed a real stream. Instrumenting layer by layer (raw in-page fetch → sendToClaude
→ httpTransport → useChat trace):

1. **StrictMode killed every dev-mode turn** (`useChat.ts:75-83`). The alive flag's effect was
   cleanup-only; React 18's dev rehearsal (mount→cleanup→mount) left `alive.current` false forever, so
   the event loop bailed after one event and the finalizer that clears "Working" was skipped — the
   stream closed (instrumented: 4 chunks, 7.5s, CLOSED) while the UI stayed busy for 300s+. Invisible
   in prod builds; fatal on :5431. Fixed by setting the flag true in the effect body.
2. **The parser dropped every reply** (`claude.ts` emit). It read top-level `text` off `assistant`
   frames; the real CLI nests `message.content[] = [{type:'text',text}, {type:'tool_use',…}]`. Fixed to
   walk the content array (text + tool_use); tests re-pinned against a live captured frame, replacing
   the imagined-shape tests.
3. **The palette's whole-string match fell through to a literal send**: "/model haiku" matched no
   command name, the palette closed, and Enter would send the raw string to the model — the exact
   behaviour the palette exists to end. Now token-wise: every whitespace token must match.
   Verified live: `/model haiku` → `["/model claude-haiku-4-5"]`, `/ret` → retry, `/cle` → clear.

### /clear ships

`useChat.reset()` (aborts in-flight work, empties the transcript, forgets the server session, KEEPS the
chosen model) + a `/clear` palette entry gated on `hasTurns`. Verified live on a completed transcript.

### The phase gate

Step-captured full conversation turn on :5431 (`phase4-shots/`): `turn-1-pane.png` (docked pane) →
`turn-2-typed.png` → `turn-3-inflight.png` (user bubble + Working) → `turn-4-done.png` (**reply "PANE
OK" rendered, "✳ Claude · 6.2s", header "ran on default"**) → `turn-5-palette-clear.png` →
`turn-6-cleared.png`. Turn completes in **7s**, **0 console errors**, `/clear` empties the thread.
Gates: `tsc` clean, `npm test` **421/421**, lint no new warnings.
