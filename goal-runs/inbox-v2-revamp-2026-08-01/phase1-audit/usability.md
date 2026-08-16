# Phase 1 — Usability / task-flow audit

Run: `inbox-v2-revamp-2026-08-01` · role: usability/task-flow auditor
Scope: the three daily jobs (Triage Inbox, Review/Approve Drafts, Monitor Sends/Ops) traced through the actual live component/handler code, plus the five cross-cutting checks. `src/exp/cand-*` tournament shells are out of scope — this audits the live app (`App.tsx` → `Shell()`).

## Job A — Triage Inbox

Path traced: `App.tsx` `Shell()` (default `tab='inbox'`) → `InboxScreen.tsx` → `ThreadScreen.tsx` → `lib/inbox.ts` writes, backed by `useInbox.ts`.

**Minimum taps, draft already exists (the common case):**
1. App opens — Inbox is the default tab, 0 taps.
2. Tap the thread row (has a `DRAFT` pill, `InboxScreen.tsx:127`) — 1 tap. Opens `ThreadScreen`.
3. Tap **Approve & send** (`ThreadScreen.tsx:203`) — 1 tap.
4. Tap **Approve & send** again in the confirm sheet (`ThreadScreen.tsx:90-94`) — 1 tap.
**= 3 taps minimum**, plus read time.

**Minimum taps, no draft (freehand reply):** tap row (1) → type → tap send / Enter (1) = **2 taps, zero confirmation** (see U4).

## Job B — Review/Approve Drafts

Path traced: `App.tsx` badge (`useOps` at `App.tsx:64`) → `DraftsScreen.tsx` (DM drafts, swipe or button) and `OpsScreen.tsx` (comment/newsjack/weekly/escalation), both backed by `lib/ops.ts` + `useOps.ts`.

**Minimum taps, DM draft via Drafts tab:** tap Drafts tab (1) → swipe right / tap **Approve & send** (1) → confirm (1) = **3 taps**.

**Minimum taps, Ops draft, already drafted, from Ops tab directly:** tap Ops tab (1) → tap **Approve & post/send** (1) → confirm (1) = **3 taps**. But reached via the Drafts tab's Ops teaser (the common discovery path, since the badge count blends both queues): tap Drafts (1) → tap the Ops row, which only navigates (1) → tap Approve (1) → confirm (1) = **4 taps** (U11).

**Minimum taps, Ops comment draft with no body yet:** tap Ops tab (1) → tap **Draft it** (1, ~10s wait) → tap **Approve & post** (1) → confirm (1) = **4 taps + a blocking ~10s generation step in the middle of the flow.**

## Job C — Monitor Sends/Ops

Path traced: `SendsScreen.tsx` (default view `overview`) → `kpi/OverviewView.tsx`, `TodayScreen.tsx` Zone 04 (`HealthStrip`), backed by `lib/sends.ts` + `lib/kpis.ts` + `hooks/useToday.ts`.

**Minimum taps, "is it healthy":** tap Sends tab (1) → Overview (default) renders Hero + Funnel + Volume + Pipeline + Governor + Seats + Campaigns in one scroll, 0 more taps = **1 tap**.

**Minimum taps, "is anything stuck" (Ops backlog too):** the health picture and the Ops backlog live on two unconnected tabs with no cross-link — Sends never mentions a stuck comment/newsjack card, Ops never mentions governor state. Full picture = **2 tab taps minimum** (Sends, then Ops), and nothing on either screen tells the operator the other exists.

---

## Findings table

