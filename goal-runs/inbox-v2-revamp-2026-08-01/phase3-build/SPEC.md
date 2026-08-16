# Arbitration + winner-apply spec

## Panel result

| seat | 1st | 2nd | 3rd |
|---|---|---|---|
| Ergonomics | **v2b** | v2c | v2a |
| Craft | **v2c** | v2b | v2a |
| IA scalability | **v2c** | v2b | v2a |
| Orchestrator (director seat, own look at pixels) | **v2c** structure | v2b surface | v2a chat internals |

All three seats calibrated correctly on their controls before voting. **Winner: v2c "workbench".** It takes craft and IA outright, places second on ergonomics, and is the only candidate that answers the audit's central desktop finding structurally rather than cosmetically. v2b places second on every seat and contributes the largest graft list. v2a places third on all three: safest, cleanest code, moves the fewest needles, and its chat internals are still the best in the set.

This is a real result, not a landslide. The ballot ships all three regardless, because the final call is Ivan's taste.

## Base

Branch from `tourney/v2c`. Route the result at **`#exp/v2`** (add to the gate regex in `src/exp/index.tsx`; leave `#exp/v2a|v2b|v2c` intact so the ballot can still link them).

## Grafts to land (each was named independently by a seat or the director)

1. **v2b's single-ownership pattern** — named by BOTH the ergonomics and IA seats, which is the strongest signal in the panel. Port `HandOff` (`v2b Cockpit.tsx:230-246`): one pending item has one owning surface, and every other appearance is a count plus a way in, never a second mutating affordance. Include the inline owner labels that make it visible ("posting is live on LinkedIn - approved in Ops", "approved in the feed lane, not here").
2. **v2b's honest empty-state copy.** "Nothing waiting on you - and this is a live read, not a stall." is the best line any candidate wrote and it solves U3 in language rather than in state alone. Apply the register across every empty surface.
3. **v2b's `approveDraft` guard on `send_blocked_reason IS NULL`.** v2b is the only candidate that fixed the U1 landmine at the data layer. Non-negotiable: port it. The dispatcher's real predicate is `approved_at NOT NULL AND sent_at IS NULL` with no block check (`docs/send-path-verification.md`), so this guard is the only thing standing between a stale replay and a real send.
4. **v2b's cockpit masthead arithmetic for Today** — a headline number defined as the sum of its own zone counts, with a stacked bar of those same counts, so the summary cannot drift from its parts. Keep Today's existing numbered/ruled/counted zone header.
5. **v2a's chat internals** — tool-call cards, the per-turn cost-and-latency line, and `Hands-free` as a labelled mode. Nobody asked for telemetry; on a Claude Code surface it belongs.

## Must-fix, all four (each was a panel must-fix or a verified defect)

