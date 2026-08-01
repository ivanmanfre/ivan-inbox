# Phase 1B — Content section IA, lane-separated

Goal-run `inbox-claude-brain-and-voice-2026-08-01`. Written 2026-08-01 read-only against:
live Supabase (service-role reads only, no writes), `exp/brain` working tree (byte-identical
to `exp/v2` for every content file — `git diff exp/v2 -- src/lib/content.ts src/lib/styles.ts
src/exp/v2c/{ContentList,DraftPane,ReviewActions}.tsx src/hooks/{useContent,useStyles}.ts`
returns empty), and `/Users/ivanmanfredi/Desktop/personal-site`.

Every count below was re-counted today, not inherited from Phase 0. Where a Phase 0 number
moved, both are stated.

---

## 0. The organising principle

**Two lanes. Nothing else.**

| Lane | Human name (every label, every string) | Identity in data |
|---|---|---|
| A | **Ivan** | `carousel_drafts.client_id IS NULL` — plus three row sets that carry *no tenancy column at all* and are therefore Ivan's by construction |
| B | **Mattan Danino** | `carousel_drafts.client_id = 'risedtc'` |

Lane B is named **Mattan Danino** everywhere a human reads it. The string `'risedtc'` is a
database value and stays in `ContentLane`, `laneFilter()`, and query code — it never reaches
a label. **This is a rename of shipped copy**: `ContentList.tsx:165` renders the chip `Rise`,
`:169` renders `"{n} of {m} on Rise's board"`, and `ContentList.tsx:63` / `DraftPane.tsx:108`
render `"On Rise's board"`. All four become `Mattan Danino` / `"on Mattan's board"` /
`"On Mattan's board"`. `DraftPane.tsx:218` (`lane === 'ivan' ? 'Ivan' : 'Rise'`) likewise.

They are two lanes and not one filtered list because **they obey different rules**:

| | Ivan | Mattan Danino |
|---|---|---|
| Terminal fact of a row | did it publish | **is it on Mattan's board** (`board_visible`) |
| Who decides | Ivan, in this app | Ivan promotes; **Mattan** approves/edits/reschedules on his own board |
| Operator writes here | `approveDraft` / `skipDraft` (2, both `.is('client_id', null)`) | **none** |
| Row sets present | drafts + ideas + publish queue + resources + styles | drafts + resources (5) + styles |
| Ceiling | 4 posts/week (canon) | not derivable from code — see §3.6 |

`laneFilter()` is the only correct way to scope. `.eq('client_id','ivan')` returns zero rows
and renders a calm, wrong, empty board (`content.ts:45-51`) — the trap has already cost a
session and is pinned by a unit test. Every read in this spec goes through it.

---

## 1. Row sets and where each one lives

Counted 2026-08-01 by direct PostgREST read.

| Row set | Rows | Tenancy column? | Lane | Writable here |
|---|---|---|---|---|
| `carousel_drafts` | 282 | `client_id` nullable | **198 Ivan / 84 Mattan** | Ivan lane only, 2 status writes |
| `scheduled_posts` | 152 | **none** (`client_id` 42703s) | Ivan, *by construction* | never |
| `lm_idea_candidates` (`status='reviewing'`) | **53** (Phase 0 said 48 — the table is written live by content-radar; both readings are correct at their instant) | **none** (`client_id` 42703s; `workspace_type` and `campaign_id` are NULL on all 53) | Ivan, *by construction* | never |
| `lm_drafts_v2` | 127 = **121 Ivan / 5 Mattan / 1 `_r1atest`** | `client_id` nullable | both, split | **never — read-only on purpose** |
| `content_prompts` style rows | **17** = 11 structure + 6 image | `scope`, all `shared` | shared registry, rendered in both lanes | never |

Two corrections that change the IA:

- **The briefing's "121 resources" was right and Phase 0's "127" was the whole table.** The
  Ivan lane holds 121; Mattan holds 5; one row is a `_r1atest` test tenant that belongs to
  neither and is dropped (§4.4). Of Ivan's 121, only **44** carry a `resource_url`, which is
  what `fetchResources()` already filters on (`styles.ts:228`).
- **The stuck proof row `bb07706c-afdf-45ef-ac03-59b1cd8c512f` is `client_id='risedtc'`** —
  it is in **Mattan's** lane, not Ivan's. `fetchResources()` is hardcoded `.is('client_id',
  null)`, so today that row can appear on no inbox surface at all. Surfacing it is a
  lane-scoped **read** change (§3.5), not a write.

---

## 2. Lane A — **Ivan**

### 2.1 Stages, mapped to real statuses

`carousel_drafts` where `client_id IS NULL`, 198 rows today:

