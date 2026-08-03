# inbox-draft-window-v2 — final report

Executed 2026-08-03, straight on from the density run, from Ivan's live use of the deployed app.

> "the content window when open each post to see is nothing like
> `dashboard-v2/?section=posts&sub=pipeline` with the html preview editable and way better
> horizontal organization.. make it much better"

Everything below is DEPLOYED: `main` @ `2ccc6a2` → GitHub Pages, bundle hash `index-wyN39HSR.js` →
**`index-DduB0OYv.js`**, live-verified authenticated at 1440 and 390.

---

## 1 · The complaint, measured

The before-shots are not illustrations — they are the argument. `before/` was captured on the
**live pre-run deploy**, opening the first row of the review queue:

| | window body scroll | viewport | screens of scrolling |
|---|---|---|---|
| 1440 | **9,040px** | 778px | 11.6 |
| 390 | **13,150px** | 776px | 17.0 |

One 760px column. The first viewport held a title, two chips and a cover photo. The QA verdict, the
source, the generation register and every action were below all of it.

After, same row, measured through the shipped functions:

| | window body scroll | the tallest column, scrolling on its own |
|---|---|---|
| 1440 | **0** — the frame holds; nothing scrolls the window | evidence rail 3,250px |
| 390 | **5,812px** (−56%) | single column |

At 1440 the artifact, the decision bar **and** the QA verdict are in the first viewport together
(`verify-live/draft-1440.png`). At 390 the sticky decision bar is on screen before any scrolling at
all (`verify-live/draft-390.png`).

## 2 · What was built

The reference's review reader (`PostWorkSurface.tsx`'s `.ws-reader`), ported as **structure**:

```
 ┌──────────┬────────────────────────────┬──────────────────┐
 │ 01 QUEUE │ 02 THE ARTIFACT            │ 03 THE EVIDENCE  │
 │ 232px    │ 1fr, capped 640            │ 300–360px        │
 │ j/k walks│ LinkedIn-faithful,         │ QA verdict,      │
 │ it; the  │ EDITABLE IN PLACE          │ artifact, source,│
 │ current  │ + sticky decision bar      │ register + a note│
 │ row lifts│   a r e s o                │ you can write    │
 └──────────┴────────────────────────────┴──────────────────┘
   reference: 232px │ minmax(0,1fr) max 640 │ minmax(300,340)
```

Three independent scrollers, which is the **one place this departs from the reference on purpose**.
Over there the rails deliberately have no height cap — two separate code comments name a capped rail
as the cause of a wheel-trapping "page gets stuck" bug, because those rails live in the page's single
scroll context. Here the page scroll is already locked behind a modal, so there is no scroll for a
column to steal, and reading a 3,250px generation register never pushes the post out of view.

**The skin is this app's.** No lucide (the five LinkedIn glyphs are drawn inline), no sonner, no new
dependency. `package.json` is unchanged.

**Below 1180px** it is one column in a deliberate order — stated so it is a decision, not an accident:
title → **the post card** → carousel strip → **the decision bar** → QA verdict → rendered artifact,
source, key points, description → generation register + note → dates/taxonomy/long tail → **the queue
rail, last**. On a phone you arrived by tapping a row, so the list is one back-tap away; twelve
sibling titles above the post is exactly the vertical scroll he complained about. The markup order
IS that order; CSS `order` puts the queue back on the left for the wide layout, so the DOM never has
to disagree with the phone.

### The editable preview

Ivan asked for "the html preview editable". The reference does **not** do this: pressing `e` there
replaces the `LinkedInPost` with a 16-row textarea at a different type size — you edit a different
object from the one you were reading.

Here the body element itself becomes the field. One CSS declaration is shared by the read `div` and
the `textarea`, which is what makes the caret land exactly where the words already were. Measured on
the live deploy:

| | top | font-size | line-height | focused | inside the card |
|---|---|---|---|---|---|
| reading (1440) | 251 | 15px | 24px | — | — |
| editing (1440) | **251** | **15px** | **24px** | yes | yes |
| reading (390) | 250 | 15px | 24px | — | — |
| editing (390) | **250** | **15px** | **24px** | yes | yes |

Nothing moves vertically. A 2px LinkedIn-blue rule appears down the left edge so the editable region
is visible (that is the 5px horizontal shift in the table).

**A caught defect worth naming:** the first cut rendered that body at **13px/20px**, not 15px/1.6 —
`faithful.css:171` flattens the whole sheet with `.wb.wb, .wb.wb *{ font-size:var(--fs-body) }` before
re-assigning its tiers, and a single-class rule loses to it. The verifier measured it
(`liBody.fontSize: "13px"`); every new selector now carries the `.wb.wb.wb` specificity the
style-delta already required. **A faithful preview that is not faithful is worse than no preview.**

