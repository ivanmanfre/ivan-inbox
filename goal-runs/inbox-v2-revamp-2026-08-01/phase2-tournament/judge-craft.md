# Judge Seat 2 — Craft and native-ness

## Calibration (mandatory, done first)

- `baseline/sends-desktop.png` / `sends-mobile.png` (known-good): placed at the **top** of my scale before opening any candidate. Correct hierarchy (Decision hero → Funnel → Volume/Pipeline), honest over-cap gauge, consistent 16px tile radius, tabular numerals. This is my craft ceiling reference.
- `baseline/ops-mobile.png` (empty-state control): placed **mid-scale, not high**. The copy voice ("Nothing waiting on you.") is correctly terse and calm, but there is no freshness signal distinguishing a confirmed zero from a silent stall (aesthetics.md §4) — I do not score this screen as well-composed for a *working queue*, only as a well-voiced empty state. This is the correct placement per the calibration note: crediting the voice, withholding credit for the missing freshness cue.
- Prose strawman (per CALIBRATION.md, 852px/169 w-1000px/88.9% prose/0 encodings): placed at the **bottom**, below Ops-empty. Zero visual encoding on a 100+-word surface is disqualifying under the kept gate, and it reads exactly like a wall of text with no drawn structure.
- Ranking holds: Sends ≫ Ops-empty > strawman. Calibration passes.

## 1. Token and scale fidelity

All three reuse `--bg/--surface/--accent/--blue` and the 3-tier severity exactly as canon — confirmed pixel-for-pixel against baseline in `sends-desktop.png` for all three (`crops/v2a/sends-desktop.png`, `crops/v2b/sends-desktop.png`, `crops/v2c/sends-desktop.png` all reproduce 28% / 103/100 / 5d identically to `baseline/sends-desktop.png`, meaning `OverviewView` was consumed, not rebuilt — the honest gauge and tile scale survive as a direct consequence). No 4th severity color found in any crop. No monospace found in any chat/code-block crop (`v2a/chat-desktop.png`'s `RUN gh run list…` pill, `v2b/chat-turn-desktop.png`'s `send_blocked_reason` code chip, all render in the system sans). All three explicitly chose the system-font-over-code-blocks route against the phase-1 spec's scoped exception — correct call: the contract's ban is unconditional and a chat surface is not worth breaking house rules for alignment that `tabular-nums` already buys back. Stat numbers stay in the 26-38px band everywhere I sampled (28px Sends across all three, 38/44px v2b Home masthead — the one place a candidate pushed toward the top of the locked range, still inside it).

## 2. The five must-not-lose decisions

| decision | v2a | v2b | v2c |
|---|---|---|---|
| honest over-cap gauge, hatched overflow, never clamps | survives — `sends-desktop.png` pixel-matches baseline | survives — `sends-desktop.png` pixel-matches baseline | survives — `sends-desktop.png` pixel-matches baseline |
| Today's numbered/ruled/counted zone header | survives verbatim, `today-desktop.png` ("01 URGENT · 0/3 cleared") | **extended**, not just preserved — `home-desktop.png` runs the same primitive across 5 zones (01-05) | survives and generalized into one `SectionHead` component, visible as "03 NEEDS REVIEW" in `content-desktop.png` |
| Today↔Sends tile mirroring | not directly visible in the sampled crop (Today's zone-4 health tile sits below the fold in `today-desktop.png`); brief states TodayScreen composition untouched, so inferred intact, not confirmed | **most legible instance in the panel** — `home-desktop.png` zone 04 "GOVERNOR 99/100" is the identical tile/dot/radius treatment as `sends-desktop.png`'s Governor tile, side by side in the same screenshot | not directly visible in sampled crops; brief claims reuse, not independently confirmed here |
| terse zero-state copy voice | verbatim — "No drafts right now." `drafts-desktop.png` | verbatim — "No drafts right now." `drafts-desktop.png`, "Nothing waiting on you." `ops-desktop.png` | verbatim — "No drafts right now." `drafts-desktop.png` |
| shared tap-feedback rule | not independently verifiable from stills; no evidence of a competing press style in any crop | same | same |

## 3. The desktop question

This is where the three separate. **v2c wins this outright.** `crops/v2c/peers-thread-chat-desktop.png` is the single best-composed 1440px screenshot in the entire tournament, baseline included: rail (200px, real nav with counts) + working list (400px) + a real thread peer + a real Claude peer, all four columns carrying legible content simultaneously, zero dead space, zero ghost copy. `content-desktop.png` and `sends-desktop.png` for v2c hold the same discipline.

**v2b's `home-desktop.png` is the second-best single screen** — a genuine 3-column dashboard where the short column (Campaign Health) is deliberately the one with the most naturally-short content, so nothing strands the way baseline's Today does. This is a real, working answer to aesthetics.md §7.6.

**v2a is the most conservative and it shows.** `content-desktop.png` is well-composed, but `ops-desktop.png` is barely different from `baseline/ops-desktop`'s under-built complaint — three lines of text top-left, ~80% of a 1440×900 canvas still pure black. The freshness stamp was added but nothing was built to use the width.

**The regression that cuts against both v2b and, more mildly, v2a:** `crops/v2b/drafts-desktop.png` and `crops/v2b/settings-desktop.png` are worse-composed than v2a's equivalents — the "Select a conversation" text is gone (A1's letter is fixed, confirmed structurally unreachable per the brief), but nothing replaced it: both screens are a ~200px content band over ~700px of flat black, no cross-link, no encoding, a harder regression than baseline's original ghost pane because Home just proved the candidate *can* fill 1440px and then didn't bother on two more screens. v2a's `drafts-desktop.png` at least earns its width with a real cross-link CTA ("11 posts waiting in the content pipeline"). v2c never has this problem at all — `crops/v2c/drafts-desktop.png` and `settings-desktop.png` keep the Claude peer docked by default, so the second region always carries live, contextual suggestion chips instead of nothing.

