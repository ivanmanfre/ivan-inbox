# Blind row-find judge — content spine (1440 x3 bands, 390 x3 bands, Mattan lane)

Captures reviewed: spine-content-1440-{top,mid-lane,deep-lane}.png, spine-content-1440-mattan-top.png,
spine-content-390-{top,mid-lane,deep-lane}.png

## 1. THREE-SECOND TEST — "find the drafts waiting on your review"

Nothing on the first-loaded screen (1440-top) points at actual rows — the top of the page is a stats
card ("19 needs review" as one bullet among four, buried in a pipeline progress bar) and an "IDEAS"
section of 60 rows that have nothing to do with review. You'd have to scroll.

Once scrolled to mid-lane, the thing that finally works is the **section header itself**: a bold
numbered label "03 NEEDS REVIEW" with a right-aligned count "19" and a small orange square dot next to
the count. That header is the only non-textual landmark — not a leading mark on the rows, not a color
on the rows. The rows underneath are plain (dash/thumbnail + title + tags) and only become "review rows"
because of the header they sit under, reinforced by SKIP/APPROVE buttons at the far right of each row.
So: locatable, but via a section-header chunking system, not via any mark carried on the row itself. A
stranger would scroll past "IDEAS" reading nothing, hit the bold "NEEDS REVIEW" header, and only then
recognize the SKIP/APPROVE buttons confirm it — call it a 2-jump scan (header, then button column), not
a 1-glance hit.

## 2. ERROR STATE

No individual row is marked as errored in any of the three content bands. The only red is an **aggregate
summary card** at the top ("39 · 4 errored · 35 elsewhere" / on the Mattan lane "4 · 3 errored · 1
elsewhere") — a rolled-up stat, not a locatable row. The closest thing to a flagged row is in the Mattan
lane: one card, "[TEST convergence-apply] ROAS vs cash conversion," carries an **orange-outlined chip**
reading "NEEDS_REGENERATE 71" among otherwise plain gray-outlined tags (TEXT, TRUST, ON BOARD). That's a
caution color on one tag, not a row-level treatment (no row background, no border, no leading icon
changes) — you have to be scanning tag chips specifically to catch it.

## 3. ANCHOR RAIL

Yes, positionally: every row in every section (Ideas, Needs Review, Resources) opens with something at
the same fixed x — a numeric badge in Ideas (70, 68, 67...), a small square avatar/thumbnail/dash
placeholder in Needs Review and Resources. Within one section your eye tracks a straight vertical rail.
But the **mark's meaning changes across sections** — a number in Ideas, a photo/thumbnail/blank dash in
Needs Review and Resources — so the rail is a column alignment, not a single consistent status glyph.
Worse: many rows show a bare "—" placeholder square with no thumbnail at all (rows with no pinned image),
so a chunk of the "rail" is empty box, not signal.

## 4. AT 390 — does the discipline hold?

Partially, and it degrades. The leading square mark still sits at a fixed left x on every row (rail holds
positionally). But every row's content now **wraps across 2–3 stacked lines** — title wraps to 2 lines,
tag chips sit on their own line below, then "Xd ago · no landing URL" on a third line — instead of the
single-line thumbnail|title|tags|date|buttons row at 1440. That turns a down-the-rail scan into a
read-the-whole-card pattern, because the second/third line's start position isn't fixed (it depends on
how long the title wrapped). Practically this also means row height balloons: at matched scroll depths,
the mobile captures (both "mid-lane" and "deep-lane") land inside the RESOURCES section on PENDING/
CHECKLIST rows — the same section, never reaching the NEEDS REVIEW rows I could see at 1440's mid-lane
depth. That's a real finding on its own: at mobile width, the same amount of scrolling gets you much less
further down the list, because wrapped, stacked rows are taller.

## 5. Mattan lane — status without reading sentences?

Partial pass at best. The red error banner and the one orange "NEEDS_REGENERATE" chip are colour-coded
and readable without parsing — those two register on sight. Everything else does not: "PASS 79" vs
"NO QA" sit in visually identical plain gray-outlined chips, so the only way to know whether a card
cleared QA is to read the chip text. "ON BOARD" is stamped on every row in this list (redundant — the
section header "ON MATTAN'S BOARD" already told you that), which is scan clutter rather than signal. The
two paragraphs above the row list (forward-calendar caveat, regen/image_urls caveat) are pure prose —
must be read in full, no scannable shape at all.

## 6. VERDICTS

- **1440: PASS.** Deciding feature — the bold, numbered, count-badged section headers ("03 NEEDS
  REVIEW · 19") chunk 173 rows into named blocks, so you can skip straight to the review block without
  reading unrelated rows, and SKIP/APPROVE buttons confirm the class once there.
- **390: FAIL.** Deciding feature — rows wrap into 2–3 stacked lines with no fixed second/third-line
  position, inflating row height so far that matched scroll depth overshoots the review section entirely;
  you're reading full cards, not scanning a rail.
