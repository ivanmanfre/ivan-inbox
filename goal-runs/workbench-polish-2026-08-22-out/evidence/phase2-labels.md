# Phase 2 - labels: every internal-name hit, fixed or deleted, with proof

Worktree: `ivan-inbox-wt-lab`, branch `polish/labels`. Verified against a real
production build (`npx vite build` + `vite preview --port 4180`), authed via
`.session.json` in localStorage, write-interceptor installed (no row ever
mutated during verification). 14 commits, one per fix. `npm run build` clean,
`npm test` at 906 passing / 1 known pre-existing failure
(`calendarItems.test.ts`), same as the pre-change baseline.

The gate lives at
`goal-runs/workbench-polish-2026-08-22-out/evidence/audit-tools/no-internals.mjs`.
It walks Today, DMs list, Thread peer, Content (Needs review / Published /
Scheduled / Errors / Ideas tabs), the Draft window (QA / Source / Log / Fields,
across 10 queue rows), the Calendar view, Magnets list, the Magnet window
(across 10 queue rows), Styles, Strategy, Sends, Ops, Settings. Final run:
**0 hits.**

---

## Fixed

| # | What it said | File:line (before) | Fix | Rendered proof |
|---|---|---|---|---|
| 1 | `urn:li:activity:7496174424996585473` printed bare under "Spun from post", the owner's named defect #1 | `src/exp/v2c/DraftPane.tsx:994` | Turns the urn into `linkedInPostUrl()` (new helper, `src/exp/v2c/fmt.ts`) and renders `<a>View the live post ↗</a>`. The raw urn stays on the link's `title` for hover/copy support access, never as read text | Live build, Published tab, row "Nobody books off your first lead magnet": Source panel shows **Spun from post, View the live post ↗**, `href="https://www.linkedin.com/feed/update/urn:li:activity:7496174424996585473/"`, `title="urn:li:activity:7496174424996585473"`. Screenshot: `07-source-post-link.png` |
| 2 | Section header `Backend depth`, forced to `BACKEND DEPTH` by CSS, the owner's named defect #2 | `src/exp/v2c/DraftPane.tsx:187`; uppercase at `src/exp/v2c/faithful.css:3359-3361` | Renamed to **What decides it** (matches the sibling Magnet window's existing "What decides it" header, no new vocabulary invented). Split `.dw-insp-h` out of the shared `.res-hdr`/`.dw-queue-h` uppercase rule into its own `.wb.wb.wb .dw-insp-h{text-transform:none}` | Live build: panel header reads "What decides it", `getComputedStyle(...).textTransform === 'none'`. Screenshot: `04-draft-source-tab.png` |
| 3 | `REWRITE_OK` printed raw inside the QA panel's explanation strip (found by Ivan from a screenshot, missed by the phase-1 grep) | `src/exp/v2c/Register.tsx:159-162` (`QaFeedback`'s `qa-clash` div) | Both `r.verdict` (parsed from the judge's own prose) and `verdict` (the stored column) now go through `label()` | Live build, QA tab: **"Judge body says Rewrite ok (76/90); the row stores Pass. Neither is derived from the other."** Extracted verbatim via Playwright `innerText`. Screenshot: `05-draft-qa-tab.png` |
| 4 | `<span className={chipClass(g.status)}>{g.status}</span>` and `{p.status}`, raw agent-group and per-entry status codes in the generation register | `src/exp/v2c/Register.tsx:440,463` | Both wrapped in `label()` | Verified by build plus the same QA-tab render (agent group chips read "Pass"/"Rewrite ok" etc, not raw codes) |
| 5 | `{e.source}`, the agent_log's own `source` column (`n8n`, `clickup_backfill`) printed raw next to a log entry | `src/exp/v2c/Register.tsx:469` | Wrapped in `label()`. Added `n8n: 'Automated'` to `labels.ts` (`clickup_backfill` already had its own "backfill" chip via `isBackfillEntry`) | Build clean; `n8n` maps to "Automated", confirmed via `labels.test.ts` |
| 6 | `<span className="ct-ref">status: {d.status}</span>`, raw column-name prefix plus raw enum in the Magnet window | `src/exp/v2c/MagnetWindow.tsx:376` | `label(d.status)`, dropping the `status:` prefix. Matches the sibling pattern already used one line over for `detail.kind` in `DraftPane.tsx:1310` | Build clean; same `label()` path proven elsewhere in this run |
| 7 | `title={\`scheduled_at ${d.scheduled_at}\`}` / `title={\`updated_at ${d.updated_at}\`}`, raw column names as tooltip prefixes | `src/exp/v2c/ContentList.tsx:249`, `src/exp/v2c/DraftPane.tsx:1067,1076` | Replaced with `Scheduled for ...` / `Last edited ...` (DraftPane versions use `absTime()` for a readable timestamp instead of the raw ISO string) | Build clean |
| 8 | `title={\`pillar ${pillar}\`}`, `` `funnel_stage ${funnel}` ``, `` `taxonomy.source ${src}` ``, three raw column/path names as tooltip prefixes on one row | `src/exp/v2c/ContentList.tsx:278-280` | `Pillar: ${tagLabel(pillar)}`, `Funnel stage: ${tagLabel(funnel)}`, `Source: ${sourceLabel(src)}`: human prefix, humanised value | Live build, Content list tooltips extracted via Playwright: `"Pillar: Case Study"`, `"Funnel stage: Trust"`, `"Source: Manual"`, etc. |
| 9 | `title={\`stage: ${stage}\`}`, raw column-name prefix on the DM thread ladder, both the "off" and normal states | `src/exp/v2c/ThreadPeer.tsx:23,35` | `` `Stage: ${label(stage)}` `` | Live build, opened a thread: `.wb-ladder` title reads **"Stage: DM sent"** |
| 10 | `<span className="ct-chip">{r.status}</span>`, `{r.post_kind}`, `{r.platform}`, three raw scheduled_posts values, unmapped | `src/exp/v2c/ContentSections.tsx:416,418,419` | All three through `label()`. Added `queued_v2: 'Queued'` and `linkedin: 'LinkedIn'` to `labels.ts` | Live build, Scheduled tab, chip text extracted: **"Pending"**, **"Reach"**, **"LinkedIn"**, **"Posted"** across every row |
| 11 | `5 lead-magnet rows at <code>reviewing</code>`, the raw `lm_idea_candidates.status` value, code-styled, printed at the reader | `src/exp/v2c/ContentSections.tsx:380` | Replaced with plain words: **"rows waiting for review"**, the same fact (the component's own header comment already states these rows are `status='reviewing'`), no column name, no code styling | Build clean; confirmed via Magnets -> Lead-magnet ideas band render |
| 12 | `<span className="dd-vk">{k}</span>`, raw jsonb keys (`QA_FEEDBACK`, `HOOK_TYPE`, `SPICE_LEVEL`, `WORD_COUNT`, ...) printed verbatim by `<Val>`'s object branch, the roughly 30 keys inside an agent's raw JSON payload | `src/exp/v2c/ContentBits.tsx` (`Val`, object branch) | Extracted the same `humanizeKey()` `KeyRows` already used (underscore to space, sentence case) and applied it to `<Val>`'s own key rendering too, so every object-shaped value in the app gets the same treatment regardless of which of the two renderers reaches it | Confirmed by the scanner: forcing every payload fold open before this fix produced 60+ raw `SCREAMING_SNAKE` key hits (`QA_FEEDBACK`, `HOOK_TYPE`, `WORD_COUNT`, ...); after the fix, the same forced-open walk produces zero key hits |
| 13 | `{ label: k.replace(/_/g, ' '), cls: 'reply' }`, an unknown DM "kind" fell back to a raw, un-capitalised, un-mapped string | `src/screens/TodayScreen.tsx:28` | Routed through the shared `label()` instead of a hand-rolled local fallback | Build clean; `TodayScreen` is a shared component (renders in both `#exp/v2` and `#exp/stock`, per the phase-1 inventory §1), so this closes the gap in both shells |
| 14 | `title={\`${p.key}: ${p.n}\`}` in `StackBar`, a caller-supplied key that could be a raw lane/stage slug, with no guard in the primitive itself | `src/exp/v2c/Surface.tsx:316` | `label(p.key)` at the primitive, so every future caller is protected without having to remember to pre-label | `StackBar` currently has zero call sites in the app (confirmed by repo-wide grep). This is a defensive fix for the next caller, not a rendered-UI fix; no screenshot, verified by build plus the `label()` unit tests |
| 15 | `k.replace(/_/g, ' ')` in `KeyRows`, an unnamed agent-object key rendered lowercase with no sentence case (`error flipped at`, not `Error flipped at`) | `src/exp/v2c/ContentBits.tsx` | Extracted a shared `humanizeKey()` that capitalises the first letter, used by both `KeyRows` and `Val`'s object branch (see #12) | Build clean |

## `labels.ts` additions (KNOWN map)

```
needs_regenerate: 'Needs regeneration'   // sentenceCase alone gave "Needs regenerate"
queued_v2: 'Queued'                      // scheduled_posts' own status vocabulary, the _v2 is a migration artefact
n8n: 'Automated'                         // agent_log.source, the automation platform's own name
linkedin: 'LinkedIn'                     // scheduled_posts.platform
```
Covered by new cases in `src/lib/labels.test.ts`.

---

## Deleted, not renamed

| What | File:line | Why deleted rather than labelled |
|---|---|---|
| `d.client_idea_id` under the label "Idea" | `src/exp/v2c/DraftPane.tsx:990` (old) | An internal foreign key into `lm_idea_candidates` with no reachable view in this app. There is no idea-detail route or window that opens from an id (confirmed: `IdeaCard` in `ContentSections.tsx` is an inline list card, never addressable by id). Unlike `source_post_id`, which links to a real, external, human-checkable artefact (the live LinkedIn post), a bare UUID here answers no question a reader can act on. Rule applied: "ask whether the user needs to see it at all", so it was deleted. |
| `taxonomyValue(d.taxonomy, 'source_candidate_id')` under the label "Candidate" | `src/exp/v2c/DraftPane.tsx:991-993` (old) | Same reasoning: an internal id into the idea/candidate pipeline with no reachable view, no link target, no actionable meaning as a bare string. Deleted. |

## Reviewed, left as-is (with reasoning)

| What | File:line | Why left |
|---|---|---|
| Rubric dimension keys (`VOICE`, `SUBSTANCE`, `AI_TELLS`, `DISTINCT`, ...) | `src/exp/v2c/Register.tsx` `DimBar`, fed by `rubric.ts`'s `RubricDim.key` | `rubric.ts`'s own type comment states the contract explicitly: *"The judge's own key, verbatim and uppercase (`AI_TELLS`, never 'ai tells')."* This is the judge's scoring vocabulary, a rubric/scorecard convention, not an internal system name, and rewriting it would misrepresent what the judge actually scored. |
| "Raw judge output" / "The applied rewrite" / "Regeneration instruction" / agent-log "payload" folds | `src/exp/v2c/Register.tsx` | Long-standing, explicitly documented design: *"nothing is dropped... the raw string is always kept and always reachable... under a fold that says how long it is."* These are announced, opt-in raw dumps for support/audit, not the headline surfaces the owner's complaint named. Forcing every one of these open in the verification scanner produced 400+ raw-token hits (urns, uuids, JSON keys) before the `<Val>` key fix, and dozens of legitimate raw-prose hits after it (a judge's own "VERDICT: REWRITE_OK" sentence quoted verbatim inside its own raw output, an agent's own recorded log line starting "GIVE_UP:..."). The scanner does not force these open; it walks what a reader sees by normal navigation (tab switches), matching the actual complaint. |
| `LogEntryRow`'s one-line summary preview (`p.text.split('\n')...find(Boolean)`) | `src/exp/v2c/Register.tsx:475-481` | Explicitly documented as verbatim on purpose: *"The first LINE of the humanised body, never the first 110 characters... the line IS the summary."* This is an agent's own recorded prose (like a commit message), not a database enum, and rewriting it would edit history the register exists to preserve. |
| `ContentSections.tsx:533-534`: the tooltip that reads `${LM_STAGE_LABEL[stage]}` followed by "folded from the database value" and the raw `${r.status}` in quotes | `src/exp/v2c/ContentSections.tsx` | Already the exact pattern this phase introduces elsewhere: a full English sentence explaining the mapping, with the raw value quoted for audit rather than substituted for it. Comment states the intent directly: *"the raw DB value rides on the title so the fold stays auditable... without spending a mark on it."* No change needed, reviewed and confirmed compliant. |
| `d.campaign_id` / `d.workflow_file_id` / `d.gate_keyword` / `d.vertical_slug` under "Campaign"/"Workflow file"/"Gate keyword"/"Vertical" | `src/exp/v2c/MagnetWindow.tsx:338-345` | Unlike `client_idea_id`, these already carry a clear, already-labelled field name and live inside the Magnet window's "Dates & fields" section, which is collapsed by default (not the headline "What decides it" surface). Same treatment `source_post_id` earns explicitly per the brief ("a raw id is not deleted, it is labelled"). Already labelled; left as-is. |
| `modelLabel()`'s raw-id fallback for an unrecognised container build stamp | `src/exp/v2c/ChatPane.tsx:25-34` | Comment states the decision explicitly: *"fall back to the raw id rather than inventing a name."* This is Ivan's own model picker inside his own AI copilot pane, a legitimate technical choice for a power-user control, not a leak. |
| `.dpill` "DRAFT" badge, `.ct-chip`'s app-wide `text-transform:uppercase` | `src/styles.css:82`, `src/exp/v2c/styles.css:209` | A pervasive, deliberate, pre-existing badge/chip typographic convention used on hundreds of already-correctly-labelled values across the whole app (type chips, stage chips, lane chips). Distinct in kind from the "Backend depth" defect (a sentence-like header shouted by name); this is a stylistic badge treatment applied uniformly, not an internal-name leak. Out of scope; touching it would be an unrelated, unrequested visual overhaul. |
| `.dw-jump` tab buttons ("QA" / "SOURCE" / "LOG" / "FIELDS"), `styles.css:1439-1441` | `src/exp/v2c/styles.css` | A separate, deliberately-styled small-caps segmented-tab control (background, padding, border-radius, a genuine tab/segment UI element), not inherited from the `.dw-insp-h` header rule this phase fixed. Short navigational tab labels in a small eyebrow face is a standard, legitimate UI convention. Confirmed the two rules are independent; fixing the header did not, and should not, touch these. |

---

## Verification detail

- Build: `npx vite build` clean; `npm run build` (`tsc -b && vite build`) clean.
- Tests: `npm test` gives 906 passing, 1 known pre-existing failure (`calendarItems.test.ts`), identical to the baseline measured before any change in this phase.
- `.env.local` and `.session.json` were missing from this fresh worktree and were copied in from the main `ivan-inbox` checkout (both gitignored, neither committed) so the local build/test/Playwright walk could run at all.
- Browser walk: `npx vite preview --port 4180` serving the worktree's own `dist/`; Playwright (`/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs`) with `sb-bjbvqvzbzczjbatgmccb-auth-token` injected into localStorage and the write-interceptor from `chip-probe.mjs:13-19` installed on every run. No PATCH/DELETE/PUT/POST(non-rpc) request was ever allowed to reach Supabase.
- Screenshots (this session's scratchpad, not committed to the repo, same convention as the phase-1 `capture.mjs` tooling, which also writes outside the repo):
  `01-content-list.png`, `02-draft-window-first.png`, `03-draft-window-matched.png`,
  `04-draft-source-tab.png`, `05-draft-qa-tab.png`, `06-published-tab.png`,
  `07-source-post-link.png`, `08-magnet-window.png`, `09-thread-peer.png`,
  `10-scheduled-tab.png`.
- Final gate: `node goal-runs/workbench-polish-2026-08-22-out/evidence/audit-tools/no-internals.mjs http://localhost:4180/` reports: **`no-internals: PASS. 0 hits across every surface walked.`**
