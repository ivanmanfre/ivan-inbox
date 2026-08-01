# Phase 1B — field-by-field diff: personal-site dashboards → inbox content section

Source for the dashboard side: `phase0-research-dashboards.md` (field inventory of
`ClientOps.tsx`, `ClientBoardPage.tsx`, `Calendar.tsx`, `StylesLive.tsx`, `AgentRebuilt.tsx`,
`AgentLogFeed.tsx`, `QAVerdictPanel.tsx`), spot-verified in `personal-site` where a claim was
load-bearing (`operator_set_board_visible` signature and grant, `nextBufferSlot`,
`awaiting_media`, `pillarMixTargets`).

Source for the inbox side: **read directly**, not inferred — `src/exp/v2c/ContentList.tsx`
(276 lines), `src/exp/v2c/DraftPane.tsx` (247), `src/exp/v2c/ReviewActions.tsx` (60),
`src/hooks/useContent.ts`, `src/exp/v2c/useContentBadge.ts`, `src/lib/content.ts`,
`src/lib/styles.ts`. All are byte-identical between `exp/brain` (checked out) and `exp/v2`
(`git diff exp/v2 -- <those paths>` is empty).

Decision column: **HAVE** (already rendered) · **CARRY** (gap → this spec adds it) ·
**FIX** (rendered but wrong/lossy) · **DROP** (with reason).

---

## 1. `ClientOps.tsx` + `clientops2/shared.tsx` → the Mattan Danino lane

### 1.1 Health strip (5 tiles)

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Avg idea-ICP (`aggregates.avgIcp`, `icpBand()`) | tile | — | **DROP.** Derived from `client_ideas` via `operator_client_ideas`, an RPC the inbox never calls, over a table it never reads. A mean with no visible denominator is also the shape this app has repeatedly refused. |
| Avg draft-QA (`aggregates.avgQa`, `qaN`) | tile, 1 dp | — | **CARRY, with the denominator.** Computable from rows already loaded: `qa` is non-null on 72/84 Mattan rows and 158/198 Ivan rows. Renders as "QA 74 avg · 72 of 84 scored", never a bare mean. |
| LM capture (`captures/views` across client LMs) | tile | — | **DROP.** Funnel telemetry lives behind `operator_client_lms`; it is board/marketing data, not content-pipeline data, and no inbox read touches it. |
| Buffer depth (board-JSON `queue.length`, `nextPublish`) | tile | — | **DROP for the count, CARRY the fact.** The board JSON is fetched by `get_client_board`, an RPC the inbox never calls. The inbox shows what it can actually see: `scheduled_at` populated on 14 of 84 Mattan rows, labelled as *our* view of the schedule, never as "Mattan's buffer". |
| Spend (`client.spend.total_usd/.week_usd`) | tile | — | **DROP.** `operator_clients_overview`; billing, not content. |
| "No red anywhere on this strip by design" | law | law kept | **HAVE.** The inbox's one red is the alert strip (`error`/`stuck`), same posture. |

### 1.2 Stage strip (01 Staged ideas → 02 In review → 03 On board → 04 In buffer)

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Staged ideas count | tile 01 | — (Ivan-lane ideas only, from a different table) | **DROP for Mattan.** `client_ideas` ≠ `lm_idea_candidates`; the inbox's Ideas stage is Ivan's by construction and there is no Mattan-lane idea source the inbox can read. Stated rather than faked. |
| In review, **the only red-if->0 count in the composition** | tile 02 | `SectionHead sev='attention'` on review | **HAVE, deliberately softer.** The inbox marks review with the neutral "attention", not red — 70 of Mattan's 84 rows are `review` and a permanent red on the normal resting state of a lane is noise. |
| On board (`board_visible=true`) | tile 03 | `countBoardVisible` + `"{n} of {m} on Rise's board"` chip | **HAVE → promoted.** In this spec it becomes the lane's **primary grouping**, not a chip (IA §3.2). |
| In buffer | tile 04 | — | **DROP**, as above. |

