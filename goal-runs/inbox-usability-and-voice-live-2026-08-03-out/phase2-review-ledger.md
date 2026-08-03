# PHASE 2 — PER-SECTION REVIEW LEDGER (62/62 screenshots viewed)

Reviewed 2026-08-03 against `reference-nixtio-full.png` (the owner-chosen look) and
`phase2-style-delta.md` (the contract). Verdict per route-width-step. Shared defects are
coded F1–F18 (defined inline at first occurrence, cross-referenced after) so one CSS fix
clears every entry that cites it.

Reference vocabulary being judged against: soft radii, airy borderless charcoal cards on a
black plate over pistachio ground, lime `#B8FF66` / orange `#FF9B22` / white / neutral data
marks, ink numerals printed inside marks, quiet uppercase labels, bold white figures, pill
chips, nothing cramped, no hairline-grid austerity, no legacy teal/blue.

---

## TODAY

### today-1440-s0 — FIX
- **F1 (P1) — hero segmented bar + legend still wears the OLD palette.** The "12 THINGS ON
  YOUR PLATE" plate bar renders red → teal `#10A37F` → blue `#0A84FF` segments, and the
  legend dots repeat it ("1 urgent" red / "10 to approve" teal / "1 going out" blue). Blue
  and teal are exactly the hues §2's token delta eliminated (TRIAD → lime/orange/white/
  neutral); the bar is clearly not reading the cat tokens (hardcoded hexes or a component
  not under `.wb` token flow). Violates spec §2 (TRIAD `--cat-1..4`) and §1's palette.
  Fix: segment fills → `to approve: var(--cat-1)` lime, `going out: var(--cat-3)` white
  (2px canvas gap between segments), `urgent` may stay `var(--sev-urgent)` (severity is
  licensed); legend dots read the same vars. Grep the Today masthead component for
  `#10A37F` / `#0A84FF` / `#30D158` literals.
- **F2 (P1) — "SENDS THIS 7D" lane bars all teal.** All four `.td-bar` fills are the old
  accent teal, and the bars measure ~8px tall. Direct violation of §3g: ".td-bar family:
  height 8px → 12px (still capsule); fill colors = cat tokens." Fix:
  `.wb.wb.wb .td-bar{height:12px}` and fill per lane index `var(--cat-1..4)`
  (Warm lime / Harvested orange / Cold white / Engager neutral), trailing count stays
  printed `--text` numeral (already correct).