| id | priority | file:line | finding | fix shape |
|---|---|---|---|---|
| U1 | **P1** | `src/lib/today.ts` (cache/`readCache`), `src/screens/TodayScreen.tsx:164-219` (`DmRow`), `src/lib/inbox.ts:160-169` (`approveDraft`) | Today's Zone 02 "Approve" list renders from a `localStorage`-cached brief (`fromCache`/`degraded` shown only as a passive banner, never disabling the action buttons) that can be up to ~12s stale on every cold open, or arbitrarily stale if the last full-brief fetch failed. `approveDraft()` only guards `.is('sent_at', null)` — it never checks `send_blocked_reason`. So: discard a draft in Inbox/Drafts → open Today before the next full-brief fetch lands → the same draft is still listed and fully tappable in Zone 02 → tapping **Approve & send** sets `approved_at` on a row that still carries `send_blocked_reason='discarded_in_inbox'`, silently reviving it. The confirm-sheet copy across the app ("The sender picks it up within about 2 minutes") documents that the external dispatcher acts on `approved_at`+`sent_at IS NULL` alone, so this is very likely to actually send a message Ivan explicitly killed. `approveOpsDraft` (`lib/ops.ts:125-130`) has the identical gap, lower risk since Ops has no client-side cache. | Guard both approve writes with `.is('send_blocked_reason', null)` in addition to `.is('sent_at', null)` (make discard permanent against any stale-UI replay); separately, gate Today's Zone 02 action buttons (not just the banner) behind `!fromCache \|\| freshEnough`. |
| U2 | **P1** | `src/hooks/useInbox.ts:22`, `src/screens/InboxScreen.tsx:100-101` | `useInbox`'s `fetchMessages().catch(() => setLoading(false))` swallows every error with no stored error state. A failed fetch (network blip, RLS hiccup, cold Supabase) renders identically to a genuinely empty inbox — `InboxScreen` shows "No threads yet." This is the exact hazard `fetchLaneProbe` (`content.ts:204-218`) was built to prevent elsewhere in the app, but Inbox — the screen opened first, every day — has no equivalent probe or even a raw error message. An operator seeing "No threads yet" has no signal to distrust it and skips triage entirely. | Add an `error` field to `useInbox`'s return (mirror the pattern already used in `SendsScreen`/`OverviewView`); render a distinct "couldn't load" state, never silently collapse to the empty-state copy. |
| U3 | **P1** | `src/hooks/useOps.ts:19`, `src/screens/OpsScreen.tsx:356-357`, `src/screens/DraftsScreen.tsx:300` | Same silent-catch pattern in `useOps` (`fetchOpsDrafts().catch(() => setLoading(false))`, no error state at all). `OpsScreen` renders "Nothing waiting on you." on a failed fetch exactly as it would on a truly empty queue; `DraftsScreen`'s Ops teaser section disappears the same way. Both of Job B's two queues share this hazard. | Same fix as U2, applied to `useOps`. |
| U4 | **P1** | `src/screens/ThreadScreen.tsx:117-124` (`onSend`, no confirm) vs `:88-100` (`onApprove`, confirmed) | `composeReply` — a freehand, unreviewed, un-gated outbound send, triggerable by pressing Enter in a single-line input — has **zero confirmation**. `approveDraft` — sending text Ivan already read once as an AI draft — **requires** a confirm-sheet tap. The riskier action (typed live, no second look, no undo) is the one action in the whole outbound-send surface with no confirmation gate. A mis-tapped Enter/return on a mobile keyboard sends immediately. | Route `onSend` through the same `useConfirm()` used everywhere else in this file, or at minimum require a second explicit tap (not Enter) to fire it. |
| U5 | **P1** | `src/hooks/useInbox.ts:26-27` vs the documented rule at `src/hooks/useOps.ts:8-15` | `useInbox` is the sole hook in the codebase that hardcodes its realtime topic (`supabase.channel('inbox')`) instead of namespacing with `useId()` (every other hook — `useOps`, `useContent`, `useAgent` — follows the rule, per `useOps.ts:8-15`'s own comment explaining why: a second subscriber on an already-held topic throws inside the effect and blacks out the whole tree). Today, only `Shell` calls `useInbox()`, so nothing breaks yet. But phase0 explicitly plans new Content and Chat tabs that will likely want thread data — the first new surface that reuses `useInbox()` (or React rendering two instances simultaneously) crashes the app to a black screen. | One-line fix: `` `inbox:${useId()}` `` in `useInbox.ts:27`, matching the established pattern, before any new tab is built on top of it. |
| U6 | **P1** | `src/lib/inbox.ts:135-150` (`fetchMessages`), `src/hooks/useInbox.ts:13-32` | Confirmed, not inferred: `fetchMessages()` pages through `inbox_messages_v` in sequential 1000-row requests up to 20,000 rows (`for (let from = 0; from < 20000; from += page)`, awaited serially, not parallelized). `useInbox`'s `refresh()` — which triggers this full re-page — runs on mount, on **every** `postgres_changes` event on `outreach_messages` (unfiltered: any insert/update/delete, anywhere, by anyone), and on every `window focus`. This feeds `InboxScreen`, `DraftsScreen`, and all three exp candidate shells. On a live table (the memory record already documents multi-thousand-row campaigns and hundred-row phantom-duplicate bursts), a single dispatcher write — which fires every ~2 minutes per active lane — triggers a full multi-request table reload on every open client, entirely to reflect a one-row change. This is the dominant network/battery cost in the app. | (a) Debounce/coalesce realtime events (trailing-edge, 2-5s) so a burst of dispatcher writes collapses into one refresh; (b) switch to incremental sync — track the max `created_at`/`updated_at` cursor already held and fetch only newer rows, patching them into existing state, instead of re-paging everything; (c) bound the working set (e.g. last 90 days + all unresolved drafts) so old resolved threads aren't part of every reload. |
| U7 | **P1** (INFERRED) | `src/screens/ThreadScreen.tsx:132,136` | `engagedDisabled = thread.stage === 'engaged'` disables the reply composer with the copy "Not connected yet. A reply here would go out as a connection invite." That message describes a *pre-connection* state, but it's gated on the `'engaged'` stage specifically — a name that elsewhere in the industry (and by the label `stageLabel` just renders verbatim) typically means the prospect is actively engaging, i.e. already connected. If the stage names are inverted from what this comment assumes, the composer is disabled for exactly the prospects most worth replying to, with a message that doesn't match their real state. Flagged INFERRED because the actual stage vocabulary lives in the DB/pipeline, not in this file — verify `outreach_campaigns`/`prospect_stage` semantics before treating this as confirmed. | Verify stage semantics against the pipeline; if inverted, the gate condition needs to target the actual pre-connection stage (likely `connection_sent`, already used elsewhere in this same file for `outLabel`). |
| U8 | P2 | `src/screens/InboxScreen.tsx:20-25,53-54,81` | The unread count is computed (`unreadTotal`) and displayed as a decorative suffix on the "All" chip, but none of the four filter chips (`all/ivan/risedtc/email`) let the operator filter to "needs a reply" or "has a draft." Finding what needs attention in a growing list is pure visual scanning. | Add an "Unread" or "Needs you" quick filter using data the screen already computes (`t.unread`, `t.draft`). |
| U9 | P2 | `src/screens/ThreadScreen.tsx:88-115` vs `src/screens/DraftsScreen.tsx` (list self-shrinks) | After approving/discarding a draft from `ThreadScreen` (the path reached from Inbox), there is no auto-advance to the next pending thread — the operator sits on the now-draftless thread and must tap back, then re-scan the list. `DraftsScreen` is a proper clearing queue (the card disappears, next card is already in place); the Inbox→Thread path is not, despite being the path Job A actually specifies (open inbox, find, read, act). | On approve/discard from `ThreadScreen`, when reached via a queue context, advance to the next thread with a draft instead of returning to the list. |
| U10 | P2 | `src/screens/DraftsScreen.tsx:25-52` (`OpsPending`) | Ops rows inside the Drafts screen render with the same visual grammar as an actionable `DraftCard` (avatar-style chip, name, snippet, timestamp) sitting in the same list, but the entire row is only a link to the Ops tab — no approve/discard here. Nothing in the row itself signals "this one just navigates." | Give the Ops-teaser rows a visually distinct affordance (e.g. explicit chevron-only "Open in Ops" styling) so they don't read as swipeable/actionable cards. |
| U11 | P2 | `src/screens/DraftsScreen.tsx:298`, `src/screens/OpsScreen.tsx:359` | Approving an Ops draft costs one more tap than a DM draft when discovered via the Drafts tab (the natural entry point, since the badge blends both queues): Drafts → tap Ops row → land on Ops tab → tap Approve → confirm = 4 taps, vs. DM's 3. There's no way to act on an Ops draft without leaving the Drafts screen. | If Job B is meant to be one pass, either surface Ops approve actions inline in the Drafts-tab teaser, or make the two-queue split explicit in the UI (e.g. a persistent Ops count next to the Drafts count) so the extra hop is expected, not a surprise. |
| U12 | P2 | `src/screens/kpi/OverviewView.tsx:136-243,397-435` vs `src/screens/TodayScreen.tsx:388-517`, `src/hooks/useToday.ts:105-111` | Governor/Accept/Pipeline health is computed independently in the Sends Overview (`Hero` + `Governor` detail) and in Today's `HealthStrip` — same source RPCs/views (`fetchAccept`, `fetchPipeline`, `fetchGovernor`), same math (duplicated, not shared, e.g. accept-rate trend logic is copy-implemented in both files), but two separate un-cached fetches taken at different times. The two screens can show slightly different numbers for "the same" governor state at the same moment, and there's no visual link telling the operator they're the same metric rendered twice. | Hoist the shared fetch+derive logic into one hook (or a light cache/react-query layer) both screens read from, so the numbers are provably the same object, not just usually close. |
| U13 | P2 | `src/hooks/useToday.ts` (throttled+cached) vs `src/hooks/useInbox.ts` (realtime) | The same pending-DM-draft rows are surfaced through two independently-paced pipelines: Today's Zone 02 via the ~12s `get-morning-brief` edge function (cached, 60s focus-throttle), Inbox's draft banner / Drafts queue via realtime-subscribed direct table reads. The three surfaces (Today Zone 02, Inbox banner, Drafts queue) can disagree on count/contents for the same underlying rows at the same instant — this is the direct precondition for U1. | Same direction as U1's fix — either gate Today's actionable rows on freshness, or have Today subscribe to the same realtime feed instead of a separately-cached edge-function payload. |
| U14 | P3 | `src/App.tsx:64`, `src/screens/DraftsScreen.tsx:231`, `src/screens/OpsScreen.tsx:326` | Three call sites (`Shell` for the badge, `DraftsScreen`, `OpsScreen`) each mount their own `useOps()` — independent fetch + realtime channel + focus listener. Typically 2 concurrent subscriptions to the same table whenever Drafts or Ops is the active tab (Shell's badge instance is always live). Bounded cost since `fetchOpsDrafts` caps at 300 rows (`lib/ops.ts:117`), so this is a real but minor duplication, not comparable to U6. | Lift a single `useOps()` result into context/a shared store if this needs fixing at all — low priority given the row cap. |
| U15 | P3 | `src/hooks/useToday.ts:105-111`, `src/screens/kpi/OverviewView.tsx:657-670` | Switching between Today and Sends tabs re-fetches the same governor/accept/pipeline views from scratch each time (no shared cache) — avoidable round-trips on a mobile PWA, compounding U12. | Same shared-hook/cache fix as U12 removes this too. |
| U16 | P3 (context) | `src/lib/content.ts:100-128,339-343` | `bucketDrafts` vs `groupByStage` — two competing groupings of the same content rows, already flagged in `phase0-scope.md:84` as a Phase 2 decision. Out of scope for the three screens audited here (Inbox/Drafts/Sends never call either), but it's exactly the kind of ambiguity a new Content tab will inherit if it reuses this file without picking one. Flagged for awareness, not re-litigated here. | Phase 2's job, not this one — noted so it isn't lost. |

---

## Cross-cutting: loading / empty / error states

| Screen | Loading | Empty | Error | Distinguishable from each other? |
|---|---|---|---|---|
| InboxScreen (`useInbox`) | Skeleton (`App.tsx:102-113`) | "No threads yet" / per-filter copy | **None — silently collapses into Empty** (U2) | No |
| DraftsScreen (rides on `useInbox`+`useOps`) | inherited | "No drafts right now." | **None** (U3, compounded by U2) | No |
| OpsScreen (`useOps`) | Skeleton | "Nothing waiting on you." | **None** (U3) | No |
| SendsScreen / `LogView` / `LaneDetail` | "Loading…" | "No … yet." copy per view | Explicit `error` state, rendered distinctly | **Yes** |
| OverviewView | "Loading…" | "No data yet." | Explicit `error` state | **Yes** |
| TodayScreen | Cache-first paint + "Loading the brief…" per zone | Explicit zone-level empty copy | Explicit, layered (`authError` / `degraded` / stale-but-cached / hard error) — the best-handled screen in the app | **Yes, and unusually thorough** |

The pattern is inverted from what the daily-frequency of each job would suggest: Job A/B (Inbox, Drafts, Ops — opened first, multiple times a day) have **no** error surfacing at all, while Job C (Sends, Today — the "just checking" surfaces) have the most thorough three-way state handling in the app, including the exact `fetchLaneProbe`-style hazard the phase0 doc called out as already-solved once. That fix was never carried over to Inbox or Ops.

## Cross-cutting: duplicated grouping / redundant surfacing (Today vs Inbox vs Drafts)

Traced directly: `TodayScreen` Zone 02 (`ZoneApprove` → `DmRow`, `today.ts` `needs_you.dm_drafts`) reads the **same** `outreach_messages` rows (unapproved, undiscarded, `direction='outbound'`) that `InboxScreen`'s draft banner and `DraftsScreen`'s queue read via `useInbox`. Same rows, three renderings, two different data pipelines with different latency (see U13). This is a confirmed instance of the redundant-surfacing pattern the task asked to check for, not merely two visual layouts of one canonical source — the sources themselves can disagree.

## Cross-cutting: destructive/irreversible actions and confirmation

| Action | Confirmed? | Notes |
|---|---|---|
| `approveDraft` (DM send) — Thread/Drafts/Today | Yes (`ConfirmSheet`) | Consistent across all three surfaces |
| `discardDraft` (DM) — Thread/Drafts | Yes, `danger:true` | Bulk "discard stale" also confirmed with a count-specific message |
| **`composeReply` (freehand DM/email send)** | **No** | See U4 — the highest-risk action in the app, zero gate |
| `approveOpsDraft` (Slack/newsjack/Ops post) | Yes, kind-specific copy | Well done — newsjack copy explains the slot-swap side effect |
| `discardOpsDraft` | Yes, `danger:true`, kind-specific consequence copy | Good |
| `postCommentReply` (publishes live on LinkedIn) | Yes, explicit "Goes live on LinkedIn" copy | Correctly the most serious-sounding confirm in the app |
| `approveWeeklyReport` / `markCommentHandled` | Yes | Correctly low-key (clipboard copy / bookkeeping only) |
| `markThreadRead` | No confirm | Correct — low stakes, fire-and-forget |
| `generateCommentDraft` | No confirm | Correct — pure generation, no external effect |

Everything that sends/publishes is confirmed **except** `composeReply` (U4) — a single, clear gap in an otherwise consistent policy.

## Tab bar (6 slots) — which to cut for Content + Chat

Current: Today, Inbox, Drafts, Sends, Ops, Settings (`TabBar.tsx:8-31`).

**Cut Settings first.** It's opened rarely (push/chime/theme/sign-out — setup-once, not a daily job), and the nav header already has a slot for exactly this kind of affordance (`avatar-me`, `InboxScreen.tsx:61` and repeated in every screen's `.row-top`) — standard iOS pattern is a gear/profile icon in the header, not a bottom-tab slot, for infrequent account-level actions.

**If a second slot is needed, fold Sends into Ops** (or vice versa) rather than cutting either outright. The evidence for this: Sends' Overview Hero and Governor detail already duplicate what Today's Zone 04 HealthStrip shows (U12) — Sends' unique value is the drill-down (Lanes, Log, Campaigns, custom Range), which doesn't need to live at the top level if "is it healthy" is already answered on Today. Sends already uses an internal segmented control (`Overview / Lanes / Log`, `SendsScreen.tsx:262-266`); adding "Ops" as a fourth segment in that same pattern is a smaller structural change than inventing a new merged screen from scratch, and it directly removes the two-unconnected-tabs gap called out in Job C ("is anything stuck" currently requires two separate tab visits with no cross-link).

Both Inbox and Drafts are the two daily-triage tabs this audit's Job A/B is built around and Today is the cold-open landing surface — none of the three should move.

## Perf finding (item 4) — CONFIRMED

`useInbox`/`fetchMessages` pages up to 20,000 rows in sequential 1000-row requests, re-run on every mount, every unfiltered realtime event on `outreach_messages`, and every window focus. See U6 above for the full trace and fix shape. This is the single highest-leverage frontend fix identified in this audit — it's a confirmed, quantifiable cost (N sequential round-trips per event, N up to 20, on a mobile PWA), not a suspected one.

## Realtime channel-collision (item 5) — CONFIRMED, one exception found

`useInbox.ts:26-27` hardcodes `supabase.channel('inbox')`; every other realtime consumer in the app (`useOps.ts:14`, and per phase0's inventory `useContent.ts:28-35`, `useAgent.ts:21-26`) follows the documented `useId()` namespacing rule. No active collision today (only `Shell` calls `useInbox()`), but it is the one hook in the codebase not following its own team's rule, and it sits directly in the path of the planned Content/Chat tabs. See U5.
