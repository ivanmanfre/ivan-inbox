# Usage evidence — what Ivan actually does in this app

Branch `wb/polish`. Window **2026-07-23 00:00Z to 2026-08-23 00:00Z** (31 days), "now" pinned at
2026-08-22 12:00Z for every age calculation so the numbers reproduce.

Every query in this file is a GET. Attempted writes against the database: **0**.
Scripts live beside this file in `evidence/usage-tools/`; `pg.py` is the shared read-only
PostgREST client and honours the 1000-row clamp by paging with `Range` headers and confirming
totals with `Prefer: count=exact`.

---

## STEP 1 — the schema, and what each table records

The OpenAPI endpoint is closed to the anon key (`{"message":"Invalid API key","hint":"Only the
service_role API key can be used for this endpoint."}`), so the schema was discovered by
`select=*&limit=1` per table and cross-checked against the app's own data layer.

Tables this app touches, by number of call sites (`grep -rho "\.from('[a-z_]*'" src/`):

| table | sites | what it is |
|---|---|---|
| `carousel_drafts` | 29 | every content draft, all lanes, all formats. The main object. |
| `outreach_messages` | 11 | every DM/InMail/email, inbound and outbound, drafts and sends |
| `inbox_messages_v` | 8 | the read view over `outreach_messages` joined to the prospect |
| `lm_idea_candidates` | 7 | the idea supply for Ivan's own lane |
| `outreach_prospects` | 4 | the people |
| `ops_drafts` | 4 | comment/newsjack/report drafts awaiting a human |
| `scheduled_posts` | 3 | the armed publish queue |
| `client_ideas` | 3 | the idea supply for client lanes |
| `scans`, `comment_feed`, `client_strategy`, `content_prompts`, `push_subscriptions`, `integration_config`, `outreach_campaigns` | 1-2 each | supporting |

Nine jobs in the rail (`src/exp/v2c/layout.ts:22`): `today, dms, content, magnets, styles,
strategy, sends, ops, settings`.

**State vocabularies that matter for the rest of this file**

- `carousel_drafts.status`, bucketed at `src/lib/content.ts:159` into
  `review | error | stuckScheduled | approvedUnscheduled | generating | scheduled | published | archived | unknown`.
- Lane scoping is a **query-layer filter**, `src/lib/content.ts:103`: Ivan is `client_id IS NULL`,
  never the literal `'ivan'`. A lane switch is a refetch, and **one lane cannot see another lane's rows**.
- A DM draft is pending iff `direction='outbound' AND sent_at IS NULL AND approved_at IS NULL AND
  send_blocked_reason IS NULL` (`src/lib/inbox.ts`, and the dispatcher's pickup predicate is
  `approved_at IS NOT NULL AND sent_at IS NULL`, `docs/send-path-verification.md`).
- `src/exp/v2c/stage.ts` maps 24 prospect `stage` strings onto a 4-step ladder
  `Invited → Connected → Messaged → Replied`; unknown stages return `null` on purpose.
- `src/exp/v2c/freshness.ts` is a feed-liveness tier (`live/quiet/stalled/never`), not a work state.
- `src/exp/v2c/rubric.ts` parses the QA judge's nine dimensions **out of prose**, because no
  structured field carries them.

---

## STEP 2 — 30 days of real usage

### 2.1 Volume by object

`usage-tools/s2_volume.py` — every figure is a `Prefer: count=exact` header read, not a
`len(rows)`.

| table | all time | created in window | updated in window | rate |
|---|---|---|---|---|
| `carousel_drafts` | 465 | 279 | 433 | 9.0 created/day |
| `outreach_messages` | 4,263 | 2,567 | — | 82.8 created/day |
| `lm_idea_candidates` | 2,286 | 812 | — | 26.2/day |
| `client_ideas` | 237 | 189 | — | 6.1/day |
| `ops_drafts` | 86 | 86 | — | 2.8/day |
| `scheduled_posts` | 185 | 41 | 41 | 1.3/day |
| `comment_feed` | 34 | 26 | — | 0.8/day |
| `outreach_prospects` | 11,844 | 5,984 | 7,101 | 193/day |
| `scans` | 256 | 131 | — | 4.2/day |