| Stage (`stageOf`) | Real status | Rows today | Renders |
|---|---|---|---|
| Ideas | *(no `carousel_drafts` row — see 2.2)* | 0 from drafts, **53** from `lm_idea_candidates` | own section, read-only |
| Generating | `generating` | 0 | section hidden when empty |
| Needs review | `review` | **16** | section, the only `sev='attention'` mark |
| Approved | `approved` | **0** | hidden; detector stays (2.4) |
| Scheduled | `scheduled` (not stuck) | **2** (2026-08-12, 2026-08-27 — both genuinely future) | section + publish-queue strip (2.3) |
| Published | `published` | **109** | section, collapsed by default |
| Errors | `error` | **2** | **alert strip above the flow** |
| Stuck | `scheduled` ∧ past-due ∧ no `source_post_id` | **0** | alert strip |
| Archived | `disqualified`, `skipped` | **69** | bottom section, collapsed |
| Other | anything the n8n vocabulary grows | 0 | bottom section, **never dropped** |

Render order is `PIPELINE_STAGES` and nothing else — there is no second ordering constant.
`error`/`stuck` are lifted out of the flow into one strip (`ALERT_STAGES`): an errored row is
not a step on the way to publishing.

### 2.2 Ideas — `lm_idea_candidates`, Ivan lane, read-only

53 rows at `status='reviewing'`. The table has **no tenancy column**, so it is Ivan's by
construction — the same argument as `scheduled_posts`, and it must be written down because
"no column" is easy to misread as "unscoped, show everywhere".

