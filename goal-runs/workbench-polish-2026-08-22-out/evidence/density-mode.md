# Density mode (`polish/dens`)

Branch `polish/dens`, worked in `/Users/ivanmanfredi/Desktop/ivan-inbox-pw-dn`. Built on top of `wb/polish` merged mid-run (Today-as-work-queue, the DM row showing its pending draft) — see "Baseline moved mid-run" below for how that changes what "before" means.

## The brief, restated in one line

`density-analysis.md`'s verdict: size is the smaller half (16px vs 15px, ~6%), leading is the lever (25.6px vs ~20px line, ~27-29%), roughly 4-to-1. Build a **switchable mode**, not a retune: comfortable stays the shipped behaviour until Ivan picks, compact tightens leading and padding on scanning surfaces only. The 16px body size is never cut, anywhere, in either mode. Reading surfaces (post body, message bubbles) are untouched.

## The token set

Declared on `.wb` (comfortable = current shipped values, restated as literals) with `:root[data-density='compact'] .wb` overrides, following the same pattern as the elevation ladder (`--e0`..`--e4`) already in `wbsys.css`.

| Token | Comfortable | Compact | Governs |
|---|---|---|---|
| `--d-row-lh` | `1.6` | `1.35` | `.r .name`, `.r .snip` line-height (16px -> 25.6px / 21.6px) |
| `--d-row-pad-v` | `10px` | `7px` | `.r` padding-top/bottom |
| `--d-row-gap` | `5px` | `3px` | `.r .mid` flex gap (name block to snippet) |
| `--d-snip-cap` | `none` | `56ch` | `.r .snip` max-width, non-`.wb-solo` case |
| `--d-snip-cap-solo` | `88ch` (matches shipped) | `52ch` | `.r .snip` max-width, `.wb-solo` case (see below — this is the case that actually renders) |
| `--d-set-pad-v` | `12px` | `8px` | `.grow` padding-top/bottom |
| `--d-set-minh` | `52px` | `44px` | `.grow` min-height (44px is the touch floor, not gone under) |
| `--d-style-pad-v` | `11px` | `7px` | `.ct-style` padding-top/bottom |
| `--d-style-b-lh` | `1.6` | `1.35` | `.ct-style-b` line-height |
| `--d-style-gap` | `12px` | `8px` | `.ct-style-i` margin-top |
| `--d-style-img` | `78px` | `56px` | `.ct-style-i img` width/height |

Switch UI: `SettingsScreen.tsx`, Appearance group, Comfortable/Compact segmented control next to the existing Theme control. Persistence follows the exact `inbox-theme` pattern: `main.tsx` reads `localStorage.getItem('inbox-density')` at boot and sets `document.documentElement.dataset.density`; the setter in `SettingsScreen.tsx` writes both. Comfortable is the un-set state, so only `'compact'` is ever written to `localStorage` / the attribute, matching how theme's `'dark'` default works.

Two defects found and fixed while verifying the headline number, **not density-gated** (both apply in both modes, because they are bugs, not opinions):