**Almost none of that is him.** Machine volume and human volume have to be separated before any
of it means anything, so the next section builds instruments that only a human click can write.

### 2.2 Human actions, isolated

`usage-tools/s2_human2.py`. Instruments, each tied to one mutation in the app's own data layer:

| instrument | write site | events in window | per day | active days |
|---|---|---|---|---|
| thread opens (distinct `read_at` instants) | `inbox.ts:855` `markThreadRead` | **215** | 6.9 | 28/31 |
| human DM approves (`approved_at`, lag > 120s after `created_at`) | `inbox.ts:632` `approveDraft` | **101** | 3.3 | 23/31 |
| DM discards (`send_blocked_reason='discarded_in_inbox'`) | `inbox.ts:764` `discardDraft` | **102** | 3.3 | 24/31 |
| content draft kills (single-row `updated_at` on rows now archived/disqualified) | `content.ts` | **179 single-row writes** | 5.8 | — |
| ops approves (`ops_drafts.approved_at`) | `lib/ops.ts` | **24** | 0.8 | 13/31 |
| client idea approves (`client_ideas.approved_at`) | `lib/content.ts` | **9** | 0.3 | 3/31 |
| comment approves (`comment_feed.approved_at`) | `lib/reactions.ts` | **3** | 0.1 | 3/31 |
| snoozes (`snoozed_at`) | `inbox.ts:687` | **2** | 0.1 | 1/31 |
| hand-typed replies (`message_type='manual_reply'`) | `inbox.ts:840` `composeReply` | **4 all time** | 0.1 | 4/31 |

**Two corrections that change the reading, both from reading rows rather than counting them:**

1. `outreach_messages.approved_at` shows **814** approvals in the window, which looks like 26
   human clicks a day. **713 of them land within 120 seconds of the row being created**, at
   timestamps like `2026-07-23T00:00:05.166Z` / `01:00:05.164Z` / `02:00:05.092Z` — that is the
   auto-sender cron, not Ivan. Real human approves: **101**. (`/tmp/dedupe.py` logic, folded into
   `s2_human2.py`.)
2. `ai_model IS NULL AND direction='outbound'` looks like 1,237 hand-written messages in the
   window. **932 of them are `connection_note`** written by the engine. The app's own hand-typed
   path stamps `message_type='manual_reply'` (`inbox.ts:843`), and there are **4 such rows in the
   entire table**. `composeReply` is effectively unused.

**Confidence.** High on the DM-side instruments: they are single columns written by exactly one
function in this codebase, and no other client writes them. Medium on content-draft kills: n8n also
writes `carousel_drafts.updated_at`, so single-row writes are *candidate* human actions, separated
from batch writes below.

### 2.3 The funnel, and where things pile up

`usage-tools/s2_piles.py`, `s2_aging.py`. Every queue in the app, sized and aged:

| queue | n | median age | oldest | source |
|---|---|---|---|---|
| **client ideas STAGED, never approved** | **176** | 13.9d | 33.5d | `client_ideas.status='staged'` |
| **content drafts in REVIEW** | **95** | 7.7d | 35.7d | `carousel_drafts.status='review'` |
| **lm idea candidates in REVIEWING** | **95** | 10.0d | 36.8d | `lm_idea_candidates.status='reviewing'` |
| content drafts in review with **no `scheduled_at`** | 89 | 7.6d | 35.7d | subset of the above |
| **ops drafts never approved, never sent** | **62** | 13.0d | 28.7d | `ops_drafts` |
| **content drafts in ERROR** | **55** | 12.1d | 35.0d | `carousel_drafts.status='error'` |
| comment feed EXPIRED unactioned | 13 | 31.0d | 36.5d | `comment_feed.status='expired'` |
| DM drafts pending approval | 8 | 23.6d | 35.6d | the inbox queue |
| comment feed PENDING | 3 | 11.0d | 19.0d | |
| stuck-scheduled content (`isStuckScheduled`) | **0** | — | — | `content.ts:186` |
| `scheduled_posts` past-due and never posted | **0** | — | — | |