1. **v2c's doubled Ops render** (orchestrator-verified in `crops/v2c/ops-desktop.png`): `Ops` title and `Nothing waiting on you.` both render twice, once from the wrapper and once from the wrapped `OpsScreen`'s own nav; the collapsed `DONE · 2` / `BLOCKED · 3` rows read as clipped at the left column edge. Fix by suppressing the wrapped screen's internal header the way `src/exp/cand-a/styles.css:126` does with a scoped nav-hide. **Then audit EVERY wrapped production screen for the same doubled header** — the bug is a class, not an instance.
2. **Ops at 1440px, unsolved by all three** (craft seat's must-fix). C doubles it, B regresses it to near-total dead black, A leaves it near baseline. It needs a real design at desktop width, not a wrapper tweak. Use the region for the collapsed Working/Done/Blocked groups plus a freshness signal (finding A5: Ops currently cannot distinguish an empty queue from a stalled feed).
3. **v2c's Content job has two incompatible mental models across viewports** (IA seat's must-fix): a full rail row on desktop (`Rail.tsx:94-100`) versus a shared Drafts segment on mobile (`Rail.tsx:58`). Pick one model and make both viewports teach it.
4. **U4 — freehand compose still sends with zero confirmation in all three candidates** (ergonomics seat's must-fix). Approving a *reviewed* AI draft asks for confirmation while typing a fresh message and hitting send does not, which is backwards. Route `composeReply` through the existing `ConfirmSheet`.

## Wire the real Claude connection

The broker is **already built, deployed and probed** — do not rewrite it. `supabase/functions/inbox-claude/index.ts` is live on project `bjbvqvzbzczjbatgmccb`; its secrets `INBOX_CLAUDE_ALLOWED_USER_ID` and `RAILWAY_CLAUDE_URL` are set. Verified in production: no auth → 401, anon key → 401 `invalid_token`, garbage token → 401, Ivan's real JWT → reaches body validation (400 `empty_prompt`).

The real transport is **already written and tested**: `src/lib/claude.ts` + `src/lib/claude.test.ts` (13 tests, in the base branch's parent — confirm they are present and passing after you branch; if the worktree predates them, copy both from `main`). Your job is to replace v2c's mock transport module with `sendToClaude` from `src/lib/claude.ts`, keeping the same event shape (`status | text | tool | done | error`).

**It ships unarmed and that is the correct end state.** `RAILWAY_CLAUDE_API_KEY` is deliberately unset because the upstream's key is not obtainable non-interactively, so a real turn currently returns `upstream_not_armed`. The UI must render that specific message ("Claude is not armed yet: the container key is not set on the broker."), never a generic failure. `CLAUDE_ERROR_COPY` already carries distinct copy for all 14 error codes; use it.

Do NOT add a workspace picker, do NOT send `working_directory` or `client_id`, and do NOT call Railway directly from the client. Read `phase1-audit/skeptic-security.md` before touching this path.

## Voice: on-device, resolved

The Supabase vault has **no `OPENAI_API_KEY`**, so the edge-brokered STT branch from `phase1-audit/voice.md` is unavailable and the fallback becomes the design: **on-device `webkitSpeechRecognition` for input and `speechSynthesis` for output.** This is better than the reference implementation for this app, not a compromise — it removes two network legs from the reference's four-leg pipeline, costs nothing, needs no key, and comfortably beats the 1.2s first-audible target because nothing leaves the device for STT.

Implement the state machine from `phase1-audit/voice.md`: `IDLE → ARMING → LISTENING → (TRANSCRIBING | PAUSED) → SENDING → SPEAKING → LISTENING/IDLE`, with `ERROR(reason, retryable)` reachable from any state and the mic **structurally un-armable while SPEAKING**. Replace timeout-patches with real states. Each failure mode gets its own message: permission denied, no speech detected, API unsupported by this browser, network. iOS requires the audio unlock inside a user gesture. Feature-detect and hide the affordance entirely where unsupported rather than showing a button that cannot work.

## Gates (from `CALIBRATION.md` — these and only these)

`scrollWidth === clientWidth` at 390px · zero console errors · any surface >100 words carries ≥1 visual encoding · prose share ≤80% (inbox and transcript surfaces are pre-classified true-positive exemptions) · stat surfaces' largest number ≥26px · three visibly distinct data states · `npm run build` clean · `npm test` green · `npm run lint` clean.

Canon is locked: no new npm dependencies, no monospace, severity stays 3-tier, type scale 26-38px for stat numbers, glyph icons, ≤2 new keyframes. Full list in `phase2-tournament/CONTRACT.md`, load-bearing traps included.

## Deliverables

- Code on branch `exp/v2` (worktree `../ivan-inbox-wt-v2`), small conventional commits, no AI attribution in messages.
- `phase3-build/LEDGER.md`: one row per work packet (graft / must-fix / wiring), what changed, which files, and how you verified it. Implementer→reviewer discipline per packet.
- Screenshots of every surface × {390, 1440} into `phase3-build/crops/`, captured with the **main repo's** `scripts/sweep.mjs` and `scripts/density.mjs`, plus the measured gate table.
- Do **not** merge to `main`, do **not** apply the winner to the default routes, do **not** set `RAILWAY_CLAUDE_API_KEY`. Nothing arms in this phase.
