# Blind row-find verdict — #exp/v2/content, "Needs review" + failing QA verdict

Screenshots: rowfind-desktop-1440x900-{1-top,2-scroll1vh,3-scroll2vh}.png,
rowfind-mobile-390x844-{1-top,2-scroll1vh,3-scroll2vh}.png

## Setup note (mechanics, not judgment)
`page.goto()` to a URL differing only by the `#` fragment from the current URL is a
same-document navigation in Chromium — no reload fires, so the app's mount-time
`getSession()` never re-ran against the freshly-injected token and the login screen
stuck. Fixed by setting `location.hash` then calling `page.reload()`. Noting this
so it's clear the FAIL below is about the UI, not a broken harness.

## Desktop 1440×900 — FAIL
Across all 19 rows in the "Needs review" section (visible across the top screenshot
and both scroll screenshots — full section, next stage "05 Scheduled" appears at the
bottom of scroll 2), every QA-verdict badge is one of two things:
- a blue-outlined pill reading "PASS <number>" (79, 82, 88, 64, 83, …), or
- a plain gray dash "—" with no label at all.

There is no badge anywhere in the section that reads anything like NEEDS_REGENERATE,
REWRITE_OK, FAIL, or any other named failing verdict. I cannot tell, from pixels
alone, whether the dash means "QA hasn't run yet" or "QA ran and failed." Nothing
distinguishes those two states — no red/orange color, no icon, no label swap. If a
failing-verdict row exists on this screen, it is visually indistinguishable from an
ungraded one, so I could not find it inside 3 seconds (or at all).

## Mobile 390×844 — FAIL
Same result. Scrolling through all 19 rows (top view has no rows visible — pipeline
stats only — then both scroll captures cover the full "Needs review" list down to
"05 SCHEDULED — 2"), the only badges present are "PASS NN" pills and bare dashes.
No distinct failing-verdict marking exists at this viewport either.

## 3(a) — count waiting for review
19. Read from three redundant places that all agree: the "Content" tab badge at the
top of the list panel ("Content  19"), the pipeline card's blue "REVIEW" bar (labeled
"19"), and the plain-text line "19 waiting on you of 130 loaded" directly under the
pipeline bars. The stage-section header itself also reads "03  NEEDS REVIEW — 19 🟠".

## 3(b) — control to see only Published
The filter chip row directly under the search box, first item, reads "Stage:" in
dim gray followed by "Any" in bold white with a small down-chevron — a dark rounded
pill roughly 90px wide sitting at the left edge of that filter row. Opening it and
picking "Published" would isolate published drafts. (Secondary candidate: the
collapsed "06  PUBLISHED — 109 ›" stage-section row lower in the list — but that
reads more like an expand/collapse toggle for one section among several stacked
sections, not a "show only this" filter, so the Stage dropdown is the cleaner
single-control answer.)

## Most confusing things on this screen
1. **Dash vs. failing verdict — no visual distinction.** This is the core problem
   above: "not graded yet" and "graded and failed" render identically as a plain
   "—". A verdict system that can fail needs a mark that says so.
2. **PASS badges all look equally confident.** "PASS 64" and "PASS 88" use the
   identical blue-outline pill with no color gradient or threshold cue — a
   borderline pass reads exactly as strong as a comfortable one at a glance.
3. **Content-type tags and QA-verdict badges share one pill style.** "PASS 82",
   "TEXT", "IMAGE", "VIDEO" all sit in a row of visually identical gray/blue chips
   next to each row — at a fast glance they blend into one undifferentiated cluster
   rather than QA-signal vs. metadata being visually separated.
