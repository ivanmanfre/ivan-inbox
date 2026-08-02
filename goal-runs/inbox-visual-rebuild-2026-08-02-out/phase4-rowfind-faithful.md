# Blind usability pass — Content lane, wt-faithful captures

Captures reviewed (actual filenames in the directory differ from the requested
band1/band2/band3 pattern — they're named top / mid-lane / deep-lane):
- faithful-content-1440-top.png
- faithful-content-1440-mid-lane.png
- faithful-content-1440-deep-lane.png
- faithful-content-390-top.png
- faithful-content-390-mid-lane.png
- faithful-content-390-deep-lane.png
- faithful-content-1440-mattan-top.png (Mattan lane)

---

## 1. THREE-SECOND TEST — "find the drafts waiting on your review"

**1440 / 390 (top band, first screen, no scrolling):** The strongest tell is a
big bold stat inside the PIPELINE card: **"19" in large type with the caption
"waiting on you / of 130 loaded"** directly beneath the pill chart. This is
plain-language and numeric — a stranger reads two words ("waiting on you"),
not a row. Above it, the pipeline chart itself has one segment rendered as a
**diagonal-hatch/striped pill** (all other stage segments are flat-color:
solid teal for Published, solid gray for Scheduled) — a shape-difference a
stranger would notice before reading its truncated label ("NEEDS ...").

**Once scrolled to the actual row list (mid-lane band):** the row cluster
itself is announced by a **bold section header row: "03 NEEDS REVIEW" with a
count badge "19" and a small orange status dot**, set off by a full-width
rule line above/below it — distinct from the "01 IDEAS" header above and the
stage-chip footer below. Every row under that header additionally carries a
**SKIP / APPROVE button pair**, which is itself a strong non-text "this row
needs action" signal.

Verdict: a stranger does NOT have to read row-by-row. The big "19 / waiting
on you" stat (first screen) plus the "NEEDS REVIEW" header + dot (row list)
triangulate the location without reading any row title.

---

## 2. ERROR-STATE ROW

**1440-deep-lane / 390-deep-lane (Resources section):** Four rows are marked
as errors: "The 4-System Audit framework...", "AI ROI Calculator for
Operations Teams", "Zapier to n8n Migration Guide", "AI ROI Readiness
Scorecard". Each has (a) a **red vertical left-edge border stripe** running
the full row height, and (b) its **"PUBLISHED" tag rendered in a red/orange
outline** instead of the flat gray used on every other PUBLISHED row (e.g.
"Anti-AI-patterns guide", "Claude Client Onboarding Pack" are PUBLISHED in
plain gray). The functional tell: the red rows show "asset ↗" but **"no
landing URL"**, while the normal gray PUBLISHED rows show both "asset ↗" and
"landing ↗". So red border + red tag = published-but-broken-link, matching
the "4 errored" count in the top red banner.

**1440-mid-lane (Ideas/Needs Review):** no error state visible — PASS-score
chips there are neutral, SKIP/APPROVE buttons are the same on every row.

**Mattan lane (1440-mattan-top):** three explicit error rows, each carrying
an amber/orange-outlined tag naming the failure type — **"QA_BLOCKED 62"**,
**"QA_BLOCKED 56"**, **"LINT_FAIL"** — plus a small red dot badge on the
row's leading icon corner. This matches the lane's own banner: "4 · 3
errored · 1 elsewhere."

---

## 3. ANCHOR RAIL (1440)

Every row does start its leading mark at the same x column (~ same left
margin across Ideas / Needs Review / Resources sections), so the eye can
track a straight vertical line down the page. BUT the **mark type changes by
section**, which partially breaks the "one glyph, one meaning" rail:
- Ideas rows → a rounded numeric score badge ("50", "49", "-1"...)
- Needs Review rows → a small checkbox square (occasionally with a small
  orange corner dot)
- Resources rows → the same checkbox square, sometimes containing a small
  image thumbnail when the resource has an asset preview, otherwise blank

So: straight rail in **position** (x is fixed), but not straight in
**meaning** (score badge vs. checkbox vs. thumbnail-in-checkbox) — a
first-time viewer has to re-learn what the leading glyph means each time a
section boundary is crossed. Title text itself does start at a consistent x
regardless of section, which helps.

---

## 4. AT 390 — does the rail hold?

Yes, same discipline as 1440, same caveat. Score-badge → checkbox → checkbox
(sometimes with thumbnail) transition happens in the same order down a
single narrower column (no side panel competing for attention, if anything
this makes the rail read slightly cleaner at 390 than 1440 since there's
only one column to scan). The red left-edge error stripe from the Resources
band is also present and equally legible at 390.

---

## 5. Mattan lane — status without reading sentences?

Yes. Amber/orange-outlined tags spell the failure type in one word/token
("QA_BLOCKED", "LINT_FAIL") rather than requiring the sentence to be read,
and a small red dot sits on each flagged row's leading icon. Combined with
the lane-level red banner count ("3 errored · 1 elsewhere"), a stranger can
tell "something is broken here, three things" without reading any post title.

---

## 6. VERDICT

- **1440 → PASS.** Deciding feature: the big "19 / waiting on you" stat on
  the first screen, confirmed by the bold "NEEDS REVIEW" section header +
  orange dot once scrolled — no row text required.
- **390 → PASS.** Same deciding feature carries over unchanged; the single-
  column mobile layout doesn't hide or demote the header/stat, if anything
  it removes competing peripheral content.
