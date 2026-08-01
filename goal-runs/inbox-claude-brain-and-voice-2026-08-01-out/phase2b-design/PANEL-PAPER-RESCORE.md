# Phase 2B — judge panel RE-SCORE, candidate `paper` only

`PANEL.md` scored `paper` on a crop set that was later found to be a **capture-instrument failure**, not a build failure: the sweep's injected session had expired, so every surface rendered the logged-out skeleton (grey placeholder bars, footer `not loaded`, unrouted titles). The crops have been re-captured against a live session (`brief-paper.md:53-66`); all 22 shots now carry real data. This document re-runs the four seats on the real renders and reconciles with the existing panel.

**Scope discipline.** Same scale, not a new one: the calibration in `PANEL.md:7-26` was re-anchored by re-opening all three controls before any paper crop was opened — `brand-refs/site-desktop-top.png` = **10**, `../inbox-v2-revamp-2026-08-01/baseline/sends-desktop.png` = **3**, `brand-refs/control-generic-admin.png` = **1**. `inkline` and `instrument` are **not** re-scored; their numbers are carried verbatim. This document ends at a **recommendation**. It picks nothing, converges nothing, applies nothing.

---

## What changed materially

`PANEL.md:59-62` (Seat 2, paper — 2) rests entirely on statements of fact that are now false:

| PANEL.md claim | status on the re-captured set |
|---|---|
| "All 22 crops are chrome over skeletons" | **false** — 22/22 render real data |
| "the 198-row lane … never rendered once" | **false** — `content-mattan-desktop.png`, `draft-desktop.png`, `content-ivan-desktop.png` |
| "severity legibility on a paper ground … none of it is visible" | **false** — visible on 5 surfaces, tested below |
| "`sends-mobile` renders the word **Loading…** where the data-viz should be" | **false** — `sends-desktop.png` renders the full viz |
| "`draft-mobile`'s skeleton blocks sit at ~16px radius … rounded search field" | **moot** — those were skeleton artifacts, not the treatment |
| One verified live reference where the contract required two | **still true** — unchanged, and still marked down |

Three of the four seats were written with a carried caveat that no longer applies. Seat 3's evidence half is untouched.

---

## Seat 1 · Brand fidelity — **9** (held, but the basis changes)

*Does the crop bin with `site-desktop-top.png` or with `control-generic-admin.png`?*

`PANEL.md:39-40` gave 9 with an explicit caveat: *"this score is for chrome. Paper rendered no data anywhere."* The caveat is now retired, and the tell-count goes from four of five to **five of five** — because the fifth tell, the one the panel said no direction ports at the site's register, is the one that only appears on populated screens.

1. **Warm paper ground + desk grid** — every crop. `content-ivan-desktop.png` field and grid pitch sit against `site-desktop-top.png` as a family, not a quotation.
2. **Editorial serif display** — `Content` / `Today` / `Ops` / `Sends` / `Drafts` at display scale, roman, tight, plus a serif numeral tier (`38`, `14`, `4`, `67`, `20`, `92`) that the baseline has no equivalent of.
3. **The highlighter behind the money number** — now verifiable and correct on **five** screens, exactly one per screen: `14` on `today-desktop.png`, `30%` on `sends-desktop.png`, `20` on `content-mattan-desktop.png`, `67` on `draft-desktop.png`, `4` on `ops-desktop.png`. `draft-desktop.png` goes further and uses the sweep as an **inline annotation behind quoted text** in the Claude panel ("Ask about ~The best cold email campaigns in…~ without leaving it") — the site's actual semantics (the highlighter marks the thing that matters), not a decoration. This is the tell `PANEL.md:135` called "the site gesture that no other direction ports."
4. **Ink-block primary with reversed tracked caps** — `IVAN` / `MATTAN DANINO` segmented, `APPROVE & SEND` against an outlined `DISCARD` (`ops-desktop.png`), `Overview` / `7d` / `All · 2`. Structurally the site's `Book the free fit call` block, square-cornered.
5. **Tracked small-caps eyebrow + square marker** — `WORK`, `DECISION`, `FUNNEL`, `VOLUME`, `01 URGENT`, `01 ON MATTAN'S BOARD`, and square markers throughout. `▪ FOR AGENCY OWNERS` on the site is the same object.

**Why not 10:** 10 is the site itself and the calibration reserves it. Two visible off-brand leaks also hold it down: the default **underlined blue link** on `ops-desktop.png` (the newsjack headline) is a hue the site does not have — and it is the *same* defect `PANEL.md:91` used to deduct instrument; and `content-ivan-mobile.png`'s tab bar carries three badge treatments at once (a paper hairline chip for `56`, filled dark-red badges for `18` and `2`).

**Score: 9.** Unchanged number, upgraded from a chrome score to an evidenced one.