### The save refuses to pick a winner

The reference's `saveDraft` is a bare `UPDATE … WHERE id`: last writer wins, silently. On this
pipeline that is not theoretical — the db/025 sweep found **four active engines that overwrite
`post_body` unconditionally**, plus Proxy Health Recovery re-generating `status='error'` rows every
ten minutes with no human in the loop. db/025 protects an *already-marked* row from service_role; it
does not protect the **first** edit, and it never tells the operator there was a newer body.

`saveDraftBody()` uses two independent detectors, because the table's triggers are not readable from
an anon key and the guard must not depend on one:

1. a **pre-flight read** of `post_body` — definitive, trigger-agnostic, catches the real case;
2. a **compare-and-swap on `updated_at`** in the UPDATE predicate — closes the read/write window *if*
   the column is maintained, and is inert (never a false conflict) if it is not.

A zero-row UPDATE is then re-read to say **which** of two things happened — a race, or an RLS
refusal — rather than blaming one for the other. 9 unit tests; the load-bearing one asserts that on a
conflict **no update is attempted at all**.

### The keyboard, with the bug the reference has

`j k a r e s o`, `Esc`, plus `⌘↵` to save. Two corrections to the ported map:

- 🔴 **A modifier guard.** The reference matches bare `e.key` outside a field, with no modifier check.
  So **`⌘A` approves the draft** and `⌘R` rejects it — select-all and reload are destructive there.
  Asserted on the live deploy: `cmdASafe: true` at both widths.
- 🔴 **`Esc` leaves the field, not the window.** The takeover's listener is a *native* one on
  `window`; React attaches synthetic handlers at the root container, which is below it, so a
  `stopPropagation()` inside the textarea cannot stop it — Escape cancelled the edit **and** closed
  the whole window in one keypress. The inner meaning of Escape now wins; the second Escape closes.
  Measured: `{editorClosed: true, windowStillOpen: true}` then `escCloses: true`.
- The buttons refuse what the keys refuse: while the editor is open, Approve / Skip / Next / More are
  **disabled**. A guard that only protects people who use keys is not a guard.

`r` is the reference's *persisted* reject (`disqualified`); `s` is its *session-local* skip (move on
without judging). Both exist there; only one had a key.

### The queue is what he can see

Opening a row hands the window **the section it was opened from**, in render order. So the rail, `j/k`
and "3 of 12" all walk exactly the rows on screen — filters, search and collapse state included — and
cannot drift from the list. A collapsed section's rows are not in the queue, which is correct: they
are not visible. A one-row queue draws no rail and the grid gives the 232px back to the artifact.

After a decision the queue **advances** instead of closing. Closing after every approve is what makes
a review queue feel like twelve separate errands.

## 3 · Feature parity — reference affordance → here

Legend: **✓** present · **+** added/exceeds the reference · **–** declined, with the reason.

### PostWorkSurface, review lane

