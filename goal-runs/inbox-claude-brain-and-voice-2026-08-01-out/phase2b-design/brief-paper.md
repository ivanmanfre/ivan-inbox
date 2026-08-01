# Direction brief — `paper` · "Field Notes"

**Thesis:** Ivan's flagship surface (ivanmanfredi.com) is warm paper, ink, editorial serif numerals, and a highlighter gesture. His operator tool should feel like it was made by the same hands: a working notebook, not a NASA console. This is the maximum-brand direction — if it wins, the app finally *belongs* to the site.

**Ground / material:** warm paper family adapted for an app (near `#F5F2EC` field, slightly deeper paper for inset panels, ink `#1A1A1A`-family text — pick exact values for AA contrast and record them). Faint grid-paper texture at very low opacity on the app frame ONLY (not inside data tables). Depth via one level of soft shadow (`0 2px 8px rgba(0,0,0,0.08)`-grade) + 1px ink-alpha hairlines (ink at 8-12%), never gray-200 borders. Sharp corners on blocks/pills/buttons (radii collapse toward 0-4px); only avatars/photos stay rounded.
**Dark theme duty:** `data-theme='dark'` must stay functional; it may be a plain competent dark, not the thesis.

**Type:** display numerals and screen titles in `ui-serif`/Georgia (system serif, roman, tight line-height); body/UI stays system sans. The signature lockup: big roman serif numeral + 11px letter-spaced uppercase sans label (e.g. `56` over `NEEDS YOU`). Small-caps tracked eyebrows for section headers (`01 · WAITING ON YOU` register). Real scale jumps: numeral tier ≥34px where a stat carries the screen, labels 11px, body 14-15px. Italic: at most one short phrase per surface; default none.

**Accent `#10A37F` deployment — the highlighter, not the paint:** primary action buttons stay ink-block (dark rectangle, paper text — like the site's CTA); the accent appears as (a) a highlight sweep BEHIND the single number that matters most per screen, (b) the live/clear severity tier, (c) square (not round) bullet markers. Accent never fills a surface, never tints a card. Severity amber/red unchanged in meaning; restyle as ink-boxed pills with colored square markers rather than colored text alone.

**Data-viz:** proportion bars become flat ink rules with an accent segment (no rounded caps); gauges become square-cornered; every encoding gets a mono... NO — no monospace: tabular-nums sans for data, serif only for hero numerals.

**Motion:** ONE easing token (cubic-bezier(.25,1,.5,1)), 150-250ms, transform/opacity only. One signature beat: the highlight sweep draws in behind the hero number when a screen loads (240ms, once, respects prefers-reduced-motion). Everything else: instant or fade.

**Empty states:** the notebook register — a single terse ink line, an em-space of paper, and one small drawn element (a square bullet or a short rule), never a giant glyph. Keep the honest freshness line ("Checked just now").

**References to FETCH (≥2, cite the move + URL + evidence):**
- `https://ivanmanfredi.com` — the ground truth (local crops exist at `phase2b-design/brand-refs/` but fetch live yourself for the current state)
- `https://stripe.press` — paper editorial as product-grade web material
- `https://www.are.na` — quiet paper-toned working tool
- `https://linear.app` — restraint/hairline discipline to keep the paper from going twee

**Canon guardrails:** do NOT use retired sage `#2A8F65` or `#F7F4EF`-verbatim-with-italic-DM-Serif nostalgia — accent is `#10A37F`, italic is near-zero, no em dashes in UI copy. No circles for numbered markers. No 4px brutalist shadows.

**Fails if:** it reads as a marketing page instead of a tool (density must survive — the content lanes with 198 rows are the test); or the paper ground murders scanability of severity states; or it's a token swap (see anti-re-skin rule).

---

# BUILD — what `paper` actually did
*(Written by the orchestrator from the committed diff after the builder hit the harness watchdog. Every claim below is read off the branch, not reported by the agent.)*

Branch `exp/brain-2b-paper`, base `87050cd`. Commits: `1c4359a` treatment layer · `6ab42d8` load above the login screen + sweep repair · `98e88d6` retire the 4th and 5th hue. 49 files, treatment concentrated in one new `src/exp/v2c/paper.css` (738 lines) loaded *after* `v2c/styles.css`, so every structural rule underneath still reads as written. No column moved, no screen added, no route renamed.

**Ground.** Black glass → warm paper with a faint desk grid. `--paper #F6F3ED` field / `--paper2 #FFFDF8` sheet / `--paper3 #EDE8DE` well / `--paper4 #E1DBCE` tint; ink `#191714 / #4A463E / #6B665C` measured at **18.7 : 8.5 : 5.1** against the field, all AA. Hairlines are ink-alpha (`.16` / `.09`), grid `.055`. The app's own token names are remapped underneath (`--bg: var(--paper)` etc.) so nothing downstream knows it moved.

**Type.** One sans at 26-38px stat / 34px title / 12.5px label → a **system-serif display tier at 46 and 40px** (`ui-serif`/Georgia, roman, `-.02em`) over a tracked 11px eyebrow tier over 15px sans body. Four real jumps, not ±2px. Zero webfont bytes: the only `@font-face` string in the file is the comment stating there is none.

**Headers.** A tracked label with a rule through the middle → a **ledger head**: serif index numeral, tracked eyebrow, a 1.5px ink rule *under* the line, count set in serif.

**Rows.** Floating 16px-radius cards on a black field → a **continuous ruled sheet**: full-bleed rows, hairline separators, a notebook margin carrying a square marker. This is the anti-re-skin move that matters most on the 198-row content lane.

**Accent — the highlighter.** `#10A37F` stops being a status colour and a button fill. It sweeps in behind the single number carrying each screen, marks the clear tier, and squares off bullets; it never fills a card and never sets text. The reason is measured, not stylistic: on paper, `#10A37F` is **2.9:1**, amber **1.8:1**, red **2.8:1** — coloured text is illegible text. So severity moves to a coloured **square marker plus a tinted hairline box with ink text**: three tiers, same hexes, same meaning, same count, and the copy passes AA. Primary action is an ink block, exactly as `ivanmanfredi.com` sets its CTA. Commit `98e88d6` removed the 4th and 5th hue that had survived from the shipped app.

**Gates:** 334 tests pass (20 files) · lint **0 errors** · `package.json` unchanged vs base (no new dependency) · no `@font-face` rule · sweep across 22 surface-viewport pairs: **zero horizontal overflow**, zero failed captures. Three sweep rows report "never settled" — a harness settle-timeout on data-heavy surfaces, not an app console error.

**Fetched references.** The treatment's ground, CTA and highlighter gesture are taken from `https://ivanmanfredi.com`, captured live this run at both viewports into `phase2b-design/brand-refs/site-{desktop,mobile}-{top,mid}.png` (the orchestrator's capture, timestamped 2026-08-01, used by this build). ⚠ **Honest gap:** the builder was killed before it recorded a second live fetch with its own retrieval evidence, so this direction cites **one** verified external reference where the contract asked for two. The top-studio judge seat should mark it down for that rather than have it papered over.

