# Phase 2B visual-treatment tournament — contract (written before any builder is dispatched)

## Premise, inverted from the last tournament

The prior contract locked the *look* and competed on *layout* (see `DIAGNOSIS.md` — confirmed). This one locks the **structure** and competes on **look and feel**. Every candidate ships the same screens, same nav model (v2c workbench: rail → working list → context peers), same information architecture (Phase 1B's lane-separated content section included), same data. What varies is the visual treatment.

## Locked (DQ if violated)

- Structure: the v2c workbench shell + the Phase 1B content IA. No nav restructuring, no screen additions/removals, no re-ordering of content within a screen beyond what the treatment's type scale forces.
- One accent hue: `#10A37F`. (How it is *deployed* is open — status color, primary-action color, highlighter gesture — but no second accent hue and no hue shift.)
- 3-tier severity: `#10A37F` clear / `#FF9F0A` attention / `#FF453A` urgent. (Their rendering may restyle; their meaning and count may not.)
- System font stack only, no webfont, no `@font-face`, no new npm dependency. **Explicit sanction:** `ui-serif` / `Georgia` / `'New York'` counts as system stack (it ships with the OS, zero bytes downloaded). A direction may use it for display numerals/headlines. The judges and ballot see this reasoning; Ivan can veto it there.
- No monospace outside code blocks (chat code blocks exempt, as today).
- WCAG AA contrast for body text in the direction's PRIMARY theme; the secondary `data-theme` must remain functional and legible (no invisible text), though it may be visibly less polished.
- All existing tests stay green; lint clean; zero console errors; zero horizontal overflow at 390px (sweep.mjs gates).
- 🔴 **Brand-canon, ABSOLUTE (amended 2026-08-01 after Ivan rejected a direction that violated it):** the warm-paper editorial identity — paper ground, editorial/DM serif display, sage, italic register — is RETIRED and is available on **no** surface. See `~/.claude/memory/global/brand-visual-system.md`. Do not propose it; do not port it from the marketing site; screenshotting `ivanmanfredi.com` is not a licence, because the site is not the product. The original wording of this line reasoned that the retirement was scoped to "content assets and client deliverables" and therefore a paper direction was legal here. **That reasoning was wrong and produced the rejected direction.** Accent stays `#10A37F`; italic near-zero; zero em dashes anywhere in UI copy.

## Open for the first time (the competitive dimensions)

Type scale + contrast ratios · spatial rhythm + density · depth/material (surface elevation, borders, shadow, translucency) · motion beyond the 6+2 keyframe budget (with a motion contract: ONE easing token, 150-250ms, transform/opacity only) · data-viz treatment · accent deployment · empty/idle-state character of every surface.

**Anti-re-skin rule** (from design-elevation skill, hard-learned): a token swap alone is a DQ. Each direction must change, at minimum: the type scale (real hierarchy jumps, not ±2px), the section-header treatment, the table/row treatment on the content lanes, and the empty-state character. Layout (columns, nav, screen inventory) stays fixed; *hierarchy within a screen* is treatment territory.

## The directions (briefs in `brief-{inkline,instrument}.md`)

| id | thesis | ground | register |
|---|---|---|---|
| `inkline` | **Ink & Signal** — the dark app, but *branded*: editorial spine on layered dark material | layered dark | serif display numerals on stats, small-caps eyebrows, accent as signal+sweep |
| `instrument` | **Instrument** — quiet precision-tool austerity, Linear/Geist grade | cool neutral light | tabular-nums, hairlines, rationed accent, depth by elevation |

Two grounds (dark / cool-light), two accent deployments, two type registers — differing in look, not layout.

## External references — fetched, never recalled

Each builder must actually FETCH (WebFetch/curl/playwright screenshot) at least 2 of its brief's named references during the build and cite what specific move it took from each, with the URL and retrieval evidence in its brief file. Recalled-from-memory references score zero.

## Measurement + judging

- Each candidate: full sweep at 390×852 and 1440×900 of every surface (today, inbox+thread, drafts, content-Ivan-lane, content-Mattan-lane, draft detail, sends, ops, settings, chat), via `scripts/sweep.mjs`. Crops into `phase2b-design/crops/<id>/`.
- Gates (instruments, DQ-only per design-elevation tournament rule): zero overflow, zero console errors, tests+lint green, contrast AA on primary theme, no new dependency, no webfont download, accent-hue grep (no second accent hex introduced).
- Judge panel, calibrated on controls BEFORE voting (controls: prior run's `baseline/sends-desktop.png` = known-competent-but-meh; `brand-refs/site-desktop-top.png` = known-branded; a generic admin-template screenshot fetched live = known-generic). Seats:
  1. **Brand-fidelity seat** — does the crop bin with `ivanmanfredi.com` or with the generic template? (the falsifiable "meh" test from DIAGNOSIS.md)
  2. **Craft seat** — type scale discipline, material consistency, severity legibility, density on the content lanes (the densest surfaces are the test)
  3. **Top-studio seat** — "would a top studio ship this", scored against the FETCHED external references, cited by URL
  4. **Felt-difference seat** — calibrated on a known-too-subtle control: candidate crop vs the CURRENT shipped look; if a stranger can't tell them apart in 3 seconds, score zero (kills the re-skin failure mode)
- Rounds: max 2. If round 2 scores worse than round 1, lock round 1 as baseline and stop (no round 3).
- **No autonomous convergence.** The phase ends with finalists staged on the Phase 6 ballot, rendered at both viewports beside the current "meh" state. The panel produces a recommendation and named grafts, never a shipped winner.

## Build mechanics

- Base: branch `exp/brain` (includes the Phase 1B content-surface structural build, which lands before treatment builders dispatch).
- Each builder: own git worktree, own branch `exp/brain-2b-<id>`, treatment applied via the existing token/styles layer plus scoped component styling. Commits stay on the candidate branch.
- Builders are BLIND to each other (no reading sibling worktrees).
- Voice/chat/broker code is out of bounds for treatment builders (styling of chat surface chrome is in; transport logic is out).
