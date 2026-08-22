# p4c: Today as a work queue, the DM row's own draft, next-call card

Branch `polish/p4c`, worktree `/Users/ivanmanfredi/Desktop/ivan-inbox-pw-c`. Files: `src/screens/TodayScreen.tsx`,
`src/screens/InboxScreen.tsx`, `src/exp/v2c/Shell.tsx`, `src/exp/v2c/BulkBar.tsx`, `src/exp/v2c/commandSource.ts`,
`src/exp/v2c/commandStore.ts`, `src/exp/v2c/commandLayer.test.tsx`, `src/lib/inbox.ts`, `src/lib/workQueue.ts` (new),
`src/lib/workQueue.test.ts` (new), `src/lib/nextCall.ts` (new), `src/lib/nextCall.test.ts` (new).

## Item A: Today as a work queue

### The ranking rule, and why

Severity tier first, oldest-first inside a tier:

| Tier | What | Why here |
|---|---|---|
| 0 | A real reply, never opened in this app | The sharpest neglect measured: 36 of 58 unanswered threads were never opened at all, not merely unanswered. An opened thread was at least seen; a never-opened one means the app has never once put the message in front of him. |
| 1 | A real reply, opened but still unanswered | Still a person waiting, but seen at least once. |
| 2 | A time-sensitive ops draft (escalation, newsjack) | Dead on arrival by the nature of the thing past a few days. |
| 3 | Any other rotting ops draft (comment, weekly report, booking) | Still work, less time-critical. |
| 4 | Content review/error pile, one card per lane | A structural backlog (95 review + 55 error rows), not a single person waiting. |
| 5 | Staged client-idea pile, one card per lane | Furthest from being actionable content (176 rows, earliest stage). |

