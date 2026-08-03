# inbox-density-and-ia-2026-08-03 — final report

Executed 2026-08-03, straight on from the usability+voice run, from Ivan's live use of the deployed
app. Three asks in the launch spec, **six more added mid-run** by the coordinator (one cancelled).
Everything below is DEPLOYED: `main` @ `48e8d10` → GitHub Pages, live-verified authenticated.

Five deploys, one per gate, because he is using the app while it is being changed.

## 1 · Ivan's asks, before → after

| ask (verbatim) | before | after (measured on the live deploy) |
|---|---|---|
| "the inbox section u can remove it i see no purpose on it having dms and sends" (twice) | Inbox job in rail + tab bar | **Gone.** DMs absorbed the conversation list — §2 is why it was a merge, not a delete |
| "the today stuff is all old shit" | 15 things under a heading saying TODAY; urgency 2.9d, DM drafts 13.6–16.6d, comment drafts 32.8–36.0d | **01 NEW TODAY / 02 CARRIED OVER / 03 SCHEDULE.** Masthead prints "**2 new today · 12 carried over, oldest 35d**" |
| "content section… scroll super vertical and long… compact stuff with collapsibles arrows and also order things in horizontal" | first review row **957px** down at 1440, **1201px** at 390 | **464px / 574px** — visible **without scrolling at both widths**, −52% both |
| "FIX Pipeline design and delete published" | PUB=109 vs a peak of 11 drew a balloon over four slivers | Published off **both** pipelines; 4 stages, fixed 56px capsule columns, linear scale |
| "delete this warning is normal '1 errored · 34 terminal with no landing URL'" | 34 unfixable alarms | Clause removed; strip disappears at 0. Audit in §6 |
| "'Approve & open gate' why u opening a new tab… make it be 'Queued'" | new tab; **card stamped Done even when the gate refused** | Fires in-app, reads the verdict, **only an accept stamps**. §5 |
| "they should be able to queue not make me wait for every single one" | one at a time | App holds a retry line; the poster serialises, not Ivan. §5 |
| "says 'OUTBOUND your feed' when it should be Comments - Ivan or Mattan" | `OUTBOUND · your feed` | `COMMENTS · Ivan` / `COMMENTS · Mattan Danino`, from the row's own client_id |
| "regen cover image and others like regen copy" | read-only window | **Regenerate copy** (drafts), **Regen cover** + **Regen content** (magnets). §7 |
| ~~"categories tag only on hover"~~ | — | **CANCELLED** by the coordinator (meant for a different app). Nothing built; recorded so the cancellation is auditable |

## 2 · Phase 1 — the Inbox cut was a DATA question first

The spec's condition was explicit: delete only if DMs already renders those rows. **It did not.**

```
inbox_messages_v ...... 2,243 rows -> 1,419 threads
INBOX surface rendered .. 135 conversations
DMs  surface rendered ..    0        <-- the whole finding
```

`DraftsScreen` was `threads.filter(t => t.draft !== null)` and there are zero pending drafts, so the
"DMs" lane was an **empty screen**, and all 135 conversations — including the **70 waiting on Ivan** —
were reachable only through Inbox. Deleting it would have traded a redundant tab for a blind spot.

**A starved lane looks identical to a dead one.** DMs looked fine because it was empty, and it was
empty because it only ever held one of four buckets.

Mapping table with live counts is in `phase1-mapping.md`; the raw probe is `phase1-census.json`, run
through the *shipped* functions via vitest — a reimplementation would only prove the census agrees
with itself.

**Orphaned kinds after the cut: none.** The arithmetic that must keep holding:

```
28 answer + 0 approve + 42 flagged = 70  = the rail badge
70 + 65 waiting on them            = 135 = every row the surface renders
135 + 1,284 send echoes            = 1,419 threads in the view
```

The breakdown bar Ivan already had **became the status filter** — it and the badge both read
`threadBucket`, so a segment can never advertise 42 and hand back 7 (asserted in `inbox.test.ts`).
"Draft ready" renders the swipe approve/discard **DraftCard** lifted out of DraftsScreen, so the
affordance survived the job that hosted it.

