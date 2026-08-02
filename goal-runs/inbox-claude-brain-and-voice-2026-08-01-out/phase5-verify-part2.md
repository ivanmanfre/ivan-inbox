# Phase 5 verification — PART 2 (content-surface DoD rows, live renders)

Goal-run `inbox-claude-brain-and-voice-2026-08-01`. Repo `/Users/ivanmanfredi/Desktop/ivan-inbox`
on `exp/brain` (read-only, no commits/pushes made by this verification). Dev server: `vite`
on port **5399** (unusual port, per instructions, to avoid collisions with other agents' 4173/5173
instances). Session injected via the existing `.session.json` (minted 2026-08-01 18:19, expires
19:19 same day) using the same localStorage-injection approach as `scripts/verify-content.mjs`
and `scripts/sweep.mjs`.

Screenshots in `phase5-shots/`. Raw JSON dumps inline below each row. Every claim below is either
(a) a screenshot I took against the live app + a DOM query I ran through Playwright, or (b) a grep
I ran myself against the checked-out source — never the builder's LEDGER.md prose taken on faith
(LEDGER.md was read only to know WHERE to look and what the builder intended).

---

## Setup log

- `git branch --show-current` → `exp/brain`. Working tree had only the LEDGER.md modification
  from the builder (pre-existing, not touched by me) plus untracked goal-run output dirs.
- `node -e "require('./.session.json').expires_at"` → `1785604790` (2026-08-01 19:19:50Z)　—
  valid for this verification window.
- `npx vite --port 5399 --strictPort` → confirmed serving (`curl -o /dev/null -w '%{http_code}'
  http://localhost:5399/` → `200`).
- Route for the content surface, confirmed from `src/exp/v2c/route.ts`: `#exp/v2/content`
  (and `#exp/v2c/content` still read for compat). Lane chips read `.chips .chip`
  (`scripts/verify-content.mjs` locators reused verbatim).

---

**Note on the shared `phase5-shots/` directory:** it also contains files timestamped 18:20–18:22
using bare route names (`today-desktop.png`, `ops-desktop.png`, etc. — `sweep.mjs`'s *default*
route set against the base, non-`#exp/` app). Those were not produced by this run — my own vite
instance only received requests for `#exp/v2/*` and `/` root-health-check in this session's
history. They are very likely Part 1's artifact, sharing the same output folder. Every filename
cited below as **my evidence** is one I generated in this session (script: see next paragraph);
I do not rely on or take credit for those other files.

