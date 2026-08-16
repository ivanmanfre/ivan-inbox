# Mobile sweep — ivan-inbox v2c Workbench (exp/vis-faithful) @ 390×844, dark

Method: Playwright (chromium), viewport 390×844, isMobile+hasTouch, deviceScaleFactor 3,
colorScheme dark. Auth injected via `.session.json` → `localStorage['sb-bjbvqvzbzczjbatgmccb-auth-token']`
before load (confirmed non-anonymous: 1407 real inbox threads, 173 real content drafts loaded).
Routes enumerated from `src/exp/v2c/layout.ts` JOBS + `Shell.tsx`: today, inbox, drafts, content,
sends, ops, settings — all reached via `#exp/v2/<job>` fresh-load URLs per `route.ts`. Peers
(Claude / thread / draft) tested as mobile takeovers per `Shell.tsx:388-417`.

All screenshots in `phase0-shots/` (this dir's sibling), prefixed `mobile-*`. Temp scripts were
written to `<worktree>/scripts/_scout-mobile-*.mjs`, untracked, read-only against `src/`.

Owner's words: "i havent even tested mobile i hope its perfect." It is not. Ranked below.

---

## 1. The Content route buries every actionable row under ~2.2 screens of dashboard chrome (CRITICAL)

On `#exp/v2/content` (Ivan lane), before the first stage-list row appears, the scroller
(`.rows.ct-rows`, `src/exp/v2c/ContentList.tsx:696`) renders, in order: an alert line, an alert
strip, the Post-Pipeline capsule chart, an advisory line, and then the **filter/facet wall**
(`FilterBar`, `src/exp/v2c/ContentBits.tsx:87-131`, rendered at `ContentList.tsx:443-446`).

Measured live (scrollTop=0, 8s post-load settle):
- `.ct-filters` (the facet wall itself) height = **1286px = 152% of the 844px viewport** — bigger
  than the whole screen, by itself.
- Total preamble from scroller-top to the first `.wb-sech` section header = **1832px = 217% of
  viewport**.
- First actionable `.ct-card` (a real content row) doesn't appear until **1896px of scroll** ≈
  2.24 full screens.
- The facet wall itself holds **18 facet groups / 105 individual filter chips** (Stage, Format,
  Image style, Hook, Source, Funnel, Experiment, QA verdict, QA score, Image, Regenerated,
  Evidence…) — every one always rendered, always visible, all wrapping to new lines at 390px.

A tap-to-jump shortcut exists and does work: `CapsuleChart` bars (`src/exp/v2c/Surface.tsx:123-153`)
carry `onClick={onJump}`; verified live — tapping the "Published" capsule scrolled the container
from 0 → 7249px instantly, and the capsule's own hit box (55×120px) comfortably clears 44×44. But
there is zero visual affordance that the chart is tappable on a touch surface (no cursor cue
exists on mobile), so this is a shortcut only a power user who already knows about it would use.
Everyone else scrolls through 2+ full screens of chart and pills before reaching the thing the tab
exists for.

Screenshots: `mobile-content-01-top.png`, `mobile-content-facetwall-y0/400/800/1200/1600.png`.

## 2. The only way out of a peer takeover is a 6×20px hit target (CRITICAL)

Opening Claude, a thread, or a draft on mobile makes that surface take over the *entire* screen
(`Shell.tsx:389-397`, `.wb-take`) and **hides the bottom tab bar completely** (confirmed:
`hasTabbar:false` in both the Claude-peer and thread-peer states). The only way back is the "‹"
glyph — `<span className="back" onClick={onClose}>‹</span>` at `src/exp/v2c/ChatPane.tsx:256` and
`src/exp/v2c/DraftPane.tsx:259` (ThreadPeer reuses the same pattern via `ThreadScreen`'s `onBack`).
Styling: `.wb .back{display:block}` (`styles.css:144`) and `.wb.wb.wb .back{font-size:var(--fs-title);
line-height:20px}` (`faithful.css:302`) — no padding, no min-width/min-height.

Measured live hit box: **6px wide × 20px tall**. That is smaller than a fingertip contact patch by
roughly an order of magnitude, on the one control that is load-bearing for getting back to any job
tab once you've opened Claude or a message thread. It does work when hit precisely (verified: tap
succeeded, state returned to `app wb` with tab bar restored both times) — but hitting a 6px sliver
with a thumb, on the one screen where there is no other way out, is a real miss-and-get-stuck risk.

Screenshots: `mobile-nav-01-claude-open.png`, `mobile-nav-03-thread-open.png`.

## 3. DM/comment-log rows lose their kind label off the left edge of the screen (HIGH)

On `#exp/v2/drafts` (the "DMs" work lane, cross-account activity log rows), every row's leading
chip — e.g. `comment_outbound` — visibly renders as **"omment_outbound"**, missing its first
character(s), because the chip's own text overflows past the left edge of the 390px viewport.

Root cause, confirmed via `Range.getBoundingClientRect()` on a live chip:
- `.log-chip` box: `left:16 width:74` (`src/exp/v2c/faithful.css:1259-1264`, grid slot
  `--log-anchor-w:84px`).
- The rendered text run itself: `left:-5.6 width:117.3` — the string physically starts at
  **x = -5.6px**, off-canvas, and overflows the 74px box by **~21.6px on both sides** because the
  rule sets `white-space:nowrap; justify-content:center` on an `inline-flex` with **no
  `overflow:hidden` and no `text-overflow:ellipsis`** — every other truncated label in this build
  (`.ct-title` at `faithful.css:708`, `.log-nm` at `faithful.css:1280`) has one; this one doesn't.
- Computed `overflow: visible`, `font-size: 11px`.

This is the first thing every row in the Drafts tab shows, on every kind label long enough to
overflow (comment_outbound, dm_sent, etc. — most of them).

Screenshots: `mobile-drafts-01-top.png`, `mobile-drafts-chip-overflow-evidence.png` (measurements
in the script output above).

## 4. Touch targets under 44×44 are the rule, not the exception (MEDIUM-HIGH, broad)

None of these are functionally broken — all were tap-tested and work — but nearly every
tap-to-act control on this surface sits well under the 44×44 guidance:

| Control | Measured | File |
|---|---|---|
| Facet chips (all 105) | ~26px tall | `styles.css:553`, `faithful.css:980` |
| Content Skip/Approve buttons | 48×28 / 76×28 | `faithful.css:1400`, `:735` |
| Inbox/Today filter chips (All/Ivan/Rise/Email) | ~30px tall | `styles.css` `.chip` |
| Search input real hit box (vs. 358×38 wrapper) | 310×20 | `InboxScreen.tsx` `.search-in` |
| Top-right settings gear ⚙︎ | 17×24 | `styles.css:119` (`padding:2px 4px`) |
| Settings "Done" button | 44×24 | `Shell.tsx:410` |
| Sends "Range: 7d" dropdown pill | 101×32 | `SendsScreen` |
| Settings Dark/Light segmented control | ~77×30 each | Settings screen |

The facet-chip case is the sharpest: 105 chips at ~26px tall, packed edge-to-edge in wrapping
rows, is a real mis-tap surface on a phone.

## 5. Content row titles get ~102px of a 390px screen (MEDIUM)

`.ct-title` does truncate correctly with `overflow:hidden;text-overflow:ellipsis`
(`faithful.css:708`) — this is NOT a broken-clip bug like #3 — but on Needs-Review rows the
thumbnail anchor + Skip/Approve buttons leave only ~102px (≈26% of the screen width) for the
headline itself, so most post titles show only their first 15-20 characters before the ellipsis.
Working as coded, but a real legibility cost that is specific to 390px (plenty of room exists at
desktop widths). Screenshot: `mobile-content-02-scroll33.png`.

## 6. Today route: 150-1400px-tall summary cards (LOW-MEDIUM, scoped)

Today isn't one of the density-banded "working lists" (`LIST_JOBS` in `layout.ts` excludes it), so
the ≤72px row rule doesn't strictly apply — but its DM-drafts/comment-drafts/feed-drafts summary
tiles measured 153-1402px tall in the live DOM (multi-paragraph annotation copy stacked inside each
card), meaning some single cards consume 1-2 full screens on their own. Screenshot:
`mobile-today-01-top.png`, `-02-scroll33.png`.

Separately: one row-height sample on Inbox (`.rows`, 14-row scan) returned an outlier of 83,950px
for the last matched element — very likely a load-more/sentinel wrapper caught by my `:scope > *`
query rather than a real visible row (the other 13 rows in the same scan were all a clean 62-83px,
matching spec). Flagged for a human to confirm against `src/screens/InboxScreen.tsx:166`; not
independently confirmed as a rendered defect.

## 7. Ops cards show a literal "#null" identifier (LOW, not mobile-specific but visible here)

Every pending card on `#exp/v2/ops` for `comment_outbound`-kind drafts shows **"#null"** where an
identifier belongs. Root cause: `src/screens/OpsScreen.tsx:130` —
`const where = isNewsjack || isWeekly || isComment ? engineLabel(draft.client_id) : \`#${draft.slack_channel}\``
— `isComment` only matches `draft.kind === 'comment_reply'`, so `comment_outbound` rows fall to the
`#${draft.slack_channel}` branch where `slack_channel` is `undefined`, template-stringified to the
literal text "null". Same on desktop, but it's exactly the kind of thing that reads as broken if
the owner opens Ops on his phone. Screenshot: `mobile-ops-01-top.png`.

## Positive findings (verified, not defects)

- **No horizontal overflow anywhere.** `document.scrollingElement.scrollWidth` never exceeded
  `innerWidth`, and no single element measured wider than the 390px viewport, on any of the 7
  routes tested. Zero `H-OVERFLOW` findings across the full instrumented sweep.
- **First-paint dark-token fix (spine §1.7) holds.** Cold reload was screenshotted every ~60ms
  from navigation: pre-React window is solid black (`index.html`'s inline `html,body{background:
  #000000}`), and by the first React paint (~465ms in this dev-server test) the root already
  carries `app wb` with the correct dark surface color (`rgb(9,11,10)`). No flash of a light/iOS
  default detected. Confirms the fix at `Shell.tsx:223-241` is applied on the mobile boot path too.
- **Core navigation and interaction all function correctly once properly tapped**: switching jobs,
  opening/closing the Claude peer, opening a thread, opening a draft (via `.ct-title`, not the
  first DOM-order `.ct-card` — that one landed on a collapsed/off-screen row in my first attempt,
  a test artifact not an app bug), typing in inbox search (filtered 1407→13 rows correctly for
  "kyle"), and tapping a facet chip (correctly filtered 173→95 drafts, `.ct-f.on` state applied) —
  all verified via real `.tap()` (not raw mouse-coordinate clicks, which give false negatives on
  off-screen elements — an early test artifact I had to correct for).

---

## Top 10 mobile defects, ranked

1. **Content route: ~2.2 screens of dashboard chrome (1832px) before any actionable row** — facet
   wall alone is 152% of viewport height; 105 chips across 18 groups always rendered.
   (`ContentBits.tsx:87-131`, `ContentList.tsx:443-446`)
2. **Peer-takeover back control is a 6×20px hit target** — the only way out of Claude/thread/draft
   full-screen views, which also hide the tab bar entirely.
   (`ChatPane.tsx:256`, `DraftPane.tsx:259`, `faithful.css:302`)
3. **DM-log row kind-chip text starts at x=-5.6px** — first character(s) of every
   `comment_outbound`/similar label render off-canvas, no ellipsis, no clip.
   (`faithful.css:1259-1264`)
4. **105 filter chips at ~26px tall** — the densest, most mis-tap-prone touch surface on the app.
   (`styles.css:553`, `faithful.css:980`)
5. **Content Skip/Approve action buttons at 48×28 / 76×28** — the primary approve-loop CTA, under
   44px tall. (`faithful.css:1400`, `:735`)
6. **Top-right settings gear at 17×24** — present on every screen's header, smallest persistent
   control in the app. (`styles.css:119`)
7. **Content row titles truncate to ~102px (26% of screen width)** on Needs-Review rows — graceful
   ellipsis, but most titles are unreadable past ~20 characters.
8. **"#null" literal identifier on Ops cards** for `comment_outbound` drafts — reads as broken.
   (`src/screens/OpsScreen.tsx:130`)
9. **Today route's summary cards run 153-1402px tall** — some single cards consume 1-2 full
   screens; unverified 83,950px outlier row on Inbox worth a human recheck.
10. **Search input's real hit box is 310×20 inside a 358×38 wrapper**, and the Sends "Range: 7d"
    dropdown (101×32) and stat-tile labels (`ACC…/GOV…/RUN…`, clipped at 41px) round out a
    pattern of undersized/truncated chrome specific to 390px.

No horizontal-overflow bugs and no first-paint FOUC were found — those two categories are clean.
