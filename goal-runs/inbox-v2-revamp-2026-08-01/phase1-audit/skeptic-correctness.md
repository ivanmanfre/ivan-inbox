# Correctness skeptic — inbox-v2-revamp-2026-08-01, phase1 usability.md

Role: refute-first. Verdicts below only survive with code/DB/live-behavior proof.

---

## U1 — "cached Approve zone can un-discard and resend a killed draft"

**Verdict: CONFIRMED (P1, no historical incident yet — live landmine, not a fired bug).**

Deciding question was the dispatcher's real filter. Found `docs/send-path-verification.md`
(2026-07-22, live n8n probe, verbatim node code) — the ONLY dispatcher that reads `approved_at`
is `Outreach - Send Messages` (Poll + Send), pickup predicate verbatim:
```
GET .../outreach_messages?approved_at=not.is.null&sent_at=is.null&...
```
**No filter on `send_blocked_reason`, `message_type`, or `channel`.** This is corroborated
independently by `src/lib/inbox.ts:184` (`composeReply`'s own comment: "sent_at defaults to
now() at the column level; explicit null keeps the row pickable by the dispatcher (approved_at
NOT NULL AND sent_at IS NULL)").

`approveDraft` (`src/lib/inbox.ts:160-169`) patches only `{message_text, approved_at}` (+
`unipile_chat_id` if passed) and guards `.is('sent_at', null)` — it never clears or checks
`send_blocked_reason`/`send_blocked_at`. `discardDraft` (`:171-176`) sets
`send_blocked_reason='discarded_in_inbox'`, `send_blocked_at=now`, leaves `sent_at` null.
So: discard → row has `send_blocked_reason` set, `sent_at` null. Re-approve via a stale UI
(Today's cached Zone 02) → row now has `approved_at` set, `sent_at` still null,
`send_blocked_reason` STILL `'discarded_in_inbox'`. The dispatcher's predicate is satisfied
(`approved_at NOT NULL AND sent_at IS NULL`) and it does not look at `send_blocked_reason` at
all — it WILL send within ~2 min. This is a resend, not "inert UI confusion."

**Live DB check (read-only, `outreach_messages`, 2026-08-01):**
- `send_blocked_reason IS NOT NULL AND approved_at IS NOT NULL AND sent_at IS NOT NULL` → **0 rows** (no historical case of a blocked row that was re-approved and actually sent).
- `send_blocked_reason IS NOT NULL AND approved_at IS NOT NULL AND sent_at IS NULL` → **0 rows** (nothing currently armed for the next dispatcher cycle).
- `send_blocked_reason = 'discarded_in_inbox' AND approved_at IS NOT NULL` → **0 rows** (no discarded draft has ever been re-approved).
- `send_blocked_reason = 'discarded_in_inbox'` (any) → **33 rows total**, none with `approved_at` set.

So: the hazard is real and proven at the code+dispatcher-contract level (both halves verified
independently: dispatcher ignores the column, app-side write never clears it), but it has never
actually fired — Ivan hasn't yet hit the specific stale-cache-then-approve sequence, or has not
tapped Approve on a stale Today row. This is a genuine live P1 (a single re-approve tap away from
sending a message Ivan explicitly killed), correctly rated, not a paper tiger.

---

## U2 — "useInbox swallows every fetch error; failed load = empty load"

**Verdict: CONFIRMED.**

`src/hooks/useInbox.ts:22`: `fetchMessages().then(...).catch(() => setLoading(false))` — no
error state stored anywhere in the hook; return value is `{ threads, loading, refresh }`, no
`error` field exists to expose. Grepped `src/screens/InboxScreen.tsx` for `error|Error|catch`:
**zero matches** — the screen has no error path at all, only `EMPTY` copy per filter
(`InboxScreen.tsx:27-32`, "No threads yet" etc.), rendered whenever `shown.length === 0`
regardless of whether that's a real empty inbox or a failed fetch.

Checked the one plausible escape hatch, `SeatHealthBanner` (mounted in `App.tsx:119,154`): its
hook `useSeatHealth.ts:7` does `fetchSeatHealth().then(setSummary).catch(() => {})` — also
swallows errors, and it polls `seat_health_summary` (a completely different, unrelated table/
concern: LinkedIn seat health, not inbox fetch state). It cannot and does not surface an
`outreach_messages` fetch failure. No toast system, no error boundary in `src/` (grepped for
`ErrorBoundary` — zero hits) intercepts this either. Confirmed no error surface anywhere in the
chain, exactly as claimed.

---

## U3 — same pattern in useOps / OpsScreen / DraftsScreen

**Verdict: CONFIRMED.**

`src/hooks/useOps.ts:19`: `fetchOpsDrafts().then(...).catch(() => setLoading(false))` — same
shape, no `error` field returned (`{ drafts, loading, refresh }`).

Both `OpsScreen.tsx` and `DraftsScreen.tsx` DO have a local `error`/`setError` state — but it is
scoped to **action** handlers only (approve/discard/draft-generation try/catch, e.g.
`OpsScreen.tsx:144-153,166-173,185-187,195-205,223-225`; `DraftsScreen.tsx:158-185`), rendered as
`{error && <div className="ops-err">...}` / `{error && <div className="err">...}`. Neither
screen's action-error state is wired to the *fetch* path — `useOps()`'s own `refresh()`/mount
fetch failure is invisible to both, exactly as claimed. This is a real, distinct bug from the
action-error handling (which is genuinely present and does work) — the auditor's claim is
specifically about the initial-load/refresh fetch, and that path has no error surface. Confirmed.

---

## U5 — "hardcoded realtime topic 'inbox' will black-screen the app on a second consumer"

**Verdict: CONFIRMED as a real, version-specific mechanism (not a benign no-op or a mere
duplicate-fetch).**

`node_modules/@supabase/realtime-js` is pinned to **2.109.0** (`package.json` → `"@supabase/
supabase-js": "^2.109.0"`, realtime-js version confirmed directly from its own package.json).

Traced the actual behavior:
1. `RealtimeClient.channel(topic)` (`RealtimeClient.js:343-354`) — doc comment: "If a channel
   with the same topic already exists it will be returned instead of creating a duplicate
   connection." Verified: it looks up `this.channels` by `topic === realtimeTopic` and returns
   the **existing object**, not a new one, on a second call with the same topic string.
2. `RealtimeChannel.on(type, filter, callback)` (`RealtimeChannel.js:408-416`):
   ```js
   const stateCheck = this.channelAdapter.isJoined() || this.channelAdapter.isJoining();
   const typeCheck = type === 'presence' || type === 'postgres_changes';
   if (stateCheck && typeCheck) { throw new Error(`cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`) }
   ```
   Once the first `useInbox()` instance has called `.subscribe()` on `'inbox'` (state becomes
   joining/joined), a second `useInbox()` instance calling `.channel('inbox').on('postgres_changes', ...)`
   hits the SAME channel object in the joined/joining state and **throws synchronously**.

That throw happens inside a `useEffect` callback (`useInbox.ts:24-32`). Grepped all of `src/` for
`ErrorBoundary` — **zero results**, no boundary exists anywhere in the app. An uncaught throw in
a React 18 effect with no boundary propagates and unmounts the tree — this is the standard "blank/
black screen" failure mode, and it is the exact mechanism `useOps.ts:8-15`'s own comment already
documents in this codebase ("throws inside the effect and takes the whole tree down to a black
screen") as the reason every other hook namespaces with `useId()`. The auditor's claim isn't
speculative flavor text — it's this codebase's own established, already-coded-around hazard,
independently reproduced by reading the pinned dependency's source. "Black-screen the app" is
accurate, not hyperbole. Not yet triggered (only `Shell` calls `useInbox()` today), so — like
U1 — it's a correctly-flagged live landmine rather than an active-today failure.

---

## U6 — "pages up to 20,000 rows on every mount/realtime event/window focus"

**Verdict: CONFIRMED mechanism, magnitude claim DOWNGRADED (numbers corrected).**

Code confirmed: `src/lib/inbox.ts:135-150` `fetchMessages()` — `for (let from = 0; from < 20000;
from += page)` with `page = 1000`, sequential (`await`ed in a loop, not `Promise.all`), breaks
only when a page returns `< 1000` rows. `useInbox.ts` triggers this full re-page on mount
(`:25`), on every unfiltered `postgres_changes` event on `outreach_messages` (`:26-28`, no
filter — matches `event: '*'`, no `filter:` clause), and on every `window focus` (`:29-30`).
**No debounce/throttle** on the realtime handler or the focus handler — grepped `useInbox.ts` in
full, `refresh` is called directly with zero coalescing.

**Live DB numbers (read-only, `inbox_messages_v`, 2026-08-01):**
- Total rows in `inbox_messages_v`: **2,139** (not near the 20,000 ceiling).
- Distinct `prospect_id` (= thread rows the screen actually renders): **1,354**.

So in reality `fetchMessages()` makes **3 sequential round trips** per trigger (0–999, 1000–1999,
2000–2138), not "up to 20." The "20,000-row ceiling / N up to 20" framing in the finding
overstates present-day cost by ~7x — this is a real number correction, not a nitpick, since the
finding's own severity language ("N up to 20 sequential round-trips... on a mobile PWA") implies
near-ceiling reality that isn't there today.

That said, the core hazard is not refuted: 3 sequential full-table round trips, re-run on
**every single-row write** anywhere in a 2,139-row table (dispatcher writes every ~2 min per
active lane per the send-path doc), with zero debounce, is still real, current, and wasteful —
just at 1,354 rendered rows rather than a hypothetical 20,000. That reconciles cleanly with the
measured 49,558-word unvirtualized DOM at 390px (≈37 words/row × 1,354 rows is a plausible
per-row cost for name + company + snippet + timestamp + pills). Net: keep as P1 for the
mechanism (unbounded re-fetch, no incremental sync, no debounce, will get worse as the table
grows — it has no ceiling-aware behavior, it's a hardcoded loop bound, not a real limit), but the
stated "up to 20 requests" figure should be corrected to "3 requests / 2,139 rows today" in any
rewrite.

---

## Summary of verdicts

| id | verdict | decisive evidence |
|---|---|---|
| U1 | CONFIRMED (P1, unfired) | dispatcher predicate verbatim in docs/send-path-verification.md ignores send_blocked_reason; approveDraft never clears it; DB shows 0 historical incidents but 0 rows currently armed either — mechanism proven, not yet triggered |
| U2 | CONFIRMED | useInbox has no error field at all; InboxScreen has zero error-handling code; SeatHealthBanner monitors an unrelated table and also swallows its own errors |
| U3 | CONFIRMED | useOps has no error field; OpsScreen/DraftsScreen's `error` state is action-scoped only, never wired to the fetch/refresh path |
| U5 | CONFIRMED | realtime-js 2.109.0 source: channel() returns the same object per topic; on() throws if already joined/joining; zero ErrorBoundary in src/ — matches codebase's own documented hazard in useOps.ts |
| U6 | CONFIRMED mechanism / DOWNGRADED magnitude | live DB: 2,139 rows / 1,354 threads today → 3 sequential requests, not "up to 20"; no debounce confirmed by full read of useInbox.ts |