### 1.3 Ideas lane (`IdeasLane`)

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Band (`icpBand`), Angle (hook/title + `score_breakdown.why`) | table | — | **CARRY onto the Ivan lane, different table.** `lm_idea_candidates` gives `normalized_topic` + `post_angle` + `why_score`. |
| ICP·Buy·Auth out of 40/30/30 (`score_breakdown.icp_fit/buyer_signal/authority_fit`) | table | — | **CARRY, different scores.** The inbox's table exposes `icp_fit_score`, `virality_score`, `gap_score`, `beat_fit_score`, `composite_score` (all 53 rows scored) — a different rubric, rendered with its own names. Never relabelled into the dashboard's 40/30/30 vocabulary. |
| `rubric_version` | inspect | — | **CARRY if present** — the inbox's table has no such column; `scored_at` stands in as the honest equivalent. |
| Source label + link | table | — | **CARRY.** `source` + `source_ref` + `slack_permalink`. |
| Approve / Pass → `operator_approve_idea` | buttons | — | **DROP (write).** Client-scoped RPC over `client_ideas`; the inbox reads a different table and adds no write (AFFORDANCES). |
| `AgentLogFeed` on the idea row (`table='client_ideas'`) | inspect | — | **CARRY structurally, elsewhere.** The idea's own log is merged into the *draft's* register once promoted (IA §5.4 item 6), which is where "who promoted this" actually needs to be readable. |

### 1.4 Review lane (`ReviewLane`)

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Client-faithful post preview (`ClientPost`, client's own founder identity, never Ivan's) | yes | plain title + body text | **DROP the chrome, keep the separation.** The inbox is an operator surface; a LinkedIn-faithful mock is the client board's job. What carries is the rule it encodes: a Mattan-lane row is **Mattan's** post — IA §3.7 puts that in the pane header and in the Claude context string so a post can never be judged against DM or comment voice. |
| Posts vs "Lead magnet launches" rail groups | yes | — | **CARRY.** `content_type`/`taxonomy.lm_launch` (3 rows) + the resource section (IA §3.5). |
| Row meta: type · `QA {score}` · `on board` · age · `FunnelTag` (reach/trust/buyers) | yes | type chip · relTime · board chip; **no QA on the card, no funnel chip** | **CARRY both.** `funnel_stage` is populated on 80/84 Mattan and 157/198 Ivan rows and is currently rendered only inside the detail pane. QA score on the card is what makes a 70-row review list scannable. |
| **Schedule to buffer** → `operator_schedule_draft` | button | — | **DROP (write).** Not in the inbox codebase; scheduling is what the n8n bridge acts on. |
| **Edit copy** → `operator_edit_draft_body` | button | — | **DROP (write).** |
| **On board toggle** → `operator_set_board_visible`, disabled unless `status==='review'` | button | — | **DROP (write) — but named.** IA §3.3 records the exact signature (`p_gate:'clientops'`, `p_draft_id`, `p_visible`), the grant (`revoke … from anon; grant … to authenticated`, `20260719_rls_closure_waves.sql:450-454`), and the precondition that lives in the dashboard's UI rather than in the RPC. If it is ever armed, it is armed with that precondition copied across. |
| `awaiting_media` schedule refusal → quiet "waiting on image" | behaviour | — | **CARRY as the re-pin warning.** IA §3.4: a Mattan `review` row with empty `image_urls` (14 rows) carries a persistent inline line naming the regen wipe. This is the only place in either codebase where that trap is written down for a human. |