Per row, from real columns: `normalized_topic` (title) with `raw_topic` beneath when they
differ · `composite_score` (populated on **all 53**) · `icp_fit_score` / `virality_score` /
`gap_score` / `beat_fit_score` / `signal_strength` · `why_score` (the scorer's prose) ·
`source` (**claude_sessions 20 · kyle_call 16 · calls 15 · manual 1 · youtube_watch 1**) ·
`source_ref` / `slack_permalink` · `content_type` (post 50 / lead_magnet 3) ·
`format_recommendation` · `post_angle` · `offer_ladder_map` · `ivan_engaged` (true on 15) ·
`ingested_at` / `scored_at`.

Promotion linkage: `promoted_draft_table` + `promoted_draft_id` + `promoted_clickup_task_id`.
All three are NULL on every reviewing row (as they must be), and they are the join back to a
`carousel_drafts` row once an idea is promoted — that link is what lets a draft's detail
screen show "promoted from this idea" (§5.3).

🔴 **Dedup trap, restated for this surface.** An idea's identity is derived from the LLM's own
title text, so the same idea re-ingested with a re-worded title is a *different row* and
nothing dedups it. Today 53/53 `normalized_topic` values are distinct, which proves nothing —
it is the mechanism, not the sample. Consequences that are load-bearing here:
**(a)** never render a count of ideas as "N distinct topics"; it is "N rows";
**(b)** never key any UI state (open/collapsed, filter selection, read-marker) on the idea id
across refreshes; **(c)** never dedup client-side by title — that would hide a real duplicate
signal the scorer is meant to see.

Affordance: **none**. `operator_approve_idea` exists and is what promotes an idea, but it
lives on ClientOps and is client-scoped (`operator_client_ideas` / `client_ideas`), not this
table. The inbox exposes no idea write and none is proposed (§AFFORDANCES).

### 2.3 The publish queue — `scheduled_posts`, Ivan lane, read-only

152 rows, **its own status vocabulary** (`QUEUE_STATUSES` = `pending, queued_v2, posting,
posted, failed, cancelled`) which is unrelated to `carousel_drafts.status`. Live today:
**posted 135 · cancelled 15 · pending 2**. Both pending rows are future-dated (2026-08-12
12:30Z, 2026-08-27 16:00Z) — legitimately queued, not orphaned.

Other real columns worth carrying: `post_kind` (reach 151 / capture 1) · `platform`
(linkedin 150 / instagram 2) · `is_repost` (true on 3) · `error_message` (**non-null on 9
rows** — the only place a publish failure is written down) · `clickup_task_id` (148; the
legacy join key) · `posted_at` · `unipile_share_url`.

Placement: a **strip inside the Ivan lane's Scheduled section**, not a section of its own and
not a third destination. It answers one question the drafts table cannot: *did the thing that
was scheduled actually go out.* The pairing rule is `carousel_drafts.status='scheduled'`
(what the n8n bridge picks up) vs `scheduled_posts.status='posted'` (what actually shipped);
where a queue row carries `error_message`, it renders in the **alert strip** next to the
draft errors, because a failed publish and a failed generation are the same class of fact to
the operator even though they live in different tables.

🔴 The bridge trap belongs in this UI's copy: flipping a draft to `'scheduled'` is what makes
n8n `yzXqLDIpuNzuhUQq` publish it. The inbox therefore **never writes that status** (§4.1),
and the queue strip is labelled as a mirror of the bridge's output, never as a control.

### 2.4 Two detectors that must stay even at zero

- **`isStuckScheduled`** — a `scheduled` row past its time with no `source_post_id` (the
  publisher's URN). Also true for a `scheduled` row with **no `scheduled_at` at all**: the
  dashboard's calendar filters on non-null `scheduled_at`, so such a row is invisible there
  *and* can never fire. **0 rows today.** Ships anyway; the alert strip renders the count.
- **Approved-with-no-date** — `countUndated(stages.approved)`, rendered as the
  `wb-pipe-warn` figure and as a sub-line inside the Approved section. **0 rows today**
  because `carousel_drafts` currently holds *no* `approved` rows in either lane.

🔴 **Extension this run:** the only real instance of the approved-but-undated failure in the
whole database is in `lm_drafts_v2`, not `carousel_drafts` — `bb07706c…`
(`rise-dtc-repeat-customer-report-card`), `status='approved'` since 2026-07-23, `landing_url`
still NULL 9 days later, and it is in **Mattan's** lane. The detector as shipped can never
see it. The spec therefore carries the same predicate onto the resource row set:
*a resource at a terminal-looking status with no live URL is stuck*, evaluated per lane, and
rendered in that lane's alert strip. This is a read and a boolean; it adds no write.

### 2.5 Ceiling

**4 posts/week.** Canon, not derivable from this codebase. Rendered as a denominator on the
Ivan lane only — "N scheduled this week of 4" — with a hard rule from the same canon: it is
an advisory denominator, **never a quota, never a gate, never red**. Nothing in the UI
blocks, warns, or scores against it.

Mattan's ceiling: see §3.6.

### 2.6 Agent material owned by the Ivan lane

See §6 for the full disposition of all four `n8nclaw_*` streams.

---

## 3. Lane B — **Mattan Danino**

### 3.1 Why this lane is shaped differently

84 rows, and **70 of them are `review`**. On the Ivan lane `review` means "waiting on Ivan to
approve". On this lane it means something else entirely: a Rise draft sits at `review` while
it is *available to be promoted*, and the fact that decides its life is `board_visible`, not
its status. 20 of the 84 are on Mattan's board; 64 are internal. Reading this lane through
the Ivan pipeline's eyes produces "70 things waiting on you", which is false.

So the Mattan lane's **primary grouping is promotion state**, with lifecycle stage as the
secondary key inside each group.

### 3.2 Stages and groups

| Group | Predicate | Rows today | What it means |
|---|---|---|---|
| **On Mattan's board** | `board_visible === true` | **20** | Mattan can see, edit, approve, veto, reschedule these on his own board. Strict `=== true`: NULL is not visible (`countBoardVisible`). |
| **Internal** | `board_visible !== true` | **64** | exists on our side only; Mattan has never seen it |
| — sub: needs a decision | `status='review'` | 70 across both groups | the promotion pool |
| — sub: published | `status='published'` | 9 | already out |
| — sub: errors | `status='error'` | **3** | alert strip |
| — sub: archived | `status='disqualified'` | 2 | bottom |

`scheduled_at` is populated on only **14 of 84** — the Mattan lane's calendar lives on the
client board and in the board JSON `queue`, not in this column, which is exactly why buffer
and schedule are read-only here (§3.4).

### 3.3 The promotion path (specified, not shipped)

Promotion is `operator_set_board_visible`. Verified signature and gate:

```
supabase.rpc('operator_set_board_visible', { p_gate: 'clientops', p_draft_id, p_visible })
   — personal-site/components/dashboard-v2/sections/clientops2/shared.tsx:446 (call)
   — GATE is the literal string 'clientops' (shared.tsx:21), a namespace, not a secret
   — supabase/migrations/20260719_rls_closure_waves.sql:450-454:
       revoke execute … from anon, public;  grant execute … to authenticated
```

So the *technical* gate would permit the inbox to call it: the inbox authenticates a real
Supabase session (`LoginScreen.tsx`, and `claude.ts` re-reads `supabase.auth.getSession()`
per send), i.e. role `authenticated`. **It still does not ship this run.** Reasons, in order:

1. The inbox codebase exposes **no** promotion path today; adding one is a new client-facing
   mutation, and the standing rule is that a new client-facing artifact is handed over by
   Ivan personally before any surface can trigger it.
2. The dashboard's toggle is only enabled while `status === 'review'` — that precondition is
   enforced in ClientOps' UI, not inside the RPC, so an inbox button would be a *weaker* gate
   wearing the same name.
3. `content.ts:255-262` already fixed this posture in code (`reviewActionable` returns false
   for every non-Ivan lane) and the Rise lane's read-only-ness is unit-tested.

The IA therefore renders promotion state as a **fact with provenance**, and where the action
belongs: the group header on "Internal" reads that promotion happens in Client Ops, and the
row shows nothing that looks pressable. The RPC is named here so that if it is ever armed, it
is armed deliberately with the `status='review'` precondition copied across, not rediscovered.

### 3.4 Buffer and schedule — read-only, with the two mechanics that matter

Mattan's forward calendar is owned by `operator_schedule_draft` on the dashboard and by the
client board itself. This lane shows it and never touches it. Two mechanics carry into the
copy because they explain what the operator is looking at:

- **Buffer slot rule**: `nextBufferSlot()` = today + 4 days, rolled off Saturday (+2) and
  Sunday (+1) (`shared.tsx:151-158`). So "scheduled" on this lane always means ≥4 days out on
  a weekday. A date closer than that was set by hand or by Mattan.
- 🔴 **`awaiting_media`**: `operator_schedule_draft` refuses a draft with no media and returns
  `error: 'awaiting_media'`; ClientOps swallows it into a quiet "waiting on image" note
  (`ClientOps.tsx:174`, `shared.tsx:463`). This is the codified form of the regen trap —
  **a Rise draft regeneration wipes `image_urls`, and the re-pinned photo has to be put back
  or the schedule silently refuses.** The inbox renders it explicitly: any Mattan-lane row at
  `review` with an empty `image_urls` gets a persistent inline line — *"No image. A regen
  clears `image_urls`; the photo has to be re-pinned before this can be scheduled
  (`awaiting_media`)."* — not a toast, not a badge, and never auto-anything. 14 of 84 rows
  are affected today (`image_urls` empty on 14).

### 3.5 Mattan's resources

5 `lm_drafts_v2` rows: `approved` 1 (**the stuck row, §2.4**), `live` 1, `review` 1,
`disqualified` 2. Read-only, same as Ivan's — the publish watcher owns this table and no
inbox affordance may resemble an approve. Rendered as a short section under the lane's
pipeline, with the stuck row lifted into the lane's alert strip carrying its real age
("approved 9 days ago, no landing URL").

### 3.6 Ceiling — **unknown, and said so**

There is **no** weekly-cap constant anywhere in `personal-site` (`grep` for
`postsPerWeek|posts_per_week|weekly_cap|WEEK_CAP|perWeek` → zero hits) and none in the inbox.
What *is* in code is a cadence, not a cap: buffer slots land ≥4 weekdays out. The lane
therefore renders the **observed** figure — "N on Mattan's board · M scheduled" — and no
denominator at all. Inventing "of 4/wk" here would be fabricating a client commitment.

### 3.7 What this lane must never show and never do

Inherited from `ClientBoardPage.tsx`, which is the authority on what Mattan may see — but
note the direction: **that authority constrains Mattan's board, not this operator surface.**
The inbox is Ivan's; it shows the full machinery (scores, verdicts, agent names, rewrites) on
both lanes, because hiding an agent log from Ivan protects nobody. What carries across is the
*mutation* posture, not the display posture:

- No affordance that writes anything a client could see. Nothing auto-posts to a client.
- Approve/skip are absent on this lane (they are `.is('client_id', null)`-scoped anyway, so
  rendering them would be rendering buttons that silently do nothing).
- No copy on this lane may be judged against, or drafted in, Mattan's DM voice. 🔴 Mattan's
  POST voice ≠ DM voice ≠ comment voice; the rows here are POSTS. Any UI string that quotes
  or paraphrases a row is quoting a post, and any Claude prompt this pane hands over (§5.6)
  says so explicitly, so a voice check downstream cannot pick the wrong reference.

---

## 4. Cross-lane surfaces (rendered *inside* both lanes, never as a third destination)

### 4.1 The style roster

17 active `content_prompts` rows, enumerated live, never hardcoded (three historical
hardcoded catalogues were all wrong the day after they were written — `styles.ts:5-10`).
Two disjoint families by slug prefix: `style-%` (11, structure) and `image-style-%` (6,
image treatment).

🔴 **They collide on `before-after`.** `style-before-after` and `image-style-before-after` both
normalise to `before-after`. Every preview lookup goes through **`previewKeyFor(p)`** →
`previewKey(family, key)` → `"image:before-after"` / `"structure:before-after"`. A
family-blind key hands the image family's published examples to the structure card. Never
call `normalizeStyleKey` at a UI call site; `previewKeyFor` is the only entry point.

Previews are computed from **published rows of the lane you are in** (`previewsByStyle` over
that lane's rows), so the same roster reads differently per lane — which is the honest
outcome: Ivan's published rows carry `image_style` "Concept Visual" ×69, "Framework Diagram"
×26, "Stat Card" ×23, "Before/After" ×10; Mattan's are "Concept Visual" ×71 and almost
nothing else. An empty preview is a designed state (`styles.ts:174-179`); a wrong preview is
a lie.

Also inherited, and kept: `normalizeStyleKey` **does not fuzzy-match**. `DATA-LED` (a live
taxonomy value) and `style-data-driven` (a live slug) stay unmatched forever. That is
correct — a stemmer would silently attach one style's examples to another's card.

### 4.2 Pillar mix — Ivan lane only, and with a live vocabulary mismatch flagged

`StylesLive.tsx` compares actual `taxonomy.pillar` against `pillarMixTargets`
(`lib/strategyConfig.ts:224-230`): Translator 30 · Methodology 25 · Teardown 15 ·
Case Study 20 · Personal 10.

🔴 The values in the data are **lowercase snake**: Ivan lane `methodology 60 · translator 37 ·
teardown 19 · personal 15 · case_study 10` (57 rows carry no pillar); Mattan lane
`case_study 50 · teardown 4` (30 with none). The inbox keys on the **raw stored value** and
maps it to a display label; it never compares to the Title-Case constant directly. Any mix
figure renders with its own denominator ("of 141 Ivan rows that carry a pillar"), because
28% of Ivan rows and 36% of Mattan rows have no pillar at all and a percentage that hides
that is a fabricated number.

Pillar mix is rendered on the **Ivan lane only**: the target constant is Ivan's editorial
strategy. Mattan's lane shows pillar as a tag and a facet, with no target.

### 4.3 Resources

`lm_drafts_v2`, per lane, **read-only on purpose** — whether an n8n watcher treats
`status='approved'` as a publish trigger is unverifiable from either repo, so the inbox
offers no approve/edit affordance that might turn out to publish a page (`styles.ts:218-221`).
Ivan: 121 rows, 44 with a `resource_url` (which is what the existing fetch filters on).
Mattan: 5.

### 4.4 The leftover tenant

`lm_drafts_v2` holds one row with `client_id='_r1atest'` (status `disqualified`). It belongs
to no lane. **Dropped**, with the reason rendered nowhere but recorded here: it is a test
tenant, not a client, and the two-lane rule means an unrecognised tenant is excluded rather
than folded into Ivan's. This is the same fail-closed posture as the cross-tenant rule — an
unknown `client_id` is never coalesced to Ivan.

---

## 5. Per-draft detail — the full register

One surface, both lanes, lane deltas noted. This replaces/extends `DraftPane.tsx`.

### 5.1 Header

Title (`title` → `topic` → "Untitled"), topic beneath when it differs, type chip
(`typeLabel(type)`; live values Ivan `text 91 · single_image 91 · carousel 15 · video 1`,
Mattan `single_image 41 · text 26 · carousel 17`), stage chip (bad-variant for
error/stuck), and **on the Mattan lane only** the board chip: `On Mattan's board` /
`Internal`.

### 5.2 QA — full verdict register, not a chip

`qa` is a jsonb object with **23 distinct keys in live data**. `normalizeQa` currently reads
three of them. What the register renders, in this order:

| Block | Real keys | Rows carrying it |
|---|---|---|
| Score + verdict chip | `score` (163), `verdict` (228) | pass is **strictly** `verdict==='PASS'`; REWRITE_OK / FAIL / missing all read amber |
| Verbatim feedback | `feedback` (229) | shown verbatim under the chip, never re-derived — a live row has `verdict:'PASS'` with `feedback` containing `VERDICT: REWRITE_OK`, and the contradiction is the information |
| 🔴 **The applied rewrite** | `rewrite_text` (**150**), `rewrite_total` (150), `rewrite_applied`, `original_verdict` | this is *what actually shipped* when a gate rewrote the post. Dropped today. It is the voice-drift blind spot `QAVerdictPanel` was built to close; carrying it is the single highest-value field in this spec |
| Regeneration history | `qa_regen_history` (10), `qa_regen_attempts` (10), `regenerate_instruction` (161), `iteration` | per-attempt score + issue count + whether a rewrite was applied |
| Gate detail | `failing_slides` (153), `claim_check` (103), `lint_violations`, `lint_quota_violations`, `lint_attempts`, `perSlide` | rendered when present |
| Provenance of the QA row itself | `parse_success` (161), `auto_promoted` (160), `published_version` (160), `backfilled` (65), `backfill_v` (64) | a backfilled QA verdict is not the same evidence as a live one and must say so |

Nothing here is truncated behind "Show more". Long prose wraps; the register is a document.

### 5.3 Source / provenance

`taxonomy.source` (263 rows) · `source_label` · `source_ref` (106) · `client_idea_id` (14) ·
`source_post_id` (spun from an existing post) · `taxonomy.source_candidate_id` (42, the join
back to `lm_idea_candidates`) · `taxonomy.auto_promoted` (44).

🔴 **`source_detail` is an object, not a string.** Live shapes: `{kind,label,metric,slug,
source_url}` ×34 · `{carousel_of,format,generator,kind,slug}` ×14 · `{kind,label}` ×6 ·
`{call_title,kind,label,quote}` ×4 · `{kind,label,lm_ref}` ×3 · plus 4 more shapes; only
**3** rows hold a bare string. **63 of the 71 object-shaped rows are in Mattan's lane.**
`content.ts:376` types it `string | null` and `DraftPane.tsx:83` pushes it straight into JSX
as a React child — which throws *Objects are not valid as a React child* and takes the pane
to a blank. **The current build almost certainly cannot open most Mattan drafts.** The spec:
normalise `source_detail` through the same `parseMaybeJson` discipline as every other
agent-written column, render `kind`/`label` as the chip, `quote` + `call_title` as a blockquote
(this is the real call quote the client board shows as its honest source chip), `source_url`
/ `slug` / `lm_ref` as links, and unknown keys as label/value rows — never dropped.

### 5.4 Agent / generation log — full register

`agent_log` is a jsonb array; **267 of 282 rows carry at least one entry**, longest is 37
(proof row `792ee91c-5b0e-475b-9150-3bee9937bbb5`, Ivan lane, published).

Real entry shape across 2 999 entries: `agent` (2999) · `ts` (2996) · `body` (2996) ·
`source` (2996) · `comment_id` (598) · three stragglers using `at`/`note`/`action`.

🔴 **`normalizeAgentLog` returns `{ts, body}` and throws away `agent` and `source`.**
(`content.ts:414`, `:422-450`.) The pane therefore renders 37 timestamped paragraphs with no
idea *who* wrote any of them — the single largest field gap in the content surface. The spec
adopts the dashboard's shape verbatim:

```ts
type AgentLogEntry = { ts: string | null; agent: string | null; body: string;
                       source?: string | null; comment_id?: string | null }
```

and keeps every existing survival property: any shape in (array / bare string / JSON string /
null / `{message}`/`{text}`/`{note}` bodies), never throws, sorted **only** when every entry
carries a parseable timestamp (a partial sort invents a history the data does not have).

What the register shows per entry — full, no truncation, no "Show more":

1. **Who** — `agent`. 36 distinct names live; the top of the roster is `Hook Agent 338 ·
   Content Agent 334 · QA Agent 332 · QA Regen Loop 261 · Lint Gate 248 · Forbidden Language
   Gate 227 · AI-Slop Gate 198 · ⚠ Claim Check 142 · IG Caption Lint Gate 135 · Editorial
   Agent 134 · Stuck Sentinel 121 · Publisher 84 · Promoter 82 · Scheduling Agent 68`.
   Unknown names render as themselves — the roster is enumerated from data, never hardcoded.
2. **When** — absolute timestamp, plus elapsed-since-previous, which is what makes a stall
   legible (the proof row opens with a Stuck Sentinel entry 23 minutes into silence).
3. **What** — `body`, in full. Where the body is JSON, the dashboard's `humanizeBody()`
   behaviour is adopted (pull `qa_feedback`/`feedback`/`overall_feedback`/`generated_post`/
   `final_post`/`hooks_text`/`revised_caption`/`summary`/`verdict_summary`/`note`/`text`/
   `body`/`message`), **but** the raw payload stays reachable in place rather than being
   dropped — the dashboard's slimming (drop `*_body`, `*_raw`, `rewrite`, `qa_rewrite`, any
   string >600 chars) exists because that surface truncates to 160 chars; this one does not.
4. **Verdict/score parsing, adopted** — `detectStatus()`'s classification (scan `body` for
   `VERDICT: PASS|FAIL|REWRITE_OK|NEEDS_REGENERATE`, `APPROVED`, or an agent name containing
   `HALT`) drives a per-entry chip, and `parseIteration()`'s regex extraction (`Status:`,
   `VERDICT:`, `SCORE:` 1-10, an `ISSUES:` count, a `REWRITE:` block surfaced when >30 chars)
   drives the **score progression across attempts** and the delta since first pass. This is
   layered *on top of* the entry, exactly as personal-site does it — the parse is presentation,
   never a stored field, and when a body does not match, the entry still renders whole.
