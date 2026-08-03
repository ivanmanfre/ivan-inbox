# PHASE 1 — the Inbox cut, as a DATA question first

Ivan, twice: *"the inbox section u can remove it i see no purpose on it having dms and sends"*.

The spec's own condition: **if DMs already renders the Inbox's rows, deleting Inbox is pure
subtraction. If it does not, they move into DMs FIRST.** So the first thing this phase did was
count, not cut.

## The census (live, 2026-08-03 11:17Z — `phase1-census.json`)

Probed through the SHIPPED functions (`groupThreads`, `inboxBreakdown`, `filterThreads`,
`pendingDmLaneOps`) via vitest, not a reimplementation — a reimplementation would only prove the
census agrees with itself. Source: `_p1-census.spec.ts`.

```
inbox_messages_v ............ 2,243 rows  ->  1,419 threads
outreach_prospects flagged ..    44 (needs_manual_reply = true)
ops_drafts ..................    17 rows, 2 pending, 0 in the DM lane

INBOX surface renders ....... 135 conversation rows
DMs surface renders TODAY ...   0 rows          <-- the whole finding
```

## Verdict: NOT pure subtraction

`DraftsScreen` (the rail's "DMs") renders exactly `threads.filter(t => t.draft !== null)`
(`src/screens/DraftsScreen.tsx:244`) plus the DM-lane Ops pointer. With zero pending drafts in the
system right now, **the DMs lane is an empty screen**, and every one of the 135 conversations —
including the 70 that are waiting on Ivan — is reachable *only* through the Inbox job.

Deleting Inbox as-is would have traded a redundant tab for a blind spot, which the spec forbids by
name. A starved lane looks identical to a dead one: DMs looked like a working surface because it
was empty, and it was empty because it only ever held one of the four buckets.

## Mapping table — kind → where it lands after the cut

| bucket (non-overlapping, `inboxBreakdown`) | live n | held by Inbox before | lands after the cut | verified visible |
|---|---|---|---|---|
| **To answer** — unread inbound, no newer send | 28 | ✅ only there | DMs · status `To answer` (default view) | live probe, phase 1 §verify |
| **Draft ready** — a pending AI draft to approve | 0 | ✅ only there | DMs · status `Draft ready`, rendered as approve/discard **DraftCards** (the affordance DraftsScreen owned) | live probe + unit test (`dms.test.ts`) |
| **Flagged: needs your reply** — `needs_manual_reply`, the reply-blindspot class | 42 | ✅ only there | DMs · status `Flagged` | live probe |
| **Waiting on them** — conversation, ball in their court | 65 | ✅ only there | DMs · status `Waiting on them` | live probe |
| **Ops DM-lane pending** (`pendingDmLaneOps`) | 0 | ❌ DMs held it | DMs, unchanged — the "approved in Ops, not here" pointer strip | code path preserved |
| **Send echoes** — outbound-only, no reply (1,284 threads) | 1,284 | ❌ never shown | Sends, unchanged (`isConversation` already excludes them) | unchanged |

**Orphaned kinds after the cut: none.** Every row the Inbox surface could render has a named home
on the DMs surface, and the two things DMs already owned (draft approval, the Ops pointer) survive.

Bucket arithmetic, which must keep adding up (spec: *a re-rank is not a filter*):

```
28 answer + 0 approve + 42 flagged = 70  = the badge
70 + 65 waiting on them            = 135 = every row the surface renders
135 + 1,284 send echoes            = 1,419 threads in the view
```

(Ivan saw 28 + 1 + 42 = 71 an hour earlier; the single draft was approved or discarded since, so
the badge is 70 now. Same arithmetic, one row moved.)

## What was built

**DMs absorbs the conversation list.** It is now the one place a person waiting on Ivan can appear:

- the four buckets became a **status filter** — the `InboxHead` stacked bar Ivan already had is now
  the control, so the bar and the filter cannot disagree (both derive from `threadBucket`);
- the lane chips (All / Ivan / Rise / Email) are unchanged and compose with status;
- the `Draft ready` status renders the **DraftCard** (swipe-right approve, swipe-left discard,
  the stale-draft bar and the bulk "Discard stale") lifted out of `DraftsScreen`, so the approval
  affordance is not lost with the job;
- the Ops DM-lane pointer strip is unchanged.

**Inbox is gone** from the rail, the mobile tab bar, `JOBS`, and the badge math. The job id
`drafts` was renamed `dms` so the URL says what the surface is, and `route.ts` carries an
**alias map** — `#exp/v2/inbox` and `#exp/v2/drafts` both resolve to `dms` rather than 404 or
silently falling back.

## Rollback

`git revert` the phase-1 commit. `#exp/stock` is untouched: `InboxScreen` gained only optional
props (`title`, `status`, `setStatus`, `before`) and `DraftsScreen` still exists and still renders
for the stock shell.
