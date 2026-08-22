# The draft window, merged and grafted

`polish/dwa` won the blind tournament (`dw-tournament.md`). It branched before
the label purge and the error-card work landed on `wb/polish`, so the merge
conflicted in `DraftPane.tsx` and `Shell.tsx`. This file records what was
resolved and how, the four grafts awarded out of the losing candidate, and the
two accent numbers the panel demanded instead of one.

Branch `wb/polish`, main worktree. Six commits: the merge, one scanner repair
the merge caused, and one per graft.

```
87e1e75  graft 4: the action bar becomes a dock, and gets the edge neither candidate had
291fe2a  graft 3: the wide viewport gets a rule, and the premise gets corrected
3c43b95  graft 2: the stage's metadata is a line of text, not three pills
48902b3  graft 1: four low-frequency controls leave the resting bar
ca4b414  qa: the badge stopped shouting and the prose did not
5e69865  merge: the draft window's elevation pass, over the label purge, both surviving
```

---

## 1 · The merge, resolved on intent

Three conflicts. In every one, both sides had changed the same region for
different reasons: dwa contributed elevation, hierarchy, control weights,
spacing, type roles, motion and the accent budget; the branch already on
`wb/polish` contributed copy, information correctness and the error path. Both
survive in all three.

### `Shell.tsx:72` · two stylesheet imports

dwa added `dwsys.css`, `wb/polish` had added `wbcal.css`, both as the last
import. Both kept. `wbcal` reaches nothing outside `.cal` and `dwsys` nothing
outside `.dw`, so their order is not load-bearing and the comment says so.

### `DraftPane.tsx:222` · the inspector header

| | dwa | wb/polish | resolved |
|---|---|---|---|
| the words | `Details` | `What decides it` | **`What decides it`** |
| the register | sentence case, no uppercase, tracking normal | uppercase, `letter-spacing:.65px` | **dwa's** |
| the tab strip | a travelling indicator (`dwa-tabind`, `stripRef`) | plain buttons | **dwa's** |

Ruling, not relitigated: "What decides it" is specific and has a voice;
"Details" is the generic label that reads as internal-tool by default. What dwa
actually owned in this defect is the REGISTER, and that half is kept whole,
including the removal of the uppercase treatment across all 228 elements.

### `DraftPane.tsx:1064` · the Source rows

The hardest of the three, because the two sides disagreed about which rows
should exist at all.

- dwa deferred every identifier behind an `Identifiers · N keys` fold at a quiet
  12px tabular tier.
- `wb/polish` had DELETED `client_idea_id` and `source_candidate_id` outright
  (internal foreign keys with no page in this app that opens from one), and
  turned `source_post_id` from a raw `urn:li:activity:...` print into a
  `View the live post ↗` link with the urn kept on hover.

Resolved: the deletions stand and the link stands. A fold is still a promise
that opening it pays, and those two keys open nothing, so deferring them would
have resurrected deleted data behind a chevron. What survives the purge is
`source_ref`, and it takes dwa's deferral and dwa's quiet tier.

Resting Source panel: `Source · manual`, `Spun from post · View the live post ↗`,
and `Identifiers · 1 key` holding `Ref`.

### What had to survive, and did

| landed earlier on `wb/polish` | check |
|---|---|
| "Backend depth" is "What decides it" | present, and `no-internals.mjs` still greps for the old words as a named defect |
| `source_post_id` is a link, urn on hover only | present |
| `client_idea_id` / `source_candidate_id` rows deleted | present |
| `REWRITE_OK` and other raw enums stop rendering | present, and extended (see §2) |
| `draftFailureReason` derives the real cause from the terminal `agent_log` entry | untouched, `src/lib/content.ts:2440` |
| errored cards carry a retry | untouched, `RetryDraft.tsx` |
| the glance layer: rail counts, the `waiting on you` roll-up | untouched, `Rail.tsx:121`, `useGlanceCounts.ts` |
| the calendar's `data-frame` attribute | untouched, `wbcal.css:454` |

**Tests after the resolution: 995 passing, 1 failing.** The failure is the
pre-existing `src/lib/calendarItems.test.ts` "passing no queue is the old
behaviour exactly", which is the documented baseline on this branch. Identical
before and after every commit in this run. dwa's own 906 was against its older
base; nothing was lost in the resolution.

---

## 2 · One repair the merge caused, found by the gate

`no-internals.mjs` allowlists a rubric dimension key only when it can read that
key off a rendered `.qa-dim-k` badge, because `rubric.ts` documents that
vocabulary as open and row-specific rather than a fixed enum. dwa sentence-cases
the badge (`dimName()`), so the allowlist started holding `AI tells` while the
judge's own summary paragraph went on quoting `AI_TELLS` inside sentences.

