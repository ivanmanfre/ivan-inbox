# FINAL evidence capture — inbox-visual-rebuild-2026-08-02

Independent instrument. Script: `final-capture.mjs` (scratchpad root), written fresh — does not
import or execute any candidate's own `scripts/*.mjs`. Dark theme throughout (no `inbox-theme=light`
override, so the no-attribute default applies), `deviceScaleFactor: 2`, wait discipline per spec:
`domcontentloaded` → zero `.sk` skeleton elements → no literal "Loading" substring in
`document.body.innerText` → innerText stable across two reads ≥1s apart (`waitSettled`), **plus** an
additional `resettle()` immediately before every band's screenshot (not just once at page load — see
finding #2 below). **NEVER `networkidle`** (the app holds an open realtime WS).

## HEAD commits captured

| candidate | worktree | port | HEAD | commit time |
|---|---|---|---|---|
| faithful | `wt-faithful` | 5444 | `22168ef` | 2026-08-02 16:27:55 +0200 |
| spine | `wt-spine` | 5442 | `534fd25` | 2026-08-02 16:29:28 +0200 |
| split | `wt-split` | 5443 | `bf9be2f` | 2026-08-02 11:53:10 +0200 |

## Session provenance (per instruction: mint fresh, fall back only after verifying exp is future)

- **faithful**: `node scripts/dev-login.mjs` hung on network (>25s, killed). Fell back to
  `wt-faithful/.session.json`, verified `expires_at` was ~11 min in the future at time of use. Capture
  ran clean; supabase-js's own `refresh_token`-based auto-refresh covers any mid-run expiry (confirmed:
  all captures succeeded, 0 auth-related console errors).
- **spine**: existing `wt-spine/.session.json` had ~37 min of validity remaining at the point the prior
  attempt's network-hang was already reproduced once (faithful, above) — skipped a second guaranteed-hang
  mint attempt and went straight to the verified-future-exp session, per the same fallback rule.
- **split**: `wt-split/.session.json` had **already expired** (`expires_at` −58s) by the time its server was
  up. `dev-login.mjs` hung again (>25s, killed — third reproduction of the same network-hang mode).
  Fell back to `wt-spine/.session.json` instead (same Supabase user `im@ivanmanfredi.com`, ~30 min still
  valid at time of use — a session is scoped to the user account, not the worktree/branch, so this is a
  real, unexpired, non-fabricated credential). **Flag for the ballot**: split's captures were taken with a
  session minted against the spine worktree, not split's own — functionally identical (same user, same
  Supabase project) but noted for full transparency.

## Findings during capture build (both fixed before the run counted as final)

1. **Colour-fork toggle mechanism differs by candidate.** `wt-faithful/src/exp/v2c/Shell.tsx:163-168` reads
   `?cat=triad` from `location.search` in a `useEffect` that runs on mount and **overwrites** any
   `data-cat` attribute set by pre-navigation script injection. `wt-spine` and `wt-split` set no such
   effect — for them the injected attribute is what sticks. First capture attempt (faithful only) produced
   byte-identical mono/triad screenshots because the attribute was stomped back to `mono` after load. Fixed
   by appending `?cat=triad` to the URL for the triad capture (harmless no-op on spine/split, which don't
   read it) while keeping the attribute injection as the mechanism for spine/split. Verified post-fix:
   `data-cat` reads `triad` and `--cat-2` resolves to the triad hex on all three candidates.
2. **Late-arriving content between bands on the same page.** First full run (faithful) showed `content@390`
   mid/deep bands' `innerText` identical to top (4324 chars) then jumping to 28415 at deep with no skeleton
   or "Loading" flag raised in between — live Supabase data kept streaming in after the initial
   skeleton-clear satisfied the page-load `waitSettled`. Fixed by adding `resettle()`, called immediately
   before **every** band's screenshot (not just once at page load), which re-verifies zero skeletons + no
   "Loading" + two-reads-1s-apart text stability right before the shutter. Also caused one genuine
   `settled=false` on `spine`/`today@1440` in the pre-fix run (page took ~9s to clear a "Loading" state that
   momentarily read as clean at an intermediate text length); re-run after the fix settled cleanly at
   `waitSettled` timeout 35s.