---

## Seat 2 · Craft / density — **2 → 7**

*Type-scale discipline, material consistency, severity legibility, and whether the 198-row content lane is navigable.*

The seat had two make-or-break questions that could not previously be asked. Both can now be asked, and paper passes both.

### Test A — is the dense lane navigable on a paper ground? **Yes.**

`content-mattan-desktop.png` and `draft-desktop.png` show the anti-re-skin move the brief claimed (`brief-paper.md:41`) actually shipped: rows are **de-carded onto a continuous ruled sheet** — full-bleed, hairline separators, no card and no shadow per row, a notebook margin carrying one square marker. Chip anatomy is one anatomy everywhere (`TEXT` / `▪ QA_BLOCKED 62` / `INTERNAL` — tracked caps, hairline box, transparent fill, ink text, square severity marker), the same discipline `PANEL.md:70` awarded instrument a 9 for. Section heads are ledger heads that keep the count above the thing being counted (`01  ON MATTAN'S BOARD … 20`), and the filter row carries live counts (`Needs review 70 · Published 9 · Errors 3 · Archived 2`, `84 drafts`). Selection on `draft-desktop.png` reads instantly at a 570px column width. This is a navigable 198-row lane.

### Test B — does severity survive on paper? **Yes, and the brief's measured argument checks out against the pixels.**

`brief-paper.md:43` claims `#10A37F` measures **2.9:1** on paper, amber **1.8:1**, red **2.8:1**, so severity moved off coloured text onto **square markers + tinted hairline boxes with ink text**. Verified:

- `draft-desktop.png` — `▪ QA_BLOCKED 67` reads as an amber square + amber hairline box + **ink** numerals. The error banner is a pink-tinted hairline box with a red square and **ink** body text, not red text.
- `content-ivan-desktop.png` — the twenty-alert run that `PANEL.md:66` watched inkline paint as a **red picket fence** is here **one** tinted head (`38 ▪ 3 errored · 35 elsewhere`) plus **one** red spine down the whole run, with every row in ink. One severity mark per run, not per row. That is the same strictly-better answer instrument earned its 9 for, arrived at independently, on the harder ground.
- `ops-desktop.png` — the four-tier stat lockup encodes state purely in square markers (green `WAITING ON YOU`, grey `WORKING`, ink `DONE`, amber `BLOCKED`) with ink labels. `BLOCKED` is findable before a word is read.
- `today-desktop.png` — severity lives in the section head (`01 URGENT … 0/3 cleared ▪`) and in a square-marker legend under a flat stacked bar. Not in the row copy.
- Scanning `draft-desktop.png`'s left margin, severity is readable **as a column** without reading any text. That is the test, and it passes.

The direction's own "fails if" clause (`brief-paper.md:26`) — *"the paper ground murders scanability of severity states"* — does not fire.

### Real deductions (five, two of them self-contradictions)

1. **Material inconsistency: the cards survive where the brief said they die.** `brief-paper.md:5` promises radii collapse to 0–4px and `:41` promises de-carding. The content lanes deliver; the dashboard surfaces do not. `today-desktop.png`'s section panels and `sends-desktop.png`'s `DECISION` / `FUNNEL` / `VOLUME` blocks are still **floating ~8–10px rounded cards with a resting shadow on a field** — structurally the shape shared by the baseline and TailAdmin. `sends-desktop.png` is the weakest anti-re-skin surface in the set: its scaffold is inherited from the baseline nearly unchanged and repainted.
2. **The accent tints a surface**, which `brief-paper.md:10` explicitly forbids ("accent never fills a surface, never tints a card"): selection on `draft-desktop.png` is a filled mint band across the row.
3. **Em dash in UI copy** — `draft-desktop.png`, error banner: *"Generation stuck — no completion within 21 minutes."* `CONTRACT-2B.md:16` bans it outright. `PANEL.md:146` charged inkline and instrument for the same class of violation; paper is charged identically. It is now **three of three**.
4. **A void, larger than the one instrument was deducted for.** `drafts-desktop.png` leaves roughly **800px** of featureless paper below a two-row list — `PANEL.md:71` deducted instrument for ~450px below `BLOCKED · 3`. Paper's Ops screen is dense to the fold, so this is not the same screen, but it is the same defect and it is bigger. The section head on that screen also reads left-clipped (`OPS · 2, APPROVED IN OPS, NOT HERE`).
5. **The one data-viz opportunity is an unstyled text dump.** `draft-desktop.png`'s QA verdict panel prints thirteen `VOICE: 8/10` / `SUBSTANCE: 7/10` lines as plain body sans — no column, no alignment, no tabular-nums treatment, no encoding — on the surface where `brief-paper.md:12` promised exactly that.