Result on the first post-merge run: **FAIL, 4 hits, 2 distinct**:
`AI_TELLS` on rows 9 and 10, `FIRST_PERSON_PRESENCE` on rows 8 and 10.

This was not a false positive. A raw enum rendered as read text, next to a badge
that no longer matches it, is the defect the gate exists for; sentence-casing
one and not the other made the window LESS consistent, not more.

Fixed in `Register.tsx` with `deShout()`, whose vocabulary is the row's own
declared dimension keys and nothing else. A SCREAMING_SNAKE token the judge did
not declare as a dimension is left exactly as written, because it is then a
verdict or a gate code and that function has no standing to rewrite it.

**After: `no-internals: PASS. 0 hits across every surface walked.`**

---

## 3 · The four grafts

Nothing from the losing candidate's inspector travelled. Its meter block, its
amber callout treatment, its row highlight and its teal recolour are all steps
backwards from the winner and are the reason it lost.

### Graft 1 · `Fix or remove ›` replaces four resting tertiary controls

| | before | after |
|---|---|---|
| controls at rest (published row, 1440) | `Edit`, `Schedule`, `Regenerate`, `Add image`, `Delete draft` | `Edit`, `Schedule`, `Fix or remove ›` |
| controls at rest (actionable row) | 7 | 4 |
| destructive control in the 390 thumb zone | yes | no |
| bar height at 2560 | 103px | 58px |

The four are one click away in a shelf at full bar measure, with a hairline
divider and a spring reveal on transform and opacity only. Nothing is removed:
each still takes the same write and carries the same confirm, and the shelf is
wide enough for the still-library picker rather than squeezed into a menu.

`Delete draft` keeps this branch's quiet error-text weight
(`.wbb-danger`, 32px, transparent, `--sev-danger` label, `margin-left:auto`).
The losing candidate rendered it full red at sibling size and last, so it took
the eye; the panel asked for exactly that one change on the way in.

### Graft 2 · plain-text metadata replaces bordered pills

| | before | after |
|---|---|---|
| rendering | three chips | one line |
| chip `background-color` | `rgb(39,39,39)` | `rgba(0,0,0,0)` |
| chip `padding` | `1px 6px` | `0px` |
| reads | `[Text] [Published] [edited 1d ago]` | `Text · Published · edited 1d ago` |

Scoped to `.dw-main-in`, so the same class on nine other surfaces and in the
inspector is untouched. The semantic chips keep their colour: `ct-chip-bad` is a
failing row saying so, and a warning that stops warning to satisfy a pattern is
a worse bug than the pattern. The separator is drawn by the row rather than
typed into the data, so a lane with one fewer chip does not get a leading
middot.

### Graft 3 · the wide viewport gets a rule, and the premise gets corrected

The award reads "centre the column at 2560, the winner left it pinned left".
**Measured first, and that premise did not survive the measurement.**

```
.dw-main-in   max-width 640px   computed margin  0px 340px   inside a 1320px track
```

The column is not pinned left. `styles.css:1022` centres it with `margin:0 auto`
and dwsys never overrode that, at any viewport, in either theme.

What IS real, and is what the panel measured rather than what it named, is the
dead canvas. The stage track was `1fr`, so it ate every pixel the window gained.
`wb2026.css` §D6 had already ruled on where that width belongs, "THE
TAKEOVER'S SURPLUS GOES TO THE INSPECTOR", and then left the stage on `1fr`,
which is the one line that stopped its own rule from being true.

| at 2560x1440 | before | after |
|---|---|---|
| grid tracks | `320 / 1320 / 920` | `320 / 1000 / 1240` |
| `.dw-main-in` computed margin | `0px 340px` | `0px 180px` |
| bare ground beside the artifact | 680px | **360px** |
| `.dw-main-in` width / `.li-card` width | 640 / 520 | **640 / 520** |

The measure does not move, at any width. A wider ribbon would make the preview
lie about what LinkedIn shows. The horizontal centring is now restated inside
`dwsys.css` §11 so it is load-bearing on a rule this run owns rather than
inherited from a sheet three files away.

The vertical is deliberately NOT centred. The losing candidate centred the block
in both axes and pushed the heading a long way down the viewport; the award
excludes that half by name.

Proof: `after/dw-final-2560x1440-dark.jpg` and `-light.jpg`. The whole LinkedIn
card including the Like / Comment / Repost / Send row is visible with the dock
below it and clear of it.