`#exp/v2/inbox`, `/drafts`, `/inbox/chat`, `#exp/v2c/drafts` all fresh-load onto DMs and rewrite to
the canonical id — verified live, not asserted.

## 3 · Phase 2 — Today, honestly ranked

Probed the live brief first (`phase2-brief.json`). The complaint was measurably true, and came with
a bug:

- of 15 things on the plate, **only 2 were younger than a day**;
- the single "**1 going out**" post had `status: 'cancelled'`. The calendar path filtered cancelled;
  the direct path did not. **One predicate on both paths now** (`isLivePost`), so the masthead reads
  0 going out and a called-off slot is reported as news instead of counted as load.

The re-rank is one derivation (`todayPlate`) feeding the masthead, both banded zones and the
schedule, with **`newCount + carriedCount === todayLoad().total`** asserted in tests — a re-rank is
not a filter.

The "**aging out: 6 — older than 3 days, out of the count**" confession is gone. Those replies are
demoted by the edge function and carry no rows, so they cannot be rendered — but since phase 1 they
are one tap away in DMs, so the line became a **hand-off row that links there**.

## 4 · Phase 3 — Content density, measured

Measured on the **real scrolling element** (the first attempt guessed a selector and got
`scrollHeight === clientHeight`, a non-scroller, which would have made any "win" unmeasurable), and
against the **first row inside the REVIEW section** — not "the first `.ct-card`", which resolved to a
row inside the alert strip and would have scored collapsing the strip as a win with the review queue
never moving.

| width | route height | scroll to first review row | visible without scrolling |
|---|---|---|---|
| 1440 | 1909 → **1416** (−26%) | 957 → **464** (−52%) | No → **YES** |
| 390 | 2893 → **2266** (−22%) | 1201 → **574** (−52%) | No → **YES** |

*(final figures re-measured on the live deploy)*

The blind-seat question — "can you find and action the thing that needs you, without scrolling?" — is
answered by measurement: at both widths the first **Needs review** row, with its SKIP/APPROVE
controls, is inside the first viewport.

Five moves, in order of pixels returned:

1. **The pipeline card became a horizontal band** (plot | hero figure | facts) instead of a four-block
   stack down a 1,150px column — the "order things in horizontal" ask. Stacks again below 1000px and
   gets a shorter plot at 390; never hidden, because he asked for it *fixed*, not removed.
2. **Sections default collapsed except the one that needs him.** `DEFAULT_OPEN` went from
   `[ideas, generating, review, approved]` to `[review]`, both lanes.
3. **Triage order** — review renders first, the pipeline sequence behind it. It used to be third.
4. **The alert strip stopped opening itself.** It resolved *open* on the live lane and cost ~420px
   above the queue: the alarm burying the work it was written to protect.
5. **The two advisory paragraphs.** The ClickUp-era note moved *inside* the alert disclosure (a
   footnote about the alert count, so 0px when closed); the cadence line dropped the sentence
   defending itself against a misreading the word "cadence" already prevents.

**Collapse state now persists**, per lane, in the section entry that already held the filters.
`sectionState` gained an `open` allowlist field with the same identifier shape and caps as a facet
key. A `TOUCHED` marker distinguishes "he closed everything" from "he has not decided yet" — without
it, closing every section would silently restore the defaults on the next load.

### The pipeline chart

Published left **both** charts: an archive count he never acts on, and the only stage that
accumulates forever, so it set the scale (109 vs a peak of 11) and squashed every in-flight stage into
its floor. The total stays in the footer line, where an archive number belongs.

The "two chart types in one plot" was geometry: marks were `flex:1` across a 460px card, ~90px wide
against a 22–72px height, so the tall one resolved as an ellipse and the short ones as lying-down
pills. Now **fixed 56px columns, 96px plot, one radius on every stage**, and sqrt reverted to
**linear** — the compression existed only to survive the 109-row outlier and bought that legibility by
drawing every bar at the wrong height.

WARNING found and fixed in the same pass: heights were emitted as a percentage against a parent that
only had `min-height`, so they resolved to `auto` and **every stage rendered at its floor** — a flat
chart drawn from a 3/10/0/2 series.