5. **Where it came from** — `source`: `n8n 2378 · clickup_backfill 598 · goal-run 18 ·
   dashboard 1 · claude 1`, 3 null. A `clickup_backfill` entry is historical reconstruction,
   not a live agent step, and is marked as such; `comment_id` (598) rides with those.
6. **The merged timeline.** ClientOps merges the linked idea's `agent_log` into the draft's,
   oldest→newest, with a note when the idea log is non-empty. Carried: when `client_idea_id`
   or `taxonomy.source_candidate_id` resolves, the idea's log is prepended and labelled, so
   "who promoted this" is visible at the top of the same scroll instead of one screen away.

Read against the proof row, the register must legibly render: Stuck Sentinel firing at 23
minutes → a first pass poisoned by a session-limit error string leaking into
`generated_post` → Lint Gate `VERDICT: PASS after 1 regeneration attempt(s)` with the
`word_cap: 171 words` reason → three further full QA cycles at REWRITE_OK 68/90 → 69/90 →
74/90 → a final clean pass across Lint / Slop / Forbidden-Language / Caption gates →
Publisher's `urn:li:activity:…` five days later. **All 37 entries, each with its agent name,
no collapse.**

### 5.5 The rest of the row

- **Post body** — verbatim, monospaced-preserved whitespace, never clamped.
- **Images** — `normalizeImageUrls` (handles a single bare URL). Ivan 105/198 rows carry
  images, Mattan 70/84. On the Mattan lane an **empty** image set at `review` carries the
  `awaiting_media` re-pin warning (§3.4).
