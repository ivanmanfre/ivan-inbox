# FINAL2 evidence capture — inbox-visual-rebuild-2026-08-02 (Content re-capture only)

Both `wt-spine` and `wt-split` took fix commits that changed their Content surface after the
`final/` round (see `../final/CAPTURE-LOG.md`, HEADs `534fd25` and `bf9be2f` respectively). This is
a Content-only re-capture so blind judges can re-verify against the current state. `wt-faithful` is
untouched since `final/` and is NOT re-captured here.

Independent instrument. Script: `final2-capture.mjs` (scratchpad root), adapted from the proven
`final-capture.mjs` — same wait discipline, does not import or execute any candidate's own
`scripts/*.mjs`. Dark theme throughout (no `inbox-theme=light` override, so the no-attribute default
applies), `deviceScaleFactor: 2`. Wait discipline: `domcontentloaded` → zero `.sk` skeleton elements
→ no literal "Loading" substring in `document.body.innerText` → innerText stable across two reads
≥1s apart (`waitSettled`), **plus** an additional `resettle()` immediately before every band's
screenshot (carried over from the `final` round's finding of late-arriving Supabase data between
bands). **NEVER `networkidle`** (the app holds an open realtime WS).

Scroll target: NOT document/html/body (`.wb-work{overflow:hidden}` clips them) — the real scroller
is the largest-delta `overflowY:auto|scroll` descendant under `.wb`, confirmed to be `.rows.ct-rows`
on both candidates via `scrollInfo` in each report JSON. Real movement (not identical-frame padding)
verified below.

"Mattan lane" is a tab switched by clicking the `.chip` labelled "Mattan Danino" — not a stacked
scroll section. This round adds the 390×844 Mattan-top band (the `final` round only shot it at
1440×900), per this task's explicit instruction.

## HEAD commits verified before capture

| candidate | worktree | port | HEAD (expected) | HEAD (verified) | tree | commit time |
|---|---|---|---|---|---|---|
| spine | `wt-spine` | 5442 | `c16f184` | `c16f184` (match) | clean (untracked `crops/` only, ignored) | 2026-08-02 17:17:47 +02:00 |
| split | `wt-split` | 5443 | `9d7441e` | `9d7441e` (match) | clean (6 untracked `scripts/gate-*.mjs`, ignored) | 2026-08-02 17:25:45 +02:00 |

HEADs re-verified again after both captures completed (both servers killed, working tree
unmodified) — no drift during the run.

## Session provenance

Both worktrees already had an unexpired `.session.json` (same Supabase user `im@ivanmanfredi.com`,
project `bjbvqvzbzczjbatgmccb`) with JWT `exp` comfortably in the future at time of use (spine
~34 min remaining, split ~35 min remaining, checked before the run). Per instruction ("reuse an
existing `.session.json` whose JWT exp is in the future — spine's worked recently"), reused both
directly rather than re-running `dev-login.mjs` (which is known to hang on this network per the
`final` round's log). Both candidates used their OWN worktree's session this time (unlike `final`,
where split had to fall back to spine's).

## Console error classification

`src/`-originated (fails): any console/pageerror message matching `/\/src\//` or a `.tsx?` module
path. Allowed exception: any message matching `inbox-claude` **and** one of `cors|access-control|
failed to fetch|network error` (the unarmed AI-brain endpoint's known, expected CORS pair).
Everything else counts as "other" (fails). **Result: 0/0/0 (src / allowed-CORS / other) across all
16 captures, both candidates** — no console or page errors observed.

## Evidence table (16 captures = 8 × 2 candidates)

| candidate | viewport | band | file | bytes | innerText len | skeletons | settled | console (src/cors/other) |
|---|---|---|---|---|---|---|---|---|
| spine | 1440x900 | top-ivan-lane | spine-content-1440-top.png | 363595 | 27290 | 0 | true | 0/0/0 |
| spine | 1440x900 | mid-ivan-lane | spine-content-1440-mid-lane.png | 470707 | 27290 | 0 | true | 0/0/0 |
| spine | 1440x900 | deep-ivan-lane | spine-content-1440-deep-lane.png | 460798 | 27290 | 0 | true | 0/0/0 |
| spine | 1440x900 | top-mattan-lane | spine-content-1440-mattan-top.png | 399627 | 7752 | 0 | true | 0/0/0 |
| spine | 390x844 | top-ivan-lane | spine-content-390-top.png | 159870 | 26911 | 0 | true | 0/0/0 |
| spine | 390x844 | mid-ivan-lane | spine-content-390-mid-lane.png | 203420 | 26911 | 0 | true | 0/0/0 |
| spine | 390x844 | deep-ivan-lane | spine-content-390-deep-lane.png | 225465 | 26911 | 0 | true | 0/0/0 |
| spine | 390x844 | top-mattan-lane | spine-content-390-mattan-top.png | 186729 | 7373 | 0 | true | 0/0/0 |
| split | 1440x900 | top-ivan-lane | split-content-1440-top.png | 434138 | 27051 | 0 | true | 0/0/0 |
| split | 1440x900 | mid-ivan-lane | split-content-1440-mid-lane.png | 540147 | 27051 | 0 | true | 0/0/0 |
| split | 1440x900 | deep-ivan-lane | split-content-1440-deep-lane.png | 529791 | 27051 | 0 | true | 0/0/0 |
| split | 1440x900 | top-mattan-lane | split-content-1440-mattan-top.png | 453554 | 9269 | 0 | true | 0/0/0 |
| split | 390x844 | top-ivan-lane | split-content-390-top.png | 186808 | 25339 | 0 | true | 0/0/0 |
| split | 390x844 | mid-ivan-lane | split-content-390-mid-lane.png | 242450 | 25339 | 0 | true | 0/0/0 |
| split | 390x844 | deep-ivan-lane | split-content-390-deep-lane.png | 225203 | 25339 | 0 | true | 0/0/0 |
| split | 390x844 | top-mattan-lane | split-content-390-mattan-top.png | 198482 | 8849 | 0 | true | 0/0/0 |

## Scroll evidence (proof of real movement, not identical-frame padding)

| candidate | viewport | mid scrollTop / (scrollHeight−clientHeight) | deep scrollTop / (scrollHeight−clientHeight) |
|---|---|---|---|
| spine | 1440x900 | 4738 / 13538 | 9477 / 13538 |
| spine | 390x844 | 4927 / 14076 | 9853 / 14076 |
| split | 1440x900 | 3956 / 11302 | 7911 / 11302 |
| split | 390x844 | 4336 / 12388 | 8672 / 12388 |

All four via `.rows.ct-rows` (`getComputedStyle(el).overflowY` = `auto`, largest scrollHeight−
clientHeight delta under `.wb`), confirmed by class name in `scrollInfo`. innerText is IDENTICAL
across top/mid/deep on the Ivan lane at each viewport (confirming the visible rows are a scroll of
the SAME list, not a route change) while the Mattan-lane top band's innerText differs sharply
(7.3k–9.3k vs 25k–27k chars) — the two lanes are genuinely different data, consistent with the
`final` round's finding #4.

## Server discipline

Each candidate's dev server was started fresh on its assigned port (spine 5442, split 5443 — never
5432), HTTP 200 verified before capture, HEAD re-verified, then killed immediately after that
candidate's 8 captures completed and before the next candidate's server started. No two servers
were ever running concurrently.

## Full detail

Per-candidate raw reports (console message text, per-band `scrollInfo`, full classification) are in
`wt-spine/spine-final2-report.json` and `wt-split/split-final2-report.json` alongside their 8 PNGs
each.
