> 🔴 **RETRACTION 2026-08-01.** This panel scored three directions. The third, `paper` (warm paper / editorial serif), was **rejected by Ivan and erased** — the warm-paper editorial identity is retired and was never asked for. Its branch, brief, crops and rescore are deleted. **Ignore every `paper` row below.** The live comparison is `instrument` (7.50) vs `inkline` (6.75), and the panel's recommendation — which was framed around grafting brand onto instrument — now reduces to instrument as base with inkline's readable third text tier and severity discipline as the named graft.

# Phase 2B — design judge panel (4 seats, one agent, sequential)

Judged on rendered images only. Calibration was performed and written before any candidate crop was opened. This document ends at a **recommendation**. It does not pick a winner, does not converge, and applies nothing.

---

## 0 · Calibration (done first, on the three controls)

**`brand-refs/site-desktop-top.png` — KNOWN-BRANDED. Top of scale: 10.**
Five countable tells, all of them load-bearing:
1. Warm paper ground (`~#F0EDE6`) carrying a faint ~40px desk grid — not white, not grey, not black.
2. Editorial serif display at extreme scale ("Add $15k-$50k/mo of new pipeline"), roman, tight.
3. The green as a **hand-swiped highlighter behind the money number** (`$15k-$50k/mo`) — an annotation gesture, never a status.
4. A solid ink-black block with reversed **italic** serif inside it ("in 90 days.").
5. Small-caps tracked eyebrow with a square marker (`▪ FOR AGENCY OWNERS`), and an **ink-block CTA** ("Book the free fit call →") — a black rectangle with serif text, not a rounded green pill.

**`brand-refs/control-generic-admin.png` (TailAdmin) — KNOWN-GENERIC. Bottom of scale: 1.**
Grey field; floating white cards at 12–16px radius with resting shadows; bold sentence-case card titles each with a `⋮` kebab; indigo bars over an indigo area gradient; tinted green/red percentage pills; coloured icon tiles; active nav rendered as a filled tinted pill; avatar + chevron topbar; `⌘K` search. Competent, and nobody's.

**`../inbox-v2-revamp-2026-08-01/baseline/sends-desktop.png` — KNOWN-COMPETENT-BUT-MEH. Placed at 3.**
This is the thing being beaten, and my scale separates it from **both** controls rather than collapsing it into either.
- Why not 1: it is better organised than TailAdmin. The decision row (ACCEPT / GOVERNOR / RUNWAY) reads instantly, `28%` and `103/100` are correctly the loudest things on screen, the funnel `104 → 29 → 15 → 0` is a real information design, and the honest amber over-cap hatch on the governor bar is a genuinely thoughtful move no template ships.
- Why not 8: it carries **zero** of the site's five tells. Black `#000` field where the brand ships warm paper. System-sans bold where the brand ships editorial serif. Green as status dot **and** progress fill **and** button **and** every sparkline bar — the exact opposite of a rationed highlighter. And it is not even one hue: a blue `Connections` dot, a purple `InMails` dot, amber, red, green — five. The third text tier ("Era totals · convos 34 · calls 0") is grey-on-black at roughly 2:1, legible only as "disabled".
- Structurally it bins with TailAdmin — floating rounded cards on a field, tinted pills, multi-hue category dots — and differs mainly by having swapped the palette to dark. **That is what "meh" is**, and it is exactly what `DIAGNOSIS.md` predicted: token-perfect, brand-absent.

Scale separates cleanly at **10 / 3 / 1**. Proceeding.

---

## Seat 1 · Brand fidelity
*Does the crop bin with `site-desktop-top.png` or with `control-generic-admin.png`?*

| | score |
|---|---|
| paper | **9** |
| inkline | **7** |
| instrument | **4** |

**paper — 9.** The chrome that rendered is the closest any candidate gets to the site, and it is not close-ish, it is nearly a match. `crops/paper/content-ivan-mobile.png`: serif "Content" display; the Ivan/Mattan selector as a **solid ink-block** with tracked caps `IVAN` reversed out of it — structurally the site's CTA; tracked caps eyebrow `WORK`; a warm `#F6F3ED` field carrying a desk grid at the same register and roughly the same pitch as the site's; a square green marker beside `just now`. `crops/paper/sends-mobile.png` repeats it: serif "Sends", ink-block `IVAN` / `OVERVIEW` / `7D` segmented controls, an ink rule under the tabs. Four of the site's five tells, present and correct.
*Caveat carried into every other seat: this score is for chrome. Paper rendered no data anywhere (see Seat 2).*

