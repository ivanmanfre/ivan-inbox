# Phase 0 — Surface classification (orchestrator synthesis)

Date: 2026-08-02. Inputs: `phase0-inventory.md` (full screen inventory, every claim file:line-cited),
`phase0-counts.md` (real row counts via authed PostgREST probes, `Prefer: count=exact`),
`phase0-diagnosis.md` (measured-meh re-verification). Branch `exp/brain` @ `17e3cfb`.

## Scope ruling (binds Phases 2-3)

**The redesign target is the v2c Workbench** (`#exp/v2/...`), the winning structure carried forward from
`inbox-v2-revamp-2026-08-01`, plus the screens it mounts from the default app (`TodayScreen`, `DraftsScreen`,
`SendsScreen`/`OverviewView`, `OpsScreen` internals, `ThreadScreen`, `SettingsScreen`).

v2c has **zero theme logic of its own** — it inherits every colour token from `src/styles.css:1-16`
(inventory, "Theme system (v2c)"). Two consequences, both binding:

1. **Treatment scoping:** candidates override the token set at the `.wb` root
   (`.wb { --bg: …; --surface: …; }`) plus a treatment stylesheet imported by the v2c shell. CSS variables
   cascade, so stock screens mounted inside the workbench inherit the candidate ladder with **zero edits to
   the default app**. `src/styles.css:1-16` (`:root`) stays untouched; the `#exp/` gate holds even on the
   candidate branch. The prior run's instrument candidate retoned `:root` globally; this run does not.
2. **v2c local radii** (`.wb{--r-sm:14px;--r-md:16px;--r-lg:20px;--r-chip:7px}`,
   `src/exp/v2c/styles.css:11-16`) are part of the treatment surface — candidates may redefine them.

Two v2c-local light-mode chrome patches (`v2c/styles.css:58`, `:127`) must be visited by every candidate or
the rail/pane headers will fight the new ladder.

## Classification table

Class definitions: **overview** = chart-forward, the Nixtio reference applies directly (M1-M9).
**working-list** = density-forward, reference applies only through the shared spine.
**detail/form** = spine-only (type scale, ladder, hairlines, mark anatomy where present).

| # | surface | route | class | real density (measured) | anchor column today |
|---|---|---|---|---|---|
| 1 | Today | `#exp/v2/today` | **overview** (hybrid: zones 01-02 are short working rows) | masthead numeral + 3-seg stack bar; urgent rows capped 30 (`today.ts:337`) | yes — avatar |
| 2 | Sends → Overview (`OverviewView`) | `#exp/v2/sends` | **overview** — the archetype exemplar | 8 parallel real queries, 4 chart primitives, everything renders at once | yes — severity dot |
| 3 | Sends → Lanes | same | **overview** | 4 lane cards, `Spark` from `inbox_sends_daily_v` | yes — status dot |
| 4 | Ops (`OpsBoard`) | `#exp/v2/ops` | **hybrid** | 4 KPI tiles + `StackBar`; pending queue (ops_drafts ≤300, full cards w/ textarea) + read history | kind chip |
| 5 | Inbox (`InboxHead` + list + `ThreadPeer`) | `#exp/v2/inbox` | **working-list** | 2,154 msgs in `inbox_messages_v` (158 in / 1,996 out) grouped to threads; ROW_H=73, ~9 visible @390 | yes — avatar |
| 6 | Drafts / DMs (`DraftsScreen`) | `#exp/v2/drafts` | **working-list** | draft-bearing threads as swipe cards, ~3-5 visible | yes — avatar |
| 7 | **Content (`ContentList` + sections)** | `#exp/v2/content` | **working-list + embedded chart — THE TEST SURFACE** | 285 `carousel_drafts` (201 ivan / 84 mattan; 88 review, 118 published); Ideas 59 rendered of 1,716; Queue 152 (135 posted, 11 error); Resources 127; Styles 124 active | **no** — status chip floats inline in the meta row (`ContentList.tsx:72-89`), no fixed leading column |
| 8 | Sends → Log | `#exp/v2/sends` | **working-list** (read) | renders newest 360 of 1,752 sent + newest 60 of 246 blocked (76% of failures invisible by construction — see counts file) | chip badge |
| 9 | Thread / DraftPane / ChatPane peers | peer panes | **detail** | DraftPane ~15-25 populated fields; QA score bar real | n/a |
| 10 | Settings | `#exp/v2/settings` | **form** | 5 rows | n/a |

