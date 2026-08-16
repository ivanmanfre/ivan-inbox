# Phase 0 — Readability at real widths (candidate `faithful`, branch `exp/vis-faithful`)

Scout run 2026-08-02. Read-only. Dev server `http://localhost:5431`, dark theme, real
session (`.session.json`, expires 2026-08-02T~19:41 UTC — was live for the whole run).
Routes enumerated from `src/exp/v2c/Shell.tsx:87-449` / `layout.ts:14` (`JOBS`):
today, inbox, drafts, content, sends, ops, settings.

Instrument: `scripts/_scout-read-01.mjs` (untracked, worktree-local). Playwright, `domcontentloaded`
only, settle = no `.sk*` skeleton nodes + no literal "Loading" + `innerText` stable across
two 500 ms checks, resettled before every shot. 30 captured states = 7 jobs × 2 viewports
(1440×900, 1024×768) × {peer-open (Claude docked, the app's own default on desktop/wide),
peer-closed (closed via `.wb-pane-x`)}, plus Content × {draft peer opened by clicking a
card title, both viewports}. Zero console errors in any of the 30 states. Screenshots at
`phase0-shots/read-<job>-<viewport>-<state>.png`. Raw per-leaf JSON at
`phase0-readability-raw.json`. All class/line citations below were read from source, not
inferred from the rendered page.

Two measurement corrections made mid-run, both already applied to the numbers below:
- **Contrast**: the first pass treated a translucent overlay (e.g. `.ct-alert{background:
  rgba(255,69,58,.08)}`) as if it were an opaque background, producing false "contrast 1:1"
  hits on `.ct-alert-n/-t/.chev` and the accent quote-count (`.td-qn`). Fixed to composite
  every ancestor background layer in real paint order before measuring. The false positives
  are gone from the numbers reported here.
- **Line length**: React frequently splits interpolated JSX (`{count}` then a string
  literal) into adjacent sibling text nodes. The first pass measured wrapped-line count off
  only the first such node (often a 1-2 char number), which inflated chars/line. Fixed to
  range over the whole leaf element.
- **`<textarea>` line counts are NOT reliable via `Range.getClientRects()`** — the Ops
  quick-reply box (`textarea.ops-body`, styles.css:674) reported "1 line" for text that
  visibly wraps to 2 lines in the screenshot (`read-ops-1440-peeropen.png`). Excluded from
  the findings below; verified by eye instead.

---

## 1 · TRUNCATION — the pipeline chart's own axis labels clip, on every route/state (CRITICAL, reproduces the prior "PUBLIS" finding)

**This is still present in `faithful`.** The Content pipeline chart's stage labels
(`Generating`, `Needs review`, `Approved`, `Scheduled`, `Published`) are ellipsis-clipped
in **every one of the 6 Content states tested** (both viewports × peer-open/closed), on
**both lanes**. Screenshot: `phase0-shots/read-content-1440-peerclosed.png` and
`read-content-1024-peerclosed.png` — both show the x-axis reading
`GENERA…` `NEEDS …` `APPRO…` `SCHED…` `PUBLIS…` under the capsule bars. "Published" is the
one a prior judge flagged as clipping to "PUBLIS" — confirmed verbatim in this candidate too.

- Source: `src/exp/v2c/Surface.tsx:151-152` — `<div className="wb-caps-x">{parts.map(p =>
  <span className="wb-caps-xl" key={p.key}>{p.label}</span>)}</div>`.
- CSS: `src/exp/v2c/faithful.css:871-877` — `.wb-caps-x{ max-width:320px }` divided across
  5 `flex:1` tracks (`min-width:22px`), each label forced through
  `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`. 320px ÷ 5 ≈ 56-64px per
  track after gaps — never enough for any of the five words at `--fs-eyebrow` (11px) with
  `+0.04em` tracking.
- Measured (Ivan lane, both viewports, both peer states): `clientWidth:56` vs
  `scrollWidth: 63 (Approved) · 66 (Published) · 71 (Scheduled) · 75 (Generating) · 87 (Needs
  review)` — every single label overflows its box.
- **Worse on Mattan's lane** (`ContentList.tsx` `ct-lane-b`, same `wb-chartcard` component
  reused for `ResourceLane`): the legend column is only **37px** wide there — "Generating"
  overflows by 38px (>100%), "Generating resources" (the LM-lane's own label) overflows by
  112px. Only the first 2-3 characters of any label survive.
- This is a component-level defect, not a peer-state or cap-lift artifact — it reproduces
  identically whether the peer is open, closed, or a draft is docked, at both widths tested.

## 2 · LINE LENGTH — the lifted Content cap does produce >90-char single lines, confirmed

The hypothesis in the task brief is correct and now measured. With the peer closed on
Content (`plan.work==='wide'`, `.wb-solo` applied because `Shell.tsx:144`'s `solo` flag
fires), `faithful.css:1221-1222` lifts the 860px readability cap
(`.wb.wb.wb.dt .wb-solo .ct-rows > *, .wb.wb.wb.dt .wb-solo .nav.wb-head{ max-width:none }`)
so `.ct-rows` children grow to the full reclaimed column.

- **Measured at 1440 (1208px column)**: `.ct-subtle.ct-warn` (Ivan lane's stale-alert line,
  `ContentSections.tsx` `AlertCountLine`) renders as **one unbroken 180-character line**
  (`charsPerLine:180`, `widthPx:1208`, `fontSize:12`). Visually confirmed in
  `read-content-1440-peerclosed.png`: "20 unacknowledged pipeline alerts, all older than the
  14-day window. Their task ids are ClickUp-era, so no draft link exists and none is faked —
  and nothing here acknowledges them." spans the full card width on one line.
- The Ivan-lane cadence note (`ContentList.tsx:441-444`, class `.ct-subtle`) does the same:
  **124 chars, 1 line, 1208px wide.**
- Mattan lane's `.ct-subtle` note (`ContentList.tsx:574-578`, "Read-only. An approve here
  might be a publish…") does it too, at **both** widths: 1208px→111 chars/1 line; **and at
  1024 (792px solo column) it STILL renders as one 111-char line** — the text is short
  enough to fit under 792px without wrapping at all, so narrowing the viewport does not
  rescue it.
- The longer Ivan-lane alert line (180 chars) does wrap at 1024/792px, but its first line
  alone runs to roughly 135-140 characters before the break (visible in
  `read-content-1024-peerclosed.png`) — well past a comfortable measure even after wrapping,
  because the average-based per-line estimate undercounts the longest greedy-wrapped line.
- Severity: these are `--fs-meta` (12px) advisory/caption lines, not the workhorse
  `--fs-body` row text, and the spine explicitly scopes them out of the fluid-width rule's
  intent ("these are 1-3 line meta annotations … not body copy", `faithful.css:1223-1227`)
  — but the CSS comment's own claim is contradicted by what's on screen: at 1208px these
  are not 1-3 line annotations, they are one very long line, because nothing constrains
  their measure once the cap is gone. The fix path used for `.ct-card`/`.wb-chartcard` (a
  `max-width` on the object itself, not just a gutter margin) was not applied to `.ct-subtle`
  / `.ct-subline`.

## 3 · TITLE CRUSH — opening both Content peers (a state the workbench explicitly supports) reduces row titles to ~20 characters

This is a peer-crowding defect distinct from #2, on the exact opposite lever: instead of
too much width, two peers at once leaves too little.

- At 1440 with **only Claude docked** (peer-open, `plan.peers.length===1`, list column
  ≈587-620px per the build's own comment at `faithful.css:1186-1188`), `.ct-title`
  (`ContentList.tsx:104`, the row's PRIMARY text per §7.7) measures **331px** wide — titles
  read comfortably (e.g. "AI faked its way through peer review - agency owners posting AI
  content are runn…", 45+ visible characters before ellipsis).
- The moment a **draft peer is also opened** (click a card → `openDraft` →
  `layout.ts:133-139` `addPeer` puts `[draft, chat]`, both shown at `wide` canvas since
  `peerCapacity('wide')===2`), the list column reverts to the CSS class's fixed **400px**
  (`styles.css:22`), and any row that still carries inline `SKIP`/`APPROVE` review-action
  buttons (`ContentList.tsx:134`, `ReviewActions … compact`) has its `.ct-title` measured at
  **125px** — roughly 18-20 characters. Confirmed visually in
  `read-content-1440-draftpeer.png`: the very card that is open in the peer next to it reads
  only **"Anthropic says its ov…"** in the list row, losing "…own AI models hacked 3
  organizations during safety testing" — the number (3) and the subject (safety testing)
  that make the headline meaningful are both gone from the row you're supposedly tracking
  while you read about it in the peer beside it.
- Grid math: row is `grid-template-columns: var(--anchor-w) minmax(0,1fr) auto
  var(--tail-w)` (`faithful.css:520`) — anchor 28px + gap 12px + tail 62px + padding 32px
  leaves ~266px for `1fr` + the review-action `auto` column; the two buttons
  (`ct-ac`, `faithful.css:731-737`) eat roughly 140px of that, leaving `.ct-title` its
  measured ~125px.
- This reproduces at both 1440 and 1024 (1024's draft-peer state drops to a single shown
  peer per `layout.ts:113-118`'s `peerCapacity('desktop')===1`, but the same 400px list
  class and same button-eaten row width apply — measured `.ct-res-row` titles at
  **254px** there, still noticeably tighter than the 461px they get with zero peers open).

## 4 · Truncation sweep — lower-severity / by-design, listed for completeness

- **Content `.ct-meta` chip row** (QA-verdict chip + type chip, `ContentList.tsx:112-127`):
  overflows by ~5px at the 125px-title states (`"PASS 79Image"` measuring 130 vs 125). This
  is masked by a deliberate 14px fade-gradient (`faithful.css:676-684`, documented in the
  file as intentional), not a hard ellipsis clip — lower severity, but worth noting the fade
  itself becomes more visible/aggressive exactly where #3 above already crushed the row.
- **Today** (`TodayScreen.tsx`, base `styles.css`, not `faithful`-owned): `.td-snip`
  (:556), `.td-qs` (:593) and `.td-next .txt` (:606-611) are all `white-space:nowrap` +
  ellipsis single-line previews of what can be multi-paragraph source text. `.td-next .txt`
  is the most extreme: measured `scrollWidth:4514` vs `clientWidth:491-518` (≈9× overflow)
  on the "NEXT" scheduled-post teaser (`TodayScreen.tsx:372-380`) — only the first ~35-40
  characters of the post body survive. This is a stock-screen pattern the candidate
  re-themes but did not rebuild (spine §1.4 bridge scope), and a single-line preview is a
  reasonable UI choice for a teaser row — flagging only because the overflow ratio is the
  largest measured in the whole sweep.
- **Inbox `.snip` / Drafts `.log-snip`**: standard single-line message-preview ellipsis,
  present at every width tested, unremarkable (matches the email-client convention the
  surface is imitating). Not flagged as a defect.

## 5 · TOKEN MISUSE (§3.5: text3 not body on surface3; text4 metadata/disabled only) — clean

**Zero violations found** across all 30 states. The runtime walk (leaf elements whose
computed `color` matched `#7F8582`/`#6F7472` within ±3 RGB, cross-referenced against
composited ancestor background and line/length heuristics for "reads as body") returned
nothing on Today or Content, and nothing elsewhere either. `.ct-subtle`/`.ct-subline` sit on
`--canvas`, not `--surface3`, in every route tested, so the specific §3.5 violation the spine
warns about does not currently manifest — worth stating as a pass, not just an absence of
data.

## 6 · CONTRAST spot-check (Content + Today, alpha-composited, per-leaf)

Only the two **expected** `.wb-cap` badges appear under 4.5:1, both cleanly inside the 3:1
non-text-mark bar the spine grants them (§8.3's justification):

- `.wb-cap[data-cat='4']` "2" and "10" — white text `rgb(255,255,255)` on `--cat-4
  #747977` → **4.43:1**, `under3:false`. Matches the spine's own harness table exactly
  (§9.4: "cat-4 #747977 … white 4.43 → WHITE"). Present in every Content state at both
  viewports (Ivan lane's "2" and Mattan/resource lane's "10").
- **Nothing else** measured under 4.5:1 on Content or Today after the compositing fix (see
  correction note above — the pre-fix run's `.ct-alert-n/-t/.chev` and `.td-qn` "1:1"
  results were measurement artifacts, not real failures; both are `--sev-urgent`/`--accent`
  text sitting on their own faint translucent tint over `--canvas`, and both clear 4.5:1
  once composited correctly).

## 7 · HIERARCHY READ — subjective notes per route (screenshots cited)

- **Today, "02 APPROVE" rows** (`read-today-1440-peeropen.png`): each hand-off card stacks
  FOUR lines at nearly identical visual weight — bold title ("DM drafts"), a quoted
  person's message ("David Card — Cool, give me a couple days…"), a stats meta line ("4
  waiting · oldest drafted 15d ago"), and a system caption ("live rows and Approve & send
  are in the DM queue — this list is the cached brief"). The quote and the system caption
  are both `text2`-weight prose of similar length; nothing in type or color tells a reader
  which one is a real person talking and which is the app explaining its own data
  provenance. This is exactly the "two adjacent text blocks, identical treatment, different
  meaning" trap.
- **Ops** (`read-ops-1440-peeropen.png`): every pending card's corner label reads **`#null`**
  literally (`OpsBoard`/`PendingCard`, id field unresolved) — not a readability-of-prose
  issue but a label that reads as raw placeholder data reaching the screen; a reader has no
  way to know if `#null` means "no ID exists" or "this is broken."
  routing.
- **Content, review rows** (`read-content-1440-draftpeer.png`): once a row's title is
  crushed to ~20 characters (§3 above), the QA chip ("PASS 79") and format chip ("Image")
  become the *only* legible thing on the row — the reader ends up scanning verdicts and
  formats with no idea which headline they belong to until they've already opened it.
- **Inbox / Sends / Settings**: no hierarchy ambiguity observed at either width — standard
  avatar + name + snippet + timestamp row, single visual register throughout
  (`read-inbox-1440-peeropen.png`).

---

## Ranked: 10 worst readability defects

1. **Pipeline chart legend labels clip on every Content state, both lanes** (`Surface.tsx:151-152`,
   `faithful.css:871-877`) — reproduces the previously-flagged "PUBLIS" defect verbatim,
   unfixed in this candidate; worse on Mattan's lane (37px column, up to 112px overflow).
2. **Title crush to ~125px (~20 chars) when both Content peers are open** (`ContentList.tsx:104`,
   `faithful.css:516-525` + `:731-737`) — a state the workbench itself offers
   (peerCapacity 2 @ wide), and it defeats the row you opened the peer to look at.
3. **Cap-lifted `.ct-subtle` lines run 111-180 chars unbroken at 1208px/792px**
   (`faithful.css:1221-1222`, `ContentList.tsx:441-444`/`:574-578`) — the exact regression
   the task brief hypothesized, now measured and screenshotted.
4. **`.td-next .txt` "NEXT" teaser hides ~90% of its content** (9× overflow, `TodayScreen.tsx:372-380`)
   — largest raw overflow ratio measured in the whole sweep, even though single-line preview
   is a defensible pattern here.
5. **Ops cards show literal `#null`** — a label reaching the screen unresolved, undermines
   trust in every other number on that surface.
6. **Today "02 APPROVE" rows stack 4 same-weight text lines** — quote vs. system caption
   indistinguishable by type alone.
7. **`.ct-meta` chip fade-mask becomes load-bearing exactly where rows are already crushed**
   (§3+§4 combine) — "PASS 79 / Image" partially overflows (130 vs 125px) right where the
   title is least legible.
8. **Mattan-lane resource titles also lose ~45% of their width under 2-peer crowding**
   (`.ct-res-row .ct-title`, 461px→254px measured) — same defect as #2, second lane.
9. **`.td-qs` quote-preview rows single-line a full reply** (up to 959-1975px content into
   ~460-480px, `styles.css:593`) — legitimate preview pattern but among the largest content
   losses measured; several rows lose the entire substantive sentence.
10. **`.wb-cap` white-on-`#747977` badges sit at 4.43:1, just under 4.5:1 body bar** — the
    spine already justifies this at the 3:1 non-text-mark bar and it is the *only* other
    sub-4.5:1 leaf found on Content/Today, so it ranks last: known, accepted, and isolated.

All screenshots referenced above are at
`/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots/read-*.png`.
Raw per-state JSON (leaf counts, every finding, not just the excerpts quoted here) is at
`phase0-readability-raw.json` in the same directory.
