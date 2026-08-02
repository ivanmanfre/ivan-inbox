# Candidate `split` — build note

Branch `exp/vis-split` (off `exp/brain` @ `17e3cfb`), 8 commits, port 5433.
Treatment lives in **one new file**, `src/exp/v2c/split.css` (1,515 lines), imported by the v2c Shell
after `styles.css`. `:root` in `src/styles.css` is untouched. `package.json` / `package-lock.json` are
byte-identical to base (`git diff exp/brain..HEAD -- package.json package-lock.json` → empty).

---

## 1 · Thesis

**Class-split: the contrast between surface classes is the design.**

| class | surfaces | register |
|---|---|---|
| `wb-ov` **overview** | Today, Sends → Overview, Sends → Lanes | full Nixtio — 56px display title, `--r-hero` chart cards, capsule marks, legend + `Total:` footers, filter pills right-set beside the title |
| `wb-hy` **hybrid** | Ops (KPI band over a queue) | overview register above the fold, working register below it |
| `wb-wl` **working list** | Content, Inbox, Drafts, Sends → Log | near-monastic — anchor rail, hairlines, tabular trailing values, zero decoration, density at the tight end of §7.8 |
| `wb-fm` **form** | Settings | spine only |

The classification is phase0's, not invented here. It is expressed as one map in `Shell.tsx`
(`SURFACE_CLASS: Record<Job, …>`) and written onto the `.wb-work` region, so every rule in the treatment
can ask which register it is in without a single route check.

**The bet:** an overview surface should feel like a briefing and a working list should feel like an
instrument, and a user who moves between them fifty times a day should feel the *change of job*, not a
change of app. Everything in §3 below exists to make sure the second half of that sentence is true.

**The named risk was the seam showing.** §3 is the answer.

---

## 2 · Token choices, within the spine's ranges

Nothing was re-derived: the §4.3.1 OKLCH ladder is adopted **unchanged**, so the harness was not re-run
(§3.2 permits re-derivation, it does not require it — and the reference's warmth is carried by composition
here, not by re-toning the ladder). `--text4` is `#6F7472`, the §4 correction, never the published
`#606562`.

| decision | value | why |
|---|---|---|
| `--fs-display` | 34 / 44 / 56, stepped by media query | §2.3. No `clamp()` — it emits fractional computed sizes and destroys the census that proves the scale exists. Measured **0 fractional sizes on all 25 captures**. |
| display title, *which surfaces* (§13 candidate choice) | `wb-ov` + `wb-hy` only | This is the class split's single loudest move. `TODAY` / `SENDS` / `OPS` are 56/700 uppercase; `CONTENT` / `INBOX` / `DRAFTS` are the **same face one tier down** — 20/600, same uppercase, same tracking. The register changes; the face does not. |
| `--r-hero` | used, 24px | Every card in an overview grid. Working lists never use it — their groups sit at `--r-card` 18px. §13 explicitly allows collapsing `--r-hero` into `--r-card`; this candidate does the opposite, because the radius step is one of the two things carrying the class difference. |
| chart flourish (§13) | capsule bars with the value inside; `--pat-*` hatching on MONO series 2-4 | M9. Pattern is load-bearing under MONO and switched off under TRIAD, where hue + lightness already separate. |
| M16 dotted leaders | **not used** | The header face already ends in a rule; a second leader would be two devices for one boundary (§3.3). |
| ticked section ruler | **not used** | Same reason. The `NN · LABEL —— count · mark` header is the ticking. |
| density | 41-42px content-box @1440, 43-44 @390 | §7.8 band is 40-60 / ≤72. Deliberately at the tight end — the monastic half of the thesis. |
| MONO / TRIAD | exactly the spine's hexes | `#10A37F #DBDFDD #A1A6A4 #747977` / `#10A37F #3A93D0 #D099E8`. Verified off the rendered page, not the source. `--cat-3` is **not** harmonised back down; TRIAD separates on hue **and** lightness. |

---

## 3 · The five seam elements — why this is one app and not two

Marked `¶SEAM` in `split.css` §9.

1. **One type scale.** Seven tokens, no eighth, both classes. Measured **≤7 distinct computed sizes on
   every one of 25 captures** against a ceiling of 9. An overview surface and a working list draw from the
   same seven sizes; only the *mix* differs.