**inkline — 7.** It genuinely ports the two gestures that matter. `today-desktop.png`: serif "Today" title, serif `14` with a **green highlighter sweep drawn behind it**, tracked `THINGS ON YOUR PLATE` beneath, and a numbered editorial register (`01 URGENT ————`). `sends-desktop.png`: serif `30` / `92` / `6d` with the sweep behind the `30`. `ops-desktop.png`: a serif headline set as an empty state. That is the site's serif-numeral-plus-highlighter language actually working on dark. It does not bin with TailAdmin.
It does not bin with the site either. The ground is still black, the primary control is not an ink block, and the active nav item is a **rounded pill with a green outline glow** (`Content`, `Claude` in the rail) — the single most template-shaped object in the direction, and the same shape the generic control uses for its active nav. Verdict: the site's typography wearing the baseline's material.

**instrument — 4.** It bins with Linear/Geist, which is a real third bin and not the generic one. Against TailAdmin it separates on countable structure: no card per row, no second hue, no shadow on a resting surface, no weight above 600, a ticked measuring rule instead of a title bar. So it is not the control.
But it is also not Ivan. `content-desktop.png` and `content-mobile.png` carry **none** of the five site tells — no serif, no warm ground, no highlighter, no ink block, no display-scale eyebrow. `content-mobile.png` is the single most anonymous image produced in this run: a white field, a black pill, grey hairlines, 15px sans. A stranger asked "which of these was made by the person who made ivanmanfredi.com" does not pick it. This is the direction's own stated failure mode — *scoring clean and anonymous at once* — arriving on schedule.

---

## Seat 2 · Craft
*Type-scale discipline, material consistency, severity legibility, and whether the 198-row content lane is navigable. Density is where a direction dies.*

| | score |
|---|---|
| paper | **2** |
| inkline | **6** |
| instrument | **9** |

**paper — 2. Unscorable as built, and that is the finding.**
All 22 crops are chrome over skeletons. `content-ivan-desktop.png`, `today-desktop.png` and `ops-desktop.png` are **the same image** but for which rail item is lit: an unrouted "Inbox" title over seven grey placeholder rows, footer reading `not loaded`. `sweep.json` corroborates — every desktop shot bailed at `settleMs` 6016–6022, and `content-mattan` and `draft` at 1440 are marked `step:"missed"`. Mobile got further (`settleMs` 13k–51k) and routes correctly, but `content-ivan-mobile` / `content-mattan-mobile` still show three skeleton rows, `draft-mobile` two skeleton blocks, and `sends-mobile` renders the word **"Loading…"** where the entire data-viz should be.
So the three things this direction had to prove were never rendered once: the 198-row lane, severity legibility on a paper ground (its own brief measured accent at **2.9:1**, amber **1.8:1**, red **2.8:1** on paper and redesigned severity specifically around that — none of it is visible), and the data-viz. Its brief's own "fails if" clause is "density must survive — the content lanes with 198 rows are the test". That test did not run.
Two self-contradictions in the chrome that *did* render: `draft-mobile.png`'s skeleton blocks sit at ~16px radius against a brief that says radii collapse to 0–4px, and `content-ivan-mobile.png` keeps a rounded-rect avatar plate and a fully rounded search field.

