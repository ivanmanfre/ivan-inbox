# Phase 4 - the improvements he asked for, ranked from measured usage

Ivan asked twice for UI and UX that makes him faster and got readability mechanics. This phase is the answer, and none of it is invented: every item below is scored against `evidence/usage-evidence.md`, which read 31 days of his real rows through his own session, GET only, zero writes attempted.

Read that file for the queries. This file is the ranking, the build list, and the rejections.

## The five findings that decide everything

1. **95 content drafts sit in review, 89 with no date. The next 14 days hold 3 armed posts.** The review queue is roughly thirty times the queue it feeds, and the two live on different screens.
2. **93 of those 95 review rows are on client lanes, where the app refuses to act on them.** `reviewActionable()` at `src/lib/content.ts:1435` is `(status === 'review' || status === 'error') && lane === 'ivan'`. On a client lane the only bulk capability a review row is given is **delete**. The single destructive action is the one that scales.
3. **The error pile is mostly mis-labelled finished work.** 55 rows at `status='error'`; 34 print "Generation stuck, no completion within N minutes" and only **6** actually stalled. On 28 rows the pipeline kept working after the sentinel fired, for a median of 76 more minutes. **44 of the 55 still hold a post body.**
4. **58 conversations are waiting on a reply, median 22.9 days, and 36 of them were never opened in this app.** No screen ranks anything by how long a person has been waiting.
5. **Search is four unlinked boxes.** Content search indexes `title` and `topic` and not `post_body`. The command palette can only offer rows currently in the DOM, and the DM list is windowed to roughly 12 to 25 of 139 threads.

## The one I verified myself, because it decides the top of the ranking

`src/lib/calendarItems.ts:421`

```ts
export function buildCalendarRail(rows: ContentDraft[]): CalendarRail[] {
  return rows
    .filter(d => d.status === 'approved' && !d.scheduled_at)
```

Twenty-five lines below it, in the same file:

```ts
export function canMoveDate(d: Pick<ContentDraft, 'status'>): boolean {
  return d.status === 'review' || d.status === 'scheduled'
}
```

The rail that exists to hold undated posts filters on `approved`. The database function it feeds refuses `approved`, and `canMoveDate`'s own doc comment records the census: **"Nothing on either lane sits at that status today (live census 2026-08-07: 0 rows, both lanes)."**

So the rail is filtered to a status with zero rows, by construction, and always renders *"Nothing approved is sitting without a date."* Meanwhile the 89 undated review drafts, which are exactly the rows `operator_set_schedule_date` accepts, are excluded from the one surface built to give them dates. The calendar shows an empty month beside an empty rail while 89 datable drafts sit on a different tab.

Dating a review row is safe and is not arming: the RPC writes `scheduled_at` and nothing else, and a `review` row with a date does not publish. That distinction has to be visible on the chip, which is Phase 3's job, and it is a real trap: a dated review row currently reads as "covered" on any view that plots `scheduled_at` without reading `status`.

## The ranking

Score is work removed over risk plus effort. Work removed is in interactions measured in Step 3 of the evidence, never in adjectives.

| # | Item | Work removed | Risk | Verdict |
|---|---|---|---|---|
| 1 | Calendar rail shows what the date RPC actually accepts | 89 invisible drafts become draggable. Arming path drops from 5 interactions plus a takeover to one drag plus one confirm | Very low. One filter, and it moves toward the database's own rule | **BUILD** |
| 2 | Error cards state the real cause and offer retry in place | 28 wrong reasons corrected, 44 recoverable bodies surfaced. Retry drops from 3-4 interactions and a takeover to 1 plus a confirm | Low. Read-side derivation, no schema change | **BUILD** |
| 3 | Client review rows get the promote capability, singly and in bulk | Clearing the pile drops from 372 interactions and 93 takeovers to about 95 | Low-medium. Existing RPC, batched. Confirm names the client and the count | **BUILD** |
| 4 | Today becomes a work queue ranked by who has waited longest | 58 waiting threads and 62 rotting ops drafts get a surface. 36 never-opened replies stop being invisible | Medium effort, low risk. Read-only ranking over data already fetched | **BUILD** |
| 5 | The DM row shows its draft, and discards from the row | Saves 1 interaction on 102 discards, 2 on the 46 that happen in runs | Low. Discard is reversible and sends nothing | **BUILD** |
| 6 | Search that crosses objects, on one key | 6-plus interactions and 2 refetches drop to 1 | Medium. Server-side ilike over existing tables, no new dependency | **BUILD** |
| 7 | Undo extended to the content actions that are safe | Removes the fear tax on bulk promote and on date moves | Low, and strictly bounded, see below | **BUILD** |