- **Key points** — `normalizeKeyPoints`; only 13 rows have any. Renders when present.
- **Description**, **IG caption**, **PDF link** (21 rows) — as today.
- **Slide metadata** (17 rows) and `taxonomy.carousel_style` — carousel rows only.
- **Dates** — created / updated / scheduled (ahead-aware) / published.
- **Dead columns, named so nobody re-adds them:** `style_id` is **NULL on all 282 rows** —
  the style a row claims lives in `taxonomy`, not here (§5.6). `regen_slides` NULL on all
  282 — regeneration lives in `agent_log` and `qa.qa_regen_*`. `video_status` NULL on all 282.
  `scheduled_posts.source` NULL on all 152.

### 5.6 Taxonomy — mapping the mission's vocabulary onto the real columns

The mission names `structure_used` and `image_style` as if they were columns. **They are not
columns.** `carousel_drafts` has 38 columns; the two relevant ones are `style_id` (a style
prompt reference — **NULL on every row in the table**) and `taxonomy` (jsonb). The mission's
vocabulary maps like this:

| Mission term | Real location | Coverage |
|---|---|---|
| `structure_used` | `taxonomy.structure_used` | 112 rows (Ivan 39 / Mattan 73). Values are SHOUTY: `HOW-TO / DECLARATIVE`, `TEARDOWN`, `FRAMEWORK WALKTHROUGH`, `HOT TAKE`, `DATA-LED`, `STORY`, `CONFESSIONAL`, `CASE STUDY` |
| `image_style` | `taxonomy.image_style` | 207 rows. Title Case: `Concept Visual` 140, `Framework Diagram` 26, `Stat Card` 23, `Before/After` 10, plus one-offs incl. free prose (`RISE frame + real client photo + Gemini mockups`) |
| "style" as a registry | `content_prompts` slugs, family-keyed | 17 rows; joined to drafts only through `normalizeStyleKey` + `previewKeyFor` |
| `style_id` | exists, **always NULL** | 0/282 |