**inkline — 6.** Real craft wins, one real craft failure.
Wins, from `draft-desktop.png` (the only inkline crop with the lane fully loaded): rows are de-carded onto hairlines with a numbered margin register `01 / 02 / 03`; selection is a 2px accent spine; chip anatomy is consistent (`TEXT · ▪QA_BLOCKED 67 · 2h ago`); the third text tier is actually readable rather than the baseline's ~2:1 grey.
The failure decides the seat. The top of that same lane is **five consecutive multi-line alert rows set entirely in red 15px body text** ("Resource "Workflow Audit Checklist…" is published with no landing URL"), filling roughly 60% of the visible lane. It is a red picket fence: it ranks nothing, spends the whole severity budget on a homogeneous group, and leaves the actual drafts underneath as the quietest thing on the screen. Severity-as-coloured-text is precisely what a 3-tier severity system exists to prevent. The same defect recurs in amber on `sends-desktop.png` (the "Ivan scope counts the warm-lane era only…" note as amber body copy) and on `today-desktop.png` / `today-mobile.png` ("aging out: 4 — older than 3 days, out of the count").
Two further deductions: `content-ivan-desktop.png` never loaded, so inkline's own densest Ivan lane is untested; and that same "aging out: 4 — older than…" string puts an **em dash in UI copy**, which `CONTRACT-2B.md:16` bans outright — as does the serif empty-state headline on `ops-desktop.png` ("Nothing waiting on you — and this is a live read, not a stall.").

**instrument — 9.** The only candidate whose densest surface both rendered and survived.
`content-desktop.png` / `content-mattan-desktop.png`: the same alert run inkline paints red is here **one red spine on the counting head** (`38 · 3 errored · 35 elsewhere`) with twelve neutral ink rows under a continuous rule beneath it. One severity mark per run, not per row — a strictly better answer to the same data, in the same app, on the same day. Chips are one anatomy everywhere (`TEXT` / `▪ QA_BLOCKED 62` / `INTERNAL` — 10px tracked caps, hairline box, transparent fill, ink text, 5px severity square). Rows carry no box at all: one hairline between siblings, hover as a background shift, selection as the same 2px accent spine that marks active nav. The sticky section head (`01  ON MATTAN'S BOARD  ·|·|·|·|·  20`) is a hairline **ticked every 8px** — it draws the grid its own type rides on, and it keeps the count of what you are looking at above what you are looking at, which is the actual mechanism that makes a 198-row lane navigable.
Two deductions. (a) The screen title is under-scaled: "Content" and "Today" render at roughly 20px regular against 15px body, so the title is nearly the weakest type on the page and the loudest thing is a card numeral. A seven-step scale is a discipline, but the top step is being spent in the wrong place. (b) `ops-desktop.png` still leaves roughly 450px of featureless white below `BLOCKED · 3` — the prior tournament's named Ops void, surviving the palette change, in the direction that explicitly claimed to have closed it.

---

## Seat 3 · Top studio
*Scored against the FETCHED external references, with retrieval evidence. A well-argued brief does not substitute for evidence.*

| | score |
|---|---|
| paper | **3** |
| inkline | **6** |
| instrument | **9** |

**paper — 3.** One verified live reference where the contract required two, and even that one is the **orchestrator's** capture of `ivanmanfredi.com`, not the builder's own retrieval. `brief-paper.md:47` states this honestly and asks to be marked down for it; marked down. Compounding it: `refs/` is **empty** (verified — zero files), so there is no retrieval artifact for any direction, and paper has nothing else to fall back on. And the studio question itself — would a top studio ship this — cannot be answered from crops in which no data ever rendered. Unanswerable at this gate is itself the answer at this gate.

**inkline — 6.** Three references cited with values that could not plausibly have been recalled: Linear's `--edge-highlight-color: #ffffff0f`, a radius census of 6px×19 nodes / 4px×10 nodes, a single motion token `160ms cubic-bezier(.25,.46,.45,.94)`; Geist's 6px radius across 42 nodes and negative display tracking (40px/−2.4px, 24px/−0.96px); the site's eyebrows at 11px / 2.42px tracking and its ground grid at `rgba(26,26,26,.024)`. That specificity is strong circumstantial evidence of real fetching.
It is not the artifact the contract asked for. `brief-inkline.md:48` says the retrieval JSON "was being written to `phase2b-design/refs/` when the builder was killed; if that directory is empty, treat the measured values above as the evidence" — the directory **is** empty. So the score reflects credible-but-unverifiable.
Second deduction, and this one is visible: the direction cites Linear's hairline discipline and tight elevation band, then ships a rounded-pill active-nav item with a green outline glow (`today-desktop.png`, rail) that Linear does not ship and the generic control does. It measured more than it used.