1. **`.wb-selmark` had no grid placement inside `.r`'s grid.** `.r` became a CSS grid in an earlier pass; the row-select checkbox kept the flex-era assumption ("the inbox row is a flex line", wb2026.css:205) and had no explicit `grid-column`, so it claimed its own implicit grid row — 18px plus a 12px row-gap, 30px of dead space on every DM row, comfortable and compact alike, before any leading/padding token applied. Pulled out of grid flow the same way `.ct-anchor > .wb-selmark` already is, positioned over the avatar's corner with an offset computed from `--anchor-w` (not hardcoded) so it tracks the avatar across both densities.
2. **`.dpill` and `.pushbtn` (added by the `wb/polish` merge's "DM row shows its draft" work) had no `.wb.wb.wb` type rule anywhere**, so both rendered at the flattener default (16px/1.6) instead of their real `src/styles.css` sizes (`.dpill` 10px/800, `.pushbtn` 12.5px/700). This made `.right` (time + dpill + pushbtn) 96px tall against `.mid`'s 46px — silently the tallest column, swallowing the leading/padding savings before they showed up in the row total. Restated at the correct size; that drops `.pushbtn` to 29px, 3px under the 32px pointer floor, so an invisible `::after` hit-area extension (the same pattern `.wb-selmark`/`.wbb` already use) was added to clear 32px pointer / 44px touch without growing a visible pixel.

## Baseline moved mid-run — what each number is against

`density-analysis.md` section 2's numbers (DMs 6/9, Content 11/90, Styles 3/17, Settings 5/5) were taken **before** `wb/polish`'s later merges (calendar rail, error-reason work, and specifically the Today-work-queue merge that changed the DM row's own markup — it now shows the pending draft's text and an inline Discard button). Comparing my compact numbers straight against that old table would credit compact mode with other agents' work.

So there are three numbers below, explicitly labelled:

- **pre-merge** = `density-analysis.md`'s own table (before `wb/polish` caught up).
- **baseline** = re-measured on the merged `wb/polish` tip, my two commits stashed out via `git checkout wb/polish -- <3 files>`, rebuilt, measured, then restored (`git checkout HEAD -- <3 files>`) — this is the honest "what would compact be compared against right now" baseline.
- **comfortable** = my final branch state, comfortable mode. This is NOT identical to baseline: it includes the two defect fixes above (selmark grid placement, dpill/pushbtn type), because those are bugs, not density opinions, and I fixed them unconditionally.
- **compact** = my final branch state, compact mode.

### Records visible in the first viewport, no scroll (dark theme)

| Surface | Viewport | pre-merge | baseline (merged, before my fix) | comfortable (merged + bug fixes) | compact |
|---|---|---|---|---|---|
| Content (Ideas) | 1440x900 | 11/90 | 11/90 | 11/90 | 11/90 |
| Content (Ideas) | 390x844 | 6/90 | 6/90 | 6/90 | 6/90 |
| DMs | 1440x900 | 6/9 | 6/10 | 9/10 | **10/10** |
| DMs | 390x844 | 5/9 | 4/10 | 7/10 | **8/10** |
| Settings | 1440x900 | 5/5 | 5/5 | 6/6 | 6/6 |
| Settings | 390x844 | n/a | 5/5 | 6/6 | 6/6 |
| Styles | 1440x900 | 3/17 | 3/17 | 3/17 | **4/17** |
| Styles | 390x844 | 1/17 | 1/17 | 1/17 | **2/17** |

(Settings and Content record *counts* changed 5->6 / stayed 90 between pre-merge and baseline because `wb/polish` added a Density row and other merged work, not because of anything in this branch.)

### First-record row height (dark theme, px)

| Surface | Viewport | baseline | comfortable | compact | delta (baseline -> compact) |
|---|---|---|---|---|---|
| Content (Ideas) | 1440x900 | 55.6 | 55.6 | 55.6 | 0 — already at target, untouched (see below) |
| Content (Ideas) | 390x844 | 77.2 | 77.2 | 77.2 | 0 |
| DMs | 1440x900 | 146.0 | 93.8 | **87.8** | **-58.2px (-40%)** |
| DMs | 390x844 | 146.0 | 93.8 | **87.8** | **-58.2px (-40%)** |
| Settings | 1440x900 | 72.4 | 72.4 | **60.4** | **-12.0px (-17%)** |
| Settings | 390x844 | 91.3 | 91.3 | **79.3** | **-12.0px (-14%)** |
| Styles | 1440x900 | 221.7 | 221.7 | **179.7** | **-42.0px (-19%)** |
| Styles | 390x844 | 324.1 | 324.1 | **266.1** | **-58.0px (-18%)** |

DMs' baseline of 146px (up from the pre-merge measurement's 106.2px) is the `wb/polish` merge's own doing — the row now shows the full pending-draft text plus a Discard button, not a defect of mine. Of the 58.2px compact saves off that 146px baseline, roughly 30px is the selmark grid-placement fix, ~16px is the dpill/pushbtn type fix, and the rest is the leading/padding tokens.

### Content (Ideas) — verified close to target, left alone