### Graft 4 · the dock's shape, and the edge neither candidate had

The bar was the stage card's welded footer: square top corners, a hairline
above, fused to the artifact. It is a dock now: a separate contained object at
the artifact's measure, resting on the well's ground, full radius on all four
corners, lifted 14px off the floor at wide viewports. Below 1180 it used to
bleed to the window edges and go square; that reasoning was right about a footer
and wrong about a dock, so it keeps its shape there too.

The edge is the part the tournament says neither candidate had. In light mode
`--e2` is `#FFFFFF`, so a white bar welded to a white artifact card had no
boundary of any kind.

| `.dw-acts` | before | after |
|---|---|---|
| `box-shadow` | `none` | `rgba(0, 0, 0, 0.08) 0px 2px 8px 0px` |
| `border-radius` | `0 0 var(--r-card) var(--r-card)` | `var(--r-card)` |
| `border-top` | `1px solid var(--hairline)` | `0` |

`--sh-card` is the existing token (`wbsys.css:270`). 8% alpha, inside the 8 to
12% `wispr-calibration.md` §3 licenses, and it sits ON TOP of the lightness step
against the `--e1` well rather than instead of it, which is what that section
actually says.

Proof: `after/dw-final-1440x900-light.jpg`.

---

## 4 · The accent census, in two numbers

The tournament's sharpest catch: both candidates reported "13 accent elements
down to 1" from the same census, both were literally true, and one of them had
fifteen saturated elements on screen at rest. The number moved because the
definition of accent moved. The colour did not leave the screen.

So this run reports two, and where they disagree the second one is the truth.
Instrument: `evidence/dw-final-accent.mjs`.

- **A · accent-token elements.** DOM elements painting `--accent` as a fill, as
  their own text colour, or as a border / outline / shadow colour, scoped to
  `.dw`. Same definition census B3 uses.
- **B · saturated elements visible at rest, from the rendered pixels.** The
  viewport screenshot is decoded in a canvas; every pixel with HSL saturation
  above .35 and lightness between .15 and .90 is labelled; connected components
  under 60px are dropped as antialiasing. No DOM, no tokens, no definition this
  run controls.

| viewport / theme | A · accent-token | B · saturated at rest, chrome | B · inside the LinkedIn artifact |
|---|---|---|---|
| 1440x900 dark | 1 | **4** | 10 |
| 1440x900 light | 1 | **4** | 10 |
| 2560x1440 dark | 1 | **6** | 10 |
| 2560x1440 light | 1 | **5** | 10 |
| 390x844 dark | 1 | **1** | 6 |
| 390x844 light | 1 | **1** | 6 |

The two are attributed separately because the LinkedIn preview is CONTENT, not
chrome: its avatar, its own reaction glyphs and the post's image are saturated
pixels this run does not spend and must not claim credit for. Blobs falling
inside the `.li-card` rect are reported apart from the rest.

**The four chrome blobs at 1440 dark**, by area:

| area px² | box | what it is |
|---|---|---|
| 2837 | 82x38 at (364,806) | `Approve`, the one accent fill |
| 1238 | 207x6 at (1160,229) | the QA score meter, on `--sev-clear` |
| 497 | 100x5 at (1209,323) | the one failing dimension bar, on `--sev-attention` |
| 86 | 2x43 at (1094,261) | the verdict-clash callout's 2px left rule |

They disagree, 1 against 4, and the second is the truth: the score meter and the
failing bar are off the accent TOKEN and still saturated ON SCREEN. The
difference between this and the state the tournament caught is size and count,
not honesty about the token: the loser left nine bars at full size and had
fifteen; this has three severity marks plus the decision, and the largest
saturated object on the screen is `Approve` rather than the QA readout.

At 2560 the chrome count rises to 6 because the inspector is wider, so the same
two bars are longer and one more log-row chip clears the 60px floor. Nothing new
is coloured; existing marks get bigger. That is the instrument being honest
about a thing the DOM census cannot see either way.

### The instrument bit me once, and it is worth recording

The first run of this census reported **9** accent-token elements and I nearly
shipped it as a finding. It was reading `--accent` off `document.documentElement`
where `src/styles.css:4` defines it as `#10A37F`, while `faithful.css:58`
REDEFINES it to `#B8FF66` inside `.wb`. And `#10A37F` happens to be exactly
`--sev-clear`, so every QA bar scored as an accent hit. Nine bars, a fake
regression, from reading a token off the wrong element. The census now reads the
token off `.dw`. Same lesson the panel drew: the number is only as good as the
scope it was taken in.

---

## 5 · Verification

