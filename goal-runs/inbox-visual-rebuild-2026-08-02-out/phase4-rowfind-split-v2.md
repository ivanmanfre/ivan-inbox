# Phase 4 — Row-Find Judge (blind, split captures v2)

Captures: `final2/wt-split/` — 1440 {top, mid-lane, deep-lane, mattan-top} + 390 {top, mid-lane, deep-lane, mattan-top}. Pixel-cropped to verify (no guessing from thumbnails): 1440 PNGs are 2880×1800 (2x), 390 PNGs are 780×1688 (2x).

## 1. Three-second test — "find the drafts waiting on your review"

Two candidate cues, not one:
- Page-level orientation: a large bold **"19 / waiting on you / of 190 in flight"** numeral tile sits near the top of the Content view (both Ivan and, differently, Mattan's lane). It tells you the count exists in under a second, but it does not help you find the individual rows — it's a dashboard tile, not a locator.
- Row-level locator: every row inside the "NEEDS REVIEW" section — and only those rows — carries a **paired SKIP / APPROVE pill-button pair** on the right edge. No row in the Ideas or Resources bands has any button at all. That button-pair silhouette (two adjacent rounded rectangles) is the one shape that is unique to review-pending rows and is recognizable without reading either the buttons' own labels or the row title.

Verdict: the deciding visual element is **the SKIP/APPROVE button pair** — it is the only row furniture exclusive to this state. The "19 waiting on you" tile is a good count-orienter but not a row-finder.

## 2. Error/failing/urgent row

Not present as an actual row on Ivan's three bands (top/mid/deep) at 1440 — the only failing/urgent signal there is a **global stat card**, red-outlined, reading "39 · 4 errored · 35 elsewhere," which pops by color alone but is a summary tile, not a content row.

A genuine failing **row** is visible in Mattan's lane at 1440 (`split-content-1440-mattan-top.png`): `[TEST convergence-apply] ROAS vs cash conversion`, badged **NEEDS_REGENERATE 71** in solid amber/orange — and pixel-verified, its thumbnail corner carries a matching **amber dot**, distinct from the green (pass) and gray (no-QA) dots on every neighboring row. This is spottable by color alone, no reading required — it's the only non-green/non-gray dot in the visible set.

At 390, this same row scrolled out of the captured viewport for `mattan-top` — no failing row was visible on mobile in what was captured, only the same red summary card.

## 3. Anchor rail

Pixel-cropped the left margin across all three 1440 bands (Ideas / Needs-Review / Resources) at identical x-range. Result: **the rail is straight** — every row's anchor glyph (score badge in Ideas, avatar/thumbnail in Needs Review and Resources) starts at the same x and is roughly the same footprint (~64px square). No zigzag.

However the *kind* of anchor changes by band: Ideas rows anchor on a **numeric score chip** (e.g. "70"), Needs-Review/Resources rows anchor on a **photo avatar or document thumbnail**. Same x, same size, different semantic object — a rail that's straight but not uniform in meaning across bands.

Empty/placeholder anchor slots: yes — several rows (e.g. "$224k/mo on referrals," "The Story-First Brief," "Founder video: why I cut my posting in half") show a flat gray square with a generic document glyph instead of a real photo/cover — a fallback icon, not a truly blank void, but visually it reads as an empty slot next to rows that do have real images.

## 4. 390 — row shape (all three bands + mattan-top)

Pixel-cropped `390-mid-lane`: rows hold a **tight, consistent shape** — one truncated title line (ellipsis, never wraps to 2 lines in the sample), one meta line (QA/pass chip + tag + timestamp), buttons fixed top-right. Row height is uniform down the list. Same pattern confirmed in `390-deep-lane`, `390-top`, and `390-mattan-top`. No inflation/wrapping observed — titles clip hard rather than reflowing, so the rail scans as a rail, not a stack of variable-height cards.

## 5. Mattan lane — QA-pass vs no-QA vs failing, without reading chip text

Pixel-verified via crop (`mattan-thumbs.png`): the thumbnail carries a small corner dot that is color-coded independent of the chip text:
- **Green dot** = QA pass (matches PASS NN chip)
- **Gray dot** = no QA (matches NO QA chip)
- **Amber/orange dot** = failing / needs regenerate (matches NEEDS_REGENERATE NN chip)

This holds at both 1440 and 390 (dot stays a legible ~10-14px filled circle at mobile scale, not shrunk into illegibility). It is a genuine non-text differentiator — confirmed by direct pixel crop, not inferred from chip color.

## 6. Verdict per width

- **1440 — PASS.** A described row class (e.g. "needs-review rows," or "the one failing row on Mattan's board") is locatable in ~3 seconds without reading every row. Deciding feature: the SKIP/APPROVE button pair (unique row furniture) combined with the three-color QA dot on the thumbnail corner (green/gray/amber), both pixel-confirmed.
- **390 — PASS**, same deciding feature — the button pair and QA dot survive the width squeeze intact and rows don't inflate/wrap, so the rail stays scannable. Caveat: the one failing/urgent row exercised in this test scrolled out of the captured 390 mattan viewport, so "find the failing row" specifically would require an extra scroll on mobile that 1440 doesn't need.

---

**Final verdict (≤5 lines):**
1440: PASS — SKIP/APPROVE button pair + 3-color QA dot (green/gray/amber, pixel-confirmed) let you locate needs-review and failing rows in ~3s without reading.
390: PASS with a caveat — same two cues survive the width squeeze and rows don't wrap/inflate, but the one failing row in this test scrolled out of the captured mobile viewport, so mobile row-finding costs an extra scroll 1440 doesn't.
