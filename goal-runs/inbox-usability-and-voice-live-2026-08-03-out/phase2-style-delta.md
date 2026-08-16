# PHASE 2 — STYLE DELTA: Nixtio "Check Box" skin onto the v2c Workbench

Design-translation spec, 2026-08-03. Reference: `reference-nixtio-full.png` (3200×2400),
pixel-sampled with ffmpeg→raw RGB (median-of-region samples + full-image histogram).
Current app: 36 baselines in `phase2-baseline/` (all viewed), tokens in
`src/exp/v2c/faithful.css` §1 (lines 33–141), structure in `src/exp/v2c/styles.css`
and `src/styles.css`.

RULES THAT BIND THIS SPEC (restated, non-negotiable):
- `:root` in `src/styles.css:1-16` untouched. Every change lives inside `.wb` scoping;
  new declarations at `.wb.wb.wb` specificity so they survive the flatten pass
  (`faithful.css:147`).
- WCAG floors: body ≥4.5:1, large/label ≥3:1 — every pair below is computed, not eyeballed.
- 44px tap targets, no horizontal overflow at 390, zero console errors.
- §11 filter grammar (`label: value ⌄`) keeps its exact semantics — skin only.
- This is a SKIN. One licensed DOM addition (the plate wrapper, §3a). Nothing else moves.

---

## 1 · SAMPLED PALETTE → NEW TOKENS

Histogram of the full reference image (top colors, excluding anti-aliasing ramps):
`#1F1F1F` (3.09M px — card surface), `#000000` (2.07M — plate), `#C5E1A5` (1.35M — ground),
`#FFFFFF` (160K), `#FF9B22` (98K — orange), `#B8FF66`/`#B9FF66` (149K — lime),
`#4C4C4C` (7.5K — strong hairline/stems), `#8F8F8F`/`#C7C7C7`/`#E3E3E3` (label grays),
`#C42E2E` (notification badge), `#EA4C89` (dribbble brand dot — not adopted),
`#5865F2` (discord brand — not adopted). Plate drop-shadow reads `#485F30`-family on the
ground (≈ black at 55–65% alpha over `#C5E1A5`).