2. **One ladder and one hairline.** `--hairline #2C302E` is every boundary in the app — the group edge on
   Content, the card edge on Sends, the rule inside the section header, the row separator. One separation
   device per boundary (§3.3): a hairline **or** a background shift **or** spacing, never two stacked.
3. **One radius family.** `--r-chip 6 / --r-ctl 10 / --r-card 18 / --r-hero 24` + the pill licence.
   v2c's local 14/16/20/7 are remapped onto it. `--r-hero` is the *only* value the two classes don't
   share, and the family is what makes that read as emphasis rather than as a different kit.
   Measured **0 pill-licence violations on all 25 captures** (baseline defect: 58 pill uses).
4. **One header face.** `NN` tabular index · **LABEL** · —— rule —— · right-set tabular count · severity
   square. It replaces the four unrelated header patterns the app shipped (`.wb-sech` / `.td-zh` /
   `.grouphdr` / `.ov-h`) and now renders identically on `01 URGENT —— 0/3 CLEARED ▪` (Today, overview) and
   `01 IDEAS —— 59` (Content, working list). The mobile tab-bar count badge was folded into the same
   anatomy as the desktop rail badge in commit 7, so the object survives to 390 too.
5. **One filter grammar.** `label: value ⌄`, one anatomy, two heights — 30px on overview (right-set beside
   the display title), 26px inline on working lists. The label is never omitted: "7d ⌄" is a mystery,
   "Range: 7d ⌄" is a sentence.

The seam test we actually ran: put `content-desktop.png` beside `sends-desktop.png`. The type, the rules,
the corners, the section headers and the filter pills are the same objects at two intensities. The thing
that changed is how much of the screen is a chart.

---

## 4 · Per-surface changes

### Content — the test surface (`wb-wl`)