- **F5 (P2) — trend paint still teal, not delta tokens.** ACCEPT tile "7d ▲3" arrow and the
  "30d" span read old-green `#10A37F`, not `--delta-up #B8FF66`. Violates §3h ("the glyph
  gets color:var(--delta-up)... trend paints read the delta tokens on dark too"). Fix:
  `.td-ts span`/trend spans → `color:var(--delta-up)`; number stays `--text`.
- Capture note: URGENT/TODAY sub-sections show "Loading the brief…" — those two zones are
  unjudgeable in this frame (re-shoot after load if their skin matters).
- Everything else lands: plate + 20px pistachio reveal + shadow ✓, rail pills with lime
  active icon ✓, display masthead ✓, campaign tiles airy ✓, section headers quiet ✓.

### today-1440-s1 — FIX
- **F2** (all four lane bars teal, ~8px — see s0).
- **F5** (ACCEPT "▲3" teal — see s0).
- Campaign-health tile row and section rules otherwise clean; "NORMAL" in `--sev-clear`
  green is LEGAL (severity hex survives per §4).

### today-390-s0 — FIX
- **F1** — legend dots red/teal/blue at 390 too (bar caught mid-load, only the teal
  segment drawn). Same fix as 1440.
- **F5** — "▲3" teal in ACCEPT tile.
- **F18 (P3) — 3-across tiles too tight at 390.** ACCEPT meta wraps as "7d · ▲3 vs /
  30d (24%)" and GOVERNOR orphans "· 18 left today" onto its own line starting with an
  interpunct. Spec gap (§3h never provisioned 390 for the tile row). Fix: at ≤480 drop
  the interpunct join (`span::before` separator suppressed on wrap) or shorten meta to
  "7d ▲3 · 24%".
- Tab bar is right: lime active label, sev badges, 8px reveal, 24px plate radius ✓.

### today-390-s1 — FIX
- **F2** — all four "SENDS THIS 7D" bars teal, thin. Same fix.
- Tiles/section headers otherwise fine at this scroll.

---

## INBOX

Route-wide notes (cited per entry):
- **F11 (P2) — avatar identity ramp is the old app's palette.** Every avatar is a saturated
  teal/blue/purple/pink gradient circle — after the reskin these are the ONLY place
  blue/purple survive, and they sit on every row of the app's busiest surface. Spec gap
  (§5 move 3 restyled only `.avatar-me`; the hash-color ramp was never covered). Fix:
  re-derive the avatar hash palette from the reference family — 4 fills:
  `#B8FF66`+ink, `#FF9B22`+ink, `#FFFFFF`+ink, `#707070`+white (or: neutral `--surface3`
  disc + 2px cat-colored ring). One constant array swap; contrast pairs already in the
  appendix (14.97 / 8.51 / 17.93 / 4.95).
- **F10 (P2) — sticky summary band lets scrolled rows show half-clipped beneath it.**
  The "56 they replied / 1357 waiting" card is sticky; rows slide under and reappear
  half-cut in the breathing gap between the card's bottom edge and the first full row
  (violates the spirit of §3f/risk 3: sticky chrome must sit on an opaque canvas strip).
  Fix: give the sticky wrapper `background:var(--canvas)` full-bleed with
  `padding-bottom:8px` (the card keeps its own surface1), or add
  `mask-image:linear-gradient(#000 calc(100% - 8px), transparent)` on the scroller top.
- P3 (spec gap): the band's progress bar is a ~6px gray hairline-era mark — the one
  austere element left on this surface. Reference bars are 12px capsules. Fix: height
  12px, `border-radius:999px`, replied-segment `var(--cat-1)`.
- Observation, not a defect: the third Claude starter ("Walk me through the send path")
  carries a bright focus ring in every 1440 frame — capture-script focus, licensed
  focus-visible mechanics.

### inbox-1440-s0 — FIX — F11 (first screenful of old-ramp avatars); P3 band bar. Masthead, search field (r-ctl 12), filter pills 36px, row chips, density band all correct.
### inbox-1440-s1 — FIX — F11.
### inbox-1440-s2 — FIX — F10 (row "Hey Ron…" half-clipped under band) + F11.
### inbox-1440-s3 — FIX — F10 (clipped row under band) + F11.
### inbox-1440-s4 — FIX — F11. Rows/chips/timestamps clean.
### inbox-1440-s5 — FIX — F10 ("Hey Steven…" sliver under band) + F11.
### inbox-1440-s6 — FIX — F11.
### inbox-1440-s7 — FIX — F10 ("Brad Matthews" row half-cut under band) + F11.
### inbox-390-s0 — FIX — F11. 8px reveal + tab bar correct; name truncation vs two chips is acceptable.
### inbox-390-s1 — FIX — F11.
### inbox-390-s2 — FIX — F10 ("Tony Christens…" clipped under band) + F11.
### inbox-390-s3 — FIX — F10 ("You: Hey Ron…" clipped) + F11.
### inbox-390-s4 — FIX — F11.
### inbox-390-s5 — FIX — F11.
### inbox-390-s6 — FIX — F10 ("Hey Jenny…" clipped) + F11.
### inbox-390-s7 — FIX — F10 (row + "2d" timestamp half-cut at band edge) + F11.

---

## DRAFTS

### drafts-1440-s0 — PASS
Work sub-tab pills, display masthead, segmented All/Ivan/Rise, quiet "OPS · 2 — APPROVED
IN OPS, NOT HERE" row, OUTBOUND chips in neutral surface2 (note: Ops paints this same
chip blue — see F4), row grammar, timestamps — all inside the vocabulary. The large void
below two rows is honest data, not a styling defect.

### drafts-390-s0 — PASS
Same; tab bar and chips correct.

---

## CONTENT

Route-wide:
- **F3 (P1) — sticky section-header pill collides with row content.** The "03 NEEDS
  REVIEW — 19" header is a content-hugging capsule; when sticky, scrolled rows pass
  BEHIND and AROUND it — row titles, PASS chips, and half an "APPROVE" button visibly
  overlap/peek at the same y. Reads broken. Violates §3f + risk 3 (sticky headers must
  repaint on an opaque canvas stripe; the pill restyle dropped the full-width backdrop).
  Fix: wrap the pill in a full-width sticky strip — `.wb.wb.wb .wb-sech-sticky{
  background:var(--canvas); left:0; right:0; padding:6px 0}` (pill keeps its border) —
  one fix clears content AND magnets at both widths.
