# The frame arms, wired, and the ballot assembled

Two jobs. The completeness critic found that the fix for the one complaint
Ivan made in his own words was unreachable from the running app, and that the
run's terminal deliverable did not exist. Both are closed here.

Everything below is either a file:line on `wb/polish` or an instrument reading
taken against the served build at `http://localhost:4188/` (not 4173, which
two sibling agents were using). Authed by injecting `.session.json` into
`localStorage['sb-bjbvqvzbzczjbatgmccb-auth-token']`. The write interceptor on
`**/rest/v1/**` and `**/rest/v1/rpc/**` was installed before every navigation
in every probe.

**Attempted writes across every capture run in this task: 0. No 401.**

---

## 1. The problem, restated in one line

`src/exp/v2c/wbcal.css:460-471` has carried three frame arms as token sets
behind `:root[data-frame='b'|'c']` since the calendar branch. `grep -rn
data-frame src/` outside that stylesheet returned zero. On the served build,
`document.documentElement.getAttribute('data-frame')` was `null`. The arms
existed in the stylesheet and could not be reached from the app, so the
complaint shipped in exactly the state he complained about.

## 2. How the arms are wired now

The same mechanism theme and density already use, not a third one.

**Boot**, `src/main.tsx:19-31`:

```
const frame = localStorage.getItem('inbox-frame')
if (frame === 'b' || frame === 'c') {
  document.documentElement.dataset.frame = frame
}
```

Read once at boot, one key, sitting directly under the identical checks for
`inbox-theme` and `inbox-density`.

**Control**, `src/screens/SettingsScreen.tsx`: a third segmented control in the
Appearance group, next to Theme and Density, built from the same `.seg.theme`
markup and the same `currentX()` / `setXAndPersist()` pair.

**Arm A removes the attribute rather than writing `'a'`.** `[data-frame='a']`
carries no declarations by design (wbcal.css:454-459), so A is the absence of
the attribute. Writing `'a'` would be harmless today and would leave a dead
selector to keep in step; removing it also lets `faithful.css:157`'s own
`24px / 8px` override below 767px apply again, which an arm that restated A's
numbers would have broken the moment the ballot switched away and back.

**Arm A stays the default.** Nothing changes for Ivan until he picks. This is
a taste call and it is his.

## 3. Computed proof, all three arms

Taken through the real wiring. Nothing was injected by hand: each arm is
selected the way Ivan selects it, by `localStorage['inbox-frame']`, so a broken
wiring would have shown up as arm A three times rather than as three labels
over one geometry. Probe: `evidence/frame-arms.mjs`,
`evidence/frame-arms-list.mjs`. Raw output: `ballot/frame-arms-proof.json`,
`ballot/frame-arms-width-cost.json`.

Content lane at 1440x900, dark, read off `.wb` and `.wb.app`:

| arm | `data-frame` | `--plate-gap` | `--plate-r` | `--ground` | `.app` padding | work area | border cost |
|---|---|---|---|---|---|---|---|
| A | `null` | `20px` | `40px` | **`#c5e1a5`** | `20px` | 1400px | 40px, **2.78%** |
| B | `"b"` | `10px` | `22px` | **`#c5e1a5`** | `10px` | 1420px | 20px, **1.39%** |
| C | `"c"` | `3px` | `0px` | **`#c5e1a5`** | `3px` | 1434px | 6px, **0.42%** |

`--ground` is `#c5e1a5` in every arm. It is locked and no arm proposes to move
it. `.app` computed `background-color` is `rgb(197, 225, 165)` in all three,
which is the same colour read a second way.

The plate's own radius follows: 40px, 22px, 0px, read off the surface element
rather than off the token, so the token is not being trusted to have applied.

## 4. The Settings control drives it live

One session, three clicks, read after each (`ballot/frame-arms-proof.json`,
key `settings`):

| action | `data-frame` | `--plate-gap` | `--plate-r` | `--ground` | `localStorage` |
|---|---|---|---|---|---|
| on load | `null` | 20px | 40px | `#c5e1a5` | unset |
| click Tight | `"b"` | 10px | 22px | `#c5e1a5` | `b` |
| click Flush | `"c"` | 3px | 0px | `#c5e1a5` | `c` |
| click Wide | `null` | 20px | 40px | `#c5e1a5` | `a` |

