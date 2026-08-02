# Baseline capture log — inbox-visual-rebuild-2026-08-02

Instrument run for the "current state" column of the final ballot and the known-BAD calibration
anchor for the judge panel (Ivan rejected this look on sight). Branch `exp/brain`, `src/` untouched.

## Session / server

- Session minted via `node scripts/dev-login.mjs` at **2026-08-02 00:19:55 CEST**, user `im@ivanmanfredi.com`,
  `expires_at` = 2026-08-02 01:19:55 CEST (60 min). All 39 captures completed well inside that window
  (two full sweeps run back-to-back, ~2 min each).
- Dev server: `npm run dev -- --port 5420` (Vite, confirmed 200 on `/` before capture).
- Capture script: `.baseline-capture.mjs` (ad-hoc, repo root, deleted after this run — not committed).
  Readiness logic ported from `git show exp/brain-2b-instrument:scripts/sweep-instrument.mjs`:
  `domcontentloaded` → poll until `.sk` (skeleton) count is 0 AND `.wb-sync-t` rail stamp (if present)
  does not read "not loaded" AND a terminal-render selector matches
  (`.ct-card, .rows .r, .td-r, .ov-tile, .log-r, .sw, .wb-empty, .wb-failed, .wb-starter, .qc`) →
  settle 2600ms. `networkidle` never used (open Supabase realtime WebSocket holds it forever — confirmed
  the trap note from the mission brief).
- Session injected into `localStorage['sb-bjbvqvzbzczjbatgmccb-auth-token']` via `page.addInitScript`,
  same key/pattern as `scripts/shot.mjs` / `scripts/sweep-v2c.mjs`.
- Dark theme is the app default (no `light` key set in `localStorage['inbox-theme']`) — no override needed.
- Viewports: mobile 390×844, desktop 1440×900, `deviceScaleFactor: 2` on both.

## Finding worth flagging: one mid-flight capture, fixed and re-shot

First sweep's `today/desktop` capture passed the generic terminal-render + skeleton-clear gate (the
chat panel's starter prompts render immediately and satisfied `.wb-starter`) but caught the **Today**
screen's slower `full` brief fetch still in flight: zones 01 (Urgent) and 03 (Today) showed literal
"Loading the brief…" text while the masthead already had numbers from a faster `counts`-mode fetch
(`src/lib/today.ts`, `src/screens/TodayScreen.tsx:166,271,352`). Word count (179) was still above the
50-word floor, so the automatic re-capture trigger did not fire on that check alone.

Fix: added a second readiness gate — poll up to 20s more for `document.body.innerText` to stop
containing "Loading the brief" — plus a `stuckLoading` flag recorded per capture. Re-ran the full sweep;
`today/desktop` went from 179→648 words and 2→3 bands, `stuckLoading=false`, confirmed by re-inspection
(real rows: Nour Siakir Oglou / Ed Hatfield / Gabriel Amarazeanu in Urgent, DM/Comment/Feed draft rows in
Approve). `today/mobile` was already clean on the first sweep (fully resolved brief, no re-capture
needed) — the race is timing-dependent per fresh page load, not route-dependent. All 12 route×viewport
captures in the table below are from the **second, fixed sweep**.

## Other notes

- `drafts` is genuinely thin right now (real data, not a failed capture): "All · 1" in both viewports —
  the DM-draft queue holds exactly one item at capture time. Word counts (111 mobile / 178 desktop) are
  low but both clear the 50-word floor and both show a fully rendered queue with a real row, not a
  skeleton or an empty-queue placeholder.
- Zero console errors on every one of the 12 page loads (no CORS noise from `inbox-claude` either — the
  chat panel renders idle starter prompts on mount and never calls the broker until a message is sent, so
  there was nothing to fire that expected-noise class this run).
- Zero skeleton elements (`.sk`) present at any capture time.
- No horizontal/vertical band exceeded the 5-band cap; `drafts` (both viewports) and `today` (both,
  3 bands) were the shortest surfaces, `content` and `inbox` (both viewports) hit the 5-band cap — both
  are the app's densest surfaces per `phase0-surfaces.md` (285 carousel_drafts / 2,154 inbox_messages_v).

## Capture table

All bytes are PNG file size. innerText word count / char length are measured once per page load (constant
across bands — this app scrolls inner containers, not the document, so scrolling does not change what's
in the DOM). Skeleton count and console errors are likewise page-level, recorded at the moment band 1 was
shot (post fully-ready wait).