| Sampled (reference)              | New token            | Shipped value | Tuning rationale + measured contrast |
|----------------------------------|----------------------|---------------|--------------------------------------|
| page ground `#C5E1A5`            | `--ground` (NEW)     | `#C5E1A5`     | adopted exact. vs plate 13.69:1 (surface boundary, no floor needed). `--ink` text on it: 12.54:1. |
| app plate `#000000`              | `--canvas`           | `#0C0C0B`     | lifted ~4% off pure black so licensed overlay shadows, the takeover scrim and the plate's own shadow still register; visually identical at arm's length. |
| card on plate `#1F1F1F`          | `--surface1`         | `#1F1F1F`     | adopted exact. |
| pill/chip step (derived)         | `--surface2`         | `#2A2A29`     | reference pills sit at `#1F1F1F` on `#000`; our chips also sit ON cards, so surface2 is one honest step above surface1. |
| hover/active step (derived)      | `--surface3`         | `#353533`     | derived, keeps the 4-step ladder. |
| in-card rules `#3B3B3B`-family   | `--hairline`         | `#303030`     | 1.25:1 vs surface1 — a whisper rule, per reference. |
| chart stems `#4C4C4C`            | `--hairline-strong`  | `#4C4C4C`     | adopted exact. 1.92:1 vs surface1. |
| white ink `#FFFFFF`              | `--text`             | `#FFFFFF`     | 19.57:1 canvas · 16.48:1 s1 · 14.37:1 s2 · 12.29:1 s3. |
| axis labels `#C7C7C7`            | `--text2`            | `#C7C7C7`     | 11.58 / 9.75 / 8.50 / 7.27:1 — clears body everywhere. |
| muted gray `#8F8F8F`             | `--text3`            | `#949494`     | TUNED: sampled `#8F8F8F` measures 4.44:1 on surface2 (filter-pill text is body-size) — under floor. `#949494` = 4.74:1 s2, 5.43:1 s1, 6.45:1 canvas, 4.05:1 s3 (s3 is label-only per existing §3.5 contract, ≥3 ✓). |
| dimmest gray `#737373`-family    | `--text4`            | `#6E6E6E`     | metadata/disabled + drawn pictograms only (existing contract): 3.84:1 canvas, 3.23:1 s1 — ≥3 non-text ✓, never body (the file already moved all body uses off text4). |
| lime `#B8FF66`                   | `--accent` + `--cat-1` | `#B8FF66`   | adopted exact. AS TEXT: 13.76:1 on s1, 16.34:1 on canvas — lime text is LEGAL on this ladder (unlike the old #10A37F, 5.2's ban was contrast-driven; keep the discipline anyway — accent stays budgeted). AS FILL: ink label 14.97:1. Focus ring on canvas 16.34:1. |
| orange `#FF9B22`                 | `--cat-2` + `--delta-down` (NEW) | `#FF9B22` | adopted exact. As text on s1 7.82:1 ✓; ink on orange fill 8.51:1 ✓. |
| white-as-data `#FFFFFF`          | `--cat-3`            | `#FFFFFF`     | ink label on white mark 17.93:1. |
| neutral 4th (derived)            | `--cat-4`            | `#707070`     | neutralised from triad's #6C716F at equal luminance; white ink 4.95:1 (≥4.5 ✓, beats the old 4.43). |
| lime (up-delta)                  | `--delta-up` (NEW)   | `#B8FF66`     | alias of accent; direction encoding, not severity. |
| notif badge `#C42E2E`            | — (not adopted)      | —             | severity semantics stay on `--sev-urgent #FF453A` (4.84:1 as text on s1; ink label on its fill 5.36:1 per existing note). |
| accent-soft (derived)            | `--accent-soft`      | `rgba(184,255,102,.14)` | tint only, never carries text. |
| ink (derived)                    | `--ink`              | `#171717`     | unchanged — label on every filled accent/cat mark. |

⚠ COLLISION, decided: `--cat-2 #FF9B22` sits one hue-degree from `--sev-attention #FF9F0A`.
Severity hexes are LOCKED (never reused as category — §5.4), and the reference's orange is
its data orange, so both stay. Guard: severity amber only ever appears as text-chip/dot/inset
rule; cat-2 orange only ever as a chart mark carrying its own ink numeral. If the blind pass
still confuses them on Content (QA_BLOCKED chips near the pipeline capsules), the licensed
fallback is swapping cat-2↔cat-3 (orange↔white) — NOT touching severity.

---

## 2 · TOKEN DELTA TABLE (faithful.css §1, lines 33–141)

Every changed token, old → new. Declared on `.wb{}` exactly where they are today.

| Token | Old (faithful.css line) | New |
|---|---|---|
| `--canvas` | `#090B0A` (:37) | `#0C0C0B` |
| `--surface1` | `#121513` (:37) | `#1F1F1F` |
| `--surface2` | `#191D1B` (:37) | `#2A2A29` |
| `--surface3` | `#212523` (:37) | `#353533` |
| `--hairline` | `#2C302E` (:38) | `#303030` |
| `--hairline-strong` | `#3E4240` (:38) | `#4C4C4C` |
| `--text` | `#F3F6F5` (:39) | `#FFFFFF` |
| `--text2` | `#AEB2B0` (:39) | `#C7C7C7` |
| `--text3` | `#7F8582` (:39) | `#949494` |
| `--text4` | `#6F7472` (:39) | `#6E6E6E` |
| `--accent` | `#10A37F` (:47) | `#B8FF66` |
| `--accent-soft` | `rgba(16,163,127,.16)` (:48) | `rgba(184,255,102,.14)` |
| `--cat-1` (MONO block :82) | `#10A37F` | `#B8FF66` |
| `--cat-2` (MONO) | `#DBDFDD` | `#E3E3E3` (ink label 13.97:1) |
| `--cat-3` (MONO) | `#A1A6A4` | `#A3A3A3` (ink label 7.11:1) |
| `--cat-4` (MONO) | `#747977` | `#707070` (white label 4.95:1) |
| `--pat-2/--pat-3` rgba base (:87-88) | `rgba(9,11,10,…)` | `rgba(12,12,11,…)` (same alphas — MONO keeps patterns) |
| TRIAD `--cat-1..4` (:116) | `#10A37F/#3A93D0/#D099E8/#6C716F` | `#B8FF66/#FF9B22/#FFFFFF/#707070` |
| TRIAD `--cat-3-ink` (:117) | `var(--ink)` | `var(--ink)` (unchanged — ink on white 17.93:1) |
| `--r-chip` | `6px` (:67) | `8px` |
| `--r-ctl` | `10px` (:67) | `12px` |
| `--r-card` | `18px` (:67) | `20px` |
| `--r-hero` | `24px` (:67) | `28px` |
| `--pad-card` | `20px` (:75) | `24px` |
| NEW `--ground` | — | `#C5E1A5` |
| NEW `--plate-r` | — | `40px` (desktop) / `24px` (≤767px, see §3a) |
| NEW `--plate-gap` | — | `20px` (desktop) / `8px` (≤767px) |
| NEW `--delta-up` / `--delta-down` | — | `#B8FF66` / `#FF9B22` |

SURVIVES UNCHANGED: `--sev-clear #10A37F`, `--sev-attention #FF9F0A`, `--sev-urgent #FF453A`
(meaning locked; all re-measured on the new ladder: 5.15 / 8.02 / 4.84:1 as text on s1 ✓);
`--ink #171717`; the whole 7-tier type scale `--fs-*` (:56-64) incl. the 34/44/56 display
steps (:127-128); `--fw-display:700`; dense-list geometry `--anchor-w/--anchor-gap/--tail-w/
--sech-h/--indent/--gut` (:73-74) — the §7.8 density band is a locked contract, the airy
delta is spent on overview surfaces, NOT on rows; motion tokens (:78-79); `--r-pill:999px`
and the entire §6.3 pill licence list; `--log-anchor-w` (:1445).

TRIAD vs MONO landing: `?cat=triad` (the shipped default) BECOMES the reference set
lime/orange/white/neutral, patterns down (unchanged behavior). `?cat=mono` stays the
zero-new-hue branch, re-derived neutral (lime + 3 grays + patterns) — the toggle still
produces zero layout shift.

Light theme block (`faithful.css:132-141`) — re-derived, same inversion logic:
`--ground:#C5E1A5` (held), `--canvas:#F7F7F5`, `--surface1:#FFFFFF`, `--surface2:#EFEFED`,
`--surface3:#E3E3E0`, `--hairline:#DBDBD8`, `--hairline-strong:#B5B5B2`,
`--text:#131313 --text2:#3D3D3B --text3:#5C5C5A --text4:#6E6E6E`. Lime CANNOT carry
text/icons on white (1.4:1): light adds `--accent-ui:#5A8A00` (4.14:1 on white — ≥3 for
icons/marks/large text) and every place dark mode paints lime GLYPHS (`.wb-rj.on .wb-rj-ic`,
`.tb.on`, `.wb-live`, delta arrows) reads `var(--accent-ui, var(--accent))`; lime FILLS keep
`--accent` + `--ink` label (14.97:1, theme-proof). Dark defines `--accent-ui:#B8FF66`.

---

## 3 · PER-SURFACE DELTAS

### (a) Page frame — the two-surface inversion
The ONE licensed DOM change: in `Shell.tsx`, wrap the direct children of the three
top-level roots — `:233` (`app wb` / `app dt wb`), `:418` (`app wb` login/loading), `:441`
(`app dt wb wb-<canvas>`) — in a single `<div className="wb-plate">`. The takeover root
`:411` (`app wb wb-take`) is already an overlay and does NOT get a plate.

```
.wb.wb.wb.app            → background:var(--ground); padding:var(--plate-gap);
                           height:100%;                     /* unchanged */
.wb.wb.wb .wb-plate      → flex:1; min-height:0; display:flex; flex-direction:column;
                           background:var(--canvas); border-radius:var(--plate-r);
                           overflow:hidden; position:relative;
                           box-shadow:0 24px 60px -20px rgba(0,0,0,.5);   /* §5 move 1 */
.wb.dt .wb-plate         → flex-direction:row;              /* rail | regions */
```
- 1440: `--plate-gap:20px`, `--plate-r:40px` → plate is 1400×860 inside 1440×900,
  20px pistachio reveal on all four sides.
- 390: `--plate-gap:8px`, `--plate-r:24px` → plate 374 wide, near-full-bleed with an
  8px ground reveal; the tab bar lives INSIDE the plate (its existing
  `padding-bottom:26px`, `src/styles.css:85`, absorbs the home indicator).
- `.app` keeps `max-width:480px` on mobile (`src/styles.css:29`) — the ground fills the
  rest of the viewport on tablets; correct, no change.
- Content width at 390 becomes 374px: the measured clip boxes in `faithful.css` mobile
  rules (358px assumptions at :979, :1121) shrink by 16px — they are % / flex based and
  survive, but the builder re-runs the 390 overflow probe (floor).

### (b) Desktop rail → reference chrome (icon+label pills)
Selectors: `.wb-rail` (v2c/styles.css:56, faithful:1217), `.wb-rj` (:62, faithful:1220),
`.wb-rj-ic` (:67), `.wb-rj-l` (:69), `.wb-rj-n` (:71, faithful:1224), `.wb-rail-grp`
(:502, faithful:1234), `.wb-rail-sync` (:87), `.wb-rail-top/.wb-rail-ttl` (:59-60).
Jobs/markup unchanged — the rail's jobs map onto the reference's pill grammar:

- `.wb-rail`: width `200px → 216px`; `background:transparent` (sits on plate);
  `border-right:none` (kills faithful:1218's border — the reference rail floats);
  padding `16px 10px 12px → 20px 14px 16px`.
- `.wb-rj` (job row → PILL): `border-radius:var(--r-pill)`; height 40px
  (padding `8px 10px → 10px 14px`); gap 11px keep; rest state `color:var(--text2)`,
  bg transparent. Hover `background:var(--surface1)`. Active `.wb-rj.on`:
  `background:var(--surface1); color:var(--text)`; **drop** the
  `inset 2px 0 0 var(--accent)` spine (faithful:1223) — a spine on a capsule reads as a
  defect; the active mark is the filled pill + lime icon (`.wb-rj.on .wb-rj-ic`
  stays `color:var(--accent)`, now lime, 13.76:1).
- `.wb-rj-n` count badge: keep pill; bg `var(--surface2)`; attention/urgent tints keep
  (retuned by severity tokens automatically).
- `.wb-rj-peer` (Claude): keep the distinct border shape; `.on` border-color
  `rgba(184,255,102,.55)` (was rgba(16,163,127,.55), v2c:80).
- `.wb-rail-top`: logo chip becomes the reference's white circle — see §5 move 3
  (shared with `.avatar-me`).
- `.wb-rail-grp` lane group keeps indent+label grammar; `border-left` color→
  `var(--hairline)`, `.on`→`var(--accent)`.
- Add `border-radius:var(--r-pill)` to `.wb-rail-sync` (it already behaves like a pill row).

### (c) Mobile tab bar
Selectors: `.tabbar` (src/styles.css:85, faithful:1240), `.tb` (:86, faithful:1243),
`.tb .cnt` (:91, faithful:1607).
- `.tabbar`: `background:var(--canvas)` (kills the rgba(22,22,24,.92)+blur — inside the
  plate nothing shows through); keep `border-top:1px solid var(--hairline)` (faithful:1241).
- `.tb`: rest `color:var(--text3)`; `.tb.on` `color:var(--accent)` (lime label 12px/600 on
  canvas 16.34:1 ✓). Tap target: each `.tb` measures ≥52px tall already (icon 22 + label +
  padding) ✓.
- `.tb .cnt`: keeps `--sev-urgent` fill + `--ink` label (faithful:1607). `.cnt.neutral`
  keeps surface3+text.

### (d) Page mastheads (TODAY / CONTENT / LEAD MAGNETS …)
Selectors: `.nav` (faithful:1191), `.nav h2`/`.wb-display` (faithful:158-164,
src/styles.css:36), `.wb-head` (faithful:1194).
- Scale UNCHANGED: 34/44/56 stepped (:127-128) — already the reference's display move,
  and it is scoped to the plate by construction (it lives inside `.wb-plate`).
- Tracking: `letter-spacing:-.02em → -.035em` on the display tier only (condensed-read
  without a condensed font; the stack stays the system grotesk — no new font file).
- `.nav` padding `18px 16px 12px → 24px var(--pad-card) 12px` (the plate's top-left
  corner radius is 40px; 24px top padding keeps the title clear of the curve).
- The right-set chips row beside the title (`.wb-head .chips`) — see (e) heights.

### (e) Filter row + pills — §11 grammar, reskinned only
Selectors: `.chips/.chip` (faithful:1199-1206), `.wb-fbar/.wb-fpill` (faithful:936-951),
`.wb-fmenu/.wb-fopt` (:957-972), `.ct-fr/.ct-fsearch/.ct-fpills/.ct-fpill/.ct-fx/.ct-fn`
(:1029-1148), legacy `.ct-fbar/.ct-fg/.ct-f` (:983-1016), sheets (:1152-1178).
- Grammar, labels, popover/sheet behavior, wrap/scroll logic: UNTOUCHED.
- Heights: `.chip` and `.wb-fpill` `30px → 36px` (desktop), padding `0 14px → 0 16px`;
  `.ct-fpill`/`.ct-f` `26px → 28px` desktop. Mobile: `.wb-fpill`/`.ct-fpill`/`.ct-fx`
  `32px → 36px` visual + a `::after{inset:-4px}` hit-extension → 44px touch (same pattern
  as `.cmic`, faithful:1762).
- Colors by token: pill `background:var(--surface2)`, value `b` in `--text`, label in
  `--text3` (4.74:1 on s2 ✓), `.on` step to `--surface3` — active stays VALUE TEXT,
  never an accent fill (§11.4 held).
- `.wb-fmenu` shadow keeps (licensed overlay); radius follows `--r-card:20px`.

### (f) Section headers + stage sections + cards/rows — the airy delta
Selectors: `.wb-sech/.td-zh/.grouphdr/.ops-sechdr` (faithful:585-607), `.log-day`
(faithful:1501), `.td-sum` (src/styles.css:481), `.ov-sec/.ov-h` (faithful:917-927),
hero cards (faithful:774-781, 432-435), rows (faithful:499-534, 763-765), `.ct-lane-b`
(faithful:1667).
- STICKY HEADERS: `background:var(--surface1) → var(--canvas)` on `.wb-sech`, `.log-day`,
  `.wb-sech-sticky` (faithful:1703) and `.td-sum` — surface1 is now the CARD color and a
  card-colored sticky stripe on the plate would read as chrome-gone-wrong. Border-top/bottom
  hairlines keep.
- Hero/overview cards (`.ov-tile .ov-kpi .ov-gov .ov-rc .ov-tbl .ov-pipe .ov-funnel
  .wb-chartcard .td-mast .wb-oband`): `border:1px solid var(--hairline) → border:none`
  (faithful:774-780) — reference cards are borderless flats; separation is the
  surface1-on-canvas step itself. `padding:var(--pad-card)` → 24px via token.
  Radius → 28px via `--r-hero`.
- Card gaps: `.ov-hero/.ov-kpis/.ov-seats/.ov-govs` `gap:12px → 16px` (faithful:924-925);
  `.ov-duo` desktop gap `16px → 20px` (:927); `.ov-sec` `margin-top:24px → 28px` (:917);
  `.wb-chartcard` margin `14px → 16px` vertical (:1372); `.td-zone` (src/styles.css:651)
  follows `--surface` automatically, radius 18 → set `var(--r-hero)` at `.wb.wb.wb` scope.
- DENSE ROWS: NO CHANGE to the 40–60px band, anchor rail, 9-10px row padding, hairline
  row rules (faithful:497-568, 763-765). Airiness is bought on overview surfaces only —
  this is the same bet faithful.css already documents (§ thesis, :4-11) and it is kept.
- Row selection keeps the `inset 2px 0 0 var(--accent)` spine (faithful:575-578) — now
  lime; hover keeps the surface2 shift.

### (g) CapsuleChart + LM chart (reference proportions)
Selectors: `.wb-caps/.wb-cap/.wb-cap-0/.wb-caps-x` (faithful:881-903, 1869-1874),
`Surface.tsx:144` (`capH`, 72px sqrt cap), card footer `.wb-cardf/.wb-legend/.wb-total`
(faithful:826-855), gauges `.ov-gauge/.td-bar/.wb-stack` (faithful:908-913).
- Geometry survives (tracks ~52px ≈ reference's measured proportion, capsule radius
  already `--r-pill`, min-width 22px, 72px plot cap, number-in-mark per §8.3).
- Colors move by token: capsules cycle lime/orange/white/neutral; ink numerals on 1-3,
  white on 4 (4.95:1 ✓). `.wb-cap-0` stub + its printed 0 keep.
- NEW value-capsule treatment (§5 move 2): the printed value inside `.wb-cap` gets a
  drawn plate — `min-width:22px; height:18px; border-radius:999px; padding:0 5px;
  background:rgba(23,23,23,.14)` — the reference's "number printed IN a capsule" read,
  at zero contrast cost (ink numeral stays on the fill's own ≥8.5:1).
- Legend dots 8px keep; `.wb-total` footer keeps (the reference's own move).
- Horizontal capsule bars (Today "SENDS THIS 7D", `.td-bar` family): height `8px → 12px`
  (still capsule); fill colors = cat tokens; the trailing count stays a printed numeral
  in `--text` (reference prints counts at bar ends).
- Sparklines `.sc-bar` (faithful:488, 848): follow `--cat-3` → now WHITE marks on dark,
  the reference's white-as-data; zero-bars stay `--surface3`.

### (h) KPI / stat figures (today / sends / ops tiles)
Selectors: `.ov-tile-big/.td-big/.wb-pipe-big/.wb-otile-n` (faithful:166-177, 794-802;
v2c:461-462), trend spans `.ov-tile-trend/.td-ts span` (faithful:786, 1623),
funnel `.ov-fn/.ov-fpct`.
- Figure sizes/weights unchanged (30px/600, the one-figure-per-surface rule holds).
- Delta arrows (reference's colored triangles): everywhere a `▲n`/`▼n` renders
  (Sends ACCEPT "7d ▲3", Today ACCEPT tile, funnel %), the glyph gets
  `color:var(--delta-up)` / `var(--delta-down)` at the existing size — lime 13.76:1,
  orange 7.82:1 on s1 ✓. The NUMBER stays `--text`; only the triangle is colored
  (accent-budget honest: one small mark per stat).
- The green inline-hex trend paints Sends carries (`--ov-tile-trend` neutralisation at
  faithful:1640 for light) now read the delta tokens on dark too.

### (i) Takeover detail window
Selectors: `.wb-tkscrim` (v2c:669), `.wb-tk` (:671-677), `.wb-tk-head` (:678-680),
`.wb-tk-x` (:683), `.wb-tk-col/.wb-tk-frame` (:691-693).
- `.wb-tk`: `background:var(--bg)` → resolves to new canvas `#0C0C0B` ✓ (it IS a second
  plate); radius `var(--r-lg)=20px → var(--r-hero)=28px`; border `1px solid var(--surface3)
  → 1px solid var(--hairline-strong)`; keep the licensed `0 24px 80px` shadow.
- `.wb-tk-head`: `rgba(18,18,20,.92) → rgba(31,31,31,.92)` (surface1 at 92%);
  same for the light override at v2c:680.
- `.wb-tk-x` keep (44px, pill — licensed class).
- Scrim `rgba(0,0,0,.55)` keep — over the pistachio reveal it dims the ground too, which
  is correct (one modal focus). Mobile: window stays full-viewport OVER the plate
  (covers the ground reveal — accepted, it is a reading takeover).
- `.wb-tk-frame` stays `background:#fff` (it hosts rendered LM/post content).

### (j) Chat pane (composer, bubbles, model chip)
Selectors: `.wb-peer` (v2c:24-29), `.wb-pane-h/.wb-pane-ic` (v2c:125-131, faithful:1247),
bubbles `.b/.b.in/.b.out` (src/styles.css:102-104, faithful:424-428, 452),
composer `.composer/.cfield/.csend` (src/styles.css:119-120), `.cmic/.wb-mic`
(faithful:1754, v2c:366), model `.wb-modelbtn/.wb-modelmenu/.wb-modelopt` (v2c:728-746),
starters `.wb-starter` (v2c:354).
- `.wb-peer`: bg follows canvas; `.wb-peer.on` inset `rgba(16,163,127,.5) →
  rgba(184,255,102,.55)` (v2c:28).
- `.wb-pane-h` (faithful:1248): `background:var(--surface1) → var(--canvas)` + hairline —
  pane chrome is plate chrome, not a card. `.wb-pane-ic.asst`: lime fill + `--ink` glyph
  (faithful:452 already routes this; v2c:131's `color:#fff` is overridden there ✓).
- Bubbles: `.b.in` `var(--surface2)` (#2A2A29) keep; `.b.out` lime fill + ink text
  (14.97:1) via faithful:452; radius `--r-card:20px` via faithful:424; msg-links in
  `.b.out` keep ink+underline (faithful:1618).
- Composer: `.cfield` bg surface1, border hairline, radius `--r-ctl:12px` (NOT pill —
  §6.3 licence unchanged); `.csend` keep pill, hover surface3; `.cmic` keep — recording
  state's accent-soft tint + lime dot now lime family.
- Model chip `.wb-modelbtn.picked` (v2c:732): `background:var(--accent-soft);
  border-color:rgba(184,255,102,.35); color:var(--text)` — lime TEXT would be legal
  (12.0:1 on s2) but the chip is chrome; keep words neutral, tint carries the state.
  `.wb-modelopt.on` same treatment (v2c:740).
- Starters/about-card/tools/code blocks: token-fed, no named change; `.wb-code.open`
  border `rgba(16,163,127,.4) → rgba(184,255,102,.4)` (v2c:317).

### (k) Buttons — primary/ghost on charcoal
Selectors: `.btn/.btn.p/.btn.s` (src/styles.css:116-118, faithful:412-417, 753-759,
1601-1605), `.wb-ask` (v2c:139), `.wb-retry` (faithful:1330), `.wb-editbtn` (v2c:700),
`.wb-delbtn/.wb-btn-danger` (v2c:715-722).
- PRIMARY (the pane's one Approve, `.ct-ac-wide .btn.p`, Ops "Approve & open gate"):
  `background:var(--accent)` → lime, `color:var(--ink)` (14.97:1) — already routed at
  faithful:1605/453; radius `--r-ctl:12px`.
- In-row shortcut `.ct-card .ct-ac .btn.p` stays the neutral surface3+hairline-strong
  ghost (faithful:1601-1604) — 18 lime buttons in one list is still 18 primaries.
- GHOST `.btn.s`: `var(--surface2)` + `--text2` (8.50:1 ✓).
- DANGER: `--sev-urgent` fill + `--ink` label (faithful:1330); `.wb-delbtn` outline
  variant keeps.
- `.wb-ask` (v2c:139): `rgba` accents → `background:var(--accent-soft);
  border:1px solid rgba(184,255,102,.35); color:var(--text)`.
- `.wb-editbtn` (v2c:700) same substitution. All hovers keep the existing
  brightness/bg-shift contract (faithful:1776-1806).

### (l) Empty / failed / skeleton states
Selectors: `.wb-empty*` (faithful:1318-1324, v2c:160-165), `.wb-failed*`
(faithful:1325-1331, v2c:148-158), `.ct-alert*` (faithful:1337-1368), `.sk` family
(src/styles.css:230-238), `.wb-th-dot` (faithful:1862-1864).
- All token-fed; no structural change. Verify only:
  `.wb-empty-f` pill on `--surface2` with `--text3` → 4.74:1 ✓;
  failed card `rgba(255,69,58,.08)` tint + `--sev-urgent` title → 4.7:1 on the tint ✓
  (tint over #0C0C0B ≈ #1F0F0E);
  skeleton `.sk` on `--surface2` + the white .07 shimmer reads on the new ladder ✓;
  thinking dots `--text3` keep.
- `.wb-ok-dot`/`.wb-live` → lime (`--accent`) ✓ marks ≥3:1 everywhere.

---

## 4 · WHAT DOES NOT CHANGE

- Layout architecture: rail | work | peer regions, `layout.ts` plans, the 400px list
  column, solo-width reflow (faithful:1418), Ops two-column grid (v2c:489-496),
  Today's zone masonry (src/styles.css:640-663). Zero re-architecture; the plate wrapper
  is the ONE DOM addition.
- The §11 filter grammar: `label: value ⌄` anatomy, popovers, bottom sheets, wrap/scroll
  fixes and their measured load-bearing rules (faithful:1114-1148) — semantics intact.
- Severity semantics AND hexes (`#10A37F/#FF9F0A/#FF453A`), §5.4/5.5 one-mark-per-run
  discipline, QA dot states (faithful:669-677).
- The 7-tier type scale, the flatten-then-reassign mechanism (§2), tabular numerals,
  the weight ceiling, the one-figure-per-surface rule.
- Dense-list vocabulary wholesale: anchor rail, density band, de-bordered rows, sticky
  header anatomy, log anchor chips, second-class-row grids (faithful §6, §12, §14).
- Motion: one easing, three durations, the single approve beat, reduced-motion kills.
- The stock iOS shell outside `.wb`: `src/styles.css:1-16` `:root`, the default app's
  own screens — untouched (bridge tokens at faithful:44-49 carry the new ladder in).
- Focus-visible ring mechanics (2px, offset 2) — only the color rides `--accent`.
- All copy, all information architecture, all interaction handlers.

---

## 5 · ELEVATION MOVES (exactly 4, inside the reference's vocabulary)

1. **The plate's drop shadow** — `.wb-plate{box-shadow:0 24px 60px -20px rgba(0,0,0,.5)}`.
   Sampled: the reference's plate rests on a soft dark bloom (`#485F30`-family ≈ black
   55-65% over ground, widest at the bottom edge). One shadow, on the plate only —
   §3.4's zero-resting-shadow rule is amended to license exactly this element (the plate
   is the app's one "floating" object; cards stay flat).
2. **Print-style value capsules on chart marks** — inside every `.wb-cap`, the numeral
   sits in a drawn 18px-tall, min-22px-wide 999px capsule, `background:rgba(23,23,23,.14)`
   on the mark's own fill (ink numeral keeps ≥8.5:1). The two big stage circles
   (IDEA 37 / PUB 42/109) keep their circle geometry — now lime/white/orange fills with
   the same ink print. This is the reference's signature "the number lives inside a
   printed shape" read, executed without new layout.
3. **Signature monogram + avatar treatment** — `.avatar-me` (src/styles.css:37) and the
   rail logo chip (`.wb-rail-top` v2c:59): kill the teal-blue gradient; both become the
   reference's white circle: `background:#FFFFFF; color:var(--ink)` (17.93:1), 34px
   avatar / 40px rail logo, with a `box-shadow:0 0 0 2px var(--ground)` ring — the ONLY
   place the pistachio enters the plate, which is what makes it a signature and not a
   palette leak. (Unread red badge on it keeps `--sev-urgent` + ink.)
4. **Colored delta triangles** — §3(h): every directional stat glyph app-wide takes
   `--delta-up` lime / `--delta-down` orange at existing size, number stays white.
   8-10px of color per KPI card, straight from the reference's CUSTOMER/PRODUCT tiles,
   and the accent census stays under budget because each is one mark.

---

## 6 · RISK LIST — where the inversion can break (builder must check each)

1. **`index.html:7` `theme-color #000000` + `:9` inline `html,body{background:#000000}`**
   — the page behind the plate is now painted by `.wb.app` (ground), but overscroll
   rubber-banding and the PWA title bar will flash BLACK against pistachio. Decision:
   leave `:root`/body alone (scoping rule); OPTIONAL follow-up outside this skin's scope
   is updating the meta only. Flag, don't fix silently.
2. **Fixed-position overlays assume edge-to-edge viewport**: `.sheet-scrim`
   (src/styles.css:207), `.wb-tkscrim` (v2c:669), `.ct-fsheet-scrim` (faithful:1152) —
   all `position:fixed; inset:0`. They will cover the ground reveal and their sheets dock
   to the VIEWPORT bottom, overlapping the plate's 40px bottom corners. Accepted for
   transient overlays; verify the bottom sheet at 390 doesn't read as broken against the
   8px reveal (if it does: `padding:0 var(--plate-gap)` on the scrim flex).
3. **Sticky elements inside scrollers**: `.td-sum` (src/styles.css:481, sticky top:0,
   bg `--bg`→canvas ✓), `.wb-sech` (faithful:589, bg surface1 → MUST move to canvas per
   §3f or every list grows card-colored stripes), `.wb-sech-sticky` (faithful:1703 same),
   `.log-day` (faithful:1504 same). These scroll INSIDE the plate so the radius never
   clips them — but their backgrounds must be re-pointed, and `overflow:hidden` on
   `.wb-plate` is what keeps the scrolled content out of the corner radius. Verify no
   scroll container escapes the plate (`.rows` overflow-y at src/styles.css:30 ✓ inside).
4. **surface1's job changed** (near-canvas → card color): every `background:var(--surface1)`
   that meant "chrome" now means "card". Audit hits: `.wb-rail` (faithful:1218 → transparent,
   §3b), `.wb-pane-h` (faithful:1248 → canvas, §3j), `.tabbar` (faithful:1241 → canvas,
   §3c), `.wb-fmenu`/`.wb-palette`/`.wb-modelmenu` popovers (faithful:960,1725; v2c:735 —
   KEEP surface1, a floating menu reading as a small card is correct), `.log-denom`
   (faithful:1521 keep), `.group` settings cards (faithful:1651 keep).
5. **Hardcoded old-accent rgba literals** (green `16,163,127` survives the token swap):
   v2c/styles.css:28, 80, 139, 192, 317, 702, 712, 732; faithful.css:469 (`.ct-chip-ok`
   inset). All → `184,255,102` at the same alphas — EXCEPT `.ct-chip-ok`, whose ring should
   move to `rgba(16,163,127,.55)`→ stays SEVERITY green (it encodes a PASS verdict, which
   is `--sev-clear`, not accent): set `rgba(16,163,127,.55)` literally, i.e. unchanged
   value, new meaning documented.
6. **Light-mode block** (faithful:132-141 + patches :1307-1312, :1629-1642;
   src/styles.css:7-16 untouchable; v2c:58,127,680 rgba patches): must be re-derived per
   §2's light table + `--accent-ui` indirection, or light mode ships lime-on-white
   failures. If the run descopes light, gate it: `data-theme='light'` keeps the OLD
   ladder untouched only if every faithful light patch still resolves — safer to ship the
   table above.
7. **`?cat=mono` branch** (faithful:82-89 default block vs :109-122 triad): after §2 the
   DEFAULT `.wb{}` block carries MONO values and `[data-cat='triad']` carries the
   reference set. Confirm which is the shipped default in `Register.tsx`/query param —
   the baselines render TRIAD (blue/purple visible in cur-sends-1440 sparklines,
   cur-content-1440 REVIEW capsule), so the reference set must land in the TRIAD block
   to appear, and MONO stays the fallback. Do not put lime/orange in both and lose the
   toggle's meaning.
8. **`.avatar-me` gradient** (src/styles.css:37 hardcodes `#10A37F→#0A84FF`) — outside
   `.wb`-scoped files; override at `.wb.wb.wb .avatar-me` inside faithful.css (§5 move 3),
   never edit the base line.
9. **390 width re-probe**: plate gap costs 16px of content width; the measured-and-fixed
   clip boxes (faithful:979-995, 1114-1148 — filter pills, meta fade) and `.app`
   `max-width:480px` interplay need one fresh horizontal-overflow pass at 390 (floor).
10. **`.wb-take` root** (Shell.tsx:411) deliberately gets NO plate — verify the takeover
    still fills the viewport over the ground without a double-frame.
11. **PWA/service worker** (`src/sw.ts`): stale cached CSS will mix old/new ladders on
    first deploy — bump the cache key with the skin.
12. **Charts on new fills**: TRIAD cat-3 is now WHITE — `.ct-anchor-dot` scheduled state
    (faithful:677) becomes a white dot on canvas with a 2px canvas ring: verify it still
    reads vs the grey default `--text4` dot (white 19.6:1 vs grey 3.8:1 — it does, but
    eyeball it).

---

## CONTRAST APPENDIX (computed, WCAG 2.x relative luminance)

| Pair | Ratio | Floor | Verdict |
|---|---|---|---|
| `--text` on canvas/s1/s2/s3 | 19.57 / 16.48 / 14.37 / 12.29 | 4.5 | ✓ |
| `--text2` on canvas/s1/s2/s3 | 11.58 / 9.75 / 8.50 / 7.27 | 4.5 | ✓ |
| `--text3` on canvas/s1/s2 | 6.45 / 5.43 / 4.74 | 4.5 | ✓ |
| `--text3` on s3 (label-only) | 4.05 | 3.0 | ✓ |
| `--text4` on canvas/s1 (non-text) | 3.84 / 3.23 | 3.0 | ✓ |
| lime on canvas / s1 / s2 | 16.34 / 13.76 / 12.00 | 4.5 | ✓ |
| ink on lime / orange / white / ground | 14.97 / 8.51 / 17.93 / 12.54 | 4.5 | ✓ |
| orange on canvas / s1 | 9.29 / 7.82 | 4.5 | ✓ |
| white on `--cat-4` #707070 | 4.95 | 4.5 | ✓ |
| sev-clear / sev-attn / sev-urgent on s1 | 5.15 / 8.02 / 4.84 | 4.5 | ✓ |
| MONO cat-2/cat-3 with ink | 13.97 / 7.11 | 4.5 | ✓ |
| ground vs plate (boundary) | 13.69 | — | ✓ |
| light `--accent-ui` #5A8A00 on white (marks/icons) | 4.14 | 3.0 | ✓ |
| rejected: sampled #8F8F8F as text3 on s2 | 4.44 | 4.5 | ✗ → tuned to #949494 |