Dominant text: 16px / 500 / **21.6px line-height (1.35 ratio)**, in both densities, both before and after this branch. This already sits inside the brief's 1.3-1.4 target band, so no token in this file touches `.ct-card`, `.ct-title`, or `.ct-row-p`. Row height is identical (55.6px / 77.2px) in both modes — verified, not assumed.

## Computed-style proof, both densities, both themes

Live `getComputedStyle` reads, `#exp/v2/dms`, `#exp/v2/settings`, `#exp/v2/styles`, compact mode:

```
dark:
  .r .snip    fontSize 16px  lineHeight 21.6px  maxWidth 524.062px (52ch, .wb-solo case)
  .r .name    fontSize 16px  lineHeight 21.6px
  .grow       paddingTop 8px paddingBottom 8px  minHeight 44px
  .gt         fontSize 16px  lineHeight 21.6px
  .ct-style   paddingTop 7px paddingBottom 7px
  .ct-style-b fontSize 16px  lineHeight 21.6px
  .ct-style-i img  width 56px  height 56px

light (density=compact, theme=light — identical, confirming no theme-conditional
       rule in faithful.css clobbers a density token):
  .r .snip    fontSize 16px  lineHeight 21.6px  width 524.062px
  .r .name    fontSize 16px  lineHeight 21.6px
  .grow       paddingTop 8px paddingBottom 8px  minHeight 44px
  .gt         fontSize 16px  lineHeight 21.6px
  .ct-style   paddingTop 7px paddingBottom 7px
  .ct-style-b fontSize 16px  lineHeight 21.6px
  .ct-style-i img  width 56px  height 56px
```

Comfortable mode, same surfaces, dark: `.r .snip` maxWidth `886.875px` (the shipped 88ch, unchanged — see next section), lineHeight `25.6px`; `.grow` padding `12px`/minHeight `52px`; `.ct-style` padding `11px`; `.ct-style-b` lineHeight `25.6px`; `.ct-style-i img` `78px`. All match the pre-existing shipped values exactly — comfortable is a verified no-op except for the two bug fixes above, which apply in both modes identically.

**One cascade trap found and fixed in this pass, the same class of bug the file's own header warns about**: `wb2026.css:518` already caps `.wb-solo .rows > .r .snip` at `88ch`, at 7 selector classes. `.wb-solo` is not a rare wide 2-column mode — it's live on the *ordinary* DMs list at desktop widths with no thread open, confirmed via `document.querySelector('.wb-work').className` returning `wb-work wide wb-solo`. My first `.r .snip{max-width:var(--d-snip-cap)}` (5 classes) silently lost that specificity fight in both densities — computed style showed `886.875px` in compact too. Added a second selector at matching 7-class specificity, later in source, reading a separate `--d-snip-cap-solo` token (88ch comfortable / 52ch compact) so comfortable keeps the exact shipped cap rather than removing it, and compact actually tightens the surface it renders on. Verified live after the fix: compact computes `524.062px`.

## Hit-target and contrast floor

