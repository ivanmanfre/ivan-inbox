# Phase 1 — the facet wall is gone

Builder run, branch `exp/vis-faithful`, worktree `wt-faithful`. Commits `7bceafa` → `d3ee53f`.
Dev server :5431 (never restarted). Captures in `phase1-shots/`, raw numbers in `phase1-measure.json`.

Owner's verdict this phase answers: *"there is a super mess with the sources and tag search dude wtf is
this."* The mess was never the counts — those are honest, derived per value from the loaded rows. The mess
was that all eighteen facets and all 105 of their values were rendered permanently, above the work.

---

## 1 · Before → after, measured

Both states at 1440×900 **with the Claude peer docked** (the app's default, `Shell.tsx:97-101`), Ivan lane,
the same session, the same 173 loaded drafts. "Before" numbers are phase0's (`phase0-facets.md` §3);
"after" is `phase1-measure.json`.

| | before | after | |
|---|---|---|---|
| post-lane filter block height | **806px** | **100px** | −88% |
| lead-magnet lane filter block | **262px** | **68px** | −74% |
| both blocks combined | **1,068px** | **168px** | −84% |
| first `.ct-card` y | **1,439** (539px below the fold) | **797** | above the fold |
| draft rows in the first viewport | **0** | **2**, both with live SKIP / APPROVE | bar met |
| always-rendered chips in the filter chrome | **105** | **0** | — |
| always-rendered facet groups | **18** | **0** | — |
| visible controls | 18 groups × N chips | 1 search field + 5 pills + 1 disclosure, per list | — |
| search field | **none** | 1 per working list | — |
| facets reachable | 18 | **18** (9 demoted behind `Filters ⌄`, all counts intact) | nothing deleted |

Mattan lane, same conditions: filter block **100px**, first card at **y=289**.
390×844: collapsed filter chrome **114px per list** (bar: ≤120), document horizontal overflow **0**,
console errors from `src/` **0** at both widths.

The counts survived verbatim. `Source ⌄` opens onto `Client Calls 31 · Kyle call 30 · Web Research 29 ·
Breaking news 17 …` — the same 19 values the wall printed, now in a 210px scrollable panel instead of
across four wrapped lines of the page.

Captures: `phase1-shots/after-1440.png`, `after-390.png`, `panel-open-1440.png`, `sheet-390.png`, plus
`filters-panel-1440.png` (the demoted disclosure), `lm-lane-1440.png`, `mattan-1440.png`.
Before side: `phase0-shots/facets-01-content-ivan-viewport.png`, `mobile-content-*`.

---

## 2 · The anatomy built

New component: **`src/exp/v2c/FilterRow.tsx`**. It reuses `.wb-fpill` / `.wb-fmenu` / `.wb-fopt` —
the classes `SendsScreen.tsx:284-310` already ships as `Range: 7d ⌄` — rather than inventing a fourth
filter chrome (§11.3: *zero bespoke filter chrome*). Sends is untouched and still works.

| piece | file:line | notes |
|---|---|---|
| `FilterRow` (the whole control) | `FilterRow.tsx:267` | search + pills + disclosure + Clear all + the honest footnote |
| `FacetPill` — `label: value ⌄` | `FilterRow.tsx:149` | real `<button>`, `aria-expanded`, its own ✕ as a separate button |
| `FacetOptions` — options with counts | `FilterRow.tsx:100` | leads with `Any <facet>` so clearing one facet is a value, not an undo |
| `MorePill` — `Filters ⌄` + live badge | `FilterRow.tsx:204` | every demoted facet in one scrollable panel; picking does **not** close it |
| `Sheet` — the 390 bottom sheet | `FilterRow.tsx:127` | own scrim, tap-out + grab handle + Escape, ≥44px rows |
| `usePlace` — flip / height cap | `FilterRow.tsx:71` | measured once on open (see §5) |
| `useDismiss` — Escape + outside click | `FilterRow.tsx:47` | both, not one |
| `useSheetMode` — `(max-width:767px)` | `FilterRow.tsx:32` | the only viewport read in the component |
| CSS, section 8b | `faithful.css:994-1163` | `.ct-fr:1004` `.ct-fsearch:1013` `.ct-fpills:1032` `.ct-fpill:1042` `.ct-fn:1046` `.ct-fx:1052` `.ct-fmenu:1071` `.ct-fmenu-r:1079` · 390 block `:1090-1123` · sheet `:1126-1153` · hover `:1156-1163` |

Facet split (pure, unit-tested): `splitFacets()` `contentFilters.ts:106`, `DRAFT_PROMINENT` `:122`
(`stage, kind, pillar, source, qa_verdict`), `RESOURCE_PROMINENT` `:127` (`status, format`).
Search: `applySearch()` `contentFilters.ts:139`.

Wiring — three working lists, three independent rows:

- post lane / Ivan: `ContentList.tsx:434-435`, rendered `:457`
- post lane / Mattan: `ContentList.tsx:564-565`, rendered `:608`
- lead-magnet sub-lane: `ContentSections.tsx:388-395`, rendered `:492`

The old `FilterBar` (`ContentBits.tsx:87`) is **not** deleted: it still serves the three
collapsed-by-default lists that add 0px to the wall unless opened — Ideas (`ContentSections.tsx:192`),
the publish queue (`:256`) and the style roster (`:573`). Those were out of scope and touching them would
have been diff growth for its own sake.

Contract conformance, probed on the rendered page (`scripts/_p1-verify.mjs`):

```
controls: 9 elements, tags {BUTTON: 9}, cursor {pointer: 9}
transitions: ["background-color 0.1s"]      eases: ["cubic-bezier(0.25, 1, 0.5, 1)"]
focus: tabIndex 0, outline "2px solid" (the global :focus-visible ring reaches them)
type census: 8 distinct font sizes, all integers · 1 element ≥700 weight, at 56px
accent census @1440: 24 elements (bar: ≤30) · pill radius ≥100px only on .wb-fpill (licensed §6.3.3)
```

---

## 3 · Persistence

**`src/lib/sectionState.ts`** — the generalisation of `today.ts:335`'s "WHITELIST PROJECTION, NOT A COPY".
Pure, no React, unit-tested in node (`sectionState.test.ts`, 10 cases).

- **Field allowlist**, `SECTION_FIELDS = ['filters','q']` (`:42`). `projectSectionState()` (`:81`)
  *reconstructs* the object from those two named fields; it never spreads. It runs on the **write path and
  the read path both**, because the bytes on disk are attacker-writable in a way the in-memory object is
  not. Test asserts a blob carrying `rows`, `approve_url?k=SECRET` and `client_id` comes back with exactly
  two keys and no trace of either string.
- **Version key**, `SECTION_STATE_VERSION = 1` (`:31`). Any other value — or a version-less blob — returns
  the empty state. Facet *keys* are a data contract (`qa_verdict`, the family-keyed `structure:hot-take`),
  so when that contract moves the honest answer is to forget, not to restore a filter whose meaning moved.
- **Shape and size caps** (`:49-52`): 24 facets max, keys must match `/^[a-z][a-z0-9_]*$/`, values ≤160
  chars, `q` ≤120. Non-string filter values are dropped; an empty value is stored as *absence*.
- **Never persisted**: row data of any kind — no titles, bodies, ids, urls, counts. Facet key, facet value,
  search string. That is the whole surface.
- **Empty state deletes the key** (`writeSectionState:142`), so "did I leave a filter on?" is answerable by
  the absence of `wb-section:*` in storage.
- Key namespace: `wb-section:<section>`. Live keys today: `content.posts.ivan`, `content.posts.risedtc`,
  `content.lm.ivan`, `content.lm.risedtc`. Sends/Drafts/Ops adopt it by passing one more string.

Hook: **`src/hooks/useSectionState.ts`** — reads storage synchronously in the initialiser (instant paint,
same rule as the Today cache), re-reads when the section key changes, and takes a **functional updater**
(see §5, defect 2).

### The reset that was killed, and why the reason it existed still holds

`ContentList.tsx:663-667` was:

```ts
const [filters, setFilters] = useState<FilterState>({})
// 🔴 Filters are never persisted across a lane switch: the two lanes spell the
// same ideas differently ('story' vs 'story_opener'), so a carried filter would
// silently hide rows …
const switchLane = (l: ContentLane) => { setFilters({}); setLane(l) }
```

Now `ContentList.tsx:684-700`: state comes from `useSectionState(\`content.posts.${lane}\`)` and
`switchLane` only sets the lane.

**Judgment call.** The stated reason is correct and is *preserved by keying rather than by amnesia*: the
section key carries the lane, so a value set on Ivan's lane can never be applied to Mattan's vocabulary —
there is no carried state to mis-apply. Forgetting was never the safety property; not crossing lanes was.
What changes is that coming back to a lane restores the answer you left there, and a reload no longer
throws it away. Verified in the browser:

```
set Source: Client Calls + Kind: single_image + q:"a"  → "16 of 173 drafts shown"
full document reload      → pills restored, q "a", "16 of 173 drafts shown"
switch to Mattan          → all pills "Any", q "" (its own key, correctly empty)
switch back to Ivan       → Source: Client Calls, Kind: single_image, q "a"
Clear all                 → localStorage key removed, "173 drafts"
```

---

## 4 · Mobile (390×844)

- Collapsed filter chrome **114px** per working list (bar ≤120). Search field 36px on its own row, pill row
  32px below it, footnote under that.
- The pill row is a **real** horizontal scroller with an announced edge: `scrollWidth 628 / clientWidth 358`,
  and `scrollLeft` driven 0 → **270** in the probe. A right-edge fade (`faithful.css:1113-1117`) marks it.
  The previous scroller on this surface was a defect precisely because nothing announced it (2,219px in a
  358px box, no scrollbar, no fade) — an announced scroller over six pills and an invisible one over
  eighty-one chips are not the same control.
- Each pill's panel opens as a **bottom sheet**: measured 333px tall, 6 rows, **minimum row height 44px**,
  grab handle, and tap-out verified to close it (`sheetClosed: true`). Escape closes it too.
- Document horizontal overflow at 390: **0** (D10).
- Pill height at touch is **32px**, per spine §11.1 (`30px ≥768 / 32px touch`) and the brief's own pill
  anatomy. The ≥44px bar is applied where the brief applies it — the sheet's touch rows.

---

## 5 · Defects the browser caught (both mine, both fixed and committed separately)

1. **A wrapping column flex container never scrolls.** `0e9a4f2`. At 390 the pill row measured
   `clientWidth 628` inside a 358px row and simply clipped — `flex-wrap:wrap` in `column` direction sizes
   the single flex line to the widest item's *max-content*, not to the container, so `overflow-x:auto` had
   nothing to scroll against. `flex-wrap:nowrap` at ≤767 (`faithful.css:1099`). This is the old wall's
   exact failure mode — a clipped row the document-overflow instrument cannot see — reproduced inside the
   fix for it.
2. **Two sequential setters never compose.** `0e9a4f2`. "Clear all" called `setFilters({})` then
   `setQ('')`; both closures read the same pre-click snapshot, so the second call restored the filters the
   first had dropped — the pills went blank while localStorage still held
   `{"source":"Client Calls","kind":"single_image"}`. `useSectionState` now takes a functional updater and
   writes inside the reducer, against the state React actually produced.
3. **A panel that clipped its own counts off the pane edge.** `d3ee53f`. `Filters ⌄` is the last pill in a
   620px column, and a `left:0` popover ran past the pane. `usePlace` (`FilterRow.tsx:71`) measures once on
   open, flips to `right:0` when it would overflow, and caps `max-height` to the room below it. Measured
   after: panel fully inside the pane, `Structure · HOT TAKE 11 · TEARDOWN 9 …` legible, 340px of content
   capped to 183px with the rest scrollable.

---

## 6 · Every judgment call, with its reason

1. **`FilterBar` kept for Ideas / publish queue / style roster.** They are collapsed by default and
   contribute 0px to the wall unless opened; the brief scopes this phase to the two working lists. Rewriting
   them would be diff growth with no measured defect behind it.
2. **Per-lane keys instead of a carried filter.** Covered in §3. The brief said "state must survive lane
   switch"; keying delivers that (switch away, come back, it's there) while keeping the vocabulary hazard
   structurally impossible. A literally-carried filter would have re-opened the exact bug the killed comment
   named.
3. **`board` demoted on Mattan's lane** (`ContentList.tsx:564`, comment in place). That lane is already
   *grouped* by board visibility (`BOARD_GROUPS`), so a board pill is a second control for a distinction the
   page structure already draws. It stays in the disclosure.
4. **Counts derived over all loaded rows, not over the current result.** "Published 109" is the fact you are
   choosing *against*; a count that already reflects the choice you have not made yet is a moving target.
   Same `buildFacets` derivation as before, unchanged.
5. **`Any <facet>` as the first option** rather than a separate "clear this filter" control. It is the state
   the facet is actually in, so it reads as a value; the ✕ on the pill is the fast path for the same thing.
6. **The demoted panel does not close on pick**, the prominent pills do. Secondary facets are usually set
   two at a time (structure + image style); a triage axis is usually set one at a time and you want to see
   the list immediately.
7. **Search is client-side over the loaded page**, matching how the facets already work — which is why the
   footnote still prints `N of M shown` and still says `filtering the N loaded of TOTAL in the database`
   when PostgREST's cap is in play. Nothing here claims to have searched the lane.
8. **Search field capped at 250px** (`faithful.css:1013`, comment in place). Uncapped it filled the line and
   pushed every pill onto its own rows — 134px instead of 100px in the docked-peer column. Capped, the first
   pills sit *in the search field's row*, which is what §11.2 describes.
9. **`.ct-fpills` given a flex basis** rather than `auto`. At `auto` its hypothetical size is max-content
   (~660px), which exceeds the line, so the whole box wrapped before any shrinking happened — a third row of
   chrome for nothing.
10. **`ct-fn` (the demoted badge), `ct-fx` (the clear ✕) and the sheet grab handle take `--r-chip`/2px, not
    `--r-pill`.** None of them is on the §6.3 licence list. Only `.wb-fpill` capsules, and it is licensed
    item 3. Confirmed by computed-radius census.
11. **Hover is one property.** `background-color`, `--dur-hover` (100ms), `var(--ease)`. I removed a `color`
    transition I had written first: §10.3 bans animated colour, and §7.4 names the background shift as *the*
    hover mark. Probe returns exactly one transition string and one easing across all nine controls.
12. **Sheet entrance animates `transform` only**, one keyframe, `var(--ease)`, 180ms — a transient overlay is
    the one class §3.4 licenses for shadow and §10.4's deletions do not name it. Reduced-motion already kills
    it via the existing `@media` block.
13. **No `useMemo` added.** `splitFacets` is a `Map` build plus two filters over ≤18 items, run in the same
    render that already runs `buildFacets` over 173 rows. Memoising it would be speculative.

---

## 7 · Gates

```
npm test    24 files, 412 tests, all passing (baseline 394 — 18 added, 0 changed)
              sectionState.test.ts   10 cases: allowlist (write path AND read path), versioning,
                                     caps, wrong shapes, empty-deletes-key, per-section isolation
              contentFilters.test.ts 15 → 23: splitFacets (order, nothing lost, counts preserved,
                                     absent facet ⇒ no pill, LM pair) + applySearch
npm run lint  zero warnings from any file this phase touched or added
              (the repo's 32 pre-existing warnings are all in scripts/*.mjs, goal-runs/*.mjs
               and six unrelated src files; none is new)
npm run build tsc -b + vite: clean, 0 errors
console       0 errors from src/ at 1440 and at 390
```

Spine censuses on the Content screen after the change: 8 distinct font sizes (≤9), all integers; 1 element
at weight ≥700 and it is 56px; 24 accent elements at 1440 (≤30); pill radius only on licensed classes;
0 horizontal overflow at 390. `:root` in `src/styles.css:1-16` untouched; no new dependency, webfont or
`@font-face`; every commit staged by explicit path; nothing pushed; `main` untouched.

## 8 · Not done here (and deliberately)

- The app-wide hover pass is Phase 3; the only hover work in this diff is on the controls this phase created.
- `Hook`'s lane-vocabulary mismatch (`story` vs `story_opener`) is untouched. It is a data-alias problem, it
  now lives in the disclosure where it does less damage, and merging the two spellings is a claim about the
  rows that needs its own decision.
- The three collapsed lists still use the old bar (§6.1).
- 390 still does not put a draft row in the first viewport (first card y=879 of 844) — the alert strip and
  the pipeline chart own that space, not the filters. That was not this phase's bar; it is the obvious next
  measurement if someone wants mobile parity.