`carousel_drafts` status distribution, all 465 rows after the operator-deleted filter
(`content.ts:319`):

| status | n | median age | max age | median days untouched | lanes |
|---|---|---|---|---|---|
| published | 145 | 68.8d | 82.9d | 13.1d | ivan 113, risedtc 24, arch 8 |
| **review** | **95** | 7.7d | 35.7d | 5.5d | **risedtc 54, arch 39, ivan 2** |
| disqualified | 90 | 32.0d | 82.9d | 21.7d | ivan 88, risedtc 2 |
| archived | 76 | 29.8d | 35.5d | 5.5d | risedtc 61, arch 12, ivan 3 |
| **error** | **55** | 12.1d | 35.0d | 8.2d | **ivan 48, risedtc 7** |
| scheduled | 3 | 6.6d | 17.1d | 3.1d | risedtc 2, ivan 1 |
| planned | 1 | 4.9d | 4.9d | 4.6d | risedtc 1 |

Review ages: **56 of 95 are older than 7 days, 27 older than 14 days, 4 older than 30 days.**

**THE BIGGEST PILE-UP, and it is a structural one.** 95 drafts sit in `review`. 89 of them have no
`scheduled_at`. The forward calendar over the next 14 days holds **3 armed items** (see 2.7). The
review queue is roughly **30x the size of the queue it feeds**, and the two are on different screens.

**Note the lane split.** 93 of the 95 review rows are `risedtc` + `arch`; 48 of the 55 error rows are
Ivan's. Because `laneFilter` scopes the fetch (`content.ts:103`), **no single screen in this app has
ever displayed both piles at once.** Whichever lane he is on, the other lane's backlog is invisible.

### 2.4 The errors — all 55 read, clustered by what actually happened

`usage-tools/s2_errors_final.py` and `s2_sentinel.py`. The prior run's REPORT.md records "46 of 46
Errors rows render a reason". There are **55** rows at `status='error'` today (48 Ivan + 7 risedtc);
the Errors tab is lane-scoped, so 46 was one lane at one moment. All 55 are `board_visible = false`.

Cause taken from the **last `agent_log` entry** (the terminal event), cross-checked against
`taxonomy.error_message` (what the card prints):

| cluster | n | lanes | rows still holding a `post_body` | median age | the fix it needs |
|---|---|---|---|---|---|
| **E1 QA score below floor** (`QA_BLOCKED`, regen budget spent, e.g. `REWRITE_OK 63/130`) | 13 | ivan 12, risedtc 1 | 13 | 14d | show the score and the failing dimension on the card; offer "regenerate with hint" |
| **E6 terminal event is `Lint Gate: PASS` yet status is `error`** | 13 | ivan 10, risedtc 3 | 4 | 6d | the row is mis-stated; reconcile status against the last log entry |
| **E3 lint fail twice** (`outcome: lint_fail` on both attempts) | 10 | ivan 9, risedtc 1 | 10 | 18d | print the lint rule that fired (`elliptical_contrast`, `ungrounded_generalisation`) |
| **E4 genuine watchdog stall** (Stuck Sentinel is the last entry, nothing after) | 6 | ivan 6 | 0 | 4d | a real retry action |
| **E2 generation never returned** (`outcome: generation_failed` on every attempt) | 6 | ivan 6 | 6 | 14d | retry; distinguish from E4 |
| **E7 other** (Lint Gate FAIL 4, QA Regen Loop 1, Editorial Agent 1) | 6 | mixed | 4 | — | as above |
| **E5 model quota refusal captured as content** | 1 | risedtc 1 | 1 | 4d | the hook literally reads `You've hit your weekly limit · resets Aug 21, 9am (UTC)` with `_parse_failed:true` — a 200-with-refusal wrote itself into the draft |