**instrument — 9.** The only direction whose references are auditable. Four fetches with HTTP status and byte counts — Geist across four pages (217,150 / 161,369 / 222,640 / 126,105 bytes), Linear's homepage (1,762,972 bytes) plus fourteen production stylesheets concatenated to 57,750 bytes, TailAdmin declared as the negative control, and Superhuman recorded as **fetched-and-rejected** rather than credited, which is the tell of a builder keeping honest books. Each move traces to quoted source text: Geist Colors' "two background colors… Background 2 sparingly" → exactly two grounds; Materials' "Don't stack two Materials on the same element" → one separation device per boundary; Linear's measured duration histogram (`.16 ×6 · .2 ×3 · .12 ×2 · .1 · 80ms`) → hover 100ms / state 150–250ms. And it is the only entry in this run that argues explicitly against a named negative control, in three specific choices with their costs stated.
One real deduction, found in its own crop rather than its own prose: `ops-desktop.png` renders the newsjack headline ("Anthropic says its own AI models hacked 3 organizations during safety testing") as a **default underlined blue link** — a second hue, on a screen its own accent census covered, in the direction whose headline claim is that `--blue: #0A84FF` now resolves to ink. A measured claim falsified by the image.

---

## Seat 4 · Felt difference
*Against `baseline/sends-desktop.png` and the current look. If a stranger cannot tell them apart in 3 seconds: 0–2. This seat exists to kill re-skins.*

| | score |
|---|---|
| paper | **9** |
| inkline | **8** |
| instrument | **8** |

**paper — 9.** Separation is total and instant. Ground (warm paper + desk grid vs flat black), type (serif display tier the baseline has none of), controls (ink blocks vs rounded grey pills), accent (a square marker and a highlighter register vs green everywhere). This survives the fact that the crops are skeletons, because on this direction **the skeleton is the material** — the field, the grid, the rules and the ink blocks are all present and all different.

**inkline — 8.** `crops/inkline/sends-desktop.png` against `baseline/sends-desktop.png` is the cleanest same-screen A/B in the run, and it is not a re-skin: serif `30` / `92` / `6d` with a highlighter sweep vs sans-bold `28` / `103` / `5d`; neutral grey ink sparkline bars vs bars painted entirely green; neutral `Connections` and `InMails` dots vs a blue one and a purple one; a working canvas inset into a darker frame vs one flat black field; a readable third text tier vs a 2:1 grey. Five changes a stranger sees before reading.
Held back by the honest version of its own risk: it is unmistakably the same room. A stranger separates them; the one person who uses this app every day may read it as *the same app, improved* rather than a different app. Whether that is the thesis succeeding or the seat failing is a taste call, and it belongs on the ballot rather than in this document.

**instrument — 8.** The ground flip clears three seconds on its own, which is also the reason not to score it higher — a light/dark flip is the cheapest possible felt difference and this seat is calibrated against cheap ones. What earns the 8 is what survives if you ignore the palette entirely and count: no card per row on a 198-row lane, ticked section rules instead of title bars, one hue where the baseline had five, no shadow on any resting surface, no weight above 600, and empty states that name their own state and offer one action. Those are structural departures, not a recolour.

---

## Summary

| seat | paper | inkline | instrument |
|---|---|---|---|
| 1 · Brand fidelity | **9** | 7 | 4 |
| 2 · Craft / density | 2 | 6 | **9** |
| 3 · Top studio (evidence) | 3 | 6 | **9** |
| 4 · Felt difference | **9** | 8 | 8 |
| **total / mean** | **23 · 5.75** | **27 · 6.75** | **30 · 7.50** |

The shape matters more than the total. `instrument` wins craft and evidence and loses brand. `paper` wins brand and felt-difference and has no craft evidence at all. `inkline` wins nothing and loses nothing — it is the only column with no score below 6 and none above 8.

---

## Recommendation (for the ballot — not a decision)

**Recommended ballot framing: `instrument` as the structural base, with `inkline`'s editorial spine grafted onto it — and `paper` staged as EVIDENCE-INCOMPLETE rather than as a loser.**

The reasoning is that the two failures are asymmetric in cost. Instrument's failure is that it is anonymous — but anonymity is fixable by addition, and the additions are already built and measured on the branch next door. Inkline's and paper's failures are density and evidence — those are fixable only by rebuilding the thing that was supposed to be the proof.