`taxonomy` is an object on 278 rows and a **bare string** on 4 — and a bare string is read as
`structure_used` (that key predates `image_style`; every observed bare string is a structure
name). Live keys beyond the six `TAXONOMY_KEYS`: `value_tier` 179 · `target_persona` 160 ·
`precondition_target` 159 · `image_description` 158 · `visual_content_link` 158 ·
`structure_reason` 110 · `error_message` 63 · `error_flipped_at` 63 ·
`generating_started_at` 46 · `post_angle` 44 · `auto_promoted` 44 · `source_candidate_id` 42 ·
`experiment` 41 · `source_post_id` 40 · `last_requeue_at` 9 · `requeue_attempts` 9 ·
`pillar_backfilled` 7 · `brand`/`city`/`format`/`register`/`image_required`/`lifestyle_idea_id`
5 each · `lm_launch` 3 · `carousel_style` 1.

**Spec:** the taxonomy block renders the six known keys as labelled rows in fixed order
(`source`, `pillar`, `hook_type`, `structure_used`, `image_style`, `experiment.arm`) **and
then every remaining key** as a label/value row, sorted, so a key the generator adds next
month appears the day it appears instead of the day someone edits `TAXONOMY_KEYS`. Two keys
get special handling: `error_message`/`error_flipped_at` (63 rows) surface next to the error
stage chip, because that is where an errored row's reason actually lives; and
`structure_reason` (110) renders directly beneath `structure_used` as its justification.