**The reason the card prints is the wrong reason on 28 of 55 rows.**

- 34 rows carry `taxonomy.error_message` beginning `Generation stuck — no completion within N minutes`.
- Only **6** of those had the Stuck Sentinel as their terminal event.
- **28** rows say "Generation stuck" while the pipeline went on to log more work after the sentinel
  fired — median **76 further minutes**, max **23,184 minutes (16 days)**, across
  `QA Regen Loop ×63, Lint Gate ×52, QA Give-Up ×15, Editorial Agent ×14, AI-Slop Gate ×5,
  Claim Check ×5, IG Caption Lint ×5, Forbidden Language Gate ×4, Hook Agent ×4, Image Generation ×1`.
- **21 rows carry no `taxonomy.error_message` at all**, and the card falls back.
- The claimed stall duration is not credible on its face: min 21 min, median 23 min, **max 20,205
  minutes = 14.0 days**.

Worked example, draft `2694b514` (`/tmp/e6.py` output):

```
12:00:07 Promoter        auto-promoted, firing generation
14:49:55 Editorial Agent stakes: LOW …
14:58:37 Lint Gate       VERDICT: PASS (first draft clean)
15:00:52 Stuck Sentinel  Generation stuck — no completion within 22 minutes.
15:37:36 Lint Gate       VERDICT: PASS (first draft clean)
16:10:42 Lint Gate       VERDICT: PASS (first draft clean)
16:48:26 Lint Gate       VERDICT: PASS (first draft clean)
```

The sentinel fires 22 minutes in, stamps `error`, and the pipeline runs for another 108 minutes and
passes lint three more times. The row is still `error` six days later.

**44 of the 55 errored rows still hold a non-empty `post_body`.** They are not empty failures; they
are finished-or-nearly-finished drafts filed under a wrong and unspecific reason.

**Confidence: high.** Every row was read individually, not counted; `agent_log` is an append-only
array written by named agents and the clustering key is the last element's `agent` field.

### 2.5 Repetition — what he does over and over

`usage-tools/s2_human2.py`, `s2_kills.py`, `s2_content_human.py`.

**Runs of the same action inside 90 seconds** (a run of N is one job done N times by hand):

| action | events | events landing inside a run of 2+ | longest run | median gap inside a run |
|---|---|---|---|---|
| DM discards | 102 | **46 (45%)** | 6 | **7s** |
| thread opens | 215 | 72 (33%) | 4 | 13s |
| human DM approves | 101 | 27 (27%) | 5 | 31s |
| ops approves | 24 | 6 (25%) | 2 | 65s |
| client idea approves | 9 | **8 (89%)** | 5 | 0s |

A 7-second median between discards, in runs up to six long, is the signature of a person clearing a
list one row at a time. **45% of all discard clicks happened inside such a run.**

**Content-side batching, separated properly.** 433 `carousel_drafts` rows were updated in the
window across only **189 distinct `updated_at` instants**. Ten of those instants are shared by
2+ rows to the microsecond — one SQL statement each, so they are jobs, not clicks: the largest are
**94 rows**, **67 rows**, **54 rows** at a single timestamp. Excluding those leaves **179 single-row
writes**, of which **78 (44%) fall inside a sub-3-second cluster** (median gap **0.31s**, clusters of
13 and 15). Sub-second spacing is a client loop or a workflow, not a hand; the honest statement is
that content rows are already being changed in batches of 5-15 and **nothing in the UI is a batch
control**, so the batching happens either in n8n or by repeated single clicks the app then fires
serially.

**Regeneration of the same material is rare, and that is a real answer to a plausible hypothesis.**
Across all 465 drafts there are **460 distinct titles**; only 3 titles repeat, involving 8 rows —
**1.1% of the table**. Topic reuse is likewise small (7 topics, 19 rows). Two of the three repeated
titles are error+error+review triples, i.e. a retry that eventually worked. *A "stop re-generating
the same thing" feature would be solving a problem that is not there.*