- **F9 (P2) — alert-card figure fuses with legend.** "5 4 errored · 1 elsewhere" reads as
  "54 errored" (same on Magnets: "35 1 errored…"). Spec gap (alert anatomy predates the
  skin). Fix: `margin-right:14px` on the big numeral + a 1px `--hairline-strong` vertical
  rule, or an em-dash before the legend.
- **F6 (P2) — numerals sit at the TOP of the big stage marks, not centered.** PUB "109"
  lime circle prints its value capsule hugging the top edge (same: IDEA 37 / PUB 42 on
  Magnets). Elevation move 2 is "the number lives inside a printed shape" — the reference
  centers ink numerals in their marks; top-pinned reads unfinished. Fix: the value
  capsule inside `.wb-cap`/stage circle gets `display:flex; align-items:center;
  justify-content:center; height:100%` on the mark (or `top:50%; translateY(-50%)`).

### content-1440-s0 — FIX
- **F6** (PUB 109 numeral top-pinned), **F9** ("5 4 errored").
- The GOOD news this frame proves: the pipeline capsules DID take the new triad —
  REVIEW 19 orange w/ ink numeral, SCHED 2 white, PUB 109 lime, stub dashes for 0 —
  plus lime/white legend dots and the `Total: 174` footer. QA_BLOCKED amber chips stay
  severity (collision guard §1 held: amber = text-chip, orange = chart mark ✓).
  Neutral in-row APPROVE ghosts per §3k ✓.

### content-1440-s1 — FIX
- P3 (F10-family): the pipeline card's legend row scrolls half-clipped against the
  masthead boundary with no hairline/fade to close the edge — raw clip line. Fix: 1px
  `--hairline` (or an 8px canvas fade) at the masthead/scroller boundary when scrolled.
- Filter grammar row (Stage/Kind/Pillar/Source/QA verdict/Filters) wraps 3-2-1 with the
  search box holding line 1 — inside §3e's untouched grammar; acceptable.
- Sticky "03 NEEDS REVIEW" pill not yet colliding at this offset. Rows, PASS chips,
  "—" placeholder chips, thumbnails: clean.

### content-1440-s2 — FIX
- **F3** — sticky "03 NEEDS REVIEW" pill with row text "…moved my laptop to the only ta"
  running behind/beside it at the same baseline.

