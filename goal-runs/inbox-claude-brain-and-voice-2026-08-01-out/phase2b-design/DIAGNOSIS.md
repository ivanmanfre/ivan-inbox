# Phase 2B — the "meh" diagnosis (orchestrator seat, from the prior run's own artifacts)

**Hypothesis under test** (from the mission): the prior tournament varied *composition* across its three candidates but all three inherited an identical visual treatment, so it produced three layouts of one look; its winning brief was written in ELEVATE mode with the existing canon as a hard floor; craft-fidelity was scored, ambition was not.

**Verdict: CONFIRMED, on the prior run's own documents.** Four independent pieces of evidence:

1. **The contract outlawed a new look before any candidate was dispatched.** `phase2-tournament/CONTRACT.md:5-7`: "Mode: ELEVATE, not replace. The current app's visual language is the **floor**. You are competing on hierarchy, density, composition and flow *within* that canon. Any candidate that invents a new aesthetic **loses on craft-fidelity before it is scored**." The lock list (`CONTRACT.md:9-16`) freezes not just the brand accent but the whole material system: exact surface tokens, system font, glyph icons, no new radii ("Do not add a 7th"), motion capped at the existing 6 keyframes plus at most 2. Everything Ivan could perceive as "look" was contractually immutable; only layout could vary.

2. **The judges verified sameness and rewarded it.** `judge-craft.md:12`: all three candidates "reproduce 28% / 103/100 / 5d identically to `baseline/sends-desktop.png`, meaning `OverviewView` was consumed, not rebuilt". `judge-craft.md:43`: "None of the three added a radius or a header pattern; all three subtracted, **which is exactly what the ELEVATE mandate asked for**." Sameness-with-baseline was scored as the top craft virtue.

3. **Every scored dimension was compositional.** The craft seat's five must-not-lose decisions (`judge-craft.md:14-22`) are all preservation checks; the desktop question (`:24-32`) is column arithmetic and dead-space accounting; `DIRECTOR-NOTES.md` evaluates region counts, stranded columns, doubled headers. No seat asked "is this distinctive", "does this look like Ivan's brand rather than a generic dark dashboard", or "would a top studio ship this". No external reference appears anywhere in the tournament corpus.

4. **The one brand-fidelity trap in canon was never run.** The standing trap "tokens are not a brand" (memory, `scan-embed-resemble-site-2026-07-23`) predicts exactly this outcome: a surface can satisfy every hex value and still read as generic. The tournament checked tokens (`judge-craft.md:10-12`) and never once looked at the live `ivanmanfredi.com` to ask what the brand *feels* like. The result is three token-perfect layouts of the same anonymous dark-mode utility look — which is what "pretty meh" describes.

**Consequence for this phase:** the failure is not in any candidate; it is in the contract. So this phase inverts the contract: structure (v2c workbench + grafts) is now the *locked floor*, and the visual treatment — type scale and contrast, spatial rhythm and density, depth/material (elevation, borders, shadow, translucency), motion beyond the 6+2 budget, data-viz treatment, accent deployment, empty-state character — is the *competitive dimension*. Brand stays locked only at: one accent `#10A37F`, 3-tier severity, system font stack, no monospace outside code blocks, no new npm dependency.

**What "meh" is, made falsifiable:** the shipped surface is indistinguishable from a default dark-theme admin template with a green accent. The test for any new direction: put a 390px crop next to `ivanmanfredi.com` and next to a generic template — a stranger should bin it with the former.

## Addendum — what the brand actually feels like (live capture, 2026-08-01)

Captured `ivanmanfredi.com` at 1440 and 390 into `brand-refs/` (site-desktop-top/mid, site-mobile-top/mid). What the live site is made of, none of which the inbox app has:

- **Warm paper ground, not black.** Cream/off-white field with a faint grid-paper texture. The app's `--bg:#000` is a token choice the brand never made on its flagship surface.
- **Editorial serif display at extreme scale** ("Add $15k-$50k/mo of new pipeline"), with *italic serif* emphasis reversed out of solid ink-black blocks ("in 90 days."). Memory canon agrees: editorial italic serif numerals are a standing brand preference (`feedback-editorial-numerals`).
- **The green is a highlighter, not a status color.** On the site, the brand green appears as a hand-swiped highlight *behind* the key number — an annotation gesture. In the app it is only ever a status dot/button fill. Same-ish hue, entirely different deployment; this is the clearest instance of "tokens are not a brand".
- **Mono-spaced small-caps eyebrows** for labels ("FOR AGENCY OWNERS") — a typewriter/annotation register. (App constraint keeps monospace out of body UI, but the *small-caps letter-spaced eyebrow* register is portable without monospace.)
- **Ink-block CTAs** — solid black rectangles with serif text, not rounded green pills.

Implication for the 3 treatment directions: at least one direction must test the paper-editorial register honestly (the app already has a working `data-theme='light'` hook), and the accent-deployment question (status color vs highlighter gesture) is a real axis to vary. `ui-serif`/Georgia is reachable *within* the locked system font stack without any webfont — whether display serif belongs in a working tool at all is exactly the kind of taste call the ballot exists for.