**Score: 7.** It clears inkline's 6 decisively on the one thing that decided inkline's seat (severity discipline — paper solves the red picket fence inkline failed). It stays under instrument's 9 on material consistency: instrument carries **no** card and no resting shadow anywhere, paper carries them on two of its surfaces, and two of paper's five defects are its own brief contradicting itself.

---

## Seat 3 · Top studio (evidence) — **3 → 5**

*Scored against the FETCHED external references, with retrieval evidence.*

This seat has two halves. Only one of them was affected by the re-capture.

**The evidence half is unchanged and still fails the contract.** `brief-paper.md:47` states it plainly and asks to be marked down: the builder was killed before recording a second live fetch, so the direction cites **one** verified external reference where the contract required **two** — and that one is the *orchestrator's* capture of `ivanmanfredi.com`, not the builder's own retrieval. `refs/` is empty (verified — zero files), so there is no retrieval artifact. **Marked down, exactly as `PANEL.md:84` did, and as the brief asks.** This is a hard cap: paper cannot reach inkline's 6, which was earned on three references carrying measured values that could not plausibly have been recalled (`--edge-highlight-color: #ffffff0f`, a 6px×19 / 4px×10 radius census, `160ms cubic-bezier(.25,.46,.45,.94)`), let alone instrument's 9 with four auditable fetches carrying HTTP status and byte counts plus a fetched-and-rejected entry.

**The workmanship half was unanswerable and is now answerable — and it answers well.** `PANEL.md:84` closed with *"the studio question itself … cannot be answered from crops in which no data ever rendered. Unanswerable at this gate is itself the answer at this gate."* That condition has lapsed. On the real renders there are several moves a top studio would sign: the highlighter deployed as an **inline annotation over quoted text** (`draft-desktop.png`, Claude panel) rather than as decoration; the ledger head with a serif index numeral and count set in serif; the four-tier stat lockup on `ops-desktop.png` encoding state entirely in markers; a severity system derived from a **measured** contrast argument rather than a stylistic one, and shipped consistently across five surfaces.

**One new deduction found in the image rather than the prose**, mirroring the deduction `PANEL.md:91` laid on instrument: `ops-desktop.png` renders the newsjack headline as a **default underlined blue link**. Commit `98e88d6` is described in `brief-paper.md:33,43` as having "retired the 4th and 5th hue" — a commit-level claim falsified by its own crop.

**Score: 5.** Off the floor because the craft question is now answered and answers well; capped below 6 because half the contracted evidence does not exist and no retrieval artifact was produced.

---

## Seat 4 · Felt difference — **9** (held, basis upgraded)

*Against `baseline/sends-desktop.png`. If a stranger cannot tell them apart in 3 seconds: 0–2.*

`PANEL.md:104` scored 9 with a hedge — *"this survives the fact that the crops are skeletons, because on this direction the skeleton is the material."* The hedge is retired. The run now contains the cleanest same-screen A/B available: `crops/paper/sends-desktop.png` against `baseline/sends-desktop.png`, the same screen, the same data model, the same day. Counting only what a stranger sees first:

- Ground: warm paper + desk grid vs flat `#000`.
- Type: serif numerals `30%` / `91` / `6d` / `92` / `28` / `15` vs sans-bold `28` / `103` / `5d`.
- Accent: **one** highlighter sweep on `30%`, the single number that matters, vs green as status dot **and** progress fill **and** button **and** every sparkline bar.
- Hue count: the baseline's blue `Connections` dot and purple `InMails` dot are gone — markers are neutral ink squares, sparkline bars are neutral ink. Five hues to one.
- Controls: ink blocks with reversed tracked caps vs rounded grey pills.
- Third text tier: readable ink-grey on paper vs the baseline's ~2:1 grey-on-black that reads only as "disabled".
- One further honest win the panel charged inkline for: the "Ivan scope counts the warm-lane era only…" footnote is **amber body copy** in the baseline and in inkline; paper renders it as plain ink. It is a footnote, not a severity, and paper is the only direction that says so.

And beyond the palette, the row model itself moves — `content-mattan-desktop.png` de-cards a lane the baseline would have carded. That is structural, not a recolour.

**Held at 9, not raised:** `sends-desktop.png`'s card scaffold is inherited from the baseline (Seat 2, deduction 1), which is the single thing in the set pulling toward "re-skin."

---

## REVISED summary

| seat | paper (revised) | paper (was) | inkline | instrument |
|---|---|---|---|---|
| 1 · Brand fidelity | **9** | 9 | 7 | 4 |
| 2 · Craft / density | **7** | 2 | 6 | **9** |
| 3 · Top studio (evidence) | **5** | 3 | 6 | **9** |
| 4 · Felt difference | **9** | 9 | 8 | 8 |
| **total / mean** | **30 · 7.50** | 23 · 5.75 | 27 · 6.75 | **30 · 7.50** |