## 4. Pixel defects, named

- **`crops/v2c/ops-desktop.png` — the worst single pixel defect in the tournament.** The screen renders "Ops" as a heading **twice**, "Nothing waiting on you." **twice**, and a second DONE·2/BLOCKED·3 row pair overlapping/clipping the first at a different x-offset, with fragments of the first instance visible behind the second. This is either a genuine duplicate-mount bug or a capture caught mid-transition — either way it is what shipped to the panel, and it lands on the direction that otherwise has the strongest desktop story. Must be fixed before this candidate can be judged clean.
- **`crops/v2b/home-desktop.png`, `chat-desktop.png`, `chat-turn-desktop.png` — a recurring orphaned line break.** The Content zone's amber alert box wraps "stuck or errored — past / their time with nothing / published" across three lines at an awkward point, separating "past" from "their time," reading as a parsing error rather than a sentence, in all three crops it appears in (same component, so same bug three times).
- **`baseline/sends-mobile.png`'s `.ov-over-lbl` clip ("103% of ca")**: independently confirmed fixed in `crops/v2a/sends-mobile.png` and `crops/v2c/sends-mobile.png` (full "103% of cap" visible, own line where needed). v2b's sampled mobile shot landed on a non-over-cap day (98/100) so the fix isn't visually confirmable from the crop I have, though the brief documents the same fix and the independent instrument pass reported zero clipped text for all candidates.
- **`crops/v2b/inbox-desktop.png`'s "1359 THREADS LOADED"**: a 44px centered stat filling the empty detail pane before a thread is opened. Better than a bare glyph, but it is still decorative — "threads loaded" is an implementation detail, not something Ivan needs to see, so it reads as filling space rather than using it.

## 5. Radii and header discipline

All three state consolidation to 2-3 card-radius tokens plus 1-2 pill values, down from baseline's 6/3. Visually consistent with that claim across every crop sampled — no outlier radius spotted in any screenshot. All three converge on one `SectionHead`/`.td-zh`-style primitive (numbered or dotted, ruled, counted) and apply it to screens that previously had their own header pattern (Sends' `.ov-h`, Settings' `.grouphdr`) — v2b's is the most visible instance of this unification because Home puts five of them on one screen (`home-desktop.png`). None of the three added a radius or a header pattern; all three subtracted, which is exactly what the ELEVATE mandate asked for.

## Ranking

1. **v2c "workbench"** — the only candidate that actually solves the desktop problem the audit named, not just patches it (`peers-thread-chat-desktop.png`); most disciplined section-header/radius unification; Claude-fills-the-second-region is a genuinely elegant craft answer to the ghost-pane defect. Held back from a clean win by `ops-desktop.png`'s duplicate-render defect, which is real and visible.
2. **v2b "cockpit + command bar"** — `home-desktop.png` is the best single dashboard composition in the set and the clearest, most legible instance of the Today↔Sends tile mirroring surviving. Loses ground for regressing Drafts/Settings/Ops to near-empty canvases worse than what it replaced, plus the repeated orphaned-text bug in the Content alert box.
3. **v2a "chat as shell"** — safest, most fidelity-preserving candidate, real (if modest) fix for Drafts via a cross-link, clean chat surface. Lowest craft ceiling of the three because it declines to solve the desktop question anywhere it didn't have to (Ops stays under-built almost exactly as baseline left it).

## Strongest craft element worth grafting

**v2c's dual-peer desktop layout** (`crops/v2c/peers-thread-chat-desktop.png`, `peers-draft-chat-desktop.png`) — the rail + list + up-to-two-peers model is the only answer in the tournament that makes 1440px look designed on every screen it touches, not just the flagship one. Whoever wins arbitration should graft this shell pattern, or at minimum its "never an empty second region" rule, onto their own nav.

## Worst craft defect that must be fixed whoever wins

**Ops at 1440px is unsolved by all three.** v2a and v2b both ship ~75-85% dead black canvas on `ops-desktop.png` despite adding a freshness stamp; v2c ships an outright duplicate-render bug on the same route. Whichever candidate wins arbitration, Ops needs a real desktop composition — not a stamp bolted onto emptiness, and not a broken screenshot.