**A count corrected.** 81 messages carry `send_blocked_reason='stale_draft_expired_10d'`, which
reads as 2.6 drafts a day thrown away unseen. Reading the rows: **all 81 share a single
`send_blocked_at` instant on 2026-07-23, and all 81 were created in April 2026.** It is one historical
sweep of an old backlog, not an ongoing loss. Do not build for it.

### 2.6 The daily shape

`usage-tools/s2_human2.py`, `s2_content_human.py`. All timestamps UTC.

Thread opens (215 events) by hour:

```
07h ██████████████████████ 22   14h █████████████████████ 21
08h ██████████████████ 18       17h █████████████████ 17
13h ███████████████ 15          18h █████████████████ 17
12h ████████████ 12             19h ██████████ 10
```

Two peaks, **07:00-08:00Z (40 opens) and 13:00-18:00Z (73 opens)**, with a real trough at 09:00-11:00Z.
Human approves peak in the same two bands: **07-08h = 22 of 101**, **17h = 12**, **22h = 9**.
Discards are sharper still: **08h alone = 20 of 102**, then 16-17h = 23.

Weekday, thread opens `{Mon 36, Tue 39, Wed 38, Thu 49, Fri 36, Sat 10, Sun 7}` — **Thursday is the
heaviest day and the weekend is 8% of the week.** Discards agree (`Thu 24`, `Sat+Sun 10`).

**Order of lanes.** The morning band (07-09h) is DM-heavy: 40 thread opens, 22 approves, 31 discards
against only 3 ops approves and 5 client-idea approves. The content-side human writes cluster in a
different band entirely — draft kills at 08h (27) and **23h (68)**, schedule/publish touches at
**08-09h (95)** and 23h (25), on **10-11 active days out of 31**. That is the shape of it: **DMs are
a daily habit; content is a twice-a-week evening sitting.** The content queue therefore ages between
sittings, which is exactly what the 95-row review pile is.

Confidence: high for DM instruments (single-writer columns). Medium for content, because the 23h
band overlaps n8n batch jobs; the batch instants were excluded but attribution of the remaining
single-row writes is inference.

### 2.7 Aging and neglect — what needs him and is not surfaced

`usage-tools/s2_aging.py`.

**Unanswered conversations.** Reconstructing every thread from `outreach_messages` and taking the
newest message per prospect: **58 threads whose latest message is inbound.**

| unanswered for | threads |
|---|---|
| > 1 day | 58 |
| > 3 days | 53 |
| > 7 days | 50 |
| > 14 days | 39 |
| > 30 days | 27 |

Median age **22.9 days**, oldest **133.6 days**. **36 of the 58 have `read_at IS NULL`** — they were
never opened in this app at all. Of the 31 that arrived inside the 30-day window, **12 were never
opened.** These are replies from real prospects. There is no screen that lists them by
"how long has this person been waiting".

**The DM approval queue is small and old.** 8 pending drafts, median age **23.6 days**, oldest 35.6.
5 of 8 are older than 10 days; 2 are snoozed. A queue of 8 is not a workload problem — the problem is
that 5 of them have been sitting for over a week with no aging signal.

**Ops drafts are the quietly-rotting queue.** 62 of 86 ops rows were never approved and never sent,
median age 13 days: `comment_outbound 27` (med 11d), `comment_reply 13` (16.6d), `newsjack 10`
(17.6d), `weekly_report 4` (22.5d), `escalation 2` (**28.7d**), `booking 2` (15d).
Newsjacks and escalations are time-sensitive by definition; at 17 and 29 days they are dead on
arrival.

**Client ideas.** 176 staged and never approved (`risedtc 148, arch 28`), median 13.9d, **84 older
than 14 days**. Against 9 idea approvals in the whole window.