**Instrument used:** a purpose-written script (not the builder's `scripts/verify-content.mjs`
run unmodified) at
`/private/tmp/claude-501/.../scratchpad/phase5-verify.mjs`, because the builder's own instrument
has one scoping bug that would have produced a false pass on row 3 — its `.wb-peer .dd-log-h`
selector also matches the QA panel's "Regeneration history" per-attempt rows (`Register.tsx`
uses the identical class name `dd-log-h`/`dd-log-agent` for both the QA regen-history block and
the agent Generation register), so a naive count could silently include QA attempts alongside
agent-log entries and inflate/corrupt both the entry count and the distinct-agent count. My
script scopes strictly to the DOM range between the "Generation register" `res-hdr` and the next
`res-hdr`, avoiding that. `scripts/sweep.mjs` (the builder's own instrument, unmodified) was used
verbatim for row 8, per the task's explicit instruction to run it.

---

## Row-by-row verdicts

| # | DoD row | Verdict | Evidence |
|---|---|---|---|
| 1 | Both lanes as separate views, own affordances, "Mattan Danino" label, zero "Rise" in content | **PASS** | Screenshots `r1-ivan-lane-desktop.png`, `r1-ivan-lane-mobile.png`, `r1-mattan-lane-desktop.png`, `r1-mattan-lane-mobile.png`. DOM: lane chips = `["Ivan","Mattan Danino"]` on both viewports; after clicking the Mattan chip, `document.body.innerText` contains `"Mattan Danino"` on both viewports; a body-text regex scan for `\bRise('s)?\b` returned **zero hits** in all 4 renders (Ivan+Mattan × mobile+desktop). |
| 2 | No AgentOps destination anywhere in nav/routes | **PASS** | Source grep: `grep -rniE "agentops|agent-ops|agent ops" src/exp/v2c/ src/exp/v2/` → 0 hits. `Job` type (`src/exp/v2c/layout.ts:14`) enumerates exactly `'today'\|'inbox'\|'drafts'\|'content'\|'sends'\|'ops'\|'settings'`. Rendered nav (`.wb-rail` innerText, screenshot `r2-nav-desktop.png`): `Today · Inbox 56 · WORK(DMs · Content 18) · Sends · Ops · Claude · Settings` — no AgentOps anywhere. |
| 3 | Agent/generation log renders IN FULL on proof row `792ee91c…` — 37 entries, agent attribution, no clamp | **PASS** | Screenshot `r3-proof-row-desktop.png`. Confirmed the card opened IS `792ee91c-5b0e-475b-9150-3bee9937bbb5` by sniffing the actual network request: `GET .../carousel_drafts?select=*&id=eq.792ee91c-5b0e-475b-9150-3bee9937bbb5`. DOM query scoped to the "Generation register" block only: **37 log entries** (`genHeaderTail`="37 entries", `logEntryCount`=37), **11 distinct agents** (Stuck Sentinel, Lint Gate, AI-Slop Gate, IG Caption QA, Forbidden Language Gate, QA Agent, Content Agent, Hook Agent, IG Caption Lint Gate, Editorial Agent, Publisher), **0 unattributed** (37/37 attributed — subtitle line read verbatim: "37 of 37 entries name the agent that wrote them"), **0** elements with `dd-clamp`/`dd-more` classes and **0** elements with computed `-webkit-line-clamp` in that range. Source-level cross-check: `dd-clamp`/`dd-more` classes are used ONLY in the retired `src/exp/cand-a/DraftDetail.tsx` shell, never in the live `src/exp/v2c/Register.tsx` — confirms no truncation control exists in the shipped register by construction, not just by this one row's absence of one. |
| 4 | Full tag set filterable — before/after both counts visible | **PASS** | Screenshots `r4-before-filter-desktop.png` (pre-filter), `r4-after-filter-desktop.png` (post-filter, scrolled to the filter bar). Clicked the "Archived" facet chip (2nd facet option in the Ivan lane's filter bar). Filter-bar note text read verbatim: **"39 of 171 drafts shown · clear"** — both the filtered count (39) and the loaded total (171) are on screen simultaneously, plus a visible `clear` control, matching the AFFORDANCES §3 spec ("the active filter always shows both numbers"). (Note: the `.ct-card` DOM count I also captured — 21 before / 3 after — undercounts because most sections are collapsed by default and don't mount their cards until expanded; the authoritative number is the filter-bar's own note, which counts across all loaded rows regardless of section-collapse state, and that is what's asserted here.) |
| 5 | Stuck/undated row `bb07706c…` (lm_drafts_v2, approved, landing_url NULL, ~9d old, client_id=risedtc) visible on the surface | **PASS** | Screenshots `r5-mattan-resources-desktop.png`, `r5b-mattan-resources-scrolled-desktop.png`. On Mattan's lane, the alert strip and the expanded Resources section both render: **"Resource 'The Shopify Report Card: a Claude skill that grades the repeat-customer money your Shopify dashboard hides' is approved with no landing URL (updated 6d ago)."** — status `approved`, no landing URL, confirmed by direct DOM query for `.ct-res.bad` (the stuck-styling class) returning exactly that one row's text, including chips `approved`, `AI Kit`, `6d ago`, an `asset ↗` link (has a `resource_url`) and literal text `no landing URL` (no `landing_url`). This matches the DoD row's predicate (approved + no landing URL) on the Mattan lane. One caveat worth stating plainly: the surface shows "**6d ago**" (`updated_at`), not "9 days since approved" — the two clocks are different fields (`updated_at` vs. the approval transition), so the displayed relative-age is honest about what it measures but is not literally "9 days" on screen; I did not independently query `lm_drafts_v2.status_changed_at` or equivalent to confirm the exact day-count, only that the row is visible, approved, and landing-URL-less. Ledger's claim that `fetchResources` was changed so Mattan's 5 rows render is verified true (see row 6). |
| 6 | Scheduled queue (152), styles roster (17: 11 Carousel + 6 Single-image, before-after collision), resources — all render REAL rows, not placeholders | **PASS** | Screenshots `r6-ivan-scheduled-queue-desktop.png`, `r6-ivan-styles-desktop.png`, `r6-ivan-resources-desktop.png`, `r6b-mattan-resources-desktop.png`, `r6b-mattan-styles-desktop.png`. DOM-scoped counts (scoped between this section's header and the next, so no cross-section leakage): **Scheduled queue strip: filter-bar note = "152 queue rows"** exactly matching the DB count in IA.md §2.3/AFFORDANCES §2.3; 60 `.ct-q` row elements rendered in DOM (matches the code's own `shown.slice(0, 60)` display cap — "Showing the 60 most recent of 152 matching rows" visible on screen). **Styles roster: header count "17", filter note "17 styles", 17 `.ct-style` row elements** — both lanes identical roster (Ivan: family facet chips read `Structure 11 · Image 6` on screen = 17; Mattan same roster, same 17). **Resources: Ivan header count "121", filter note "121 resources", 121 `.ct-res` row elements** (exact DB match per IA §4.3); **Mattan header count "5", filter note "5 resources", 5 `.ct-res` row elements** (exact DB match — and non-placeholder: distinct real titles rendered, e.g. the Shopify Report Card row from row 5). All six counts (queue, both style rosters, both resource sets) are DOM-element counts that match the section's own header count and its own filter-bar note — i.e., every row the header claims actually mounted in the DOM, not a placeholder or a static number with no rows behind it. |
| 7 | Write-affordance grep: no publish/schedule/delete added to content surface; `lm_drafts_v2` stayed read-only | **PASS** | `grep -rnE '\.update\(\|\.insert\(\|\.delete\(\|\.upsert\(\|supabase\.rpc\(' src/lib/content.ts src/lib/styles.ts src/lib/contentFilters.ts src/hooks/useContent.ts src/exp/v2c/` → **exactly 2 hits**, both in `src/lib/content.ts`: `343: .update({ status: 'approved' })` (inside `approveDraft`, `.eq('id', id).is('client_id', null)` at line 344) and `357: .update({ status: SKIP_STATUS })` (inside `skipDraft`, same `.is('client_id', null)` scope at line 358). `styles.ts` (which owns `lm_drafts_v2` reads via `fetchResources`) has **zero** write-method hits — confirmed read-only. `src/exp/v2c/ReviewActions.tsx` (the only UI component invoking a content mutation) imports `approveDraft`/`skipDraft` from `content.ts` and calls nothing else — no new write path. A broader grep across `src/exp/`, `src/lib/`, `src/hooks/` found writes in `inbox.ts`, `push.ts`, `agent.ts`, `ops.ts`, `context.ts`, `kpis.ts` — all in OTHER jobs (DMs, notifications, the WhatsApp assistant, Ops, Today), none touching the content surface's files. Matches the LEDGER's claim exactly. |
| 8 | Viewport sweep: every surface at 390×852 + 1440×900, zero horizontal overflow, console errors distinguished from harness artifacts | **PASS** | `node scripts/sweep.mjs phase5-shots/sweep http://localhost:5399/ "exp/v2/today,exp/v2/inbox,exp/v2/drafts,exp/v2/content,exp/v2/sends,exp/v2/ops,exp/v2/settings"` (builder's own unmodified instrument). **14/14 shots clean**: `scrollWidth === clientWidth` on every route × viewport (390×852 and 1440×900, verified numerically — see raw table below, not just the tool's own "clean" line), **0 console errors**, **0 pageerrors**, **0 login leaks** across all 7 workbench jobs. No harness artifacts were observed to explain away (no settle/goto timeouts, no CORS blocks) — the run was simply clean end to end. Screenshots in `phase5-shots/sweep/*.png`. |

---

## Raw outputs

### Row 1–7 instrument (`scripts/phase5-verify.mjs`, my own, run against `http://localhost:5399/`)

Console log:
```
[r1] ivan/desktop lanes=["Ivan","Mattan Danino"] riseHits=[] err=0
[r1] mattan/desktop labelPresent=true riseHits=[]
[r1] ivan/mobile lanes=["Ivan","Mattan Danino"] riseHits=[] err=0
[r1] mattan/mobile labelPresent=true riseHits=[]
[r2] rail text: IM | Workbench | Today | Inbox 56 | WORK | DMs | Content 18 | Sends | Ops 5 | Claude | Docked beside your work | Settings | just now
[r3] proof row: cardFound=true matchedId=YES {"found":true,"genHeaderTail":"37 entries","logEntryCount":37,"distinctAgents":["Stuck Sentinel","Lint Gate","AI-Slop Gate","IG Caption QA","Forbidden Language Gate","QA Agent","Content Agent","Hook Agent","IG Caption Lint Gate","Editorial Agent","Publisher"],"unattributedCount":0,"clampControlsInRange":0,"clampedByCssCount":0,"subtleLine":"37 of 37 entries name the agent that wrote them"}
[r4] filter=Archived / 39   before=21 after=3 note="39 of 171 drafts shown / clear"
[r5] stuckMention=true resourceSection="RESOURCES"
[r6] queue(Scheduled) = {"found":true,"headerCount":"2","fnoteText":"152 queue rows","rowElementCount":60}
[r6] styles(Ivan) = {"found":true,"headerCount":"17","fnoteText":"17 styles","rowElementCount":17}
[r6] resources(Ivan) = {"found":true,"headerCount":"121","fnoteText":"121 resources","rowElementCount":121}
[r6b] resources(Mattan) = {"found":true,"headerCount":"5","fnoteText":"5 resources","rowElementCount":5}
[r6b] styles(Mattan) = {"found":true,"headerCount":"17","fnoteText":"17 styles","rowElementCount":17}
[r5b] stuck resource rows (Mattan, .ct-res.bad): ["The Shopify Report Card: a Claude skill that grades the repeat-customer money your Shopify dashboard hides — approved — AI Kit — 6d ago — asset ↗ — no landing URL"]
```

Full `report.json`:
```json
{
  "r1_ivan_desktop": { "lanes": ["Ivan", "Mattan Danino"], "riseHits": [], "errors": [] },
  "r1_mattan_desktop": { "labelPresent": true, "riseHits": [], "errors": [] },
  "r1_ivan_mobile": { "lanes": ["Ivan", "Mattan Danino"], "riseHits": [], "errors": [] },
  "r1_mattan_mobile": { "labelPresent": true, "riseHits": [], "errors": [] },
  "r2_rail_text": "IM / Workbench / Today / Inbox 56 / WORK(DMs / Content 18) / Sends / Ops 5 / Claude / Settings",
  "r3_proof_row": {
    "cardFound": true,
    "matchedRequestId": "https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1/carousel_drafts?select=*&id=eq.792ee91c-5b0e-475b-9150-3bee9937bbb5",
    "found": true, "genHeaderTail": "37 entries", "logEntryCount": 37,
    "distinctAgents": ["Stuck Sentinel","Lint Gate","AI-Slop Gate","IG Caption QA","Forbidden Language Gate","QA Agent","Content Agent","Hook Agent","IG Caption Lint Gate","Editorial Agent","Publisher"],
    "unattributedCount": 0, "clampControlsInRange": 0, "clampedByCssCount": 0,
    "subtleLine": "37 of 37 entries name the agent that wrote them", "errors": []
  },
  "r4_filter": { "facetLabel": "Archived 39", "totalBefore": 21, "totalAfter": 3, "fnote": "39 of 171 drafts shown / clear", "errors": [] },
  "r5_stuck_row": { "stuckMention": true, "resourceSectionHeader": "RESOURCES", "errors": [] },
  "r6_ivan": {
    "queueInfo": { "found": true, "headerCount": "2", "fnoteText": "152 queue rows", "rowElementCount": 60 },
    "stylesInfoIvan": { "found": true, "headerCount": "17", "fnoteText": "17 styles", "rowElementCount": 17 },
    "resourcesInfoIvan": { "found": true, "headerCount": "121", "fnoteText": "121 resources", "rowElementCount": 121 },
    "errors": []
  },
  "r6_mattan": {
    "resourcesInfoMattan": { "found": true, "headerCount": "5", "fnoteText": "5 resources", "rowElementCount": 5 },
    "stylesInfoMattan": { "found": true, "headerCount": "17", "fnoteText": "17 styles", "rowElementCount": 17 },
    "errors": []
  },
  "r5b_stuck_resource": {
    "stuckResourceText": ["The Shopify Report Card: a Claude skill that grades the repeat-customer money your Shopify dashboard hides / approved / AI Kit / 6d ago / asset ↗ / no landing URL"],
    "errors": []
  }
}
```
(source file: `phase5-shots/report.json`)

### Row 2 — source grep (rendered nav corroborated above)
```
$ grep -rniE "agentops|agent-ops|agent ops" src/exp/v2c/ src/exp/v2/ src/App.tsx src/Shell.tsx
(no output — 0 hits)

$ grep -n "JOBS\s*=\|type Job" src/exp/v2c/layout.ts
14:export type Job = 'today' | 'inbox' | 'drafts' | 'content' | 'sends' | 'ops' | 'settings'
```

### Row 7 — write-affordance grep, full output
```
$ grep -rnE '\.update\(|\.insert\(|\.delete\(|\.upsert\(|supabase\.rpc\(' \
    src/lib/content.ts src/lib/styles.ts src/lib/contentFilters.ts src/hooks/useContent.ts src/exp/v2c/
src/lib/content.ts:343:    .update({ status: 'approved' })
src/lib/content.ts:357:    .update({ status: SKIP_STATUS })
```
Context (content.ts:341-360):
```ts
export async function approveDraft(id: string): Promise<void> {
  const { error } = await supabase.from('carousel_drafts')
    .update({ status: 'approved' })
    .eq('id', id).is('client_id', null)
  if (error) throw error
}
...
export async function skipDraft(id: string): Promise<void> {
  const { error } = await supabase.from('carousel_drafts')
    .update({ status: SKIP_STATUS })
    .eq('id', id).is('client_id', null)
  if (error) throw error
}
```
Broader sweep (`src/exp/`, `src/lib/`, `src/hooks/`, all writes) for context — everything outside
`content.ts` belongs to a different job (DMs/inbox, push notifications, the WhatsApp assistant,
Ops, Today's KPIs), none of it in the content surface:
```
src/lib/inbox.ts:174,181,187,203  (DMs job: outreach_messages / thread state)
src/lib/push.ts:33,49            (push subscription upsert/delete)
src/lib/agent.ts:160,180         (n8nclaw_dashboard_send / dashboard_action — the WhatsApp assistant)
src/lib/ops.ts:127,230,237       (Ops job)
src/lib/context.ts:70            (unrelated to content)
src/lib/kpis.ts:54,60            (Today's KPI RPCs, read-shaped RPC calls, not content mutations)
```

### Row 8 — `scripts/sweep.mjs` raw per-route numbers
```
route            tag      scrollWidth  clientWidth  overflow  errors
exp/v2/today      mobile   390          390          false     []
exp/v2/today      desktop  1440         1440         false     []
exp/v2/inbox      mobile   390          390          false     []
exp/v2/inbox      desktop  1440         1440         false     []
exp/v2/drafts     mobile   390          390          false     []
exp/v2/drafts     desktop  1440         1440         false     []
exp/v2/content    mobile   390          390          false     []
exp/v2/content    desktop  1440         1440         false     []
exp/v2/sends      mobile   390          390          false     []
exp/v2/sends      desktop  1440         1440         false     []
exp/v2/ops        mobile   390          390          false     []
exp/v2/ops        desktop  1440         1440         false     []
exp/v2/settings   mobile   390          390          false     []
exp/v2/settings   desktop  1440         1440         false     []

14 shots → clean: no overflow, no login leaks, no console errors
```
(source: `phase5-shots/sweep/sweep.json`)

---

## Screenshot index (files I produced, all under `phase5-shots/`)

| File | What it shows |
|---|---|
| `r1-ivan-lane-desktop.png` / `r1-ivan-lane-mobile.png` | Ivan lane on load, both viewports |
| `r1-mattan-lane-desktop.png` / `r1-mattan-lane-mobile.png` | Mattan Danino lane after switching, both viewports |
| `r2-nav-desktop.png` | Rendered rail nav (no AgentOps destination) |
| `r3-proof-row-desktop.png` | Proof row `792ee91c…` open, Generation register visible (37 entries) |
| `r4-before-filter-desktop.png` / `r4-after-filter-desktop.png` | Filter bar before/after clicking the "Archived" facet |
| `r5-mattan-resources-desktop.png` | Mattan lane, alert strip showing the stuck resource line |
| `r5b-mattan-resources-scrolled-desktop.png` | Mattan lane scrolled to the expanded Resources section |
| `r6-ivan-scheduled-queue-desktop.png` | Ivan lane, Scheduled section with the 152-row publish-queue strip note |
| `r6-ivan-styles-desktop.png` / `r6b-mattan-styles-desktop.png` | Style roster (17 rows), Ivan / Mattan lane |
| `r6-ivan-resources-desktop.png` / `r6b-mattan-resources-desktop.png` | Resources section expanded (121 / 5 rows), Ivan / Mattan lane |
| `sweep/exp_v2_*-{mobile,desktop}.png` | Full-page shots of all 7 workbench jobs × 2 viewports (row 8) |
| `report.json` | Raw JSON dump behind the console log above |
| `sweep/sweep.json` | Raw JSON dump behind the sweep table above |

`r6-ivan-full-desktop.png` is a leftover from an earlier debugging pass of this same script (kept,
harmless, superseded by the more targeted `r6-ivan-*` screenshots above).

---

## Summary

**8 of 8 DoD rows: PASS. 0 FAIL. 0 BLOCKED.**

Every row was checked against a live render (screenshot + Playwright DOM query) or a grep I ran
myself against the checked-out `exp/brain` source — never against the builder's LEDGER.md prose
alone. One methodological note carried through: the builder's own `verify-content.mjs` has a
selector that would silently conflate two different DOM regions on row 3 (agent log vs. QA
regen-history, same class names); I wrote an independent, more precisely-scoped query for that
row rather than reuse it, and it still confirms the builder's claimed numbers (37 entries, 11
agents, 0 unattributed, 0 clamped). No source, config, or dependency file was modified; nothing
was committed or pushed; the repo remains on `exp/brain` exactly as checked out, aside from the
new files under `goal-runs/.../phase5-shots/` and this report, which are goal-run outputs, not
source.