- **Settings switch inside `.grow`**: switch itself is 31x51px, untouched. Compact `.grow` min-height is 44px (the touch floor exactly, not under it); comfortable is 52px. Neither density shrinks the switch.
- **`.pushbtn` (Discard)**: real, clickable, newly added by the merged draft-preview work. Restoring its correct type (fixing the flattener bug above) drops its visible box to 29px — 3px under the 32px pointer floor. Rather than grow the visible pill (reopening the row-height problem this fix exists to close), added an invisible `::after` hit-area extension: `inset:-2px 0` on pointer (33px), `inset:-8px 0` under `@media (pointer:coarse)` (45px, clears the 44px touch floor). Same pattern `.wb-selmark::after` and `.wbb::after` already use in this file.
- **`.wb-selmark` hit area**: unaffected by the grid-placement fix — its own `::after{inset:-13px}` (18px box + 26px = 44px) is untouched, still clears 44px touch in both densities.
- **No contrast ratio was touched.** Every token in this file is geometry (font-size stays fixed, only line-height/padding/gap/width/thumb-size move) or position (`.wb-selmark`). No color, no alpha, no token from the elevation ladder or accent budget was read or written.
- **Nowhere did a hit-target requirement force a row to keep more space than the density target wanted** beyond the two cases above (Settings min-height floor at 44px, pushbtn's invisible extension) — both are reported, not silently absorbed.

## What was deliberately left alone

- **16px body size**, everywhere, both densities. No `--fs-*` token was touched.
- **Post body, message bubbles, DM thread prose** (`.b`, `.wb-bubble`, `.wb-p`, `.dd-body`, etc.) — none of their selectors appear in this file's density section. Leading there stays 1.5-1.6 in both modes.
- **Content (Ideas) list** (`.ct-card`, `.ct-title`, `.ct-row-p`) — verified already at 1.35 leading / 21.6px line, row height identical in both modes (55.6px / 77.2px), not touched.
- **The calendar chip and `ContentCalendar.tsx` / `.cal-*`** — owned by `polish/cal`, not opened.
- **`Rail.tsx`, shell chrome, Content stage tab strip** — owned by `polish/glance`, not opened.
- **`TodayScreen.tsx`, `InboxScreen.tsx` markup** — owned by `polish/p4c`; the DM row's structure was not restructured, only styled from `wbsys.css` (the `.dpill`/`.pushbtn`/`.wb-selmark` fixes are pure CSS, no TSX touched beyond the merge itself).
- **`DraftPane.tsx`** — not opened, per the two-competing-branches note.
- **`src/styles.css`** (the stock sheet) — read only, never edited. `#exp/stock` was not measured but no selector in this branch's changes reaches outside `.wb`.
- **Colour, contrast, the elevation ladder, the accent budget** — no token, no selector touching any of these.

## Verify

- `npm run build` (tsc -b && vite build): clean, no errors, at every commit in this branch.
- `npm test`: baseline established at 906 passing / 1 known pre-existing `calendarItems.test.ts` failure (pre-merge); after merging `wb/polish`, baseline moved to 986 passing / same 1 known failure — confirmed matches the coordinator's note. Final branch state: **986 passing, 1 known pre-existing failure**, unchanged.
- Served on port 4189 (`npx vite build && npx vite preview --port 4189 --strictPort`), measured with Playwright from `/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs`, session injected from `/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json` into `sb-bjbvqvzbzczjbatgmccb-auth-token`.
- Write interceptor installed on `**/rest/v1/**` and `**/rest/v1/rpc/**` before every navigation (fulfilling PATCH/PUT/DELETE/POST with `200 []`), reused from `evidence/density-tools/measure-new.mjs`'s exact blocker shape. **Attempted writes across every measurement run in this phase: 0** (`after/dn-write-log.json`).
- Measurement tool: `evidence/density-tools/measure-new.mjs`'s `MEASURE_FN` reused verbatim (same type-census walker, same visible-record filter, same row decomposition, same canvas `measureText` character-width method), wrapped in a new driver script (this worktree's own preview port, plus a density/theme axis via seeding `localStorage` before navigation) so the two runs are comparable. Script and raw JSON: `after/dn-density-measurements.json`, `after/baseline/dn-density-measurements.json`.
- Screenshots: `after/shots/dn-<screen>-<density>-<theme>-<viewport>.jpg`, all 4 in-scope surfaces (content-ideas, dms, settings, styles) x 2 densities x 2 themes x 2 viewports = 32 shots. (Calendar excluded — out of scope, owned by `polish/cal`.)

## Preview-server hazard, for the record

Port 4189's `vite preview` process was killed mid-run at least twice by a sibling agent's `pkill -f "vite preview"` (visible in that agent's own command line, captured in `ps aux` while diagnosing a `net::ERR_CONNECTION_REFUSED` failure). Restarted each time from this worktree's own `dist/`; no measurement in the final numbers above was taken against a stale or foreign build — each restart was followed by a fresh `npx vite build` confirmation before re-measuring.

## Commits

1. `dens: the density mode switch (Settings control + boot persistence)`
2. `dens: density tokens for DM rows, settings rows, style cards + DM selmark fix`
3. `merge: wb/polish into polish/dens`
4. `dens: merge wb/polish, fix .dpill/.pushbtn flattener trap on the DM row`
5. `dens: fix the snip ch-cap losing to the wb-solo 88ch rule on the live DMs list`