### 1.5 Inspect rail — the load-bearing provenance

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Pipeline provenance block: `idea_source_label`, `idea_source_ref` (link if URL), `idea_icp_score`+band, `source_post_id` flag, fallback "Pre-pipeline draft — no linked idea" | yes | `source_label` / `source_detail` / `source_ref` rows | **FIX + CARRY.** 🔴 `source_detail` is an **object** on 71 rows (63 of them Mattan's) — shapes `{kind,label,metric,slug,source_url}` ×34, `{carousel_of,format,generator,kind,slug}` ×14, `{call_title,kind,label,quote}` ×4, and more — while `content.ts:376` types it `string \| null` and `DraftPane.tsx:83` pushes it straight into JSX. React throws *Objects are not valid as a React child* on an object child, so **the current build almost certainly blanks the pane on most Mattan drafts.** Spec: normalise it, render `kind`/`label` as a chip, `quote`+`call_title` as a blockquote, urls/slugs as links, unknown keys as rows. Plus the explicit no-link fallback. |
| `QAVerdictPanel`: final verdict chip · iteration count · score delta since first pass · per-iteration score/issues/rewrite-applied · **the applied rewrite text** ("what auto-publish shipped") | yes | score + verdict chip + `feedback` clamped to 3 lines | **FIX.** IA §5.2. The inbox reads 3 of 23 live `qa` keys. `rewrite_text` (150 rows), `rewrite_total`, `qa_regen_history`/`qa_regen_attempts` (10), `failing_slides` (153), `claim_check` (103), `original_verdict`, `iteration`, `parse_success`/`auto_promoted`/`published_version`/`backfilled`/`backfill_v` all dropped today. The rewrite text is the voice-drift blind spot the dashboard panel exists to close. |
| `AgentLogFeed`: merged idea+draft timeline, `AGENT_ICON` roster of 17 named agents, `detectStatus()` PASS/FAIL/REWRITE/HALT chips, `humanizeBody()` JSON unwrap, `append_agent_log` note composer | yes | timestamp + body, each clamped to 5 lines behind Show more | **FIX (major).** 🔴 `normalizeAgentLog` returns `{ts, body}` and **discards `agent`** — present on **2 999 of 2 999** entries — **and `source`** (n8n 2378 / clickup_backfill 598 / goal-run 18 / dashboard 1 / claude 1) **and `comment_id`** (598). The proof row's 37 entries therefore render as 37 anonymous paragraphs. Spec: full entry shape, full bodies (no clamp), 36-name roster enumerated from data not hardcoded, `detectStatus`/`parseIteration` layered on top, `clickup_backfill` entries marked as reconstruction, merged idea log prepended. The **`append_agent_log` note composer is DROPPED** — it is a write, and the section ships read-only. |

### 1.6 Buffer lane / Live lane / Lead-magnet line / Actions feed

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Buffer calendar with drag-to-reschedule (`operator_schedule_draft`) | yes | — | **DROP (write).** |
| Buffer list = board-JSON `queue` ledger | yes | — | **DROP (read we cannot make).** `get_client_board` is not an inbox read. |
| Live lane: `board_visible=true` + already-`published`; toggle-off only while `status==='review'` | yes | board chip only | **CARRY the grouping, DROP the toggle** (IA §3.2/§3.3). |
| LM cards: status pill · **cover-pair picker** (two stores: `setLmActiveCover()` row covers vs `operator_set_lm_cover` board-JSON covers) · funnel figures · resource/landing links · embedded `LaunchBlock` · QA + agent log | yes | — | **DROP the cover picker (write, and a two-store trap), CARRY the read.** IA §3.5/§4.3 renders Mattan's 5 and Ivan's 121 resource rows read-only: `topic`, `format`, `status`, `resource_url`, `cover_url`, `landing_slug`. 🔴 `lm_drafts_v2` is read-only on purpose — an approve here might be a publish. |
| Client activity feed (`operator_client_actions`, 20 rows: edit_copy / approve / request_changes / shift_request / **voice_note with inline audio** / angle_swap / post_removed / …) + unseen badge + `operator_mark_actions_seen` | yes | — | **DROP this run, sized.** Genuinely Mattan-lane material and the source of his board-edit voice signals — but it needs an RPC the inbox has never called, and the badge half of it is a **write** (`operator_mark_actions_seen`). Recorded as the single biggest deliberate omission in the Mattan lane. |
| Outreach tab (`operator_client_outreach`) | yes | — | **DROP.** Not content. The inbox has its own Sends/Ops jobs. |

---

## 2. `ClientBoardPage.tsx` → what constrains the Mattan lane

This file is the authority on what **Mattan** may see. It constrains his board, **not** this
operator surface — the inbox is Ivan's, and hiding an agent log from Ivan protects nobody.
What carries across is the mutation posture and two display facts.

| Field / rule | Client board | Inbox decision |
|---|---|---|
| **No agent trail, no QA scores, no verdicts, no prompts, no model names, ever** on a live board (`DetailModal:3259-3273`) | hidden | **Does not constrain the inbox** — recorded explicitly so nobody "fixes" the inbox by stripping its register. It *does* constrain any string this section could ever hand to a client-visible path; there is none, because there is no write. |
| `STEP_LABELS` translation (`'Copy quality gate'` → "Quality check") | client-facing relabelling | **DROP.** The inbox shows the real agent names (`Lint Gate`, `AI-Slop Gate`, `⚠ Claim Check`, `QA Regen Loop`, …). Friendly nouns would make the register useless to the operator. |
| Ideas bank / Voice tab / Photos tab / story-intake are preview-only, hidden on live boards | hidden | **Confirms IA §2.2**: on a live client the idea queue lives on Ivan's side. The inbox's Ideas stage is therefore correctly Ivan-lane-only. |
| Stage vocabulary: client-friendly overrides; the standalone "Scheduled" stage **disappears** on live boards and folds into "Up next" so two buckets never "wear the same word" | yes | **Informs, does not copy.** The inbox keeps machine statuses because its reader is the operator — but the same anti-ambiguity rule is why `scheduled` is tested for stuck-ness before it counts as scheduled, and why `scheduled_posts` statuses are labelled as a **separate vocabulary** rather than merged with draft statuses. |
| Honest source chip: `source_detail {kind,label,call_title,quote,lm_ref}` — real call quotes, never a vague "Picked by Ivan" | yes | **CARRY** (§1.5 FIX). The client sees the quote; today the operator sees a crash. |
| History block: every `edit_copy`/`approve`/`request_changes`/`note` with before/after diff (`client_board_draft_history[_v2]`) | yes | **DROP this run** — same sizing as the actions feed (§1.6). |
| `chats.mock === true` → explicit "example · goes live when LinkedIn connects" badge; `SAMPLE_LEAD_PIPELINE` always labelled "example data" | yes | **Law carried.** No fabricated or sample content row may ever render unlabelled in either lane. The inbox has no sample data path; this is a standing prohibition, not a feature. |
| `CLIENT_TZ = 'America/Los_Angeles'` hardcoded for client-facing times | yes | **DROP.** Inbox renders the operator's local time plus absolute ISO. Recorded so a future "why is the time different from Mattan's board" question has an answer. |
| All writes go through the versioned `client_board_action[_v2]` family, session-token gated | yes | **DROP entirely** — the inbox never writes anything a client can see. Nothing auto-posts to a client. |

---

## 3. `Calendar.tsx` → the Ivan lane's Scheduled section

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Posts merged from `carousel_drafts` (title, status, `scheduledAt`) | yes | Scheduled stage section | **HAVE.** |
| Lead magnets merged from `scheduled_posts` "comment {keyword}" rows (title from `postText`, `clickupTaskId`, `platform`, `isRepost`) | yes | **nothing — `fetchScheduledQueue` has zero call sites** | **CARRY.** IA §2.3, the publish-queue strip. 152 rows currently invisible to the app. |
| Drag-to-reschedule → direct `carousel_drafts.update({scheduled_at, status})` | yes | — | **DROP (write).** 🔴 And the reason is the most dangerous mechanic in this diff: that update **also flips `status→'scheduled'`**, because the sync bridge `yzXqLDIpuNzuhUQq` only picks up `status==='scheduled'` rows (`incident-calendar-schedule-no-queue-2026-06-13`). Writing that status from the inbox would publish to LinkedIn. `content.ts:220-229` already forbids it in a comment; this diff makes it a spec line. |
| Paired direct write to the `scheduled_posts` row (`clickup_task_id===item.id`, guarded `.in('status',['pending','queued_v2'])` + `.select('id')` so a no-op move doesn't lie with a success toast) | yes | — | **DROP (write).** The guard's *lesson* is carried: no optimistic success state in this section without a returned row. |
| `CarouselEditor` / `LeadMagnetEditor` / `ScheduledPostEditor` sheets | yes | `DraftPane` (read-only) | **HAVE, read-only.** |
| `delete_scheduled_post` RPC (in `useContentPipeline`) | exists | — | **DROP.** No delete affordance ships. |

---

## 4. `StylesLive.tsx` → the roster + pillar mix

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Style set from `content_prompts` `slug LIKE 'style-%' AND is_active` — `slug,title,body,updated_at` | yes | `fetchStyleRoster()` exists; **no v2c consumer** (only `cand-a/b/c` render it) | **CARRY.** IA §4.1. 🔴 The dashboard's `LIKE 'style-%'` **misses the 6 image styles entirely**; `styles.ts:46` already fixes this with the two-pattern `or(...)`. The inbox roster is 17, the dashboard's is 11. |
| Blurb = first ~2 non-heading lines of `body`, ≤180 chars | yes | `body` fetched, unrendered | **CARRY.** |
| "updated" badge if `updated_at` ≤ 7d | yes | — | **CARRY.** |
| Honest RLS error state ("no access · content_prompts read blocked"), never a hardcoded fallback list | yes | `Failed` component | **HAVE (law).** Three historical hardcoded catalogues were each wrong the next day. |
| Per-style **published examples** | ✗ (the dashboard has none) | `previewsByStyle` exists, unconsumed | **CARRY — an inbox-only gain.** 🔴 Lookup **must** be `previewKeyFor` (family-qualified): the families collide on `before-after`, and a family-blind key hands the image family's 10 published Before/After examples to the structure card. |
| Pillar target vs actual: `pillarMixTargets` (Translator 30 · Methodology 25 · Teardown 15 · Case Study 20 · Personal 10) vs `taxonomy.pillar` counts on `published` rows in the last 30d, capped 500; drift bands at 25%/50% | yes | — | **CARRY, Ivan lane only, with a correction.** 🔴 The stored values are lowercase snake — `methodology 60 · translator 37 · teardown 19 · personal 15 · case_study 10` — while the target constant is Title Case, so a naive comparison scores every pillar at 0% actual. The inbox keys on the raw value and maps to a label. And it prints its own denominator: **57 of 198 Ivan rows carry no pillar at all**; a percentage that hides that is fabricated. |
| No client_id distinction (Ivan-only aggregate) | yes | — | **CHANGED deliberately.** The roster renders in both lanes with lane-scoped previews; the **target mix stays Ivan-only** (it is Ivan's editorial strategy — Mattan's lane shows pillar as a tag with no target: `case_study 50 · teardown 4`, 30 unset). |

---

## 5. `AgentRebuilt.tsx` ("AgentOps") → folded, not ported

There is no AgentOps destination and none is created (`JOBS` has no agent entry).

| Field | Dashboard | Inbox today | Decision |
|---|---|---|---|
| Stat strip: total messages (+today), logged this week, proactive alerts (+distinct types), pending reminders | yes | — | **DROP.** Three of the four count streams the inbox drops entirely (§below); a strip of counts for material that isn't rendered is decoration. |
| Transmission log (`n8nclaw_chat_messages`, role→Ivan/Agent, day separators, paginated 50, "load older") | yes | `lib/agent.ts` has it; **no v2c consumer** | **DROP from the content section** (IA §6). The workbench already docks one chat peer; a second, different assistant chat inside a content lane teaches that the two are the same thing. |
| **THE BOX** — up to 4 unacked alerts + **Ack** button → `dashboardAction('n8nclaw_proactive_alerts', id, 'sent', 'true')` | yes | — | **Alerts CARRY as a count line; Ack DROPS.** All 20 live alerts are `pipeline_stall`, unacknowledged, newest **68 days old**, and their `data.tasks[]` carries **ClickUp task ids** (`86ahjhub4`) not draft uuids — so there is nothing to deep-link and nothing today to act on. Renders in the **Ivan lane** alert strip as `olderUnsent`-style prose. Ack is a write through `dashboard_action`, a `SECURITY DEFINER` field-setter whose allowlist can also **arm outreach**; no write ships. |
| Alerts accordion (20 rows, dot by `sent`, type tag, per-row Ack) | yes | — | **DROP the rows** (all outside the 14-day window; stale-unsent ≠ actionable today), keep the count. |
| Reminders accordion + **Mark complete** → `dashboardAction('n8nclaw_reminders', id, 'status','completed')` | yes | — | **DROP.** 35 rows / 11 pending, all personal (`💊 Take your RETA`, `Cancel ClassPass`). Zero content semantics. |
| Summaries accordion (date, message count, summary, ≤4 topics) | yes | — | **CARRY** to the Ivan lane, collapsed, bottom, read-only, plus `action_items` (the dashboard omits them). The only written record of content decisions Ivan made outside this app. |
| Send (RPC `n8nclaw_dashboard_send`, **falling back to an unauthenticated spoofed-WhatsApp webhook POST** on any RPC error) | yes | `agent.ts:151-164` deliberately does **not** port the fallback | **DROP.** The hardened posture stands unused rather than being weakened; from a phone a stray retry would ghost-message the real assistant loop. |
| No `client_id` concept anywhere in `n8nclaw_*` | fact | — | **Resolved:** Ivan by construction, same argument as `scheduled_posts` and `lm_idea_candidates` (IA §1, §6). |

---

## 6. Inbox-side fields with no dashboard equivalent (kept, not diffed away)

These exist only in the inbox and are the reason its content surface is not a re-skin.

| Field | Why it stays |
|---|---|
| `fetchLaneProbe` → `{scoped, total}` | "Empty lane" and "the filter ate everything" render differently. Neither the dashboard nor this app could tell them apart before it existed. |
| `loadedAt` stamped only on a **successful** read | An empty board with a fresh stamp is confirmed empty; without a stamp it has never been read. |
| `missing` vs `error` on a single draft | A deleted draft and an unreadable one are different facts. |
| Exact server-side `count` alongside `rows` | PostgREST caps a SELECT at 1000 long before a header count notices; `rows.length` lies. |
| `unknown` / `other` stage buckets | Rendered, never dropped, so nothing can hide from the board just because the n8n status vocabulary grew. |
| `useId()`-namespaced realtime topics | A second mount on an existing channel throws inside the effect and takes the tree to black. |
| Confirm sheets whose copy states the *mechanism* ("Marks approved. Nothing publishes — scheduling stays on the board.") | The dashboard's equivalent actions carry no such statement, and the approve/publish confusion is exactly what the trap list is made of. |

---

## 7. Gap ledger — every dashboard field that does not carry

| # | Field | Reason |
|---|---|---|
| G1 | Avg idea-ICP, LM capture, Spend tiles | RPC reads the inbox does not make; not content-pipeline data |
| G2 | Buffer depth / buffer ledger / buffer calendar | needs `get_client_board`; and every affordance on it is a write |
| G3 | `operator_approve_idea`, `operator_schedule_draft`, `operator_edit_draft_body`, `operator_set_board_visible`, `operator_set_lm_cover`, `operator_mark_actions_seen`, `append_agent_log`, `client_board_*`, `delete_scheduled_post`, `dashboard_action` acks, `n8nclaw_dashboard_send` | **all writes.** The content section ships read-only apart from the two Ivan-lane status writes that already exist |
| G4 | Client activity feed + draft history (edits, approvals, voice notes) | real Mattan-lane value; needs an uncalled RPC and its badge half is a write. **Largest deliberate omission — sized, not forgotten** |
| G5 | Client-faithful `ClientPost` preview chrome | client-board job; the operator surface keeps the register separation instead (IA §3.7) |
| G6 | `STEP_LABELS` friendly relabelling, `CLIENT_TZ` | client-facing translations that would blind the operator |
| G7 | Outreach tab, Leads tab, Performance/Newsletter/Strategy surfaces | not content |
| G8 | Cover-pair picker (two competing cover stores) | a write, and a two-store trap the inbox has no reason to inherit |
| G9 | `n8nclaw` chat, reminders, ack/complete, send-with-webhook-fallback | IA §6 — not content, or a write, or both |

**Counts: 7 FIX/CARRY items that change rendered fields, 9 gap classes dropped with reason,
0 dashboard fields left unaccounted.**