## 5 · Ops — the comment gate (and a live correctness bug)

Investigated the n8n side before designing anything, because the shape depended on it.

**The bug.** The five poster gates genuinely refuse — disarmed flag, post older than 5 days, 3-a-day
cap, 10-minute spacing, one-in-flight, per-target cooldown — and the webhook answers **bare text with
HTTP 200 for every outcome**. The card stamped `approved_at` + `sent_at` **unconditionally**. So a
refused comment rendered as handled and never posted.

Now approve fires the gate from the app, reads the sentence, and **only an accept stamps**.
`classifyGateReply` **fails closed** — an unrecognised sentence is never an accept, because the cost of
a wrong "accepted" is exactly the defect being replaced. Every string it matches is quoted from the
live workflow and pinned by tests.

**Queueing several.** The poster **rejects rather than defers** (one row in `approved|posting`
globally), so firing them all would silently lose every one after the first — a refusal leaves the row
`pending` with nothing scheduled to retry it. The app holds the line and re-fires the head as the
window opens. Safe because the gate is idempotent (`already <status>` on a replay). A cap refusal
**stops** the line rather than hammering the webhook until midnight, and says it is holding for
tomorrow.

**Durable where it matters.** The poster writes nothing to `ops_drafts`; it owns `comment_feed`, and
`context.feed_id` is that row's id. Accepted state is re-read from there on every load, so a refresh
cannot invent a "Queued" badge. **Explicit column list, never `*`** — that table carries
`approve_token`, a live capability token.

**Honest limit, stated on the card:** a card that is merely *waiting* is still `pending` server-side,
i.e. still fully actionable, so a reload loses the automatic retry and nothing else. The risedtc
hand-post lane (no `approve_url`) is untouched — it has no poster by design.

CORS was **probed, not assumed**: allow-origin for this app's origin, allow-methods `OPTIONS, GET`.
POST is not allowed by that node and its preflight 500s — the method must stay GET. No edge relay
needed.

## 6 · Alert hygiene — what was demoted, auditable

The test applied: **an alert must name something Ivan can act on today.**

| line | verdict |
|---|---|
| LM "N terminal with no landing URL" (34 rows) | **REMOVED** from the alarm — those rows predate landing pages, so it is history, not a defect. The per-row mark stays |
| LM strip at 0 errored | **Disappears** rather than rendering empty |
| Content "N pipeline alerts predate the 14-day window (ClickUp-era ids)" | **KEPT, relocated** into the alert disclosure — 0px when closed |
| Content "N drafts generating for over 20 minutes" | **KEPT** — actionable (re-fire) |
| Content "N publish failures in the queue" | **KEPT** — actionable, and the only place a failed publish is written down |
| Content "N errored · N past due · N elsewhere" | **KEPT** — all three are real failures |
| Today "aging out: N — out of the count" | **REWRITTEN** into a hand-off row to DMs |

## 7 · The old dashboard's actions, in the reading window

Inventoried from `~/Desktop/personal-site/components/dashboard` — the page is OTP-gated (password
hash **and** an emailed 8-digit code), so the source was the reliable route. Full ~60-action inventory
was produced; the ones Ivan named shipped.

| action | endpoint (same one the old dashboard hits) | writes |
|---|---|---|
| **Regenerate copy** (draft window) | `post-gen-v2` | `carousel_drafts.status`, `taxonomy.generating_started_at` |
| **Regen cover** (magnet window) | `lm-regen-cover-v2` | `lm_drafts_v2.cover_url` **only** |
| **Regen content** (magnet window) | `lm-gen-v2` `phase:content` | `lm_drafts_v2.status`, then the engine writes the body |

Both conflicts are **surfaced, not resolved behind his back**:

- **The image trap.** post-gen writes `image_urls` only when `include_image='Yes'`, and the old
  dashboard sent Yes for every `single_image` row — the known "regen wipes image_urls, re-pin the
  photo" trap. Here the **default is copy-only, so a hand-pinned photo survives**, and
  "Copy + new image" is a separate button that says what it does.