`inkline` and `instrument` carried verbatim from `PANEL.md:117-121`; they were not re-judged here.

**The shape, which still matters more than the total.** `paper` and `instrument` finish **tied at 7.50 by two opposite routes**. Paper wins brand (9 v 4) and felt-difference (9 v 8) and loses evidence (5 v 9); instrument wins craft (9 v 7) and evidence (9 v 5). Neither dominates the other on any pair of seats. `inkline` no longer has the "nothing below 6" distinction to itself and is now strictly behind both on the mean.

---

## Does the RECOMMENDATION change? — **Yes. Materially.**

🔴 **Recommendation only. This phase ends at Ivan's ballot. Nothing here is a decision, and nothing is converged or applied.**

`PANEL.md:129-131` recommended *"`instrument` as the structural base, with `inkline`'s editorial spine grafted onto it — and `paper` staged as EVIDENCE-INCOMPLETE rather than as a loser,"* resting on one stated asymmetry: *"Instrument's failure is that it is anonymous — but anonymity is fixable by addition… Inkline's and paper's failures are density and evidence — those are fixable only by rebuilding the thing that was supposed to be the proof."*

**Two of that recommendation's three load-bearing premises are now false.**

1. *"`paper` … has no craft evidence at all"* (`PANEL.md:123`) — false. It has 22 usable crops and passes both of its own make-or-break gates.
2. *"fixable only by rebuilding the thing that was supposed to be the proof"* — false. No rebuild was ever required; the proof existed and the capture was broken. The asymmetry that decided the recommendation has evaporated.
3. **The graft list has become a description of paper.** Of the six named grafts (`PANEL.md:134-142`) — the serif display + numeral spine, the highlighter sweep behind one number per screen, the tracked small-caps eyebrow as lockup partner to a big numeral, the numbered row register, the ink-block primary control, and the faint desk grid on the app frame — **all six already ship natively in `paper`**, on real data, in the crops above. The prior recommendation was, in effect, a plan to reconstruct `paper` on top of `instrument`.

### Revised framing recommended for the ballot

- **Stage `paper` as a live co-leader, not as EVIDENCE-INCOMPLETE.** It ties `instrument` at 7.50 and beats it on the two seats that encode `DIAGNOSIS.md`'s actual complaint ("this is anonymous").
- **The ballot's real question inverts.** It was *"can brand be grafted onto the best-made thing?"* It is now *"which is the smaller, safer diff — grafting brand onto instrument, or grafting instrument's material discipline onto paper?"* On the evidence, the second diff is smaller and mostly **subtractive**: de-card the two dashboard surfaces (`today`, `sends`), replace the mint fill selection with a spine, close the `drafts` void, kill the blue link, delete one em dash. Adding a brand no direction of instrument's own measured. Naming that as the cheaper path is a judgment for the ballot, not a call this document makes.
- **`instrument` remains the only auditable-evidence direction, and that is not a formality.** It is the sole direction whose claims can be checked without trusting a brief. If Ivan weights contract compliance, instrument still wins outright on the seat paper fails.
- **Conditions that must ride on the ballot regardless of pick:** the em dash in UI copy is now a violation in **three of three** directions; the blue link leak is in **two of three** (`instrument/ops-desktop.png`, `paper/ops-desktop.png`); paper's evidence gap (1 of 2 references, `refs/` empty) is unfixed and should not be waived by the re-capture — the re-capture repaired the crops, not the retrieval.
- **The rebase flag at `PANEL.md:158-160` is unchanged and still applies to all three branches** (base `87050cd`, current `exp/brain` tip ahead). Any graft plan is costed with the rebase, not after it.

### Reconciliation note the ballot should carry

`inkline` was judged on a crop set produced by the same harness, and `PANEL.md:67` records that *"`content-ivan-desktop.png` never loaded, so inkline's own densest Ivan lane is untested."* That is a smaller instance of the failure that invalidated paper's set, and it was **not** re-captured. Whether inkline's craft 6 deserves the same courtesy is a fairness question outside this document's scope — flagged, not adjudicated.

### Revised biggest risk if Ivan picks `paper`

Not "there is no evidence it works" — that risk is retired. The live risks are: (a) the **contract violation stands** — one external reference, no retrieval artifact, so its studio claims rest on the orchestrator's own capture; (b) **material inconsistency between its lanes and its dashboards** — the content lanes de-card, `sends` and `today` do not, so the direction is currently two materials wearing one palette, and the version of it a stranger would call a re-skin is the one screen (`sends`) most directly comparable to the baseline; (c) it is the **most opinionated** direction in the run — a warm paper operator tool is a taste bet, and Seat 4 measures that a stranger sees the difference, not that the person using it eight hours a day still likes it in week three.
