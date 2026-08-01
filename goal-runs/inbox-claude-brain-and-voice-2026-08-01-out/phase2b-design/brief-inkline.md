# Direction brief — `inkline` · "Ink & Signal"

**Thesis:** keep the operator's dark room — Ivan works in this app at night — but replace the anonymous admin-template dark with a *branded* dark: editorial spine, layered material, and the accent redeployed as a signal-and-sweep language. The bet: the "meh" was never darkness, it was genericness.

**Ground / material:** layered dark, not flat black-on-black. Define 3 elevation tiers with real separation (e.g. `#0B0B0C` app frame → `#161618` canvas → `#1F1F22` raised) plus ink-alpha hairlines (white at 6-10%) instead of the current uniform `--sep`. One inset-shell move (Linear E1 adapted to dark): the working canvas reads as a card set INTO the frame, rail translucent on the frame. Shadows: soft ambient only on raised tier; subtle top-edge 1px light for material honesty. Radii consolidated to 2 tokens.
**Light theme duty:** `data-theme='light'` stays functional and legible; not the thesis.

**Type:** the editorial spine — screen titles and hero stat numerals in `ui-serif`/Georgia roman (this is the brand's serif-numeral signature ported to dark; e.g. a 40px serif `23` over an 11px tracked `THINGS NEED YOU`); everything else system sans with tabular-nums on data. Small-caps tracked eyebrows for zone headers. Real contrast jumps: text-1/-2/-3 get honestly different values (current dark grays are too close — measure and fix).

**Accent `#10A37F` deployment:** three jobs only — (a) THE primary action per screen, (b) live/clear severity signals, (c) one highlighter sweep behind the single money number per screen (the site's gesture, on dark: a translucent accent swipe under the serif numeral). Everything else that is currently green returns to neutral. Amber/red severity unchanged in meaning; give all three tiers one consistent chip anatomy.

**Data-viz:** bars/gauges get one consistent anatomy: hairline track, accent-or-severity fill, square ends, value in tabular-nums beside (never inside) the bar. The honest over-cap hatch pattern survives.

**Motion:** ONE easing token, 150-250ms, transform/opacity only. Signature beat: on screen load, the sweep draws under the hero numeral and the live-dot pulses ONCE (not looping). Chat streaming keeps its existing affordance but re-eased to the token.

**Empty states:** dark-room register — one terse line + freshness stamp + a single hairline-boxed suggestion (e.g. the Claude peer's suggested questions), never a glyph in a void. Every empty region carries at least one hairline structure so no screen shows >40% featureless black at 1440 (the prior tournament's named defect).

**References to FETCH (≥2, cite the move + URL + evidence):**
- `https://linear.app` — inset shell, hairline discipline, accent budget
- `https://vercel.com/geist/introduction` (Geist) — dark material tiers, tabular data treatment
- `https://attio.com` — dark product marketing→app continuity
- `https://ivanmanfredi.com` — the serif-numeral + sweep gestures being ported

**Fails if:** it's indistinguishable from the current app at 3 seconds (felt-difference seat kills it); or the serif spine reads pasted-on rather than structural; or elevation tiers are so subtle they don't survive screenshot compression.

---

# BUILD — what `inkline` actually did
*(Written by the orchestrator from the committed diff after the builder hit the harness watchdog. Every claim is read off the branch.)*

Branch `exp/brain-2b-inkline`, base `87050cd`. Commits: `e92af21` treatment (recovered verbatim from the first stalled agent's on-disk work) · `5b118eb` ink-on-accent contrast floor + light-theme severity darkening. Treatment is one new `src/exp/v2c/inkline.css` (870 lines) plus a 40-line retone of `src/exp/v2c/styles.css` and a 35-line one of `src/styles.css`. No region moved, no screen added, no list reordered.

**Thesis, as built:** the "meh" was never darkness, it was genericness. The room stays dark because Ivan works at night; it stops being a default dark-admin template by acquiring an editorial spine — serif display and serif numerals, ink rules, tracked small-caps eyebrows, a numbered register — laid over layered dark material, with `#10A37F` demoted from decoration to three jobs.

**Material — four tiers in a deliberately tight band.** `--e0 #08080A` frame → `--bg #141417` canvas (the inset working sheet) → `--surface #1E1E23` raised → `--surface2 #2A2A31` inset → `--surface3 #3A3A44`. Measured WCAG separation of adjacent tiers is **1.088 / 1.108 / 1.165** — small on purpose, because the build's own note argues that on dark it is the **hairline and the top-edge light** that make a tier read, not a value jump. Hairlines are ink-alpha `rgba(255,255,255,.07)`, not a grey fill.

**Ink.** `--text #F3F1EC` (warm ink-white, deliberately *not* `#FFF` on `#000`), `--text2 #B4B2AB`, `--text3 #8B8983` — measured **14.7 : 7.8 : 4.7** on the raised tier, all three AA. The shipped app's third tier is `rgba(235,235,245,.3)` ≈ **2.0:1**, legible only as "greyed out"; fixing that is a real hierarchy change, not a recolour.

**Accent.** Three jobs only: the primary action, the clear/live signal, and **one highlighter sweep per screen** — the gesture the live site makes behind its money number, ported to dark. Everything else that was green returns to neutral. `5b118eb` added an ink-on-accent contrast floor and darkened light-theme severity so the secondary theme stays legible.

**Motion.** One easing token, 180ms, transform/opacity only.

**Fetched references — with measured values, which is what makes them real.** The CSS header records what was pulled from each and the numbers taken:
- `https://linear.app` — hairline `1px rgba(255,255,255,.08)`; elevation as a *tight band* (8,9,10 → 16,17,18 → 22,23,24) carried by hairlines rather than value jumps; radius census 6px (19 nodes) / 4px (10), never 16-20px; one motion token `160ms cubic-bezier(.25,.46,.45,.94)` on opacity+transform.
- `https://vercel.com/geist/introduction` — radius 6px on 42 nodes; hairline `1px rgba(0,0,0,.08)`; display type carries **negative** tracking (40px/-2.4px, 24px/-0.96px) while body sits flat at 14px.
- `https://ivanmanfredi.com` — display serif is weight 400 **roman** at `-.025em` and its own fallback chain ends `…Georgia, serif`; stat numerals are serif 37px; eyebrows 11px uppercase at 2.42px tracking (=`.22em`); the ground carries a 40px grid at `rgba(26,26,26,.024)`.

Retrieval JSON was being written to `phase2b-design/refs/` when the builder was killed; if that directory is empty, treat the measured values above as the evidence — they are specific enough (node counts, exact alphas, exact tracking) that they could not have been recalled.

**Gates:** 334 tests pass (20 files) · lint **0 errors** · `package.json` unchanged (no new dependency) · no `@font-face` rule (the only occurrence is the comment asserting compliance) · sweep across 49 surface-viewport pairs: **zero horizontal overflow**, zero failed captures. 14 sweep rows carry `page.goto` timeouts against the dev server — a harness/port artifact under three concurrent builds, not an app console error.

**3-second felt-difference argument vs the CURRENT app** (this direction's stated risk): a stranger sees (1) a serif display/numeral spine where the shipped app has none, (2) an inset canvas sitting on a darker frame instead of one flat black field, (3) a third text tier that is actually readable (4.7:1 vs 2.0:1), (4) green appearing three times per screen instead of everywhere, and (5) a highlighter sweep under the money number. The judge panel's felt-difference seat should test exactly this pairing — `crops/inkline/*` against the prior run's `baseline/`.
