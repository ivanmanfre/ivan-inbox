# Blind usability judge — rf2 (Content, exp/v2)

## Task
Locate a draft in "Needs review" that QA has NOT judged yet, from screenshots only, in under 3 seconds.

## Desktop 1440x900 — PASS
Screenshots: rf2-desktop-1440x900-{1-top,2-scroll1vh,3-scroll2vh,4-hover-pass-row}.png

Signal used: each row has a small pill in the same slot (bottom-left, right under the title, before the kind tag TEXT/IMAGE/VIDEO). Judged rows show a green-outlined "PASS NN" pill. Un-judged rows show a plain dash "—" in a neutral dark pill of the same size/position. In the scrolled screenshot (rf2-desktop-1440x900-2-scroll1vh.png), the first 5 rows under "03 NEEDS REVIEW" all show the "—" pill in a contiguous block, immediately readable — no scanning of individual titles required, just scan the pill-color column. Time-to-locate: well under 3 seconds — the dash pills read as a visually distinct cluster against the green PASS pills.

## Mobile 390x844 — PASS
Screenshots: rf2-mobile-390x844-{1-top,2-scroll1vh,3-scroll2vh,4-hover-pass-row}.png

Same signal, same slot, same contrast (dash-in-neutral-pill vs green-outlined PASS-pill), confirmed in rf2-mobile-390x844-2-scroll1vh.png where un-judged and judged rows interleave 1:1 and remain trivially distinguishable at a glance. Time-to-locate: under 3 seconds.

## Hover check: corner indicator vs PASS chip color
Hovered a row with a "PASS 83" chip ("Two-agent AI QA still leaks AI copy..."). Cropped/zoomed the avatar + chip region (see /tmp crops referenced during the run; same region visible in rf2-desktop-1440x900-3-scroll2vh.png and -4-hover-pass-row.png).

Finding: the avatar's bottom-right corner dot and the "PASS" chip's outline/text are the **same color family** — both a teal-green. No clash. They read as one coherent "healthy/in-flight + passed QA" signal rather than two competing color codes.

## Overall
Desktop: PASS
Mobile: PASS
Corner indicator vs PASS chip: same color family (teal-green), no clash.