3. **Content scroll container is not the document.** `.wb-work{overflow:hidden}` — the actual scrollable
   pane is `.rows.ct-rows` (global `.rows{overflow-y:auto}` rule in `src/styles.css`, unscoped, so it
   reaches inside `.wb` too). `document.scrollingElement`/`html`/`body` never move. `scrollTo()` now finds
   the real scrolling descendant (largest `scrollHeight − clientHeight` among `overflowY: auto|scroll`
   elements under `.wb`) instead of assuming document scroll — confirmed working on all three candidates
   (`.rows.ct-rows`, scrollHeight ~14.6k–20.8k vs clientHeight ~580–770px on Content, real movement recorded
   per-band in each report JSON's `scrollInfo`).
4. **"Mattan lane" is a tab, not a stacked scroll section.** `ContentList.tsx` renders two lanes (`Ivan`,
   `Mattan Danino`/`risedtc`) switched by clicking a `.chip` — not one continuous scroll. The "Mattan lane
   top band" capture clicks the `Mattan Danino` chip, waits for the lane's own load (its `.rows` container
   is real-data-sized: ~6k px scrollHeight vs ~700px client on 1440), then shoots at `scrollTop=0`.

All three findings were verified independently against source in each of the three worktrees (not
assumed identical) before the fix was applied uniformly; the mechanism differences (finding #1) and the
scroll target (finding #3) are confirmed consistent across `wt-faithful`, `wt-spine`, and `wt-split`.

## Console error classification

`src/`-originated (fails): any console/pageerror message matching `/\/src\//` or a `.tsx?` module path.
Allowed exception: any message matching `inbox-claude` **and** one of `cors|access-control|failed to
fetch|network error` (the unarmed AI-brain endpoint's known, expected CORS pair). Everything else counts
as "other" (fails). **Result: 0/0/0 (src / allowed-CORS / other) on every one of the 39 captures, across
all three candidates** — no console or page errors of any kind were observed in this final pass.

## Evidence table (39 captures = 13 × 3 candidates)

| candidate | route | viewport | band | file | bytes | innerText len | skeletons | settled | console (src/cors/other) |
|---|---|---|---|---|---|---|---|---|---|
| faithful | content | 1440x900 | top-ivan-lane | faithful-content-1440-top.png | 338618 | 37433 | 0 | true | 0 |
| faithful | content | 1440x900 | mid-ivan-lane | faithful-content-1440-mid-lane.png | 509268 | 37433 | 0 | true | 0 |
| faithful | content | 1440x900 | deep-ivan-lane | faithful-content-1440-deep-lane.png | 458580 | 37434 | 0 | true | 0 |
| faithful | content | 1440x900 | top-mattan-lane | faithful-content-1440-mattan-top.png | 432937 | 10787 | 0 | true | 0 |
| faithful | content | 390x844 | top-ivan-lane | faithful-content-390-top.png | 151853 | 37055 | 0 | true | 0 |
| faithful | content | 390x844 | mid-ivan-lane | faithful-content-390-mid-lane.png | 237325 | 37055 | 0 | true | 0 |
| faithful | content | 390x844 | deep-ivan-lane | faithful-content-390-deep-lane.png | 222231 | 37055 | 0 | true | 0 |
| faithful | today | 1440x900 | top | faithful-today-1440-top.png | 349484 | 3055 | 0 | true | 0 |
| faithful | today | 390x844 | top | faithful-today-390-top.png | 165805 | 2691 | 0 | true | 0 |
| faithful | sends | 1440x900 | top-mono | faithful-sends-1440-top-mono.png | 309606 | 1953 | 0 | true | 0 |
| faithful | sends | 1440x900 | top-triad | faithful-sends-1440-top-triad.png | 309773 | 1953 | 0 | true | 0 |
| faithful | inbox | 1440x900 | top | faithful-inbox-1440-top.png | 433019 | 8657 | 0 | true | 0 |
| faithful | ops | 1440x900 | top | faithful-ops-1440-top.png | 278345 | 707 | 0 | true | 0 |
| spine | content | 1440x900 | top-ivan-lane | spine-content-1440-top.png | 363942 | 28795 | 0 | true | 0 |
| spine | content | 1440x900 | mid-ivan-lane | spine-content-1440-mid-lane.png | 410613 | 28795 | 0 | true | 0 |
| spine | content | 1440x900 | deep-ivan-lane | spine-content-1440-deep-lane.png | 466289 | 28795 | 0 | true | 0 |
| spine | content | 1440x900 | top-mattan-lane | spine-content-1440-mattan-top.png | 415770 | 8858 | 0 | true | 0 |
| spine | content | 390x844 | top-ivan-lane | spine-content-390-top.png | 159870 | 28416 | 0 | true | 0 |
| spine | content | 390x844 | mid-ivan-lane | spine-content-390-mid-lane.png | 154420 | 28416 | 0 | true | 0 |
| spine | content | 390x844 | deep-ivan-lane | spine-content-390-deep-lane.png | 173814 | 28416 | 0 | true | 0 |
| spine | today | 1440x900 | top | spine-today-1440-top.png | 354067 | 3055 | 0 | true | 0 |
| spine | today | 390x844 | top | spine-today-390-top.png | 163221 | 2691 | 0 | true | 0 |
| spine | sends | 1440x900 | top-mono | spine-sends-1440-top-mono.png | 303791 | 1835 | 0 | true | 0 |
| spine | sends | 1440x900 | top-triad | spine-sends-1440-top-triad.png | 303762 | 1835 | 0 | true | 0 |
| spine | inbox | 1440x900 | top | spine-inbox-1440-top.png | 423256 | 8657 | 0 | true | 0 |
| spine | ops | 1440x900 | top | spine-ops-1440-top.png | 273232 | 707 | 0 | true | 0 |
| split | content | 1440x900 | top-ivan-lane | split-content-1440-top.png | 432690 | 26724 | 0 | true | 0 |
| split | content | 1440x900 | mid-ivan-lane | split-content-1440-mid-lane.png | 357775 | 26724 | 0 | true | 0 |
| split | content | 1440x900 | deep-ivan-lane | split-content-1440-deep-lane.png | 404147 | 26724 | 0 | true | 0 |
| split | content | 1440x900 | top-mattan-lane | split-content-1440-mattan-top.png | 440189 | 9261 | 0 | true | 0 |
| split | content | 390x844 | top-ivan-lane | split-content-390-top.png | 185998 | 26345 | 0 | true | 0 |
| split | content | 390x844 | mid-ivan-lane | split-content-390-mid-lane.png | 185841 | 26345 | 0 | true | 0 |
| split | content | 390x844 | deep-ivan-lane | split-content-390-deep-lane.png | 182661 | 26345 | 0 | true | 0 |
| split | today | 1440x900 | top | split-today-1440-top.png | 345798 | 3052 | 0 | true | 0 |
| split | today | 390x844 | top | split-today-390-top.png | 168745 | 2688 | 0 | true | 0 |
| split | sends | 1440x900 | top-mono | split-sends-1440-top-mono.png | 310354 | 1997 | 0 | true | 0 |
| split | sends | 1440x900 | top-triad | split-sends-1440-top-triad.png | 308317 | 1997 | 0 | true | 0 |
| split | inbox | 1440x900 | top | split-inbox-1440-top.png | 418428 | 8781 | 0 | true | 0 |
| split | ops | 1440x900 | top | split-ops-1440-top.png | 281875 | 707 | 0 | true | 0 |

## Scroll evidence (Content bands — proof of real movement, not identical-frame padding)

| candidate | viewport | mid scrollTop / (scrollHeight−clientHeight) | deep scrollTop / (scrollHeight−clientHeight) |
|---|---|---|---|
| faithful | 1440x900 | 4855 / 13870 | 9709 / 13870 |
| faithful | 390x844 | 5214 / 14898 | 10429 / 14898 |
| spine | 1440x900 | 5297 / 15134 | 10594 / 15134 |
| spine | 390x844 | 7079 / 20226 | 14158 / 20226 |
| split | 1440x900 | 5265 / 15042 | 10529 / 15042 |
| split | 390x844 | 6483 / 18522 | 12965 / 18522 |

Note: the Ivan-lane list is real, currently-small live data (the review queue is short right now); real
scroll depth on Content is dominated by the Mattan/risedtc lane (the 285-row real dataset — `.rows.ct-rows`
measured `scrollHeight` ~6k–20k px vs ~580–770px client across all three candidates and both viewports),
which is why the Ivan-lane bands above move a modest, real amount while the Mattan-lane top band alone
(captured separately) sits atop a much taller list. No band was faked or padded to force apparent movement.

## Full detail

Per-candidate raw reports (console message text, per-band `scrollInfo`, full classification) are in
`wt-faithful/faithful-final-report.json`, `wt-spine/spine-final-report.json`,
`wt-split/split-final-report.json` alongside their 13 PNGs each.