**What is NOT broken, stated so a later phase does not chase it:** 0 stuck-scheduled content rows,
0 past-due `scheduled_posts` that never fired, 0 incomplete scans, 0 orphaned generation rows found.
The send path and the publish path are healthy. **The queues that rot are the ones that need a human
decision, without exception.**

### 2.8 The week's shape

`usage-tools/s2_aging.py` section 7 — `scheduled_at` across `carousel_drafts` + `scheduled_posts`.

Past 14 days ran at 1-4 items/day with one 7-item day (08-20). Forward 14 days:

| date | armed items | what |
|---|---|---|
| 2026-08-24 | 2 | 1 `scheduled_posts` pending, 1 `carousel_drafts` scheduled |
| 2026-09-01 | 1 | 1 `carousel_drafts` scheduled |
| every other day to 2026-09-05 | **0** | — |

(The `cancelled` `scheduled_posts` rows dated forward — 3 on 08-23, 2 on 08-24, 3 on 08-27 — are
cancelled and will not fire; they are noise on any calendar that does not filter status.)

**3 armed posts across the next 14 days, against 95 drafts in review and 89 of them with no
`scheduled_at`.** The gap is not a supply problem. It is a scheduling problem: nothing carries a
draft from review to a date, and no screen shows both sides of that gap at once.

Four review drafts do carry a forward `scheduled_at` (08-25, 08-26, 08-27, 08-28, 08-31) — a
`review` row with a date is not armed and will not publish, so those five dates read as "covered"
on any calendar that plots `scheduled_at` without reading `status`.

---

## STEP 3 — how many interactions his real work takes

Counted by reading the code, not by guessing. "Interaction" = one click, one tap, one keypress that
commits something, or one deliberate scroll. A **confirm sheet** costs one click
(`ConfirmSheet.tsx:58`, one primary button). A **takeover** is the modal window over the whole canvas
(`Takeover.tsx:57`); a **peer** is the docked right-hand region (`layout.ts:33`).

The five tasks are the five highest-frequency human actions measured in 2.2.

### T1 — read a conversation (215 in the window, 6.9/day)

| # | interaction | file:line |
|---|---|---|
| 0 | DMs is the boot route, so no navigation is needed | `route.ts:21` `DEFAULT_ROUTE = { job: 'dms' }` |
| 1 | click the row | `InboxScreen.tsx:246` `onClick={() => onOpenThread(t.prospect_id)}` |
| — | peer opens beside the list on desktop; `read_at` stamped as a side effect | `Shell.tsx:288` `openPeer({kind:'thread'})`, `ThreadScreen.tsx:109` |
| 2 | scroll: the thread auto-pins to the newest message, so reading back costs scroll | `ThreadScreen.tsx:113-116` |
| 3 | close, or click the next row (which replaces the peer) | `ThreadPeer.tsx:60` |

**2-3 interactions, 0 takeovers.** This one is fine. Do not touch it.

Caveat on the instrument: `markThreadRead` only fires when `thread.unread > 0`
(`ThreadScreen.tsx:109`), so 215 is a **lower bound** on opens — re-reads of an already-read thread
are invisible.

### T2 — discard a DM draft (102 in the window, 3.3/day, 45% inside a run of 2-6)

| # | interaction | file:line |
|---|---|---|
| 1 | click the thread row (the list shows a `DRAFT` pill, not the draft) | `InboxScreen.tsx:246`, pill at `:277` |
| 2 | click **Discard** in the draft card inside the thread | `ThreadScreen.tsx:439` |
| 3 | click **Discard** in the confirm sheet | `ThreadScreen.tsx:134-137`, `ConfirmSheet.tsx:58` |

**3 interactions per draft, 1 round trip.** In a run of six that is **18 interactions and 6 confirm
sheets** for one job. The measured run pattern (median 7s between discards, runs up to 6) is exactly
that.

