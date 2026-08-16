# Phase 0 — Today-screen staleness ("the approve dm draft is old asf")

Scope: `exp/vis-faithful` worktree, `#exp/v2/today` (Job=`today` inside the v2c
Workbench, rendered by `src/exp/v2c/Shell.tsx:332-334` -> `TodayScreen`).
Read-only scouting. No src/ files modified.

## 0. Capture notes (trap hit + worked around)

`#exp/v2/today` does NOT reach `TodayScreen` on a cold load the way the brief
implied. `Shell.tsx:219-241` has an unconditional early-return gate:

```
if (inbox.loading && inbox.threads.length === 0 && !inboxError) {
  return <div className="app dt wb">…<h2>Inbox</h2><InboxSkeleton /></div>
}
```

This fires for **every** job, including `today` — the Rail highlights "Today"
(job state is correct) but the main pane shows a generic "INBOX" skeleton
until `useInbox()` (mounted once at the top of `Shell`, `Shell.tsx:117`)
finishes paging `inbox_messages_v` (2,200 rows / 3 pages of 1000, confirmed via
`Range` header: `content-range: 0-0/2200`). This gate carries no literal
"Loading" text, so a naive "no 'Loading' in innerText" settle check reports
false-done. Fixed by waiting for the **full** (non-`counts`) `get-morning-brief`
response specifically (~12s inclusive of the inbox page-in), per
`src/hooks/useToday.ts:20-21` comment ("the full payload … takes ~12s").
Screenshots: `phase0-shots/today-03-settled.png` (top of screen),
`phase0-shots/today-05-scrolled.png` (full inventory, viewport scroll), raw
payload: `phase0-shots/today-brief-payload.json` (full mode) and
`today-brief-counts-payload.json` (counts mode).

## 1. Full zone inventory (generated_at 2026-08-02T18:31:37.855Z, scope=Ivan)

**Masthead**: 13 things on your plate — 1 urgent · 12 to approve · 0 going out.

**01 URGENT (0/1 cleared)**
- Nour Siakir Oglou — kind=reply, waiting_since 2026-07-31T14:31 (2d), not an autoreply.
- Banner: "aging out: 6 — older than 3 days, out of the count" (`aging_count`=6, server-side, see §3a).

**02 APPROVE (0/12 cleared)**
- **DM drafts — 4 waiting · oldest drafted 15d ago.** Preview row shown = David Card (newest of the 4, not the oldest).
  - David Card — created_at 2026-07-29T20:30 (4d)
  - Joachim Koch — created_at 2026-07-20T22:00 (13d)
  - Prakhar Vohra — created_at 2026-07-18T13:00 (15d)
  - Vuk Sretenovic — created_at 2026-07-17T22:30 (16d) ← the oldest, drives the "15d ago" caption
- **Comment drafts — 6 targets · oldest drafted 35d ago** (Chad Drew, `commenting_log` id `b403b156…`, drafted_at 2026-06-28T12:01, still `status='draft'`, never approved/posted).
- **Feed drafts — 2 pending · newest 7h ago** (Shayne Williams pending, Ernest Simonyan failed) — this zone is fresh; see §4.

**03 TODAY** — 0 scheduled today (clear). NEXT: Wed Aug 12 (carousel). QUEUE: 217 prospects ready to send.

**04 CAMPAIGN HEALTH** — Replies 0 today/25 7d; Accept 27% (▲3 vs 30d); Governor 102/125 (5 left today); lane bars (Warm/Orbit 60, Harvested 33, Cold 9, Engager 1); LinkedIn lane: fresh_supply 307, sends_today 0, accepts 3, replies 0, need_reply 44, **stuck 243**.

## 2. The "approve dm draft" row — identified and probed

Underlying table: **`outreach_messages`** (not a dedicated "drafts" table),
surfaced by the `get-morning-brief` edge function's `dm_drafts` block. Rows
captured from the intercepted network payload (`today-brief-payload.json`),
then probed live over PostgREST (Bearer = `.session.json` access_token, apikey
= anon key from `.env.local`):

