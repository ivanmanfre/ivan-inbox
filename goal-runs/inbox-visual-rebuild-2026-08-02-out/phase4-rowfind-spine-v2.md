# Blind Row-Find Pass — Content Spine v2 (1440 + 390)

Captures reviewed: `spine-content-{1440,390}-{top,mid-lane,deep-lane,mattan-top}.png`

## 1. Three-second test — "find the drafts waiting on your review"

Two elements do this, neither requires reading title text:
- The section header itself: `03 NEEDS REVIEW` in bold caps, with the count (`19`) followed by a small **orange filled square** dot sitting right next to the number. That dot is the only colored status mark in the whole header rail, so it pops out of an otherwise monochrome list of section headers.
- Underneath it, every row in that block repeats a **solid white-filled "APPROVE" pill** next to an outline-only "SKIP" pill. The filled button is the one repeating shape that differs from every other row type in the document (Ideas rows have no buttons at all, Resources rows have no buttons at all). Scanning down the page, the solid-fill button band is what visually delineates "these rows want a decision from me."

Weaker secondary cue: the sidebar `Content 19` pill and the pipeline widget's brighter-white segment in the otherwise grey progress bar — both correct but neither is a "look at the row" cue, they're page-chrome.

## 2. Error/failing row in visible area

Two instances found, both in the **deep (Resources) lane**, not the Ideas/needs-review lanes:
- 5 rows (`4-System Audit framework`, `AI ROI Calculator`, `Zapier to n8n Migration Guide`, `AI ROI Readiness Scorecard`, `Workflow Audit Checklist`) show a `PUBLISHED` chip wrapped in a **thin red 1px border**, paired with plain grey `no landing URL` text next to it — versus the first row (`Claude Client Onboarding Pack`) whose `PUBLISHED` chip has a normal grey border and shows `asset ↗ landing ↗` links instead.
- In the Mattan needs-review band, one row (`[TEST convergence-apply] ROAS vs cash conversion`) carries an **orange-bordered** `NEEDS_REGENERATE 71` chip, distinct from the grey-bordered `PASS`/`NO QA` chips on neighboring rows.

Could you spot it without reading? Marginally — yes, in the sense that a 1px red or orange stroke breaks the pattern of grey chip borders, but it is a subtle, thin-line signal on a small chip, not a bold fill or icon. It's catchable on a slow scan, not a true peripheral-vision catch. (The big aggregate `39 · 4 errored · 35 elsewhere` and `4 · 3 errored · 1 elsewhere` red-outlined banners at page top are unmissable, but those are page-level summaries, not row markers.)

## 3. Anchor rail

Straight, not zigzag. Every row sampled across Ideas, Needs Review, Resources, and the Mattan board all start their leftmost mark (initials square, avatar photo, or thumbnail image) at the same x position — the content column's left margin (~322px at 1440). This holds across all four bands and both lanes.

No empty anchor slots were visible in any of the captured rows — every row had a populated avatar/thumbnail, none were blank placeholders.

## 4. At 390 — do rows hold a tight two-line shape?

No — they inflate. At 1440 a needs-review row is effectively two visual lines (title+timestamp, then chips+buttons sharing a line). At 390 that same row becomes **three stacked lines**: title+timestamp, then a chip row, then a full-width `SKIP` / `APPROVE` button pair on its own line. That's a genuine card, not a scannable rail line.

Worse, in the 390 Resources (deep) band the status chip text is **clipped mid-word** — `PUBLISHED` renders as `PUBLIS` before the label is cut off, rather than wrapping or shrinking gracefully. That's a rendering defect, not just a density trade-off: you can't even trust the chip label is intact, so you're forced to tap/expand rather than scan.

## 5. Mattan lane — QA-pass vs no-QA/failing, without reading

Cannot reliably tell at either width. `PASS 82` and `NO QA` chips use identical grey neutral styling — same border color, same size. The only differentiator is a tiny icon glyph inside the chip (a filled vs. a hollow square, roughly 6-8px), which is far below the threshold of a glance-scan and effectively requires reading the glyph up close, which defeats the point.

The one row state that IS visually distinct is `NEEDS_REGENERATE` (orange border) — but that's a third category (regeneration needed), not a QA pass/fail signal, so it doesn't answer the QA-pass-vs-no-QA question; it just proves color-coding exists for at least one status and wasn't extended to the QA chips.

## 6. Verdict

**1440 — PASS.** Deciding feature: the straight left-aligned avatar/thumbnail rail plus the repeating solid-fill APPROVE button gives a describable row class ("needs-review rows") a locatable visual signature in under 3 seconds, without reading titles.

**390 — FAIL.** Deciding feature: rows inflate from a 2-line rail entry into a 3-line stacked card (title / chips / full-width buttons), and the Resources band clips status-chip text mid-word (`PUBLIS`) — the rail breaks down into cards you must read individually rather than scan.