`experiment.arm` flattens to `arm`, as today. **41 experiment rows, all in the Ivan lane —
0 on Mattan's.** The arm chip therefore never renders on Mattan's lane, from data, not from
a rule.

### 5.7 Ask Claude

The existing `Ask Claude` button opens the chat peer carrying the draft's label. Unchanged in
mechanism. One addition to the handed-over context: the **lane and the register** — "this is a
POST in Mattan Danino's lane" — so a downstream voice check cannot judge a post against DM or
comment voice. That is a string in the context payload, not a new affordance.

---

## 6. Agent material — every `n8nclaw_*` stream placed, every leftover resolved

There is **no AgentOps destination**, and none is created. `src/lib/agent.ts` and
`src/hooks/useAgent.ts` exist in the inbox and are consumed **only** by the retired `cand-a/b/c`
shells — v2c reads none of them. Disposition:

| Stream | Live state (read 2026-08-01) | Lane | Placement |
|---|---|---|---|
| `n8nclaw_proactive_alerts` | **20 rows, all `alert_type='pipeline_stall'`, all `sent=false`, newest 2026-05-25 (68 days old)**. Bodies are "N posts stuck in pipeline" over *Ivan's own* content; `data.tasks[]` carries **ClickUp task ids** (`86ahjhub4`), not draft uuids | **Ivan** — it is an alarm about Ivan's content pipeline | **Ivan lane alert strip**, as a single count line, never as rows: *"20 unacknowledged pipeline alerts, newest 68 days old — ClickUp-era task ids, no draft link."* This is exactly `fetchAlerts`' `olderUnsent` behaviour (14-day window; every row is outside it, so the windowed list is legitimately empty and the count is the whole story). No Ack button ships (§AFFORDANCES) |
| `n8nclaw_daily_summaries` | 7 recent; `topics` mix content work with personal finance ("portfolio performance", "Bitcoin holdings") alongside "LinkedIn post history", "voice consistency" | **Ivan** | **Ivan lane, collapsed section at the very bottom**, read-only: date · `message_count` · `summary` · `topics` · `action_items`. Never on Mattan's lane; never interleaved with drafts. Justification for keeping it at all: the summaries are the only written record of decisions Ivan made about content *outside* this app |
| `n8nclaw_reminders` | 35 rows, 11 pending; content is personal — `💊 Take your RETA`, `💉 Take your HCG!`, `Cancel ClassPass` | Ivan's, but **not content** | **DROPPED from the content section**, explicitly. Rendering a medication reminder inside a content pipeline is a category error, and there is no content-shaped reminder in the table to justify a filter. It gains no surface in this run |
| `n8nclaw_chat_messages` | newest 2026-07-29; the WhatsApp assistant transcript | Ivan's, but **not content** | **DROPPED from the content section**. The workbench already has a chat peer (Claude); a second, different chat inside a content lane would teach that the two are the same thing. `sendChat`'s hardened RPC-only path (`agent.ts:151-164` — the dashboard's spoofed-webhook fallback is deliberately not ported) stays unused here |

**Leftovers that are neither lane's content and are resolved elsewhere:**

- **`ops_drafts`** (Ops job) — carries a real `client_id` with both `ivan` and `risedtc`
  engines, so it *looks* like it belongs to the lanes. It does not move. It has its own
  approve semantics that are strictly more dangerous than anything in the content section:
  🔒 on the comment lane, approve **publishes**; `weekly_report` approve *is* the send
  (`ops.ts:227-233`); rows expire. The content section links to Ops for a content-shaped row
  (newsjack, weekly_report) and **never mirrors an approve button**.
- **`client_board_actions` / `operator_client_actions`** (Mattan's edits, approvals, voice
  notes) — genuinely Mattan-lane material and genuinely valuable (his board edits are the
  voice-signal source). Not carried this run: it needs `operator_client_actions`, an RPC the
  inbox has never called, and the read is only half of it (the dashboard pairs it with
  `operator_mark_actions_seen`, a write). Named in FIELD-DIFF as a deliberate, sized gap.
- **`carousel_drafts` rows with `board_visible=true` and `client_id IS NULL`** — there are
  **4**. A board flag on an Ivan row is meaningless (Ivan has no client board). They stay in
  the Ivan lane and the board chip is simply not rendered there. Recorded so the next reader
  does not conclude the Ivan lane needs a promotion concept.

---

## 7. Read map — every query this IA needs

All lane-scoped reads go through `laneFilter()`. Nothing new is invented; the two additions
are marked.

| # | Read | Function | Status |
|---|---|---|---|
| R1 | lane drafts, recent-or-active, exact count | `fetchContentDrafts(lane)` | shipped |
| R2 | lane probe (`scoped` vs `total`, so "empty" and "the filter ate everything" cannot render the same) | `fetchLaneProbe(lane)` | shipped |
| R3 | one full draft | `fetchDraftDetail(id)` | shipped |
| R4 | publish queue | `fetchScheduledQueue()` | **shipped but unconsumed** — this IA is its first consumer |
| R5 | style roster | `fetchStyleRoster()` | shipped, unconsumed by v2c |
| R6 | resources | `fetchResources()` | shipped, **Ivan-only hardcoded** → needs a lane parameter (read change) |
| R7 | reviewing ideas | — | **new read**, `lm_idea_candidates?status=eq.reviewing`, no tenancy column |
| R8 | agent alerts (windowed + older-unsent count) | `fetchAlerts()` | shipped in `lib/agent.ts`, unconsumed by v2c |
| R9 | daily summaries | `fetchDailySummaries()` | shipped in `lib/agent.ts`, unconsumed by v2c |

R6 and R7 are the only data-access changes and both are SELECTs. No RPC is added. No write is
added.

---

## 8. Honest-state rules that survive from the shipped surface

Non-negotiable, all already in the code and all kept:

- An **unreadable** board and an **empty** board never render the same (`Failed` vs
  `CalmEmpty`, plus `laneTotal` to catch a filter that ate everything).
- A **deleted** draft and an **unreadable** draft never render the same (`missing` vs
  `error`).
- Counts come from the server's exact count, never `rows.length`, because PostgREST caps a
  SELECT at 1000 long before a header notices.
- `loadedAt` is stamped only on a **successful** read: an empty board with a fresh stamp is
  confirmed empty; an empty board with no stamp has never been read.
- Every realtime channel topic is `useId()`-namespaced, or a second mount binds
  `postgres_changes` to an already-subscribed channel and takes the tree to black.
- 🔴 The panel is blind to direct DB edits until the queue-sync webhook fires. Any figure this
  surface shows that a client board also shows may therefore disagree for minutes. No copy in
  this section may claim a client "has seen" anything on the basis of a local read.