| id | prospect | created_at | age (from 08-02) | sent_at | approved_at | send_blocked_reason |
|---|---|---|---|---|---|---|
| `699c248a…` | Vuk Sretenovic | 2026-07-17T22:30 | **16d** | null | null | null |
| `a181861f…` | Prakhar Vohra | 2026-07-18T13:00 | 15d | null | null | null |
| `c2bbf068…` | Joachim Koch | 2026-07-20T22:00 | 13d | null | null | null |
| `9a77664b…` | David Card | 2026-07-29T20:30 | 4d | null | null | null |

All 4 are genuinely unsent/unapproved/unblocked, so they legitimately pass the
edge fn's own filter (`direction=outbound, sent_at IS NULL, message_type=dm,
send_blocked_reason IS NULL` — `get-morning-brief/index.ts:141-148`, in the
`ivan-listener` repo, see §3b). Cross-checking each prospect's full message
history (`outreach_messages?prospect_id=in.(…)`) against `outreach_prospects`
(stage/blacklisted/last_reply_at) gives two distinct verdicts:

- **David Card (4d) — STALE ORPHAN, already handled.** A *later* outbound
  message to the same prospect (`439b6bee…`, created 2026-07-30T09:00) **was
  actually sent** (`sent_at 2026-07-30T09:00:50`). The draft shown on Today is
  the discarded/superseded predecessor from the night before — Ivan (or the
  drafting pass) already moved the thread forward, but the abandoned draft row
  was never marked sent/blocked/dismissed, so it still reads as "waiting for
  approval" and is the one shown as the zone's preview text (`dms[0]`, the
  newest by created_at).
- **Vuk Sretenovic / Prakhar Vohra / Joachim Koch (13–16d) — genuinely still
  open.** No later outbound exists for any of these three prospect_ids; each
  row is still the last word in its thread. `outreach_prospects.stage='replied'`
  and `needs_manual_reply=true` for Vuk and Prakhar — these are real,
  unaddressed reply-drafts that have simply aged in the backlog. This is a
  data-hygiene fact (Ivan hasn't triaged them), not a bug in the row itself —
  but nothing in the pipeline separates "genuinely still open, 2 weeks old" from
  "drafted yesterday."

So the "old asf" draft is **both** things at once: one row is a stale, unretired
duplicate of a decision already made, and three rows are a real backlog with no
lifecycle/expiry signal — and the UI currently surfaces the newest (David Card,
the orphan) as the representative preview rather than the oldest or a
flagged-stale one.

## 3. Root cause — traced through all three suspects

### (a) Client cache — `src/lib/today.ts` (exonerated as the cause here)
- `today.ts:4-8` — transport rule (bare `fetch()`, never `.functions.invoke()`).
- `today.ts:333-337` — `CACHE_KEY='today-cache'`, `MAX_ROWS=30`.
- `today.ts:346-403` (`projectBrief`) — whitelist projection written to
  localStorage; caps each array at 30 rows, drops capability URLs, but does
  **not** filter by age at all — it caches whatever the server sent.
- `useToday.ts:44-52` paints the cached brief synchronously on mount, then
  **always** kicks off a live `counts` + `full` refetch (`useToday.ts:64-118`)
  and overwrites `brief`/cache once the full call lands.
- Verified live: the network capture in this run pulled a **fresh** server
  response (not a cache hit — `fromCache` would show a `td-old` sync badge,
  and the screenshot shows "Synced 20:34 · now"), and it still contained the
  15–16-day-old rows. **The client cache is not the cause** — it faithfully
  reflects a server payload that itself has no freshness window on this zone.

### (b) The edge function — `get-morning-brief/index.ts` (root cause, primary)
Note: this function is **not** in the `ivan-inbox` worktree — it lives in a
sibling repo, `/Users/ivanmanfredi/Desktop/ivan-listener/supabase/functions/get-morning-brief/index.ts`
(confirmed by grepping every checked-out branch/worktree of `ivan-inbox` for
the string — zero hits; `ivan-inbox`'s own `supabase/functions/` only has
`inbox-claude`, `inbox-push`, `inbox-morning-push`). `inbox-morning-push`
(worktree) just calls this same deployed function by URL.

- **`dm_drafts` query, lines 140-167**: `outreach_messages` filtered on
  `direction=outbound, sent_at IS NULL, message_type=dm,
  send_blocked_reason IS NULL`, `order(created_at desc).limit(50)`. **No age
  cutoff, no window, and no check for a later outbound to the same
  prospect_id** — so a draft superseded by a subsequent real send (David Card)
  is never excluded, and a draft that's just old (Vuk/Prakhar/Joachim) never
  ages out or gets flagged.
- **`commentDrafts` query, lines 84-96** (full mode: 88-96): `commenting_log
  .eq('status','draft').order('drafted_at' desc).limit(50)` — same shape, same
  absence of a window. Matches the 35-day-old Chad Drew row exactly.
- **Contrast — `feed_drafts`, line 104**: has `feedSince = now - 3 days` and
  only rides rows `.gte('created_at', feedSince)` — this is why that zone
  reads fresh (newest 7h). Contrast — **`urgencies`, line 434**:
  `AGE_CUTOFF = now - 72h`, applied as an explicit post-filter that removes
  (and counts) anything older, plus an autoreply demotion (lines 296-329,
  431-442). So the function's own code proves a freshness-window pattern
  already exists (feed_drafts, urgencies) — it was simply never applied to
  `dm_drafts` or `commentDrafts`.
- **`inbox-morning-push/index.ts:17-18`** (worktree) documents the same gap
  awareness one level up: "Counts mode = the same filtered definition that
  feeds badge + Today hero (no scan opens, no autoreplies, 72h cutoff)" — that
  72h cutoff line is describing the `urgencies` post-filter only; the push
  body's `approvals` count (`comments`+`dms`+`feed`) inherits the **unwindowed**
  `dm_drafts`/`comment_drafts` counts verbatim.

### (c) The row's own state — verdict per §2 above
- 3 of 4 DM drafts (Vuk, Prakhar, Joachim) = genuinely still open, unaddressed
  for 13-16 days — a real backlog fact, not a query bug.
- 1 of 4 (David Card) = a stale **orphan**: the thread moved on (a later
  message was actually sent), but nothing in the send path retires the
  earlier unsent draft row once superseded.
- All 6 comment drafts are similarly unaddressed-but-real (spot-checked the
  oldest); no evidence of supersession found in the one row inspected.

**Named root cause**: (b) is the primary and structural cause — the
`dm_drafts` and `comment_drafts` queries in `get-morning-brief/index.ts` carry
no freshness window and no supersession check, unlike the `urgencies` and
`feed_drafts` blocks in the same file which already do. (c) compounds it for
David Card specifically (an orphaned/superseded row with no retirement path).
(a) the client cache is not implicated — it's a faithful mirror of an
unwindowed server payload.

## 4. Every zone's selection logic, one line each

- **Urgent (`urgencies`)** — reply-waiting computed from message log + `approve`
  (hypertarget) rows; **windowed** (72h `AGE_CUTOFF`, index.ts:434) and
  autoreply-demoted; could still surface stale items only via the ~14-day
  inbound-reply lookback window (index.ts:336) before the 72h filter trims it.
- **Approve → DM drafts** — `outreach_messages` outbound/unsent/unblocked,
  `limit(50)`, **no window, no supersession check** — will surface any
  never-cleared draft indefinitely, including ones superseded by a later send.
- **Approve → Comment drafts** — `commenting_log status='draft'`, `limit(50)`,
  **no window** — same exposure (35d oldest observed).
- **Approve → Feed drafts** — `comment_feed`, **3-day window** (`feedSince`,
  index.ts:104) — structurally can't show anything older than 3 days.
- **Today (`scheduled_posts`)** — hard `[startOfToday, startOfTomorrow)` range
  — cannot surface stale items by construction.
- **Campaign health strip** — KPI rollups (`fetchAccept/Pipeline/Governor`,
  client-side `lib/kpis.ts`) and `outreach_health.linkedin` scalars from the
  edge fn — these are point-in-time counts, not item lists, so "staleness"
  doesn't apply the same way; not investigated further here.
- **Content calendar / outreach queue** — rolling windows / stage filters, not
  rendered on Today's visible zones (Today only reads `outreach_queue.total`
  and `postsToday`/`nextUp` derived from the calendar) — out of scope for the
  visible staleness complaint.

## 5. Old dashboard comparison — `personal-site/components/dashboard-v2/sections/Today.tsx`

This screen has **no freshness logic of its own** — it's presentational; the
windows live in `lib/useCockpitData.ts`. Checked every feed query there
(lines 84-99, `countWithItems(...)` calls):

- `carousel_drafts status='review'` (both client_id null and not-null lanes) —
  `.order('updated_at' desc)`, **no window**.
- `comment_feed status='pending'` — `.order('created_at' desc)`, **no window**.
- `followup_drafts status='pending_approval'` — `.order('created_at' desc)`,
  **no window**.
- `dashboard_workflow_stats last_execution_status='error'` — `.order('updated_at'
  desc)`, **no window** (this one arguably shouldn't have one — errors stay
  relevant until fixed).
- `carousel_drafts status='scheduled'` — **the only one with a window**:
  `.gte('scheduled_at', localDayStart).lte('scheduled_at', localDayEnd)`
  (today-only, exact mechanism as `get-morning-brief`'s `today_content`).
- `usePulse` (drift alarms) — status derived as `quiet`/`frozen` per source,
  which *is* an implicit freshness signal, but it's a system-health probe, not
  an item-level "how old is this approval" signal.

**Summary of the old dashboard's rule**: exactly the same gap as the new
Today screen — every "needs you" queue is a bare status filter + `order by
desc + limit`, no age cutoff, no staleness caption at all (it doesn't even
show "oldest N ago" the way the new Today screen does). The only genuinely
freshness-aware pattern anywhere in either codebase is a same-day scheduling
window (`scheduled_posts`/`carousel_drafts status=scheduled`) and the new
Today screen's 72h `urgencies` cutoff — neither of which was ever extended to
the approval-drafts queues.

## 6. Recommended fix (minimal, per root cause)

**T2 edge-fn query change (smallest diff, fixes the structural cause) —**
`get-morning-brief/index.ts` (ivan-listener repo):

1. **Supersession check for `dm_drafts` (fixes the David Card class).** After
   building `dmDrafts` (line 154-167), drop any row whose `prospect_id` has a
   *later* outbound message with `sent_at IS NOT NULL`. Concretely: fetch
   `outreach_messages.select('prospect_id, sent_at').eq('direction','outbound').not('sent_at','is',null).in('prospect_id', dmIds)`,
   take the max `sent_at` per prospect, and filter
   `dmRows.filter(r => !(maxSentByProspect.get(r.prospect_id) > r.created_at))`.
   This is a few extra lines, one extra indexed query, no schema change.
2. **Age surfacing, not silent exclusion, for the genuinely-old rows (Vuk/
   Prakhar/Joachim class).** Don't drop these — Ivan still owes them a reply —
   but stamp an explicit `is_aging: true` (e.g. `created_at` older than a
   7-day threshold, matching the "aging" vocabulary already used for
   `urgencies`) on both `dm_drafts` and `comment_drafts` rows, and add
   `dm_aging_count` / `comment_aging_count` scalars the same way
   `aging_count` already exists for urgencies (index.ts:434-439). This gives
   the UI something to visually separate "2-day-old, worth a glance" from
   "16-day-old, needs a decision" without ever hiding a real backlog item.
3. Do **not** add a hard exclusion window to `dm_drafts`/`comment_drafts` the
   way `feed_drafts` has one (3d) — unlike feed comments, these are one-off
   manual reply decisions Ivan still needs to make; hiding them would recreate
   the exact "urgencies hid the report-open noise" tradeoff the 2026-07-25
   redesign comment (index.ts:283-294) already reasoned through in the
   opposite direction. Surfacing age honestly, not excluding, is the correct
   fix for this zone.

**Client-side companion (small, `src/screens/TodayScreen.tsx`) —**
4. `ZoneApprove` (`TodayScreen.tsx:248-311`): once `is_aging` exists, sort
   `dms`/`comments` oldest-first (or at minimum stop previewing `dms[0]` by
   `created_at desc` — line 262/277) so the preview line shows the row that
   actually needs attention, and render an "aging" tag on rows past the
   threshold the same way `ZoneUrgent` already renders the `aging_count`
   banner (`TodayScreen.tsx:183-185`).

No client-cache change is needed (§3a) — `today.ts` already caches whatever
the server sends faithfully; fixing the server payload fixes what gets cached.