### Named grafts — from inkline into instrument
1. **The serif display + numeral spine.** `ui-serif`/Georgia roman on screen titles and hero stat numerals, at `-.02em`. This is the single highest-value graft in the run: it costs zero bytes, it is the brand's actual signature, and it directly repairs instrument's weakest measured point (a 20px screen title losing to its own 15px body). Take it at title and hero-numeral only — instrument's seven-step sans scale everywhere else stays.
2. **The highlighter sweep behind the one money number per screen** (`inkline/today-desktop.png`, the `14`; `sends-desktop.png`, the `30`). This is the site gesture that no other direction ports, and it is exactly one accent element per screen, so it survives instrument's rationing rule.
3. **The tracked small-caps eyebrow at display scale** under the hero numeral (`THINGS ON YOUR PLATE`). Instrument already has the 11px/600 `.11em` tier; inkline's contribution is deploying it as a *lockup partner to a big numeral* rather than only as a section label.
4. **The numbered row register** (`01 / 02 / 03` in the row margin, `content-mattan-desktop.png`). Instrument numbers its section heads but not its rows; inkline's ledger register is a cheap, on-brand way to make a 198-row lane countable.

### Named grafts — from paper into whatever wins
5. **The ink-block primary control.** Paper's `IVAN` / `MATTAN DANINO` segmented and its buttons are solid ink rectangles with tracked caps reversed out — structurally the site's CTA. Instrument's black pill (`content-desktop.png`) is one radius away from this already. This is the cheapest remaining brand tell.
6. **The faint desk grid on the app frame only** (never inside data tables), at site-measured `rgba(ink,.024)`. It is the site's most recognisable ground texture and it survives on a cool-neutral ground, not only a warm one.

### Fixes the ballot should carry as conditions, not grafts
- Instrument's **blue link leak** on `ops-desktop.png` (newsjack headline) — a second hue in the direction that claims to have retired it.
- Instrument's **~450px Ops void** below `BLOCKED · 3` — the prior tournament's named defect, unfixed.
- The **em dash in UI copy**, present in inkline (`ops-desktop.png` empty-state headline; "aging out: 4 — older than 3 days") and in instrument (`content-desktop.png` alert body; `content-mattan-desktop.png` "— the photo has to be re-pinned first"). `CONTRACT-2B.md:16` bans it outright. Currently a violation in two of three directions.

---

## Biggest risk per candidate, if Ivan picks it

- **`paper`** — There is no evidence it works. Not one of its 22 crops rendered a row of data, so the 198-row lane, severity on a paper ground (its own measurement puts amber at **1.8:1** there) and all data-viz are wholly unproven. Picking it is picking a thesis and a mobile chrome shot, and committing to a rebuild to find out whether the density survives. Its thesis is also the closest to the flagship surface, which is why it deserves a re-sweep rather than a burial — but a ballot vote on it today is a vote on an unfinished measurement.
- **`inkline`** — The red picket fence. On the one lane it actually rendered (`draft-desktop.png`), five consecutive multi-line alerts in red body text occupy the top of the screen and make the real work the quietest thing on it. That is the same defect the prior "meh" had (severity spent everywhere, therefore meaning nothing), reproduced in a new typeface. If it ships unfixed, the tournament will have changed the register and kept the disease.
- **`instrument`** — It solves the wrong problem. It is the best-made and best-evidenced thing here and it answers "is this loud and undisciplined" — but `DIAGNOSIS.md` established the complaint was "this is anonymous", and `content-mobile.png` is more anonymous than the baseline it replaces, not less. Ivan could ship it, use it happily for a week, and still not feel that the app belongs to the same hands as his site. Ungrafted, it is the highest-craft way to lose the brief.

---

## 🔴 Flag for the ballot — rebase required before any apply

All three candidate branches (`exp/brain-2b-paper`, `-inkline`, `-instrument`) are based on **`87050cd`**. The current `exp/brain` tip now carries the broker/assembler work that landed after these builders were dispatched. **Every one of them needs a rebase onto the current tip before any apply**, and the treatment layers are single large CSS files (paper 738 lines, inkline 870 + retones to two shared sheets, instrument 766 + a retoned token block in `src/styles.css`) — inkline and instrument both touch shared files, so their rebases are not conflict-free by construction. Any graft plan must be costed with the rebase, not after it.