| affordance | | note |
|---|---|---|
| `j`/`k` between drafts | ✓ | plus a visible queue rail, current row lifted |
| `a` approve · `r` reject · `s` skip · `e` edit | ✓ | `r`→Skip (persisted), `s`→Next (no judgment) |
| `o` detail → full editor slide-over | ✓ adapted | `o` opens the actions drawer; the backend depth is already in the evidence rail, so there is no second window to open |
| Inspect toggle (whole rail) | ✓ adapted | per-section collapsibles instead, persisted per surface |
| queue rail: title · type · age · position | ✓ | |
| LinkedIn-faithful preview | ✓ | geometry ported verbatim; lane-aware author, so Mattan's row never wears Ivan's face |
| carousel slide strip | ✓ | + Drive `/view` → `/thumbnail` conversion (the reference's `driveThumb`) |
| the preview as the editor | **+** | the reference swaps it for a textarea |
| save conflict detection | **+** | the reference is last-write-wins |
| modifier guard on shortcuts | **+** | fixes `⌘A` approving |
| `review-advance` rise-in animation | – | the app has exactly ONE choreographed beat (approve, §10.5). A second motion vocabulary breaks that contract for a 0.28s flourish |
| session tally (`3 approved · 1 rejected`) | – | the rail already shows what is left; a session counter that never corrects itself on a failed write (it does not, there) is a number that drifts |
| ideas table · bulk kill · promote · defer | – | the ideas LANE, not the draft window — the reference fires them from the table, not the reader |
| triage drawer · disqualify-all-stuck | – | the Content list already carries the alert strip this duplicates |
| `?open=<id>` deeplink | – | this app routes on `#exp/v2/<job>` and deliberately refuses to address a row id (`route.ts`: "a URL that pretends to restore one would 404 into an empty pane") |

### CarouselEditor (the full-depth slide-over)

| affordance | | note |
|---|---|---|
| Save copy (`post_body`) | ✓ **+** | in place, conflict-guarded |
| Regenerate (paid) | ✓ | confirm + the image trap + the db/025 guard both stated before firing |
| Generate (an `idea`-status row) | ✓ | the button's label is status-aware, as the reference's status machine is |
| Retry a stuck generation | ✓ | same path |
| Schedule | **+ added** | manual `datetime-local`; the confirm says *the publisher reads this and posts it*, not "scheduling" |
| Delete | ✓ | hard-DELETE-then-archive contract preserved |
| QA verdict panel | ✓ **+** | reads all 23 live `qa` keys; the reference regex-parses a subset out of `agent_log` and drops `rewrite_text` |
| Agent log feed | ✓ **+** | no 160-character clamp |
| Source briefing | ✓ | |
| Agent-log note composer (`append_agent_log`) | **+ added** | **fired for real, landed, restored** — §5 |
| Save fields (taxonomy) | – | the window shows all ~31 taxonomy keys; editing them is a data-entry surface, and the six the reference exposes are generator inputs, not review decisions |
| Save slides | – | **dead code in the reference**: `renderMedia()`'s slides branch requires `urls.length === 0` but is only called when `urls.length > 1`, so the button can never render |
| `ig_caption` edit | – | rendered read-only; no lane in this app publishes to Instagram |
| **Post now** | – 🔴 | irreversible public post, and it authenticates with a **shared secret** (`pn-…`) that would have to ship inside a world-readable GitHub Pages bundle. Adding a second public copy of a publish capability is not a parity gap worth closing |
| Image library / upload / apply | – | needs the `post-stills` bucket and its anon-listing workaround (the authed role lost `storage.objects` SELECT on 07-19) — a separate surface, not a window feature |
| **Per-image regen** (`✨ Edit image`) | – 🔴 | needs `ImageEditorModal` **and** the `image_edit_versions` insert that `commitImageEdit` writes. That insert is **the only undo trail in the whole system**; shipping the paid fire without the trail would remove the one reversal path an image edit has. The single-image case is already served: "Copy + new image" |
| Animate / `redoVideo` (paid) | – | the video lane, with its own engine and its own approval |
| status-transition toasts | – | no toast system in this app (no sonner); state is shown on the object, not in a corner |

### Lead magnets (`LmWorkSurface` + `LeadMagnetEditor`)

| affordance | | note |
|---|---|---|
| queue rail + `j`/`k`/`s`/`o` | ✓ | |
| resource artifact iframe | ✓ | self-contained documents only; a kit-CSS fragment says so instead of rendering as raw serif text |
| cover display · Regen cover (paid) · Regen content | ✓ | |
| promo post preview | ✓ **+** | the faithful card, **editable in place** |
| `post_body` / `email_copy` edit | **+ added** | **fired for real, landed, restored** — §5 |
| QA verdict + agent log + note | ✓ **+** | |
| live URLs | ✓ | opening one confirms first — it is a public page |
| Approve & build assets · Approve status only | – 🔴 | the standing rule, unchanged: whether an n8n watcher treats `lm_drafts_v2.status='approved'` as a publish trigger is **not readable from this repo**. The window says so on the row rather than hiding the absence |
| Schedule LM · Repost | – 🔴 | same class — both publish |
| DM templates A/B (`spec_patch`) | – | `spec` is an agent-written jsonb blob; a read-modify-write on it needs merge discipline this window has no reason to own |
| Cover picker (`operator_set_lm_active_cover`) | – | only meaningful on rows with `covers[]` longer than 1; a named candidate, not a gap |
| Edit resource on live page (token reveal) | – 🔴 | reveals a live capability token into a browser tab |
| Delete LM | – | the LM lane has no destructive action today; adding one to a lane we deliberately keep read-only-for-status is a scope decision, not parity |

## 4 · The edit round-trip, against the database

Driven **through the shipped UI** on a real Ivan-lane row (`96b11b18…`, 1,707 characters), then
restored — `roundtrip/roundtrip.json`, screenshots `1-editing.png` / `2-saved.png` / `3-conflict.png`.

| claim | result |
|---|---|
| text typed into the LinkedIn card and saved lands in `carousel_drafts.post_body` | **true** |
| the same PATCH stamps `taxonomy.human_edited` (the db/025 marker) | **true** |
| an engine writing the body from outside, mid-edit, is **detected** | conflict box shown |
| the refused save writes **nothing** — the engine's words survive | **true** |
| the operator's own text is still in the editor | **true** |
| both texts on screen, two named choices, no winner picked | `Take theirs, drop mine` / `Keep mine, overwrite theirs` |
| the row restored byte-identical (**body and taxonomy**) | **true / true** |

Taxonomy is restored too, deliberately: a save arms db/025, and leaving a row an engine can no longer
rewrite would be a side effect of a *test*.

## 5 · What was fired, and what was not

| action | fired at a real row? | |
|---|---|---|
| edit + save (`carousel_drafts.post_body`) | **YES** | landed, conflict path exercised, restored — §4 |
| `append_agent_log` (the note) | **YES** | 0 → 1 entries, RPC 204, `agent_log` restored exactly |
| `saveLmField` (`lm_drafts_v2.post_body`) | **YES** | HTTP 200, **1 row returned**, landed, restored |
| **Schedule** | **NO** | 🔴 `status='scheduled'` + `scheduled_at` is what the n8n Bridge `yzXqLDIpuNzuhUQq` reads to put a post on LinkedIn. Verified to the **dispatch boundary**: same table, same `.is(client_id, null)` scope and the same verified-write contract the round-trip proved live. The first real fire is Ivan's |
| **Regenerate copy** (paid) | **NO** | unchanged from the density run — destructive and paid; dispatch boundary only |
| **Regen LM cover / content** (paid) | **NO** | same |

The LM probe mattered more than it looks: an edit affordance on a table where RLS answers a silent
204 would render as "Saved" and write nothing. It returns a row. It is not a decorative button.

## 6 · Verification, on the deployed build

`verify-live/verify.json` — draft **and** magnet windows, both widths, on `main` @ `2ccc6a2`:

- **0 console errors**, **0 horizontal overflow**, **0 tap targets under 44px**, both windows, both widths.
- `j`/`k` moves and returns; `⌘A` does not approve; `Esc` cancels the field and leaves the window open;
  a second `Esc` closes it.
- The artifact renders at LinkedIn's own 15px/24px, `rgba(0,0,0,.9)` — not the app's flattened 13px.
- `npm test` **531/531** (29 files, +9 this run) · `tsc -b` clean · `npm run build` clean · `oxlint`
  adds no new warnings.
- Bundle hash **changed** (`wyN39HSR` → `DduB0OYv`), so the `skipWaiting` service worker (`13844f7`)
  hands Ivan's open tabs the new build rather than queueing behind them.

**One flag, run down rather than waved through:** the 390 detector reported an `img` past the
viewport. It is a carousel tile inside the strip's own `overflow-x:auto` scroller — by design, exactly
as the reference's `.ws-slides` is, and `hScroll` is false. The verifier now separates
*inside-a-horizontal-scroller* from *overflow*, so the distinction is measured rather than argued.

Defects the verifier caught before deploy, not after: the 13px artifact type (§2); an empty LM promo
body that was a 586×20 clickable target; and the rail's `scrollIntoView` walking every ancestor, which
on the phone dragged the whole window down past the post to reveal a queue row nobody asked for.

## 7 · External changes

| system | change | rollback |
|---|---|---|
| GitHub Pages (`main`) | one deploy, `13844f7` → `2ccc6a2` | `git revert 2ccc6a2` |
| Supabase | **no migration, no new function, no policy change.** New writes use existing tables and the existing `append_agent_log` RPC | — |
| n8n | **none** — nothing created, modified, activated or deactivated | — |
| personal-site | **none — read only**, as required | — |

The round-trip and the write probe both wrote to live rows and both restored them; verified by
re-reading after the restore, not by assuming the PATCH landed.

## 8 · Open / residual

- **Schedule has never been fired.** Deliberate — it publishes. The first fire is Ivan's, and the
  confirm says what it does in those words.
- **Regen still unfired at a real row** (inherited from the density run).
- **The conflict resolver is two choices, not a merge.** "Keep mine" re-bases and overwrites; there is
  no three-way diff. That is honest for a 1,700-character post, and a merge UI would be a bigger
  surface than the problem.
- **The queue is a snapshot** taken at open. A row added to the section while the window is open is
  not in the rail until it is reopened. The alternative — re-scoping the queue under a live `j`/`k`
  walk — is worse.
- **The LM window still cannot approve.** Not a gap; the unverifiable-publish rule stands until
  someone reads the watcher.
- Named candidates, not built: `Restart` for a disqualified row; the LM cover picker; the image
  library. Each is a surface, not a button.

## 9 · Where everything is

`before/` (live, pre-run) · `after/` (local, first build) · `verify-local/` + `verify-live/`
(`verify.json` + 6 shots each) · `roundtrip/` (`roundtrip.json` + 3 shots) · `writeprobe/`
(`writeprobe.json`). Probes: `_shots.mjs`, `_wverify.mjs`, `_roundtrip.mjs`, `_writeprobe.mjs`.
Unit tests: `src/lib/saveConflict.test.ts`.