**3-second felt-difference argument.** Every one of the five things a stranger reads first is different from both controls: ground (warm paper vs both the current app's black and the generic template's white-on-grey), type (a serif display tier neither control has), header (a ruled ledger head), rows (a continuous sheet, not cards), accent (a highlighter gesture, not a status dot). Against `brand-refs/control-generic-admin.png` the separation is total; against `brand-refs/site-desktop-top.png` the family resemblance is the point.

---

# RE-CAPTURE — 2026-08-01

**What was wrong:** the sweep's injected session (`.session.json`, minted by `scripts/dev-login.mjs`) had expired before the crop run — `expires_at` was in the past relative to capture time. `src/lib/supabase.ts` uses the default Supabase storage key with `autoRefreshToken: true`, but an already-expired token injected via `localStorage` before first paint never gets a chance to refresh — the client treats it as unauthenticated and the app renders its logged-out/no-data skeleton (grey placeholder bars, footer "not loaded", wrong header title because the route never resolved real state). This is a capture-instrument failure, not a defect in the `paper` treatment, which was already committed and untouched.

**What was done:** re-ran `node scripts/dev-login.mjs` in this worktree to mint a fresh magic-link session against the sole app user (im@ivanmanfredi.com) via the Supabase Management API + admin `generate_link`/`verify` flow; new `.session.json` written with a far-future `expires_at`. Confirmed dev server already live on `localhost:5401`. Re-ran `node scripts/sweep-paper.mjs .../crops/paper http://localhost:5401/` for all 11 surfaces × 2 viewports (390×852, 1440×900) — today, inbox, thread, drafts, content-ivan, content-mattan, draft, sends, ops, settings, chat — overwriting the prior unusable crop set in place.

**Result:** all 22 shots clean — `overflow=false` everywhere, `loginVisible=false` everywhere, 0 console errors, every click step (thread row, Mattan chip, first content card) landed `ok`. Word counts confirm real data on every surface (e.g. content-ivan desktop 6652 words, content-mattan desktop 1670 words, draft desktop 9972 words) — none of the ~19-word chrome-only skeleton floor.

**Verified by eye (Read tool) on the three highest-stakes crops:**
- `content-ivan-desktop.png` — real Workbench chrome, real alert copy ("20 unacknowledged pipeline alerts…", "38 · 3 errored · 35 elsewhere"), real resource rows with actual titles and "updated 6d ago" timestamps, footer "just now". Real data, not placeholders.
- `content-mattan-desktop.png` — Mattan's lane selected, real QA-blocked draft cards with titles/status pills, "20 of 84 on Mattan's board" copy, footer "6s ago". Real data.
- `draft-desktop.png` — a specific content draft open with full QA verdict breakdown (VOICE 8/10, SUBSTANCE 7/10, etc.), Claude panel open with contextual suggestions, footer "8s ago". Real data.

**Surfaces confirmed rendering real data:** all 11 (today, inbox, thread, drafts, content-ivan, content-mattan, draft, sends, ops, settings, chat) at both viewports — 22/22 usable. None still broken.