### content-1440-s3 — FIX
- **F3** — same collision at top ("LM promo…" row's chrome behind the pill).
- **F14 (P3) — section pill stack numbering wobbles.** "05 SCHEDULED / 06 PUBLISHED" are
  numbered; "ARCHIVED / PILLAR MIX / STYLES / DAILY SUMMARIES" are not. Spec gap. Fix:
  index the stage sections only (01–06) and drop indices from the non-stage pills'
  markup — or number all. The ragged-width left-aligned pill stack itself is good rhythm.

### content-390-s0 — FIX
- **F9** ("5 4 errored" fusion at 390 too).
- Rows, QA_BLOCKED chips, right-aligned owner chips under the title: acceptable.

### content-390-s1 — FIX
- **F6** (PUB 109 top-pinned numeral in the tall lime capsule).
- **F15 (P3)** — filter pill row scroll-clips mid-pill at the plate edge ("So…" cut, no
  fade). Risk-9's re-probe class. Fix: right-edge fade on the `.ct-fpills` scroller:
  `mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent)`.

### content-390-s2 — FIX
- **F12 (P2) — review-row anatomy too cramped at 390.** SKIP+APPROVE (~180px) squeeze the
  title to ~110px (2-line hard truncation, "Anthropic says its own…"), and the meta chip
  row clips MID-CHIP behind the button column with a visible sliver and no fade. Spec gap
  (dense band is locked, but the 390 two-button row was never provisioned; risk 9's
  overflow probe class). Fix: at ≤480 let actions wrap under the meta row
  (`.ct-ac{flex-basis:100%; justify-content:flex-end}`) or demote SKIP into the row's
  overflow; restore the meta fade mask.

### content-390-s3 — FIX — **F3** (sticky pill overlaps a row: "…PROVE" button half-visible behind it) + **F12**.
### content-390-s4 — FIX — **F3** (pill over "PASS 88" row, clipped "PROVE") + **F12**.
### content-390-s5 — FIX — **F3** (pill collision at top) + **F14** (unnumbered tail pills).

---

## LEAD MAGNETS

### magnets-1440-s0 — FIX
- **F6** — IDEA 37 lime mark and PUB 42 white circle print numerals top-pinned.
- **F9** — "35 1 errored · 34 terminal…" fusion.
- Correct here: LANE header grammar, `lm_drafts_v2` code chip, legacy-fold footnote in
  quiet uppercase, filter row, pipeline triad colors (lime/white + neutral REVIEW 10).

### magnets-1440-s1 — FIX
- P3 (F10-family) — search field + Status/Format pills scroll half-clipped against the
  masthead boundary; no hairline/fade closes the edge, so chopped half-pills float under
  the owner chips. Same fix as content-1440-s1.

### magnets-1440-s2 — FIX — **F3** (sticky "01 IDEA — 37" pill; "…o landing URL" row text beside/behind it).
### magnets-1440-s3 — FIX — **F3** ("Outreach Checklist…" title running behind the pill).
### magnets-1440-s4 — FIX — **F3** ("o landing URL" + timestamp colliding with pill).
### magnets-1440-s5 — FIX — **F3** (pill over first row). The needs-review rows themselves (thumbnails, format chips AI KIT / GUIDE / SKILL PACK, orange QA dots) are clean.

### magnets-390-s0 — FIX
- **F8 (P2) — pipeline stage labels ellipsize to garbage at 390:** "ASS… / REV… / SC…".
  Text clipping reads broken/cheap. Spec gap (§3g geometry "survives" but 390 label width
  was never provisioned). Fix: at ≤480 swap to fixed 3-char labels (GEN/AST/REV/APR/SCH/
  PUB) via `data-abbr` + CSS, or drop to 9px/`-.01em` with `text-overflow:clip` only if
  all six fit — never ellipsis on a 4-char label.
- **F6** (IDEA 37 / PUB 42 top-pinned numerals), **F9** ("35 1 errored" fusion).

### magnets-390-s1 — PASS
Total-card footer, read-only note, filter pills, section pills, and wrapped 2-line row
titles all correct at this offset.

### magnets-390-s2 — FIX — **F3** (sticky "01 IDEA — 37" pill over "…al Audit: Systems" row).
### magnets-390-s3 — FIX — **F3** (pill over "…st: 6 Questions" + row beneath half-cut).
### magnets-390-s4 — FIX — **F3** (pill over "Reveal Where…" + timestamp at same y).
### magnets-390-s5 — FIX — **F3** (pill over "…le Audit: 3" row).
### magnets-390-s6 — FIX — **F3** (pill over "…o landing URL" row).
### magnets-390-s7 — FIX — **F3** (pill over "…o landing URL"; inline "04 NEEDS REVIEW — 10" pill mid-list is fine — only the STUCK state collides).
- Route-wide P3 observation (spec gap, judgment call): ~30 consecutive IDEA rows each
  repeat "CHECKLIST · no landing URL" — the reference would break this rhythm. Since the
  dense band is locked, the licensed move is de-duplicating the META, not the rows: when
  every row in a section shares the same format chip + "no landing URL", hoist it into
  the section header ("37 · all CHECKLIST · none landed") and drop the per-row repeat to
  `--text4`.

---

## SENDS

### sends-1440-s0 — FIX
- **F5 (P2)** — DECISION tiles still paint their metric meters and trend text in old teal
  `#10A37F`: ACCEPT's bar + "▲3" + "30d" span, RUNWAY's bar. §3h routes every directional
  glyph through `--delta-up/--delta-down` and the "green inline-hex trend paints Sends
  carries" explicitly to the delta tokens. The GOVERNOR meter may legitimately stay
  `--sev-clear` while state=NORMAL (severity is locked); the ACCEPT/RUNWAY meters are
  metrics, not verdicts → `var(--accent)` lime fills. Fix: replace inline `#10A37F`
  paints with `var(--delta-up)` (text/arrows) and `var(--accent)` (metric meter fills);
  leave the three status dots + NORMAL text on severity tokens.
- Correct: FUNNEL band figures, amber scope note (severity text licence), VOLUME cards
  with lime/orange dots and white sparkbars (§3g's white-as-data landed).

### sends-1440-s1 — PASS
Volume 4-card grid with the full new legend (CONNECTIONS lime / DMS orange / INMAILS
white / EMAILS neutral) + `Total: 179` footer is the strongest reference-match in the
build. PIPELINE lane dots/bars are runway severity (5D+/2-5D/UNDER 2D legend) — legal
under §4's severity lock, not an old-palette survival. Minor capture note: volume-card
tops scroll-clip at the tab-row boundary with no closing hairline (F10-family, P3).

### sends-1440-s2 — PASS
Governor meters green-while-NORMAL = severity-driven, legal. NORMAL chips neutral,
seat card anatomy clean.

### sends-1440-s3 — PASS
CAMPAIGNS list correct (neutral ACTIVE chips, tabular counts). Note: first row renders
one surface lighter than siblings — hover state caught by the capture pointer, not a
defect (re-shoot to confirm if in doubt).

### sends-390-s0 — FIX
- **F7 (P1) — DECISION tile labels truncate to "AC… / G… / R…" at 390.** Unreadable
  chrome on the route's primary answer ("where do I stand right now"); looks broken.
  Spec gap (3-across grid kept at 390). Fix: let the label wrap
  (`white-space:normal; line-height:1.2`) — ACCEPT/GOVERNOR/RUNWAY each fit a ~96px
  column at 11px — or stack the grid `1fr` at ≤420.
- **F5** — "▲3"/"30d" teal here too.
- **F17 (P3)** — funnel labels nearly fuse ("ACCEPTED CONVOS"); give the figure cells
  `min-gap:16px` and drop the interpunct separators at 390.

### sends-390-s1 — PASS — volume 2×2 with correct marks and wrapped legend; Emails empty-state dashes read fine.
### sends-390-s2 — PASS — pipeline severity encoding + legend + `Total: 70 sendable` all clean.

### sends-390-s3 — FIX
- **F16 (P3)** — seat card title truncates a 4-character name ("Ri…" for Rise) because the
  NORMAL chip crowds it; give the name `min-width:0` ellipsis only AFTER the chip shrinks
  (`.chip{flex-shrink:0}` is backwards here — let the chip never shrink but the grid go
  2×1 at ≤420, or drop "NORMAL" to a dot on the name).
- Meters severity-legal; label/value wrap ("Cohort accept") acceptable.

### sends-390-s4 — FIX
- **F16 (P3)** — footer "Total: 465 sen…" clips at the card edge (and the leading "1" of
  "1 OF 7 CAMPAIGNS SHOWN" crowds the padding). Fix: `flex-wrap:wrap; row-gap:4px` on
  the card footer, `text-align:right` on the total.
- Campaign name truncation ("Warm - Kyle En…") is acceptable dense-row behavior.

---

## OPS

### ops-1440-s0 — FIX
- **F4 (P1) — OUTBOUND chip is painted old BLUE.** The chip text (and tint) on every ops
  card reads `#0A84FF`-family — the precise hue §2 removed from the system, and Drafts
  renders the SAME chip neutral. One rogue literal breaks the family on an approval
  surface Ivan reads daily. Fix: the ops card chip → `background:var(--surface2);
  color:var(--text2)` (match Drafts), or if it must signal direction, lime text
  (13.76:1 on s1). Grep the ops card component for `0A84FF`/`3A93D0` literals.
- Everything else on this frame is the build at its best: digest card with lime/orange
  colored figures + lime/neutral/orange stacked capsule bar (the reference's exact
  chart voice), lime quote band, ink-on-lime "Approve & open gate" primary, ghost
  Discard, 28px hero radius, airy padding.

### ops-1440-s1 — FIX — **F4** (blue OUTBOUND chip on the Rise card). ALREADY HANDLED rows (DONE · 4 / BLOCKED · 3) quiet and correct.
### ops-390-s0 — FIX — **F4**. Digest 2×2 + stacked bar + quote band all correct at 390.
### ops-390-s1 — FIX — **F4** (Rise card chip). Buttons pair cleanly at 390.
### ops-390-s2 — PASS — quote band, comment box, Approve & copy, ALREADY HANDLED rows: clean.

---

## SETTINGS

### settings-1440-s0 — FIX
- **F13 (P2) — the toggle is stock iOS green, not the family's lime.** "New-reply sound"
  switch renders ~`#34C759`; it is the only saturated non-token green in the app now.
  Spec gap (§3 never named the switch; §4's "stock iOS shell OUTSIDE .wb" doesn't apply —
  this is inside the plate). Fix: `.wb.wb.wb .switch.on{background:var(--accent)}` knob
  white (knob-on-lime 1.5:1 is fine — non-text UI on a 44px control with the state also
  carried by position).
- Rest is right: quiet uppercase section rules, borderless setting cards, Dark/Light
  segmented pill, sev-red Sign out text.

### settings-390-s0 — FIX — **F13** (same toggle). Compact "SETTINGS … Done" top bar + card stack otherwise clean.

---

# PRIORITY-RANKED FIX LIST

**P1 — breaks family resemblance or looks broken**
1. **F3** Sticky section-header pill has no full-width canvas backdrop — rows, chips and
   APPROVE buttons visibly collide with chrome on Content + Magnets, both widths
   (14 screenshots). `faithful.css` `.wb-sech-sticky`: full-bleed `background:var(--canvas)`
   strip behind the pill. Violates §3f / risk 3.
2. **F1** Today hero segmented bar + legend: teal/blue old palette. Re-point segment fills
   and legend dots to `--cat-1/--cat-3` (+ licensed `--sev-urgent`). Violates §2.
3. **F2** Today "SENDS THIS 7D" bars: all-teal 8px → cat-token 12px capsules. Violates §3g.
4. **F4** Ops OUTBOUND chip in old blue (Drafts renders it neutral — one literal). Violates §2.
5. **F7** Sends 390 DECISION labels truncate to "AC…/G…/R…" — unreadable primary chrome.
   Spec gap; wrap or stack.

**P2 — a top studio would fix**
6. **F5** Teal trend paints (Today ACCEPT, Sends tiles): arrows/spans → `--delta-up`,
   metric meters → `--accent`; governor meters stay severity. Violates §3h.
7. **F11** Inbox avatar hash ramp (teal/blue/purple/pink) — last surviving old hues,
   on every row; re-derive from lime/orange/white/neutral. Spec gap.
8. **F10** Inbox sticky summary band shows half-clipped rows in its under-gap; canvas
   strip or fade. (P3 siblings: raw scroll-clip edges under mastheads on content-1440-s1,
   magnets-1440-s1, sends-1440-s1.)
9. **F6** Stage-mark numerals top-pinned in circles/capsules — center the value capsule
   (elevation move 2 half-landed).
10. **F12** Content 390 review rows: 110px titles + mid-chip clipping behind SKIP/APPROVE —
    wrap actions, restore fade. Spec gap / risk 9.
11. **F8** Magnets 390 stage labels "ASS…/REV…/SC…" — abbreviate, never ellipsize.
12. **F9** Alert cards read "54 errored"/"351 errored" — separate figure from legend.
13. **F13** Settings toggle iOS-green → `--accent`.

**P3 — nice-to-have**
14. **F14** Content section-pill numbering inconsistency (01/03/05/06 vs unnumbered tail).
15. **F15** 390 filter-pill scroller clips mid-pill with no right fade.
16. **F16** Sends 390 clips: "Total: 465 sen…" footer, "Ri…" seat name.
17. **F17** Sends 390 funnel labels nearly fuse ("ACCEPTED CONVOS").
18. **F18** Today 390 tile meta wraps with orphan interpuncts.
19. Inbox band progress bar still a 6px hairline-era mark → 12px capsule, lime replied-segment.
20. Magnets IDEA list meta monotony ("CHECKLIST · no landing URL" ×30) — hoist shared meta
    into the section header, per-row copy drops to `--text4`.

---

# TASTE

The four licensed elevation moves are all present and pulling their weight: the plate
shadow reads exactly like the reference's floating slab; the white monogram/avatar with
the pistachio ring is a genuine signature; ink-numerals-in-marks landed on the pipeline
capsules (fix the centering, F6); the delta triangles are specified right but still
painted teal (F5) — finishing F5/F6 completes moves 2 and 4 rather than needing new ones.

Beyond completing those, the build undersells the reference in exactly ONE place, and one
micro-move closes it:

1. **Peak-mark coloring on the Sends volume sparklines.** The reference never shows an
   all-white bar run — its dot-matrix and bar charts always carry one colored mark in the
   field of white/neutral. Our four VOLUME sparklines are uniformly white. Give each
   sparkline's peak bar the card's own category color:
   `.wb.wb.wb .sc-bar.peak{background:var(--cat-1)}` (Connections), `--cat-2` (DMs),
   stays white for InMails (its dot is already white), `--cat-4` never gets a peak (empty
   Emails). One `class="peak"` on the max-value bar in `Surface.tsx`'s sparkline map —
   8px of color per card, zero layout shift, accent census still under budget (one mark
   per surface, same rule as the delta triangles).

No further moves recommended — anything more (ground-colored accents inside the plate,
white promoted cards, new chip fills) starts inventing a direction the reference doesn't
license. Fix the P1/P2 list, land the peak marks, and the family resemblance is complete.