### What is explicitly not built, and why

- **Bulk approve for DM drafts.** Approving a DM is sending it to a real person. The codebase already refuses this deliberately, with a sentence at `BulkBar.tsx:171`. 45% of discards happen in runs but only 27% of approves do, so the measured demand is on the safe half anyway. Bulk discard ships; bulk approve does not, and no amount of interaction-saving changes that.
- **Approve a DM from the list row.** It would save an interaction on 101 events, and it would let him send a message he has not read. The trip into the thread is what puts the draft in front of him. The row gets the draft *preview* and the discard, and approve keeps costing the open.
- **Undo on send or approve.** Permanently dead and not revisited. The dispatcher claims on `sent_at IS NULL` without re-checking `approved_at`, so a client-side undo fails open and the message goes out anyway.
- **De-duplicate regeneration.** The hypothesis was that he regenerates the same material. Across 465 drafts there are 460 distinct titles; 3 titles repeat across 8 rows, 1.1% of the table, and two of those three are a retry that eventually worked. The problem does not exist. Reported so a later run does not chase it.
- **Anything built for stale-draft expiry.** 81 rows carry `stale_draft_expired_10d`, which reads as an ongoing loss of 2.6 drafts a day. All 81 share one `send_blocked_at` instant on 2026-07-23 and all 81 were created in April. It was a single historical sweep.
- **Optimistic state everywhere.** Rejected as a blanket policy. An optimistic UI that lies about a write which then failed is worse on this app than a 400ms wait, because the failure path here is a client board and a publish queue. Optimism is applied only where the failure is visible and reversible in the same view.
- **Reviving the swipe DraftCard.** `Shell.tsx:146` declares `const [status] = useState<Status>('needs')` with no setter anywhere in the codebase, so the swipe-and-approve card, its gestures and its Later control are unreachable in this shell. That is real dead code and it is reported, but reviving a gesture surface is a bigger change than the one interaction it saves. Item 5 gets the same interaction back with less machinery. The dead branch is named in the report for Ivan to kill or keep.

## Build notes that bind the implementers

- **Item 3 makes drafts visible on a client's board.** It is not prospect-facing, but it is client-facing, so the bulk confirm must name the client and the exact count, and there is no silent path. Single-row promote already exists and is unchanged.
- **Item 1 must not let a planned date read as an armed one.** A `review` row with a `scheduled_at` is planned, not armed, and Phase 3 owns making that legible on the chip. If Phase 3 has not landed that encoding, item 1 ships behind it, not before it.
- **Item 4 touches `TodayScreen` and `InboxScreen`, which render in `#exp/stock` too.** Eleven components are shared between the two shells. Every change there is scoped under `.wb` or gated on a prop, and the escape hatch is proven pixel-identical afterwards with the same-window method.
- **Item 6 adds queries, not dependencies.** PostgREST `ilike` over tables already reachable. The 1000-row select clamp applies, `not.eq` drops NULLs, and an `in()` filter dies near 16KB of URL.
- **Item 7's undo is bounded to discard, board promote and date moves.** Each already has an inverse in the data layer. Nothing that sends gets an undo.
- No new runtime dependency. The app has three and keeps three. No n8n. No migration applied; a migration file may ship unapplied.
