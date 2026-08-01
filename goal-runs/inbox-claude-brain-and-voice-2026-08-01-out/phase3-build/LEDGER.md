# Phase 3 build ledger — inbox-claude-brain-and-voice-2026-08-01
Branch: exp/brain (off exp/v2 @64e3b72; archival commit d1b4f33). Every build task appends: what changed, commits, tests/lint/build status, self-verification evidence. Sections in build order.

## 1. Content structural build (per phase1b-content/ IA + AMENDMENTS A4)

Structure and data completeness only. The app's existing visual treatment, tokens
and card shells are reused verbatim — the re-skin is a separate phase, and a
second aesthetic in the meantime would be two.

### Commits (all on `exp/brain`, nothing pushed, `main` untouched)

| Hash | Message (subject) |
|---|---|
| `4d79630` | feat(content): carry the fields the surface was dropping — agent attribution, the QA register, source_detail |
| `3ec20bb` | feat(content): two lanes, each with its own view — Ivan by pipeline, Mattan by promotion state |
| `6fea33f` | verify(content): both lanes, both viewports, against the live database |

### Files touched

**Data layer (extended, additive except the three fixes)**
- `src/lib/content.ts` — `LANE_LABEL`/`LANE_POSSESSIVE`/`CONTENT_LANES` (the one
  place `'risedtc'` becomes a name); `AgentLogEntry` grows `agent`/`source`/
  `comment_id` (A4.1); `source_detail` retyped `unknown` + `normalizeSourceDetail`
  (A4.2); `QaSummary` grows the full 23-key register incl. `rewriteText`;
  `parseLogEntry`/`scoreProgression`/`isBackfillEntry`; `taxonomyExtras`/
  `taxonomyValue`; `fetchIdeaCandidates` (R7); `queueFailed`; `ScheduledQueueRow`
  grows `post_kind`/`unipile_share_url`; list `COLS` grows `funnel_stage` and four
  PostgREST jsonb projections (`qa->>verdict` etc.).
- `src/lib/styles.ts` — `fetchResources(lane)` via `laneFilter` (R6);
  `Resource.landing_url`; `isStuckResource` + `RESOURCE_TERMINAL_STATUSES`.
- `src/lib/contentFilters.ts` — **new.** Generic facet machinery + per-row-set
  specs (drafts, ideas, queue, resources, styles).
- `src/hooks/useContent.ts` — `useScheduledQueue` (R4, first consumer),
  `useIdeaCandidates` (R7), `useResources` (R6), `useStyleRoster` (R5),
  `useAgentDigest` (R8/R9).

**UI**
- `src/exp/v2c/ContentList.tsx` — rewritten as the lane router + `IvanLane` +
  `MattanLane` + the merged alert strip.
- `src/exp/v2c/ContentSections.tsx` — **new.** Ideas, publish-queue strip,
  resources, style roster, pillar mix, alert count line, daily summaries.
- `src/exp/v2c/ContentBits.tsx` — **new.** `Val` (the defensive unknown
  renderer), `Rows`/`KeyRows`, `FilterBar`, `FilteredEmpty`, `Figure`.
- `src/exp/v2c/Register.tsx` — **new.** `QaRegister` + `AgentRegister`.
- `src/exp/v2c/DraftPane.tsx` — the full per-draft register; exports
  `draftContextLabel`.
- `src/exp/v2c/ChatPane.tsx` + `Shell.tsx` — one new optional prop
  (`aboutContext`) so the payload carries the lane and the register (IA §5.7).
- `src/exp/v2c/styles.css` — appended block, existing tokens only.
- `src/exp/cand-a/DraftDetail.tsx`, `cand-b/StudioScreen.tsx`,
  `cand-c/StylesGallery.tsx`, `cand-a/ContentStyles.tsx` — retired shells, kept
  compiling. `tsc` failing cand-a's `source_detail` JSX child is the proof the
  retype works.

**Tests / instruments**
- `src/lib/content.test.ts` (+22 cases), `src/lib/contentFilters.test.ts` (new,
  15 cases), `src/lib/styles.test.ts` (+3 cases).
- `scripts/verify-content.mjs` — **new**, the live instrument.

### Gates

| Gate | Result |
|---|---|
| `npm test` | **334 passed / 20 files**, 0 failed (was 294; +40 new) |
| `npm run lint` | **0 errors**, 17 warnings — all pre-existing and all outside `src/exp/v2c`, `src/lib`, `src/hooks` |
| `npm run build` | clean (`tsc -b` + vite, 0 errors) |
| new npm dependency | none |
| write affordances | `grep '\.update(\|\.insert(\|\.delete(\|\.upsert(\|\.rpc('` over every content file → **exactly 2 hits**, both pre-existing `approveDraft`/`skipDraft`, both `.is('client_id', null)` |
| AgentOps destination | `grep -n 'agent' src/exp/v2c/{layout.ts,route.ts,Rail.tsx}` → **0 hits** |
| `.eq('client_id','ivan')` | 0 hits; Ivan is `IS NULL` everywhere, pinned by unit test |
| `supabase.functions.invoke` | 0 hits (no edge call added) |

### Live self-verification — `scripts/verify-content.mjs`

Real Supabase session (`scripts/dev-login.mjs`), `vite preview` on :4173, 8 runs
at **390×852** and **1440×900**. Screenshots in `phase3-build/content-shots/`:

`ivan-lane-mobile.png` · `ivan-lane-desktop.png` · `mattan-lane-mobile.png` ·
`mattan-lane-desktop.png` · `ivan-filtered-desktop.png` ·
`draft-register-desktop.png` · `mattan-draft-mobile.png` ·
`mattan-draft-desktop.png` · `verify.json`