**There is no bulk discard for ordinary drafts.** The only bulk escape is `StaleBar.discardAllStale`
(`DraftsScreen.tsx:295`), which is scoped to `t.draftStale` rows. And conversations are declared
**bulk-incapable by construction**: `InboxScreen.tsx:246` renders `<RowSelect … caps={[]} />`, so
selecting threads and pressing a bulk button gives the refusal sentence at `BulkBar.tsx:171`
("A conversation is answered one at a time").

### T3 — approve a DM draft (101 in the window, 3.3/day)

Identical to T2 through step 2, ending on **Approve & send** (`ThreadScreen.tsx:443`) plus its
confirm (`:120-123`). **3 interactions.** If he edits first, the textarea is already inline in the
card (`ThreadScreen.tsx:335`) and approve sends the edited text (`:127` passes `edited`), so an edit
adds keystrokes but **no extra navigation**. That path is good.

**The dead affordance.** `DmsSurface.tsx:79` renders the full swipe-and-approve `DraftCard` **only
when `status === 'approve'`**. `Shell.tsx:146` declares `const [status] = useState<Status>('needs')`
— **no setter exists anywhere in the codebase** (`grep -rn "setStatus"` finds only `useChat.ts`).
The status axis is frozen at `'needs'`, so the `DraftCard` branch, its swipe gestures
(`DraftsScreen.tsx:155-161`), its three-button bar and the `Later` control on the card are
**unreachable in this shell**. Every approve therefore costs the trip into the thread. That is
1 extra interaction on every one of the 203 approve/discard events measured — **203 avoidable
interactions in 30 days**, and it is a one-line-scope defect, not a redesign.

### T4 — triage a content draft (the 95-row review pile; 179 single-row content writes in the window)

**Ivan's lane (2 of the 95 review rows, and all 48 errored rows):**

| # | interaction | file:line |
|---|---|---|
| 1 | click the stage tab if not already on it | `Surface.tsx:180` `StageTabs` |
| 2 | click **Approve** or **Skip** on the row itself | `ContentList.tsx:286` → `ReviewActions.tsx:88-90` |
| 3 | confirm | `ReviewActions.tsx:54-67` |

**2 interactions per row, 0 takeovers.** Already good. And it is bulk-capable: `ContentList.tsx:186`
gives these rows `['approve','skip']` caps, so `x`-select N rows then one bulk button plus one
confirm clears N rows in **N + 2 interactions** instead of 2N (`BulkBar.tsx:60-125`).

**A client lane (93 of the 95 review rows: risedtc 54, arch 39):**

`reviewActionable(status, lane)` is `(status === 'review' || status === 'error') && lane === 'ivan'`
— `content.ts:1435`. On a client lane it is **always false**. So:

| # | interaction | file:line |
|---|---|---|
| 1 | switch lane (a full refetch, `content.ts:299`) | `ContentList.tsx` CommandStrip |
| 2 | click the board-group + stage tab | `ContentList.tsx:987` |
| 3 | click the row → **takeover opens over the whole canvas** | `ContentList.tsx:190`, `DraftPane.tsx:1453` |
| 4 | scroll the takeover to read the post | `LinkedInPost.tsx:203` |
| 5 | click **Put on Mattan's board** | `DraftPane.tsx:1243` |
| 6 | confirm | `DraftPane.tsx:911-918` |

**4 interactions per row after arriving, 1 full-screen takeover, 1 server round trip.** The takeover
does auto-advance to the next row (`DraftPane.tsx:866-868`), which is the one thing that keeps this
survivable.

**And there is no bulk path at all on this lane.** `ContentList.tsx:186` computes
`caps = [...(reviewActionable ? ['approve','skip'] : []), ...(lane==='ivan' || boardGroupOf(d)!=='board' ? ['delete'] : [])]`.
For a client review row that evaluates to **`['delete']` and nothing else**. Selecting all 54 risedtc
review rows offers exactly one bulk button: **Delete**. The single destructive action is the only one
that scales, and the action he actually needs (promote to the board) is per-row only.