Clicking Wide removes the attribute and stores `'a'`, which the boot check
then reads as "not b, not c", so it does not re-apply. Round trip works.

Rendered: `ballot/frame-settings-control-1440x900-dark.jpg`.

## 5. `#exp/stock` is untouched, proved rather than argued

The arms select `:root[data-frame='b'] .wb`, and `.wb` is the workbench shell's
own class. Stock does not render it. Measured with `data-frame='c'` forced on
the root before stock mounts:

- `document.querySelectorAll('.wb').length` in stock: **0**, with and without
  the attribute.
- `getAttribute('data-frame')` in stock: `"c"` when forced, so the attribute
  genuinely reached the page and simply had nothing to select.
- Screenshots: `ballot/frame-stock-framec-1440x900-dark.png` and
  `ballot/frame-stock-nostoreframe-1440x900-dark.png` are **byte-identical**
  (`cmp` exits 0, same md5).

The Settings control is shared markup and does appear inside stock's Settings
screen, the same way Theme and Density already do. It changes nothing there.

## 6. The finding that changes the ballot: the draft window is a null surface

The task named the calendar and the draft window as the two surfaces to show
the arms on. **The draft window does not respond to the arms at all**, and the
proof is not a guess:

- All three arms render it **byte-identical** at 1440 (`fe6d4a87…`) and again
  at 2560 (`76ea6c67…`), on two separate builds an hour apart.
- Each of those captures recorded `dwOpen: true` with the correct
  `data-frame`, `--plate-gap` and `--plate-r` on the root, so the arm was
  genuinely applied and the window genuinely open.
- Cause, measured: `.wb-tkscrim` is `1440x900` on a `1440x900` viewport,
  x0 y0. The takeover covers the whole screen, so the plate and its border are
  entirely behind it.

So the ballot shows the draft window **once**, with that stated plainly, and
adds the **Content list** as a second surface that genuinely differs. A ballot
that showed three identical pictures over three different labels would have
been worse than showing one.

**A trap worth recording.** The first capture pass wrote a second copy of the
*calendar* under the draft-window filenames, because it did a second
`page.goto()` to the same hash: in a hash-routed app that is not a navigation,
the Calendar tab stayed selected, and the `.ct-card` click hit nothing. Two
arms then looked identical for a reason that had nothing to do with the arms.
`frame-arms-dw.mjs` opens the draft window first, off the List tab a fresh
load lands on, and records `dwOpen` in its own proof so the failure cannot be
silent. `frame-arms.mjs` had its broken draft pass deleted rather than fixed,
so re-running it cannot clobber the good shots.

---

## 7. What is in `BALLOT.html`

One file, `goal-runs/workbench-polish-2026-08-22-out/BALLOT.html`. Built by
`evidence/build-ballot.mjs`, which is re-runnable and exits non-zero if any
source image is missing.

- **2.60 MB**, well under the 20MB ceiling. No recompression was needed, so
  every screen is the original capture at quality 82.
- **20 images**, every one inlined as a `data:` URI. All CSS and JS inline.
- Verified by opening `file:///…/BALLOT.html` in Chromium:
  **0 external requests**, **0 broken images**, **0 console errors**, no
  horizontal page scroll, and **no em dashes** anywhere in the rendered text.

The four decisions, each rendered rather than described:

1. **The green border.** Arms A, B, C side by side on the Content calendar at
   1440, the same three again on the Content list, the draft window once with
   the null-surface note, and the Settings control that changes it. Radio per
   arm. This one goes first because it is the complaint he made.
2. **Density.** Comfortable against compact on DMs, Styles, Settings and the
   Content list. One line says what changed: the type size did not, the leading
   and the padding did.
3. **The draft window**, before against after.
4. **The calendar**, before against after.

Each decision states its question in plain words and carries a radio group.
The picks collect in a sticky bar at the foot of the page, which is held to
about 90px because a taller one covers the screens he is judging. Picks
persist to `localStorage` in a `try/catch`, so a `file://` origin that refuses
storage degrades to "not saved" rather than to a broken page. Nothing submits
anywhere. Any screen can be clicked to see it at full size.

### The honest note on the frame, on the page