Reasoning worth recording:

- **Content is the test surface** (spec's central risk, confirmed by measurement): it is the app's widest
  composite (5 sub-tables), its largest actionable bucket (88 in review), and the one surface with **no
  anchor column** — the meta chip floats inline, so nothing tells the eye which row it is on. Judges weight
  it hardest; the three-second row-find test runs here at 390 and 1440.
- **OverviewView is where M2/M3/M4 (viz-as-hero, metric anatomy, legend+total) land natively** — 8 real
  queries and 4 chart primitives already exist; the reference upgrades their craft, it does not invent data.
- **Sends → Log truncation is a design fact, not a bug to fix here:** the log can honestly say
  "newest 360 of 1,752" — a candidate that adds the denominator is using real data (counts probe proves the
  totals exist); a candidate that charts "all sends" from the 360 fetched is misrepresenting. Written into
  the spine contract.
- **Ideas lane renders 59 of 1,716** (`status='reviewing'` filter, `content.ts:290-301`) — the lane is
  honest, but any "ideas total" figure a candidate wants must come from a count probe, not `rows.length`.

## Diagnosis confirmation (Phase 0 requirement)

`phase0-diagnosis.md`: all five measured-meh claims **hold exactly** on current `exp/brain`
(8/9 iOS tokens hex-for-hex; 28 distinct sizes incl. ten half-pixel steps; 218/231 weights ≥600 with exactly
one 400; zero `font-variant-numeric` in `src/styles.css`; 18 radii, 58 pill uses). One aggregate reconciles
differently (314/345 declarations in the 9-17px band vs the quoted 237/290) with the claim's shape unchanged.
No commit since the original measurement touched either stylesheet. Fixing these is table stakes per the spec.

## Data-honesty notes for builders (from the counts probe)

- Anon key alone returns **HTTP 200 with zero rows** on RLS tables — silent, not 401. Every capture/measure
  run needs the minted session (`scripts/dev-login.mjs` → `.session.json`). A skeleton crop is a failed
  capture, never a design verdict.
- Counts come from `Prefer: count=exact` head probes, never `rows.length` (PostgREST caps at 1000 silently).
- Tenancy conventions differ per table (`carousel_drafts`/`lm_drafts_v2` raw-NULL vs `inbox_messages_v`
  pre-coalesced `'ivan'`) — a candidate adding per-lane figures must copy the app's own lane filters
  (`content.ts:86-89`), not invent scoping.
- `TodayScreen` zones 01-03 + masthead bind to edge fn `get-morning-brief` (opaque server-side). Real
  network data, table not client-visible. Candidates restyle it; instruments cannot independently verify its
  figures and must not fail it for that.

## Fabrication sweep result

Zero hard-coded arrays feed any chart or list across ~40 screens/modules inventoried (default app,
cand-a/b/c, v2c). All `Spark`/`Gauge`/`StackBar`/`Funnel`/`PillarMix` trace to live queries or RPCs
(inventory, "Notable surprises" §2-3). The fabrication skeptic in Phase 4 starts from a clean baseline:
**any hard-coded series found in a candidate diff is new, and is a DQ.**

## Carried forward to Phase 2

1. Spine must supply the missing anchor column for Content (and keep the avatar/dot anchors that already
   work in Inbox/Today/Overview).
2. All three retired candidates AND v2c independently promoted content-drafts to a nav-level destination —
   converged evidence the Content surface deserves first-class design attention.
3. v2c mobile nav swaps Settings for a Claude slot; desktop keeps both (`Rail.tsx:146-186`) — candidates
   inherit this structure as-is; structure is locked, treatment is the run.
4. Two rate/figure conventions per surface must survive restyle: severity dots (3-tier, meaning locked) and
   lane/category encodings (Fork 2, Phase 2's headline decision).