**Cost of clearing the current pile as it stands: 93 rows x 4 interactions = 372 interactions and 93
takeovers**, against 2 + 93 = 95 if promote were a capability.

### T5 — find one person or one draft from anywhere

There is no cross-object search. There are **four separate, unlinked search boxes**, each scoped to
one surface and to what is already loaded:

| where | what it searches | file:line |
|---|---|---|
| DMs | person, company, and full message text of loaded threads | `InboxScreen.tsx:174` → `inbox.ts:463` `searchThreads` |
| Content | **`title` and `topic` only** — not `post_body` | `FilterRow.tsx:355` → `ContentList.tsx:912` `applySearch(…, d => [d.title, d.topic])` |
| Magnets | topic | `ContentSections.tsx:687` |
| `⌘K` palette | command titles, lane names, and **only the rows currently in the DOM** | `commandSource.ts:242` over `CommandLayer.tsx:66` `document.querySelectorAll('.wb-work [data-wbrow]')` |

The palette limitation is sharper than it looks: the DMs list is **windowed**
(`InboxScreen.tsx:151` `useRowWindow`, `ROW_H = 73`, `OVERSCAN = 6`), so at a 900px viewport roughly
**12-25 of the ~139 threads exist in the DOM at once**. `⌘K` can only offer to open those. And
content search is per-lane by construction, because the fetch itself is lane-filtered
(`content.ts:103`), so "where is that draft about margins" requires knowing the lane first.

Measured consequence: to answer "what did we say to this person and what content have we made about
their objection", he must visit DMs, search, read, switch to Content, switch lane, search title only
(the body is not indexed), and switch lane again. **6+ interactions and 2 refetches, with no
guarantee the phrase he remembers is in a title.**

### T6 — clear an errored draft (55-row pile; the ask that started this run)

The card shows the reason (`ContentList.tsx:177` `draftFailureReason`) and, on Ivan's lane, offers
Approve/Skip inline. It offers **no retry**. Regeneration lives only inside the takeover and only on
Ivan's lane (`DraftPane.tsx:1249` `{lane === 'ivan' && (<RegenDraft …/>)}`):

| # | interaction | file:line |
|---|---|---|
| 1 | click the row, takeover opens | `DraftPane.tsx:1453` |
| 2 | click **Regenerate** (a disclosure, not a command) | `DraftPane.tsx:279-282` |
| 3 | choose "Copy only" or "Copy + new image" in the expanded row | `DraftPane.tsx:283-296` |
| 4 | if he hand-edited it, tick "Replace my edit" first | `DraftPane.tsx:290-294` |

**3-4 interactions and one takeover per retry, no bulk.** Retrying the 48 Ivan-lane errored rows =
**~168 interactions and 48 takeovers.**

Scheduling is behind a second disclosure on the same bar: **Schedule** toggles a panel
(`DraftPane.tsx:1261-1263` `setMore`), inside which a `datetime-local` input plus a button plus a
confirm (`DraftPane.tsx:381-420`) arm the post. So **draft to armed post = open takeover, click
Schedule, set a datetime, click Schedule it, confirm = 5 interactions and a takeover**, per post.
That is the mechanism behind the 3-armed-posts-in-14-days number in 2.8.

### Summary of Step 3

| task | frequency | interactions now | takeover required | bulk path exists |
|---|---|---|---|---|
| T1 read a thread | 6.9/day | 2-3 | no | n/a |
| T2 discard a DM draft | 3.3/day | 3 | no | **no** (stale-only) |
| T3 approve a DM draft | 3.3/day | 3 | no | **no** (and the card path is dead code) |
| T4a triage Ivan content | — | 2 | no | **yes** |
| T4b triage client content | 93 rows waiting | **4** | **yes** | **delete only** |
| T5 find something | daily | 6+ across 2 surfaces | no | n/a |
| T6 retry an errored draft | 55 rows waiting | **3-4** | **yes** | **no** |
| T7 arm a post to a date | 3 armed in 14 days | **5** | **yes** | **no** |