- **The db/025 guard.** A service_role write cannot overwrite a human-edited body, so a regen on an
  edited row runs for minutes and lands nothing. The window says so **before** firing and offers 025's
  own documented escape hatch ("Replace my edit") as a deliberate, separate act.

WARNING also caught while reading the type: `taxonomy` is jsonb that is **sometimes a bare string** on
live rows. Spreading a string into an update would have written character-indexed garbage over the
column. Every read and merge goes through `taxObj()`, with a test.

**VERIFICATION LIMIT, named as required.** The regen fires are destructive (they replace live copy)
and paid (image generation), so they are verified **to the dispatch boundary** — CORS preflight probed
from this origin, payload shape checked against the inventoried source file-by-file, table-write path
unchanged from the app's existing writes — and **were not fired at a real row**. The first real fire
is Ivan's.

## 8 · Verification (re-measured on the deployed build)

- **7 routes × 2 viewports on the live URL: 0 console errors, 0 horizontal overflow, 0 tap targets
  under 44px** (`phase4-live/verify.json`), 14 screenshots.
- `npm test` **522/522** (28 files) · `tsc -b` clean · `npm run build` clean.
- `#exp/stock` **verified untouched** on the live deploy — still the pre-revamp shell with its own
  Inbox/Drafts tabs.
- Retired URLs verified by fresh load, not by reading the regex.
- Gate transport verified **from the app's own origin in a browser**: the fetch returns 200, the body
  is readable, and the shipped classifier maps that reply to a refusal — never an accept. Probed with
  a deliberately invalid token so it hits the gate's `bad link` guard before any DB read.

**Two floors fixed that this run inherited rather than caused:** `.chip` 36px, `.sg` 30px and
`.wb-ws` 28px at 390 were under the 44px floor (byte-identical on the pre-run live deploy), now
extended vertically; and the verifier's own pseudo-element measurement was scoring extended controls
as unextended, which is why the prior run's numbers had looked clean.

`npm test` was also made **hermetic** (src + supabase only): this run's live DB probes are spec files
so they exercise the shipped functions, and a probe must never be able to fail a deploy gate for being
offline. They run via `vitest.probe.config.ts`.

## 9 · External changes (with rollbacks)

| system | change | rollback |
|---|---|---|
| GitHub Pages (`main`) | five phase deploys, `a81174c` → `48e8d10` | `git revert` the phase commit; `#exp/stock` still serves the pre-revamp shell |
| n8n | **none** — read-only investigation; no workflow created, modified, activated or deactivated | — |
| Supabase | **none** — no migration, no new edge function. New reads only (`comment_feed`, explicit column list, existing `authenticated` policy) | — |

## 10 · Open / residual

- **The regen buttons have never been fired at a real row** (§7). Deliberate; the first fire is his.
- **Cap divergence in the poster, found not fixed:** the day cap is **3** in `Validate + Approve` but
  **5** in `Post Comment`. Harmless today because the one-in-flight gate serialises everything, but it
  is a stale second copy of a cap. n8n was not touched this run.
- **"Queued" is not representable in `ops_drafts`** — the outbound path fills `approved_at` and
  `sent_at` together. Making it a real state means stamping `approved_at` only and having something
  write `sent_at` later. Schema semantics: Ivan's call.
- The comment queue's **waiting line is in-memory** (the accepted state is not). Stated on the card.
- Short capsules are wider than tall at the 28% drawing floor. Same vocabulary and radius as the tall
  ones, so it reads as one chart — but it is a floor, not a proportion.
- The alert strip is now closed on every count, including a 1-row day. Deliberate.

## 11 · Where everything is

`phase1-mapping.md` + `phase1-census.json` · `phase2-brief.json` · `measure/*.json` (before/after/live)
· `phase4-live/verify.json` · shots in `phase1-shots/`, `phase2-shots/`, `measure/`, `phase4-live/`,
`baseline-live/` · probes `_p1-census.spec.ts`, `_p2-brief.spec.ts`, `_verify.mjs`,
`_measure-content.mjs`, `_db.mjs`, `vitest.probe.config.ts`.