- **The anchor rail exists now** (§7.1/§7.2, the run's most-weighted defect). Every row is
  `grid-template-columns: 28px minmax(0,1fr) auto`. The leading slot is a `.ct-anchor` plate carrying the
  thumbnail, and **status is an inset 3px spine on that plate's left edge** — it cannot float, because its
  position *is* the row's left edge. Measured **x-variance 0px across 70 rows at Mattan's real density, at
  both 390 and 1440.** Trailing timestamps share a right edge, variance 0.
- **De-bordered rows** (§7.3): the group carries the boundary, rows carry a single `border-top`. ~200
  floating boxes became one ruled sheet.
- **13 facet chips → one filter pill.** Measured: the facet row was five wrapped rows at 390 and owned the
  entire first screen of the app's densest surface. §11.2 is literal — *one* compact inline pill. The
  facets moved inside its menu, grouped and counted.
- **Ideas became anchored rows**, with the composite score in the anchor slot. A real number in a fixed
  slot beats a thumbnail that does not exist.
- **The 20 "resource published with no landing URL" cards became one ruled group** — 20 red cards for one
  run of one tier is §5.5's exact defect. The count above them is red; the rows are text.
- Density lifted 37 → 42px content-box (round 1 found it at 39, one under the §7.8 floor).

### Sends → Overview (`wb-ov`) — the archetype

- Display title + `Range: 7d ⌄` filter pill right-set beside it; view switcher **sized to its own labels**
  (it was a 588px-wide wall; see §6 for why the first fix didn't take).
- M3 metric anatomy on the DECISION tiles; **one** `--fs-figure` numeral per surface (`29%`), verified.
- M4 legend + right-aligned `SENT 7D: 93` footer, behind an additive `expressive` prop so the default app
  is untouched.
- MONO series carry `--pat-*` hatching (visible on the DMs spark); TRIAD switches it off.
- Amber prose returned to reading weight — 88 characters of full-strength `#FF9F0A` body copy became
  `--text2` behind a 2px amber spine. It is a fact, not an alarm.

### Sends → Log (`wb-wl`) — data honesty (§8.5)

`fetchSendLogTotals()` (new, additive, nothing in the default app calls it) runs two
`Prefer: count=exact` head probes. Rendered, read off the DOM by `scripts/verify-split.mjs`:

```
newest 113 of 1,524 sent
newest 7 of 208 blocked
```

Numerator and denominator are scoped identically (client filter, and the same
`send_blocked_reason != 'discarded_in_inbox'` exclusion the log itself applies) — the two cannot disagree.
Nothing charts "all sends" from the fetched slice. Anchor rail variance 0 across 120 log rows.

### Today (`wb-ov`)

- Masthead as the display surface's hero; zones 01-03 in `--r-hero` cards; the short row zones take §7's
  row anatomy, so their rail variance is 0 too.
- **The app's undeclared fourth hue is gone.** Today's `going out` legend dot measured `rgb(10,132,255)` —
  iOS blue, outside *both* colour answers. The three segments are three categories of one workload, so they
  take `--cat-1..3`; `to approve` painted in the clear-green was saying "nothing is wrong" about the eleven
  things most wrong.
- `<Avatar size={42}>` writes an inline width that beats every class, so Today ran a 42px rail while Inbox
  and Content ran 28px. Inside the workbench the anchor is the anchor.

### Inbox (`wb-wl`)

- Monastic list: 28px avatar anchor, de-bordered rows, tabular right-set times. Rail variance 0 across 16
  rows; content-box 45px.
- **InboxHead kept the overview register** because it *is* a chart — but its second segment was painting
  1,315 rows in `--surface3`, i.e. the track's own colour, so **96% of the bar rendered as empty rail**.
  The three parts are categories; they take `--cat-1..3`.

### Ops (`wb-hy`)

KPI band in the overview register (`--r-hero`, one `--fs-figure`, capsule stack), pending queue and read
history in the working register below it. The band's hero numeral was painted `#10A37F` — **accent as a
text colour, 3.20:1, explicitly forbidden by §5.2.** The figure went back to `--text` and the colour moved
to the bar, which is a mark. The stack's `rgba(235,235,245,.4)` — an iOS token bleeding through the ladder
— went with it.

### Drafts (`wb-wl`)

Swipe cards keep their shape (a card deck by design) but take the group's boundary vocabulary and tight
padding. An unmapped ops kind fell through to its raw id: `comment_outbound` rendered as a 68px string
clipped mid-word inside a 28px anchor. It now falls back to the kind's first token, uppercased, cut to four.

### Detail panes / Settings

Spine only. Thread and DraftPane take the ladder, the type scale, the hairlines and the radius family. The
draft pane's QA score dropped a tier so a surface with a pane open still has exactly one `--fs-figure`
numeral.

---

## 5 · Self-instrument numbers

Two committed instruments, both using the fixed wait logic (`domcontentloaded` → skeletons cleared → rail
stamp not `not loaded` → the string "Loading the brief" gone → a terminal render exists). **Never
`networkidle`** — the realtime WebSocket can never satisfy it.

- `scripts/sweep-split.mjs <outDir>` — 25 captures + the §14 in-page instruments.
- `scripts/verify-split.mjs` — the two things a single page load can't answer (§9 toggle, §8.5 denominators).

### Acceptance index (§14), measured

| § | contract | bar | measured | verdict |
|---|---|---|---|---|
| 1.4 | bridge tokens declared | `--bg` ≠ `#000000` | `#090B0A` on `.wb` | PASS |
| 1.7 | mobile first-paint carries `.wb` | class assertion | `app wb` + `wb-work wide wb-wl` on the loading branch | PASS |
| 2.2 | ≤9 computed sizes/screen, 0 fractional | ≤9 / 0 | **max 7, 0 fractional**, 25/25 captures | PASS |
| 2.4 | ≤1 element ≥700, and it is ≥28px | ≤1 | **max 1**, always the 56px `H2` display title; 0 captures with a ≥700 element under 28px | PASS |
| 2.6 | tabular-nums everywhere | 0 numeral leaves at `normal` | **0**, 25/25 | PASS |
| 5.2 | accent forbidden as text | 0 words in accent | **0 words.** The 10 remaining hits are single glyphs (`↑ ✳ ▤ ◉ ◈ ✦ ⚙︎ ☼`) — the active nav mark, §5.1 job #2, at 4.85:1 worst case | PASS |
| 5.6 | ≤30 accent elements @1440 | ≤30 | **max 28** (Sends). Content 6, Ops 9, Inbox 9, Drafts 6, Content-with-pane 10 | PASS |
| 6.4 | pill licence | licensed list only | **0 violations**, 25/25 (baseline: 58 pill uses) | PASS |
| 7.1 | anchor rail x-variance | 0px, both widths | **0px** — Content 18 & 70 rows, Inbox 13/16, Log 120, Today 3 | PASS |
| 7.2 | Content status is anchored | not in a wrapping meta flex | inset spine on `.ct-anchor`; chip #1 in a `flex-wrap:nowrap` slot | PASS |
| 7.7 | trailing values share a right edge | 0px | **0px**, Content + Inbox | PASS |
| 7.8 | density band | 40-60 @1440, ≤72 @390 | Content **41-42 / 43-44**; Inbox & Log **45** | PASS |
| 8.1 | one `--fs-figure` numeral per surface | ≤1 | **≤1 on every capture** | PASS |
| 8.5 | data honesty | denominators from a count probe | `newest 113 of 1,524` / `newest 7 of 208`, read off the DOM | PASS |
| 9 | both answers, zero layout shift | 0 shifts | toggled in-page: **0 shifts across 410 elements (Sends) and 2,043 (Content)**, tokens change | PASS |
| 9.1 | no undeclared hue | 0 | **0 rogue hues**, 25/25 (baseline: `#0A84FF` on Today) | PASS |
| 10.4 | motion deleted from the 50×/day paths | 0 transitions | `transition:none` on `.wb-rj`, `.seg/.sg`, `.wb-peer`, `.wb-work`, `.r.active`, `.ct-row.on` | PASS |
| 10.6 | reduced-motion | 0 transform transitions | media query kills both halves of the beat + all non-opacity transitions | PASS |
| 12 D9 | console errors from `src/` | 0 | **0 console errors on all 25 captures.** Not "excluding the known CORS pair" — literally zero were emitted | PASS |
| 12 D10 | horizontal overflow @390 | none | **`document.scrollWidth > clientWidth` false on all 25** | PASS |
| 12 D13 | both light patches visited | required | `v2c/styles.css:58` and `:127` re-answered in `split.css` §14 | PASS |
| gates | `npm test` / `lint` / `build` | green | **378 tests / 22 files pass**. `oxlint`: exit 0, **0 errors, 17 warnings — none of them in any of the 14 files this branch touched** (all are pre-existing `react-refresh` / `no-control-regex` notes in untouched files and foreign `goal-runs/` dirs). `npm run build` green. | PASS |
| D3 / D8 | no new dep, no secret in `dist/` | — | 0 dependency changes; the only JWT in `dist/` decodes to `"role":"anon"` — the public key, baseline behaviour | PASS |

Full per-capture table: `shots/table.md`. Raw: `shots/report.json`. Toggle + denominator log: `verify.txt`.

### What the instrument itself got wrong (both fixed, both committed)

- The pill-licence regex omitted `seg`/`sg`/`chip`, which §6.3.2-3 explicitly license — it reported **4
  phantom violations on every Sends capture** for two rounds.
- The figure census walked only DOM *leaves*, and a metric numeral wraps its unit in a child span
  (`29` + `<span>%</span>`), so it reported `fig=0` on the one surface that has a hero figure. It now walks
  any element carrying its own text node, and excludes the display title by requiring a digit.

An instrument that flatters the build is worse than no instrument. Both corrections are in commits 6-7 with
the number that exposed them.

---

## 6 · Deliberate departures, with reasons

1. **The `.chips` scope row became the segmented control, not a `label: value ⌄` pill.**
   §11.3 asks for zero bespoke filter chrome. Four bare capsules ("Ivan", "Rise", "Email") with no label
   were exactly the mystery §11.1 names — but they are a *scope* switcher (which client's data), not a
   *facet* filter (which rows of this data), and §6.3.2 already licenses view-switcher segments as pill nav.
   Rather than invent a third anatomy, they became the segmented control they already were: one track, one
   knob, sized to their labels. **The app now has exactly two filter objects and only two.** Content shows
   both, doing different jobs: a lane segment and a `Filter: All ⌄` pill.
2. **Inbox and Drafts run as one full-bleed ruled sheet; Content's sub-lists sit in bordered groups.**
   §7.3 says the group carries the boundary. Content has five sub-tables on one surface and needs them told
   apart; Inbox is one list, and the work region's own border already is its boundary. Adding a second
   container there would be two devices for one boundary (§3.3).
3. **The ladder was not re-derived and the harness was not re-run.** §3.2 permits it; nothing measured
   asked for it. Every contrast bar in the spine's published table is inherited unchanged, and re-toning
   would have put a fresh set of numbers between this candidate and a judge for no gain.
4. **Three uses of `!important`, all of them beating an inline style, all named in the file.** Categorical
   tokens over a chrome palette (`ov-cat-*`, `td-cat-*`), the accent-census retirements (`sev-ok`), and the
   Today anchor width written by `<Avatar size={42}>`. There is no other lever against an inline style, and
   no fourth use.
5. **MONO's pipeline bar is quieter than what it replaced.** Retiring amber from the "needs review" stage
   (§5.4 — severity is never category encoding) costs the bar its instant pop. The signal moved to the
   `18 waiting on you` hero figure and the amber square on the section header that counts them, which is
   §5.5's own prescription. Under TRIAD the bar is colourful again. This is the honest cost of the rule.
6. **Six pipeline stages, four categorical tokens.** The cycle is walked so that no two stages that can sit
   adjacent ever share a token; in the real data the render is `cat-4 · cat-2 · cat-4 · cat-3`, no adjacent
   repeat. Beyond that the spine's answer is pattern, and pattern is already carried on the series that need
   it.

## 7 · Known, unfixed

- **`#null` renders as an Ops card's context label** when `slack_channel` is null. Pre-existing on
  `exp/brain`, visible in `ops-desktop.png`. Left alone: inventing a fallback string is a content decision,
  not a presentation one, and this run is presentation.
- **Content's sub-group headers omit the `NN` index** that top-level headers carry (`NEEDS REVIEW` vs
  `01 ON MATTAN'S BOARD`). Intentional as depth-2 hierarchy (§7.6), but it is the one place the header face
  renders in two variants.
- Light theme is legible, not polished. Dark is the anchor, per §12.

---

## 8 · Captures

All 25 under `shots/`, dark unless named `light-`, `deviceScaleFactor: 2`, minted session, fixed wait logic.
`innerText` length is recorded per capture in `shots/table.md` — no capture is a skeleton crop.

The captures the brief asked for by name:

| ask | file | innerText |
|---|---|---|
| Content @1440 | `shots/content-desktop.png` | 26,500 |
| Content @390 | `shots/content-mobile.png` | 26,121 |
| Content @ Mattan's real density, 1440 / 390 | `shots/content-mattan-desktop.png` / `-mobile.png` | 9,253 / 8,874 |
| Today @1440 | `shots/today-desktop.png` | 3,395 |
| Today @390 | `shots/today-mobile.png` | 3,031 |
| Sends Overview @1440 | `shots/sends-desktop.png` | 1,986 |
| Sends Overview @390 | `shots/sends-mobile.png` | 1,630 |
| chart surface, `data-cat="mono"` | `shots/cat-mono-sends-desktop.png` | 1,986 |
| chart surface, `data-cat="triad"` | `shots/cat-triad-sends-desktop.png` | 1,986 |

Plus Sends → Lanes, Sends → Log (both widths), Inbox, Ops, Drafts, Settings, a thread pane, a draft pane,
and the two light patches.

The two `cat-*` captures have identical `innerText` (1,986) and identical `scrollWidth` (1,440) — and
`verify.txt` proves the stronger claim in-page: **0 geometry changes across 410 elements when the attribute
flips.**

---

## 9 · Commits

| | |
|---|---|
| `7b14739` | treatment stylesheet — ladder + bridge, 7-token type scale, radius family, pill licence, accent budget, motion, both colour answers; Shell first-paint `.wb` at 390 + the per-job surface class |
| `e251186` | Content anchor rail + de-bordered groups; filter pills replace the facet chip row; Sends log denominators from `count=exact` probes; OverviewView legend + Total footers behind an additive prop |
| `19625a7` | accent census 53→30 (green retires to neutral, categorical stage tokens, neutral log chips); alert wall becomes one ruled group; density lifted into the 40-60 band; sweep + instrument script |
| `e5e74a8` | one filter control per §11.2 (13 pills → one grouped menu); ideas become anchored rows; amber prose returns to reading weight |
| `8664877` | Sends timeframe becomes an M5 filter pill right-set beside the display title; view switcher sizes to its labels; last 700 retired |
| `ee6968f` | sweep round 1 — density floor 39→42, accent 31→11 on Content, iOS blue retired, severity stops encoding category on 3 stacks, chip rows become the licensed segment, view switcher *actually* sizes to its labels; instrument gains figure / rogue-hue / accent-as-text censuses |
| `90dc438` | sweep round 2 — accent stops carrying words; tab count badges drop from solid red to the rail's attention tint; one figure per surface with a pane open; `verify-split.mjs` |
| `bf9be2f` | close the comment `lightningcss` rejected — the browser's own CSS error recovery had been silently dropping the `.tb .cnt` rule |