Ties inside a tier break oldest-first. This is the "plain age sort within severity tiers" the brief
explicitly allows, and it is defensible because severity here is not a vibe: tier 0 is a strictly
worse failure than tier 1 (nobody has even looked vs. somebody looked and didn't act), and tiers 2-5
follow the real cost of leaving each object type untouched (a missed escalation vs. an idea that
just waits one more day).

### Never-opened is unmissable

A dedicated red callout above the list (`8 people wrote and were never opened here`, live count) plus a
per-row `● NEVER OPENED` badge in `SEV.stale` red, the same red the rest of Today already uses for
urgent state (Masthead's urgent segment, HealthStrip's bad counters). No new color vocabulary.

### It crosses lanes

`Shell.tsx` mounts `useInbox()` and `useOps()` unconditionally (both already existed at the Shell
level for every job, not just DMs/Ops), so `inbox.threads` and `ops.drafts` carry every lane's rows
already. The work queue reads those directly, plus two new minimal reads (`lib/workQueue.ts`,
`fetchContentReviewPile`/`fetchContentErrorPile`/`fetchStagedIdeaPile`) that select
`client_id, created_at, title` from `carousel_drafts` (status `review`/`error`) and `client_ideas`
(status `staged`) and group by lane client-side. All three are far under PostgREST's 1000-row clamp
(max 176 rows measured), so no Range paging was needed. Live run showed a 26-item queue mixing ivan,
risedtc and arch rows in one ranked list, something no existing screen has ever done (confirmed:
`content.ts:103`'s lane filter means Content/Magnets/Styles never show two lanes at once, and Today's
brief never carried content/idea rows at all).

### The action comes with the item

- **Reply row** (tier 0/1): click opens the exact thread via `onOpenThread(prospect_id)`, the same
  peer-opening call Shell already uses for every other thread-open in the app. This is the real
  action surface for a DM under Item 5's own ruling (approve still costs the open, on purpose), so
  routing there is not a shortfall, it is the correct destination.
- **Ops row** (tier 2/3): opens the Ops job. No per-row focus mechanism exists into OpsBoard from
  outside it, and OpsBoard/OpsGroups belong to another item in this run, so this is job-level routing,
  not row-level. Documented as a known limitation below.
- **Content/idea pile card** (tier 4/5): opens Content **pre-filtered to its lane**. `Shell.tsx` owns
  the `lane`/`setLane` state `ContentList` reads as a prop, so the new `onOpenContent` callback calls
  `setLane(lane)` then `goJob('content')` together, a genuine pre-filter, not just a job switch. Tab/
  stage-level filtering inside Content was left alone (`ContentList.tsx`, `content.ts` are other
  items' files).

### Interaction counts, before and after (three item types)

| Item type | Before | After |
|---|---|---|
| Never-opened reply | Not visible anywhere on Today; discoverable only by opening DMs, filtering, and scrolling to find it manually (no screen ranks by wait time at all, confirmed by the evidence). Effectively unbounded. | 1 click: appears pre-ranked at the top of the queue; click opens the exact thread. |
| Rotting ops draft (escalation/newsjack) | Invisible on Today; requires remembering to check the separate Ops job, then scanning for old rows (2+ steps, and only if you think to look). | Surfaced automatically on the screen he opens every morning, ranked by severity; 1 click opens Ops. Discovery cost drops to zero; the approve/discard control itself is unchanged (owned by another item). |
| Client content review pile | Invisible on Today; reaching a single row required switching to Content **and** switching lane (2 separate interactions) before anything was visible. | Visible on Today with live count and oldest age; 1 click both switches the job and pre-filters the lane (2 interactions collapsed into 1). |

### Known limitation, stated honestly

Ops items route to the Ops job, not a specific row, because no cross-job row-focus mechanism exists
and building one would mean editing `OpsBoard.tsx`/`OpsGroups`, which belong to another item in this
run. If that changes, Item 4's `openId: null` convention for ops rows (see `lib/workQueue.ts`) is
where a future per-row focus would plug in.

## Item B: the DM row shows its draft

- `InboxScreen.tsx`'s default row now shows the pending draft's own text (not just the `DRAFT` pill)
  whenever a draft exists and is not snoozed, gated on `status !== undefined` (the same opt-in signal
  the existing draft banner already used, so `#exp/stock`, which never passes `status`, is unaffected).
- An inline **Discard** button (reused `.pushbtn`, zero new CSS) sits beside the pill, behind the same
  confirm sheet `ThreadScreen.tsx`'s discard already uses (`Discard this draft? It will not be sent.`).
- **Interaction count**: discard was 3 (open thread, find card, discard) → now 2 from the row
  (Discard, confirm), or 1 per item in a bulk run.
- **Bulk discard** added as a new `RowCap` (`'discard'`), wired through `commandStore.ts`,
  `RowSelect`/`InboxScreen.tsx` (draft rows register with `id = draft.id`, `caps=['discard']`),
  `BulkBar.tsx` (confirm + run + button), and `commandSource.ts` (palette entry, Act group, no key).
  Conversations without a pending draft still get `caps=[]`, unchanged, so "a conversation is
  answered one at a time" still holds for everything that isn't a safe discard.
- **Approve was NOT moved to the row**, on purpose. Approving a DM sends a real message; the trip
  into the thread is what puts the draft in front of him before it sends. This is stated as a
  deliberate non-change, not an oversight.
- **The dead swipe surface was not revived.** `Shell.tsx:150` (`const [status] = useState<Status>('needs')`)
  has no setter anywhere in the codebase, so `DmsSurface.tsx`'s `status === 'approve'` branch
  (`DraftCard`, its swipe gestures, its Later control) is unreachable. Confirmed still true after
  this run's changes. Not revived, per the brief: more machinery than the one interaction it saves,
  and Item 5 recovers that same interaction (draft preview + discard) with far less of it.

## Item added mid-run: next-call card (dashboard-port-audit.md port #1)

`lib/nextCall.ts` reads `calendar_events` (never read by this app before) for the next 7 days,
non-all-day, limit 20, matching `personal-site/hooks/useUpcomingEvents.ts`'s own query shape.
Read-only reference only; `personal-site` was never built, edited or deployed from this worktree.

Rendered as a new zone "B" on Today, gated the same way as the work queue (`threads !== undefined`).

Two bugs in the source were deliberately **not** carried across:

1. **`is_test` bookings.** The webhook flags them; the old UI never filters them, so a test booking
   can occupy the hero. Fixed here, and fixed **client-side** (`is_test !== true`), not with
   `.eq('is_test', false)` server-side, because that would drop every row where `is_test` is NULL,
   which is every non-Calendly (e.g. Google Calendar) row. Unit-tested (`nextCall.test.ts`,
   `isRealBooking` describe block) specifically for the NULL-keeps-true case.
2. **Meeting-type chips.** The source does `stored || resolveMeetingTypeFromTitle(title)`, and
   `stored` is Calendly's free-text event name ("30 Minute Meeting"), not one of the five real enum
   keys, so the old UI renders a "?" chip on every Calendly booking. Here, `stored` is validated
   against the real key set first; an unresolvable value falls back to title classification, and if
   that also fails, **no chip renders at all** rather than a fabricated "Unknown" badge.

Attribution (`source`, e.g. "via linkedin") is shown when present, a free field the old dashboard's
own UI never rendered despite Calendly writing it on every booking. `referral_token`/`utm_*` were
left out as not cheap enough to be worth a line each.

Empty state matches the exact wording measured live on the old dashboard ("No calls on the calendar
this week / Upcoming calls surface here as they land in calendar_events"), and is distinguished from
the loading state (`Loading the calendar…`) so a genuine zero never reads as a stall. Live run on
2026-08-22 showed the empty state (his calendar was in fact clear for 7 days), so the honest-empty
path is what actually ran end to end, not a code path assumed but never exercised.

## Numbering, and the stock-safety mistake caught and fixed mid-run

The four original zones (`New today`, `Carried over`, `Schedule`, `Campaign health`) keep their
original `01`-`04` labels **unconditionally**, because they render in `#exp/stock` too and any
change to those literal strings would be a pixel change to a shell this run must leave untouched.
An earlier pass in this run renumbered them to `02`-`05` to make room for the new zones ahead of
them; a structural stock probe caught it (`#exp/stock`'s Today tab showing `02,03,04,05` instead of
`01,02,03,04`) before it shipped, and it was reverted. The two new zones are lettered **A** (Work
queue) and **B** (Next call) instead, so they can never collide with the original sequence and never
require touching it.

## Stock proof

Two independent proofs, not one:

1. **Structural DOM signature, before vs. after, on the exact commit boundary.** A throwaway git
   worktree was built from `3b98100` (the `wb/polish` tip immediately before this run's merge, i.e.
   the real "before" other agents' work already established) and served on a separate port. Probed
   `#exp/stock`'s Inbox tab and Today tab on both builds:
   - Inbox tab: **2491 DOM nodes**, identical tag-count breakdown, on both builds.
   - Today tab: **384 DOM nodes**, identical `.td-zone` ids (`td-z1..td-z4`) and identical `.td-zn`
     labels (`01,02,03,04`), on both builds.
   - `button.pushbtn` count: **0** on both (the new Discard button never renders in stock).
   - `#td-z0`/`#td-z-call` (work queue / next-call zone ids): **absent** on both.
2. **Screenshots**: `p4c-stock-inbox-BEFORE-1440.jpg` / `p4c-stock-inbox-AFTER-1440.jpg` and
   `p4c-stock-today-BEFORE-1440.jpg` / `p4c-stock-today-AFTER-1440.jpg`, captured against the same
   before/after commit boundary. Page `innerHTML` length matched exactly (120440 chars) on the
   direct A/B pair built from the same session.

Also confirmed via `commandLayer.test.tsx`'s existing "no bare-key write actions" test, updated
(not weakened) for the new `discard` cap and still green: no key runs `discard`, same as every
other Act command.

## Verify

- `npm run build`: clean, both before and after the `wb/polish` merge.
- `npm test`: baseline established fresh on this worktree at **906 passing**, one known
  pre-existing failure (`calendarItems.test.ts`, "passing no queue is the old behaviour exactly",
  `stage: 'stuck'` vs `'scheduled'`, unrelated to this run). After `wb/polish` merged in, baseline
  moved to **934** (per the coordinator's note); after this run's own changes, **960 passing**, same
  single pre-existing failure, at the same test.
- Playwright from `/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs`, served
  from `npx vite preview --port 4183` in this worktree, auth injected via `.session.json` into
  `sb-bjbvqvzbzczjbatgmccb-auth-token`.
- **Write interceptor installed before every navigation**, on `**/rest/v1/**`, blocking
  PATCH/DELETE/PUT and **all POST including `/rest/v1/rpc/**`** (RPC calls are POSTs the naive
  chip-probe.mjs pattern lets through; this run's interceptor does not).
- **Attempted-write count: 2**, both `POST /rest/v1/rpc/inbox_governor`. This is a **pre-existing**
  call (`lib/kpis.ts:75`, `fetchGovernor()`), fired by Today's existing Health strip
  (`useToday`'s `healthRun`) on every Today load, unmodified by this run and unrelated to items 4/5.
  Confirmed pre-existing by probing `#exp/stock`'s Inbox tab alone (which never mounts Today): **0**
  blocked calls there in both the before and after builds. `inbox_governor` is called with no
  arguments and returns aggregate rows for the Governor stat tile; PostgREST issues every RPC call
  as POST regardless of whether the underlying function reads or writes, which is exactly why the
  brief calls out RPC POSTs by name as a trap the naive interceptor misses. Nothing this run added
  makes any RPC or write call; the two new content/idea pile reads and the calendar_events read are
  all plain `.select()` GETs, confirmed in the same capture (no additional blocked calls appeared
  when Today, DMs or the never-opened/discard flows were exercised).

## Screenshots

`goal-runs/workbench-polish-2026-08-22-out/after/`:
`p4c-today-1440.jpg`, `p4c-today-390.jpg`, `p4c-dms-1440.jpg`, `p4c-dms-390.jpg`,
`p4c-nextcall-1440.jpg`, `p4c-stock-inbox-1440.jpg`,
`p4c-stock-inbox-BEFORE-1440.jpg` / `p4c-stock-inbox-AFTER-1440.jpg`,
`p4c-stock-today-BEFORE-1440.jpg` / `p4c-stock-today-AFTER-1440.jpg`.

## Coordination notes

- Merged `wb/polish` into `polish/p4c` mid-run (label purge + calendar rail + scheduling), no
  conflicts; `TodayScreen.tsx`'s only incoming change was `KIND`'s fallback switching to the shared
  `label()` helper, upstream of every edit in this run.
- Did not build a second global pending-count primitive. `polish/glance`'s rail-level roll-up was not
  yet merged into `wb/polish` at the time of this run; Item A's `right={items.length...}` text is
  local to its own zone header, not a rail badge, so there is nothing to reconcile yet.
- Zero em dashes in every line this run added or edited (comments and UI strings both); pre-existing
  em dashes elsewhere in these shared files were left untouched as out of scope.