```
npm run build            clean (tsc -b, then vite build, 0 errors)
npx vitest run           995 passing, 1 failing
                         the failing one is the pre-existing calendarItems.test.ts
                         baseline, unchanged before and after every commit
conflict markers         grep -rn '<<<<<<<\|>>>>>>>' src/   → 0
no-internals.mjs         PASS, 0 hits across every surface walked
attempted writes         0, across every browser run in this session
console errors           0, across all six viewport/theme captures
src/styles.css           no diff, #exp/stock untouched
em dashes authored here  0
```

Every browser run installed the write interceptor on `**/rest/v1/**` **and**
`**/rest/v1/rpc/**` before any navigation, fulfilling PATCH, PUT, DELETE and
non-rpc POST with `200 []`, and counted what it blocked. `tools/refresh.mjs` was
never run.

Every selector authored in `dwsys.css` §11 carries three `.wb` classes.
`faithful.css:181` is `.wb.wb, .wb.wb *{ font-size: ... }` at specificity 0-2-0
and a two-class selector loses to it silently, rendering at body size while
reading correctly in the diff.

### Screenshots

`goal-runs/workbench-polish-2026-08-22-out/after/`, same instrument and framing
as the `before/` set (`evidence/dw-final-capture.mjs`, derived from
`dwa-capture.mjs`):

```
dw-final-1440x900-dark.jpg    dw-final-1440x900-light.jpg    ← graft 4's proof is the light one
dw-final-2560x1440-dark.jpg   dw-final-2560x1440-light.jpg   ← graft 3's proof
dw-final-390x844-dark.jpg     dw-final-390x844-light.jpg
dw-final-actions-1440x900-dark.jpg     dw-final-actions-390x844-dark.jpg
dw-final-inspector-1440x900-dark.jpg   dw-final-inspector-390x844-dark.jpg
```

---

## 6 · What is still wrong, unsoftened

The tournament's watch-first list survives the grafts, because the grafts were
awarded for the artifact region and every item on that list is somewhere else.

1. **The agent log** is still ten internal agent names, ten timestamps and a
   glyph each, at rest, on every viewport. `Promoter`, `Editorial Agent`,
   `Lint Gate`, `AI-Slop Gate`, `Claim Check`, `Forbidden Language Gate`,
   `QA Agent`, `Content Agent`, `Hook Agent`. The reviewer's question about it
   is "did anything go wrong", and the panel answers that only by making him
   read all ten rows. Highest remaining defect on the screen.
2. **`Raw judge output · 2,389 characters`, `rewrite_total 74`,
   `Verdict provenance · 3 fields`, `Gate detail · 1 gate`.** Variable names and
   item counts used as section headers. Visible at rest, both themes, every
   viewport. `no-internals.mjs` does not catch them because they are neither
   uuid, urn, nor SCREAMING_SNAKE, which is a limit of the gate and not an
   absolution.
3. **The dock still covers part of the post image at 1440 and 390.** Graft 4
   changed how the bar reads, not where it sits. `reference-study` §2 Move 4 says
   the row belongs at the bottom edge of the artifact, which is correct at 2560
   and wrong at every smaller viewport. Untouched on purpose: it is a layout
   change, not a graft.
4. **The three-region arrangement is unresolved.** The right rail is still
   organised by where the data came from rather than by what the operator needs
   to know. Winning a tournament inside the existing shape did not prove the
   shape is right, and this run did not test it either.
5. **The queue rail's selected row** still carries an accent-family tint. It is
   `--accent-soft` at 14% alpha behind neutral text, which `reference-study` §3
   Move 2 explicitly licenses for "selected but not primary", so it is reported
   separately rather than folded into the count above. Same disclosure both
   tournament candidates made, and it is still the right one.
6. **The 390 log-row timestamp wrap** was not re-measured this run.
7. **The `Spice check` control** is still a bare label with no visible
   affordance at the foot of the summary card. It reads as a leftover because it
   is one.

## 7 · The one place I did not do what the award said

Graft 3 asked for a centring that the measurement says was already there, and
named a defect ("pinned left") that does not reproduce on this branch at any
viewport in either theme. I implemented the dead-space half of it, which does
reproduce and which the panel's own closing section measured correctly, and
recorded the correction rather than shipping a change that would have been a
no-op wearing the award's words. The horizontal bare ground at 2560 went 680px
to 360px. The artifact's optical centre still sits left of the screen's, and
cannot be moved to it without equalising the two rails, which would mean a 700px
queue rail of post titles. That is a composition question for the run that takes
on item 4 above, not something a graft can close.