The border costs **40px of 1440, 2.8% of the width**, and the page says so in
a table before he picks: A 2.78%, B 1.39%, C 0.42%. It says plainly that this
is a smaller cost than it looks, and that the space he was actually losing on
the calendar came from elsewhere and is already fixed (the chip now sits at
37% of its cell instead of filling it). So the pick is about how the app looks,
not about reclaiming room.

### The honest note on density, on the page

The gain is real and modest, in a table: DM rows 93.8px to 87.8px, which is one
more thread on screen, 9 to 10; Settings rows 72.4 to 60.4; Styles cards 3 of
17 visible to 4 of 17; Content list 105.3px in both, unchanged on purpose. The
page states that **the bigger density win already shipped and is not on this
ballot**, being the rail counts and the calendar chip, which went in
unconditionally and are in every arm. It does not oversell it.

The DM, Settings and Content numbers were re-measured for this ballot on the
build the images came from (`evidence/ballot-density.mjs`,
`ballot/ballot-density-proof.json`) rather than quoted from another agent's
instrument. The Styles card figure is the density agent's, from
`after/dn-density-measurements.json`, because my own selector matched a
different element on that screen and I would rather cite theirs than publish a
number I could not reproduce.

### Provenance

Every "after" image comes from **one build**, captured after the frame wiring,
the Today alert fix, the DM avatar accent fix and the call-transcript port were
all in the tree. Confirmed in the images: the DM avatars are muted, not the
accent. The "before" images are the phase-0 baseline set in `before/`, which is
a different build by definition. The page states this in its own header and
prints the commit plus the count of files still uncommitted in `src/` at build
time, so "one build" is not a claim that quietly rounds off two sibling
branches' work in progress.

## 8. What is not in the ballot

Named so the omissions are not silent.

- **Only 1440 is on the page.** The 2560 arms were captured and are in
  `ballot/`, but the page shows the width he actually works at, and four
  decisions at two widths is eight scroll screens of near-identical pictures.
- **Dark theme only.** Every arm on the page is dark. Light is thin across the
  whole run and adding a half-covered light set to a decision page would
  suggest a completeness that does not exist.
- **No mobile.** 390 is not on this ballot. The frame arms do reach 390, where
  arm A falls back to `faithful.css:157`'s 24/8 and arms B and C win on
  specificity, so the arms are not identical there. Untested by capture.
- **Nothing at 1024**, which the critic correctly flags as the one canvas with
  distinct component output and zero coverage anywhere in the run.
- **The frame arms on Today, DMs, Ops, Sends, Magnets and Strategy.** The plate
  wraps every lane, so all of them move with the pick. Two surfaces were shown
  because two is enough to judge a border and eight is a chore.

## 9. Verification

- `npm run build`: clean.
- `npx vitest run`: **1108 passing, 1 failing, 54 files**. The failure is
  `src/lib/calendarItems.test.ts:402`, the pre-existing wall-clock time bomb,
  byte-identical on `main` and logged at `p4c-today.md:169-171`. Baseline for
  this task was 1042 passing; the count is above it and the failure is the same
  known one.
- `#exp/stock`: byte-identical with and without the attribute, §5.
- `BALLOT.html` opened from disk: 0 network requests, 0 broken images, §7.
- Attempted writes across every probe run: **0**.

## 10. Files

| path | what |
|---|---|
| `src/main.tsx` | boot read of `inbox-frame` |
| `src/screens/SettingsScreen.tsx` | the Frame control |
| `BALLOT.html` | the deliverable, 2.60 MB, 20 images, self-contained |
| `evidence/build-ballot.mjs` | assembles it, fails loudly on a missing image |
| `evidence/frame-arms.mjs` | computed tokens, the Settings control, the stock compare |
| `evidence/frame-arms-dw.mjs` | draft window and calendar per arm, 1440 and 2560 |
| `evidence/frame-arms-list.mjs` | Content list per arm, and the width cost |
| `evidence/ballot-density.mjs` | the density arms and their re-measured numbers |
| `ballot/frame-arms-proof.json` | raw readings, §3 and §4 |
| `ballot/frame-arms-dw-proof.json` | raw readings, §6 |
| `ballot/frame-arms-width-cost.json` | raw readings, the 2.78 / 1.39 / 0.42 |
| `ballot/ballot-density-proof.json` | raw readings, the density table |
| `ballot/BALLOT-rendered-1440x900.jpg` | the ballot itself, rendered from disk |