Result: **zero horizontal overflow, zero console errors, zero clipped text, zero
"Rise" labels** across all 8.

Claims checked against live rows:
- lanes render exactly `["Ivan", "Mattan Danino"]`;
- Ivan's sections: Ideas · Generating · Needs review · Scheduled · Published ·
  Archived · Pillar mix · Resources · Styles · Daily summaries; **23 facet groups**;
  60 idea rows + 21 draft cards rendered;
- Mattan's groups: **On Mattan's board → Internal**, each with stages nested
  inside; lane note "20 of 84 on Mattan's board"; 73 cards;
- filtering to `stage=Archived` on Ivan's lane: 39 matched of 171 loaded, and the
  filter bar prints both numbers;
- **proof row `792ee91c`: 37 register entries, 11 distinct agents, 0
  unattributed, 0 "Show more", 0 clamped**, with `THE APPLIED REWRITE`,
  `VERDICT PROVENANCE`, `GENERATION REGISTER · 37 entries` and
  `TAXONOMY · OTHER KEYS` blocks present;
- a Mattan draft whose `source_detail` is a jsonb object (`Case Study: Don Pablo`,
  `{kind,label,metric,slug,source_url}`) opens with its source block rendered on
  both viewports — the crash class is closed.

Three defects the instrument found that reading the file could not:
1. a live `composite_score` is a float (68.32) and the fixed-width score box
   clipped it — the box now sizes to content rather than rounding a score;
2. a `qa` payload nests four levels deep, and label-beside-value ate the width
   until the innermost value had 0px to wrap into — keys now sit above values,
   depth drawn with a rule;
3. 63 rows carry a taxonomy `error_message` and most recovered — only a row
   errored *now* gets the red box; on the rest it renders as history.

### Deviations from IA.md, with reasons

1. **The merged idea log (IA §5.4 item 6) is not built.** The linked idea's
   `agent_log` cannot be read: `client_ideas` returns **0 rows** to this app's
   authenticated role (RLS — probed live, HTTP 200 with `[]`), and
   `lm_idea_candidates` has **no `agent_log` column at all** (column list probed
   live). The linkage still renders — `client_idea_id` and
   `taxonomy.source_candidate_id` are rows in the Source block — but the merged
   timeline the IA describes is not derivable. **SKEPTIC-confirmed reality wins.**
2. **`fetchResources` no longer filters `resource_url IS NOT NULL`.**
   AFFORDANCES §2.4 makes "has a resource URL" a *facet*, and a facet whose rows
   were already removed at the query has one side. Dropping it is also what lets
   Mattan's lane render all 5 of its rows rather than 3 (2 of his 5 have a null
   `resource_url`). The lane scope (the R6 change) is unaffected — and the stuck
   proof row `bb07706c…` does carry a `resource_url`, so it was hidden by the
   tenancy filter alone, exactly as the DECISION-TABLE says.
3. **`slug` and `lm_ref` inside `source_detail` render as rows, not links**
   (IA §5.3 groups them with `source_url`). They are references, not resolvable
   URLs; linking one produces a dead anchor that looks like a working one. Only
   `http(s)` values become links.
4. **"Regenerated" and "Backfilled" facets are derived from `qa` only**, not from
   `agent_log` as well (AFFORDANCES §2.1). `agent_log` is not in the list fetch
   and must not be: 2 999 entries across 282 rows is a payload nobody scrolls.
   Both facets are exact for the `qa` half and simply absent where only the log
   knows; the detail pane shows the log-side evidence in full.
5. **The alert strip is built from UNFILTERED rows.** A filter may narrow the
   flow; it may never hide a broken row. Consequence: with a filter active, the
   card count in the strip is not inside the "N of M shown" figure.
6. **Ivan's weekly ceiling renders as "N scheduled in the next 7 days of a
   4-a-week cadence"** — advisory, never red, never a gate (IA §2.5). Mattan's
   lane shows the observed figures and **no denominator** (IA §3.6).
7. **"Rise" was renamed inside the content section only.** `Sends`, `Inbox`,
   `Today`, `Drafts` and the KPI screens still label the `risedtc` scope "Rise";
   those are outreach client scopes on other surfaces and outside this mission.
   The content surface — every chip, section head, lane note, pane subtitle,
   filter label — is verified free of the string live.
8. **Mobile keeps the same structure, not a reduced one.** Both lanes, both
   registers and every section render at 390px; the only viewport fork is the
   Shell's existing takeover behaviour.

### Left for the design phase

- The section is dense and long by construction (the register is a document).
  Nothing here decides rhythm, scale or hierarchy beyond reusing existing tokens.
- The filter bar is a horizontally scrolling chip rail with 23 facet groups on
  Ivan's lane. It is honest and it fits without overflow; it is not yet
  *designed*, and it is the first thing a re-skin should take.
- `<details>` payload disclosure inside a log entry uses the UA triangle.
- The pillar-mix bars, the score progression and the stacked pipeline bar are the
  only visual encodings; the promotion groups on Mattan's lane have none yet.
- Nothing in this build has been shown to Ivan, and no client-facing artifact was
  created or sent.

## 2. Assembler into broker + depth block (per phase2-tournament verdict)
(pending)

## 3. Railway model passthrough (T3 grant, serialized last)
(pending)

## 4. Model picker UI + honest degrade
(pending)

## 5. Voice instrumentation
(pending)