| route | viewport | band | file | bytes | innerText words | innerText chars | skeletons | console errors | stuckLoading |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| today | mobile | 1 | today-mobile-band1.png | 171,009 | 581 | 3,039 | 0 | 0 | false |
| today | mobile | 2 | today-mobile-band2.png | 161,028 | 581 | 3,039 | 0 | 0 | false |
| today | mobile | 3 | today-mobile-band3.png | 125,753 | 581 | 3,039 | 0 | 0 | false |
| today | desktop | 1 | today-desktop-band1.png | 387,032 | 648 | 3,403 | 0 | 0 | false |
| today | desktop | 2 | today-desktop-band2.png | 291,579 | 648 | 3,403 | 0 | 0 | false |
| today | desktop | 3 | today-desktop-band3.png | 285,051 | 648 | 3,403 | 0 | 0 | false |
| inbox | mobile | 1 | inbox-mobile-band1.png | 187,291 | 844 | 4,424 | 0 | 0 | false |
| inbox | mobile | 2 | inbox-mobile-band2.png | 192,624 | 844 | 4,424 | 0 | 0 | false |
| inbox | mobile | 3 | inbox-mobile-band3.png | 183,133 | 844 | 4,424 | 0 | 0 | false |
| inbox | mobile | 4 | inbox-mobile-band4.png | 188,019 | 844 | 4,424 | 0 | 0 | false |
| inbox | mobile | 5 | inbox-mobile-band5.png | 188,200 | 844 | 4,424 | 0 | 0 | false |
| inbox | desktop | 1 | inbox-desktop-band1.png | 438,243 | 1,058 | 5,537 | 0 | 0 | false |
| inbox | desktop | 2 | inbox-desktop-band2.png | 430,325 | 1,058 | 5,537 | 0 | 0 | false |
| inbox | desktop | 3 | inbox-desktop-band3.png | 432,608 | 1,058 | 5,537 | 0 | 0 | false |
| inbox | desktop | 4 | inbox-desktop-band4.png | 428,355 | 1,058 | 5,537 | 0 | 0 | false |
| inbox | desktop | 5 | inbox-desktop-band5.png | 425,519 | 1,058 | 5,537 | 0 | 0 | false |
| drafts | mobile | 1 | drafts-mobile-band1.png | 61,318 | 111 | 557 | 0 | 0 | false |
| drafts | desktop | 1 | drafts-desktop-band1.png | 187,035 | 178 | 922 | 0 | 0 | false |
| content | mobile | 1 | content-mobile-band1.png | 216,443 | 6,870 | 41,821 | 0 | 0 | false |
| content | mobile | 2 | content-mobile-band2.png | 206,935 | 6,870 | 41,821 | 0 | 0 | false |
| content | mobile | 3 | content-mobile-band3.png | 226,403 | 6,870 | 41,821 | 0 | 0 | false |
| content | mobile | 4 | content-mobile-band4.png | 221,399 | 6,870 | 41,821 | 0 | 0 | false |
| content | mobile | 5 | content-mobile-band5.png | 219,832 | 6,870 | 41,821 | 0 | 0 | false |
| content | desktop | 1 | content-desktop-band1.png | 444,125 | 6,935 | 42,200 | 0 | 0 | false |
| content | desktop | 2 | content-desktop-band2.png | 470,690 | 6,935 | 42,200 | 0 | 0 | false |
| content | desktop | 3 | content-desktop-band3.png | 454,049 | 6,935 | 42,200 | 0 | 0 | false |
| content | desktop | 4 | content-desktop-band4.png | 364,929 | 6,935 | 42,200 | 0 | 0 | false |
| content | desktop | 5 | content-desktop-band5.png | 445,677 | 6,935 | 42,200 | 0 | 0 | false |
| sends | mobile | 1 | sends-mobile-band1.png | 152,670 | 304 | 1,468 | 0 | 0 | false |
| sends | mobile | 2 | sends-mobile-band2.png | 98,537 | 304 | 1,468 | 0 | 0 | false |
| sends | mobile | 3 | sends-mobile-band3.png | 127,816 | 304 | 1,468 | 0 | 0 | false |
| sends | mobile | 4 | sends-mobile-band4.png | 149,640 | 304 | 1,468 | 0 | 0 | false |
| sends | desktop | 1 | sends-desktop-band1.png | 299,046 | 369 | 1,824 | 0 | 0 | false |
| sends | desktop | 2 | sends-desktop-band2.png | 253,866 | 369 | 1,824 | 0 | 0 | false |
| sends | desktop | 3 | sends-desktop-band3.png | 293,271 | 369 | 1,824 | 0 | 0 | false |
| ops | mobile | 1 | ops-mobile-band1.png | 162,039 | 96 | 481 | 0 | 0 | false |
| ops | mobile | 2 | ops-mobile-band2.png | 152,605 | 96 | 481 | 0 | 0 | false |
| ops | desktop | 1 | ops-desktop-band1.png | 318,835 | 166 | 864 | 0 | 0 | false |
| ops | desktop | 2 | ops-desktop-band2.png | 316,421 | 166 | 864 | 0 | 0 | false |

39 captures total, 0 flagged, 0 console errors of any class (expected-cors or src-error), 0 skeletons,
0 stuck-loading at final capture time. Full machine-readable version: `capture-report.json` in this
directory.

## innerText range across surfaces

96 words (`ops/mobile`) to 6,935 words (`content/desktop`) — Content is the outlier by a wide margin
(consistent with `phase0-surfaces.md`'s classification of Content as "THE TEST SURFACE": 285
`carousel_drafts` rendering at once with no anchor column), everything else clusters 96–1,058 words.
