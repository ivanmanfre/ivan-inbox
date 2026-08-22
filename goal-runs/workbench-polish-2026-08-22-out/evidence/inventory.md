# Workbench surface inventory — grep-derived verification matrix

Scope: `#exp/v2` (canonical) / `#exp/v2c` (legacy alias, same shell), code in `src/exp/v2c/`.
Route parsing: `src/exp/v2c/route.ts` (`parseWbHash`, `wbHash`). Boot default `{ job: 'dms', focus: null }`.
Old shell for comparison: `#exp/stock`, rendered directly by `src/App.tsx` (`Shell()` at line 62), gated in `src/App.tsx:57-60`. `#exp/stock` never mounts `ExpGate` or `CommandLayer` — nothing in `src/exp/v2c/` runs there, but several components those files IMPORT are defined outside `v2c/` and are mounted by both shells independently. Those are marked **SHARED** below with both call sites.

All file:line references verified by direct read on branch `wb/polish`, 2026-08-22. No memory, no assumption.

---

## 1. Top-level jobs (the rail / mobile tabs)

Source of truth: `src/exp/v2c/layout.ts` (`JOBS`, `JOB_LABEL`, `JOB_ICON`, `WORK_JOBS`, `LIST_JOBS`), rendered by `src/exp/v2c/Rail.tsx`.

| Job (hash `#exp/v2/<job>`) | Renderer (file:line) | Opened by | Desktop rail row | Mobile | Shared with `#exp/stock`? |
|---|---|---|---|---|---|
| `today` | `Shell.tsx:433-435` → `TodayScreen` (`src/screens/TodayScreen.tsx`) | Rail click / mobile tab (`Rail.tsx:191`) | `Rail.tsx:120,138-139` (`before` group) | `MOBILE` array `Rail.tsx:190-196` | **SHARED** — `App.tsx:151` (`Shell()`), `App.tsx:167` (`tab==='today'` dt-full) both render the same `TodayScreen`. `TodayScreen` also renders `SystemAlertStrip` (`TodayScreen.tsx:4,670`) — transitively shared. |
| `dms` | `Shell.tsx:399` → `dmsSurface` → `DmsSurface.tsx:32-88` → `InboxScreen` (`src/screens/InboxScreen.tsx`) | Rail click / mobile tab | `Rail.tsx:120` | yes | **SHARED** — `InboxScreen` is imported directly by `App.tsx:6,130` for `tab==='inbox'`. This is the #1 shared-component trap named in the goal. `DmsSurface` also pulls `DraftCard`/`PushedBar`/`StaleBar` from `src/screens/DraftsScreen.tsx` (`DmsSurface.tsx:1`), and `DraftsScreen.tsx` itself is directly rendered by `App.tsx:7,141` for `tab==='drafts'` — so those three pieces are shared too. |
| `content` | `Shell.tsx:400-408` → `ContentList` (`src/exp/v2c/ContentList.tsx:1016`) | Rail click / mobile "Content" segment (shares slot with Magnets/Styles/Strategy, `WorkSegment` in `Rail.tsx:26-65`) | nested under "Content" group label, `Rail.tsx:140-143` | folded into mobile `content` tab, `WorkSegment` strip inside the surface | v2c-only component tree, but reads `src/lib/content.ts`, `src/lib/contentFilters.ts` (not UI). No JSX shared with stock. |
| `magnets` | `Shell.tsx:414-416` → `MagnetsList.tsx` | Rail / WorkSegment tab | nested, `Rail.tsx:140-143` | WorkSegment strip | v2c-only |
| `styles` | `Shell.tsx:419-421` → `StylesList.tsx` | Rail / WorkSegment tab | nested | WorkSegment strip | v2c-only |
| `strategy` | `Shell.tsx:426-428` → `StrategyView.tsx` | Rail / WorkSegment tab (joined 2026-08-19) | nested | WorkSegment strip | v2c-only |
| `sends` | `Shell.tsx:429` → `SendsScreen` (`src/screens/SendsScreen.tsx`) | Rail / mobile tab | `Rail.tsx:121` (`after` group) | `MOBILE` array | **SHARED** — `App.tsx:12,168` renders the same `SendsScreen` for `tab==='sends'` in both the desktop dt-full branch and mobile. |
| `ops` | `Shell.tsx:430` → `OpsBoard.tsx` → reuses `OpsGroups`/`PendingCard` from `src/screens/OpsScreen.tsx` | Rail / mobile tab | `Rail.tsx:121` | `MOBILE` array | **SHARED** (partial) — `OpsScreen.tsx` itself is directly rendered whole by `App.tsx:13,169` for `tab==='ops'`; `OpsBoard.tsx` reuses two of its exported components (`OpsGroups`, `PendingCard`, `OpsBoard.tsx:2`) rather than the whole screen, so a change to those two sub-components lands in both shells; a change to `OpsBoard.tsx`'s own frame does not. |
| `settings` | `Shell.tsx:436` → `SettingsScreen` (`src/screens/SettingsScreen.tsx`) | Rail row / mobile gear (`⚙︎`, `Shell.tsx:526`) | `Rail.tsx:162` (`wb-rail-foot`) | mobile `⚙︎` via `wb-gear`, `Shell.tsx:519-526` | **SHARED** — `App.tsx:11,142` renders the identical `SettingsScreen` for `tab==='settings'`. This is also where the theme toggle lives (`inbox-theme` localStorage key, `SettingsScreen.tsx:79`) — theme state is process-wide, not workbench-scoped. |
| Claude (not a job) | `Shell.tsx:443-456` → `ChatPane.tsx` | Rail "Claude" row (`Rail.tsx:152-156`) / mobile "Claude" tab (`Rail.tsx:230-233`) / ⌘D toggles mic (`Shell.tsx:228-242`) / `#exp/v2/<job>/chat` URL (`route.ts:40`) | separate section below rail-sep, `Rail.tsx:147-159` | last mobile tab slot | v2c-only — does not exist in `#exp/stock` at all. |

Viewport model (the ONE fork, `src/exp/v2c/layout.ts:128-149`, `planWorkbench`): three canvases — `mobile` (<1000px), `desktop` (1000-1319px, 1 peer max), `wide` (≥1320px, 2 peers max). Media queries defined in `Shell.tsx:97-98`: `MQ_DESKTOP='(min-width: 1000px)'`, `MQ_WIDE='(min-width: 1320px)'`, read via `window.matchMedia` in `readCanvas()`/`useCanvas()` (`Shell.tsx:100-118`). This is the only JS-level viewport branch below `Shell`; every other component receives `canvas`/`plan`/`mobile` as props rather than reading the viewport itself (stated design invariant, `layout.ts:9-12`).

---

## 2. Content job — internal tabs/views (List / Calendar / Strategy / Styles-adjacent)

All rendered inside `job==='content'` (`Shell.tsx:400-408`) → `ContentList.tsx`.

| Surface | Renderer (file:line) | Opened by | Notes |
|---|---|---|---|
| Flow/List view | `ContentList.tsx:1016-1151` (`ContentList`), lane split into `IvanLane` (`:646-843`) and `MattanLane` (`:880-1012`) | default; `ct-cmd-lanes ct-cmd-views` pill toggle inside `CommandStrip` (`ContentList.tsx:403-414`) | Ivan lane uses `StageTabs` (`Surface.tsx:172-193`) over `TAB_ORDER` (`ContentList.tsx:540-543`: ideas/review/generating/approved/scheduled/published/error/stuck/archived/other). Mattan/client lanes use group+stage composite tabs (`BOARD_ORDER` × `CLIENT_STAGES`, `ContentList.tsx:866-874`). |
| Calendar view | `ContentCalendar.tsx` (388 lines), mounted `ContentList.tsx:746-749` (Ivan) / `:984` (Mattan) | `ct-cmd-lane ct-cmd-views` "Calendar" pill; persisted key `wb-content-view` (`ContentList.tsx:39,1050-1056`) | Named defect #7-10 in the goal spec (chip 3D look, 70%-of-cell chips, mis-anchored tooltip, pistachio frame cost) live here. Uses `useConfirm` (`ContentCalendar.tsx:10`) for schedule-date writes. |
| Ideas band (tab `ideas`) | `IdeasSection` (`src/exp/v2c/ContentSections.tsx`), mounted `ContentList.tsx:776-787` | `StageTabs` "Ideas" tab | Ivan lane only (`lm_idea_candidates`, no tenancy column). |
| Pillar mix (tab `published`) | `PillarMix` (`ContentSections.tsx`), mounted `ContentList.tsx:836` | auto-shown under Published tab | |
| Publish queue strip (tab `scheduled`) | `QueueStrip` (`ContentSections.tsx`), mounted `ContentList.tsx:826-831` | auto-shown under Scheduled tab | |
| Filter row / search / facet disclosure | `FilterRow.tsx` (407 lines) | search field, pill click opens `.wb-fmenu` disclosure | Own mobile breakpoint `MOBILE_MQ='(max-width: 767px)'` (`FilterRow.tsx:30,34,36`), independent of the Shell's canvas model. |
| Bulk bar | `BulkBar.tsx`, mounted inside `CommandLayer` (`CommandLayer.tsx:307-315`) | appears when ≥1 row selected via `x` key or `RowSelect` click | Rides above the list in every job that has rows; reads `RowSelect` marks. |

### Strategy / Styles / Magnets jobs (siblings of Content, same rail group)

| Surface | Renderer | Notes |
|---|---|---|
| Strategy | `StrategyView.tsx` (268 lines) | Per-lane editable doc; own `useStrategy` hook; uses `PullIndicator`/`usePullToRefresh` (shared components, but only mounted here inside v2c). |
| Styles | `StylesList.tsx` (47 lines) → `StyleRoster` (`ContentSections.tsx`) | Per-lane style/preview roster. |
| Magnets | `MagnetsList.tsx` (77 lines) → `ResourceLane` (`ContentSections.tsx`) | Lead-magnet pipeline list; opens `MagnetWindow` takeover on row click. |

### Ops job internals

| Surface | Renderer (file:line) | Notes |
|---|---|---|
| Ops board frame | `OpsBoard.tsx` (216 lines) | Wraps `OpsGroups`/`PendingCard` from `OpsScreen.tsx` (**shared** components, see §1). |
| Reaction Desk | `ReactionDesk.tsx` (197 lines), mounted inside `OpsBoard.tsx` (`:2,` `ReactionDesk` import) | Ivan, 2026-08-19: reactions moved here from Content. v2c-only. |
| Pipeline notes / summaries | `SummariesSection` (`ContentSections.tsx`), mounted in `OpsBoard.tsx` | Reads `usePipelineHealth`. |

---

## 3. Takeover windows (full-canvas overlays)

Chrome: `Takeover.tsx` (`export function Takeover`, `Takeover.tsx:19-80`). z-index 50, below confirm sheets (`.sheet-scrim`, z-60, comment `Takeover.tsx:16-17`). Escape closes unless focus is in a text field (`Takeover.tsx:41-51`). v2c-only — `#exp/stock` has no takeover chrome; its equivalent reading surface is `ThreadScreen` in the `dt-detail`/mobile-thread branch (`App.tsx:172-184,187-193`), a different component entirely.

| Window | Renderer (file:line) | Opened by | Queue rail? | Viewport fork | Shared with stock? |
|---|---|---|---|---|---|
| Draft window | `DraftPane.tsx` → `DraftWindow` (`DraftPane.tsx:1433-1483`), body `Body` (`:706-1427`) | Row click in Content List/Calendar (`onOpen`/`OpenDraft` type, `ContentList.tsx:85`), `Shell.tsx:291-293,481-491` | `QueueRail` (`DraftPane.tsx:95-149`), hidden when queue length < 2 | Single-column below 1180px (`DraftPane.tsx:47` comment + CSS `@media (max-width:1179.98px)` `styles.css:1283`); sticky action-bar height measured via `ResizeObserver` (`DraftPane.tsx:1016-1037`) | v2c-only chrome; the DATA it edits (`lib/content.ts`) is the same table `dashboard-v2`/DraftsScreen touch, but no JSX is shared. |
| Lead-magnet window | `MagnetWindow.tsx` → `MagnetWindow` (`:560-594`), body `Body` (`:276-496`) | Row click in Magnets list (`onOpen`/`OpenMagnet`, `ContentSections.tsx`), `Shell.tsx:294-296,481-491` | `QueueRail` (`MagnetWindow.tsx:64-94`) | Same `Takeover` chrome, same 1180px single-column fold | v2c-only |

Both windows share the `InspRail`/`Sec` tabbed-evidence-panel pattern. **`DraftPane.tsx:186-187`: the evidence rail header literally renders `<span>Backend depth</span>`, and `faithful.css:3359-3361` applies `text-transform:uppercase` to `.dw-insp-h` — this is the exact "BACKEND DEPTH" defect named in the goal spec's mission doc (`workbench-polish-2026-08-22.md`, named defect #2).**

---

## 4. Context peers (right-hand dockable panes, desktop/wide only; take over the screen on mobile)

Model: `src/exp/v2c/layout.ts` `Peer` type (`:34-40`), `addPeer`/`dropPeer`/`contextPeer` (`:157-182`). Rendered by `Shell.tsx` `renderPeer` (`:441-478`).

| Peer | Renderer (file:line) | Opened by | Shared with stock? |
|---|---|---|---|
| Thread peer | `ThreadPeer.tsx` (67 lines) → wraps `ThreadScreen` (`src/screens/ThreadScreen.tsx`) | Row click in DMs list (`openThread`, `Shell.tsx:288`) | **SHARED** — `ThreadScreen` is directly rendered by `App.tsx:9,172,189` in both the desktop `dt-detail` pane and the mobile full-screen branch. `ThreadPeer.tsx` only adds a header strip (`Ladder` stage indicator, Avatar, "Ask Claude" button) around the shared `ThreadScreen`. `ThreadScreen.tsx` itself imports `RestoreStrip` from `../exp/v2c/RestoreStrip` (`ThreadScreen.tsx:13`) — so a component that LIVES in the `v2c/` directory tree renders inside `#exp/stock` too. This is the second concrete instance of the "shared component" trap named in the goal, and it is the least obvious one because the file path makes it look v2c-exclusive. |
| Claude chat peer | `ChatPane.tsx` | Rail "Claude" row, `⌘D`, or URL `#exp/v2/<job>/chat` | v2c-only — no chat surface exists in `#exp/stock`. |

Peer capacity: 1 on `desktop` canvas, 2 on `wide` (`layout.ts:111-113`, `MAX_PEERS=2`). On `mobile`, a focused peer takes the whole screen (`work:'hidden'`, `layout.ts:132-135`) and the work surface (including `CommandLayer`) unmounts (`Shell.tsx:495-509`).

---

## 5. Command layer, palette, bulk bar

Mounted once, unconditionally, inside `workSurface` (`Shell.tsx:395`) — present on every job, both canvases, and re-mounted standalone in the mobile takeover branch (`Shell.tsx:504`).

| Surface | Renderer (file:line) | Opened by | Shared with stock? |
|---|---|---|---|
| Command palette | `CommandPalette.tsx:57-163` | `⌘K`/`Ctrl+K` (`CommandLayer.tsx:267-272`) | v2c-only — `CommandLayer` never mounts under `#exp/stock` (confirmed: `CommandLayer.tsx:100-103` comment states this explicitly). |
| Shortcut sheet (`?`) | `CommandPalette.tsx:168-218` (`ShortcutSheet`) | `?` key (`CommandLayer.tsx:285`) or palette footer | v2c-only |
| Bulk bar | `BulkBar.tsx:130-216` | Selecting ≥1 row (`x` key, or `RowSelect` click) | v2c-only chrome, but its writes go through the same `approveDraft`/`skipDraft`/`deleteDraft`/`deleteClientDraft` functions the stock `DraftsScreen`/`OpsScreen` single-row controls call. |
| Row selection mark | `RowSelect.tsx` (94 lines) | rendered on every list row via `data-wbrow`/`data-wbsel`/`data-wbfocus` attributes | **PARTIALLY SHARED** — `RowSelect` is rendered from inside `InboxScreen.tsx` (comment confirms, `CommandLayer.tsx:100-103`: *"RowSelect is rendered from InboxScreen, which the pre-revamp #exp/stock shell also renders without ever mounting this layer"*). So the selection-mark DOM (data attributes, `.wb-rj` styling hooks) is present and inert in `#exp/stock` — a CSS change to `RowSelect`'s mark could paint an unclickable artifact into the escape hatch even though no key ever drives it there. |

Keys bound (exhaustive, `CommandLayer.tsx:18-40`): `⌘K`/`Ctrl+K` open palette, `j`/`k` focus row, `Enter` open row, `x` select/deselect, `/` focus search, `?` shortcut sheet, `Escape` layered close (palette → sheet → selection → focus → open peer/window). No bare-key write actions exist by design (comment `CommandLayer.tsx:29-33`).

---

## 6. Chat and voice surfaces

| Surface | Renderer (file:line) | Opened by | Status |
|---|---|---|---|
| Chat pane (transcript + composer) | `ChatPane.tsx` | Rail "Claude" / `⌘D` / URL focus | Live. Hosts slash-command palette (`matchCommands`, `ChatPane.tsx:140-163`) and container-skill palette (`chat/containerPalette.ts`). |
| Voice control (mic button, idle/arm) | `VoiceControl.tsx:34-78` | tap = arm/resume/skip per state; long-press / right-click = hands-free (`onContextMenu`, `VoiceControl.tsx:67`) | Live, mounted in `ChatPane.tsx:3`. |
| Voice state strip | `VoiceControl.tsx:82-116` (`VoiceStrip`) | auto-shown while voice state ≠ IDLE | Live |
| Hands-free sheet | `VoiceControl.tsx:121-154` (`HandsFreeSheet`) | long-press/right-click the mic | Live, reuses `.sheet-scrim`/`.sheet-card` (same class family as `ConfirmSheet`/`PushLaterSheet`). |
| Live conversation dock | `VoiceDock.tsx` (163 lines) | started from hands-free / live loop | Live — replaced `LiveSheet` on 2026-08-16 specifically so the transcript stays visible while talking (dock vs. modal takeover). |
| **`LiveSheet.tsx`** | `LiveSheet.tsx:23-85` | — | **RETIRED, NOT MOUNTED ANYWHERE.** Confirmed via repo-wide grep: only self-references and a comment in `VoiceDock.tsx:4,6` and `chat/useRealtime.ts:5` mention it; no `<LiveSheet` JSX call site exists. Kept in-tree only as a spec reference (explicit comment, `LiveSheet.tsx:4-8`: "Do not wire it back"). **Exclude from the verification matrix as a live surface** — a phase-later check that expects this component to render will find nothing to verify. |

---

## 7. Menus, dropdowns, popovers, confirm sheets, toasts/strips

| Surface | Renderer (file:line) | Mount point | Shared with stock? |
|---|---|---|---|
| Confirm action sheet | `src/components/ConfirmSheet.tsx` (71 lines), `ConfirmProvider` | **Root-mounted**: `src/main.tsx:65-71` wraps `<App/>` itself, so it exists before either shell picks a variant | **SHARED — root level, unconditionally.** Every `useConfirm()` call site in v2c (`BulkBar.tsx:2`, `ContentList.tsx:22`, `ContentCalendar.tsx:10`, `DraftPane.tsx:4`, `MagnetWindow.tsx:4`, `ReviewActions.tsx:2`) and every stock screen (`DraftsScreen.tsx`, `OpsScreen.tsx`, `ThreadScreen.tsx`) render through the SAME provider/sheet markup. |
| Push-to-later sheet | `src/components/PushLaterSheet.tsx` (138 lines), `PushLaterProvider` | **Root-mounted**: `main.tsx:66,69` | **SHARED — root level.** Used by `DraftsScreen.tsx` and `ThreadScreen.tsx` (both stock-rendered) as well as anywhere in v2c that calls `usePushLater()`. |
| Prospect context sheet | `src/components/ContextSheet.tsx` (150 lines) | Opened from `ThreadScreen.tsx:234` (name tap) | **SHARED** — since `ThreadScreen` itself is shared (§4), this sheet renders identically in `#exp/stock`'s `ThreadScreen` and in the workbench's `ThreadPeer`. |
| Discarded-draft restore strip | `src/exp/v2c/RestoreStrip.tsx` (127 lines) | Rendered inside `ThreadScreen.tsx:13` (imported directly) | **SHARED, and mislabeled by its own file path** — lives under `src/exp/v2c/` but is imported into the shared `ThreadScreen.tsx`, so it renders inside `#exp/stock` too. This is the single easiest surface to miss in a "did it land everywhere" check because grepping `src/exp/v2c/` for "did I touch every workbench file" will find it, but grepping "what renders in stock" by directory will not. |
| Stale-draft bulk-escape strip | `StaleBar` (`src/screens/DraftsScreen.tsx`), mounted in `DmsSurface.tsx:68` | Shown above DMs list when stale drafts exist | **SHARED** — `StaleBar`/`PushedBar`/`DraftCard` all live in `DraftsScreen.tsx`, which is itself directly rendered whole by `App.tsx:141` for stock's `drafts` tab. |
| Seat health banner | `src/components/SeatHealthBanner.tsx` (28 lines) | Top of every work surface, `Shell.tsx:391` | **SHARED** — also rendered in `App.tsx:129` (`listScreen`) and `App.tsx:167` (`dt-full`). |
| System alert strip | `src/components/SystemAlertStrip.tsx` (165 lines) | Inside `TodayScreen.tsx:670` | **SHARED transitively** — `TodayScreen` is shared (§1), so this renders in both shells. This is the second named "shared trap" component from the goal brief, confirmed live. |
| Filter pill disclosure menu | `FilterRow.tsx` (`.wb-fmenu`, opened per-pill) | Click a filter pill | v2c-only |
| Swap-image picker | `SwapImage` (`DraftPane.tsx:446-540`) | "Swap image"/"Add image" button inside the draft window's sticky action bar | v2c-only, unfolds inline (not a separate overlay) |
| Command palette / shortcut sheet / bulk bar | see §5 | | v2c-only |
| Voice hands-free sheet | see §6 | | v2c-only |

---

## 8. Themes

- `data-theme='light'` attribute on `<html>`, set from `localStorage['inbox-theme']`. Read at boot in **both** `src/main.tsx:8-10` (before React mounts, applies regardless of which shell/experiment loads) and toggled from `src/screens/SettingsScreen.tsx:79` (the shared Settings screen, §1). Dark is the implicit default (absence of the attribute). CSS consumers: `src/styles.css:7-16,131` (base app) and `src/exp/v2c/faithful.css` — 20+ `:root[data-theme='light']` / `:root:not([data-theme='light'])` rules, e.g. `faithful.css:161,1513-1518,1909-1944,2268-2271,4138-4158`.
- **Theme state is process-wide, not workbench-scoped.** Because the toggle lives in the shared `SettingsScreen` and the attribute is set on `document.documentElement` before any shell mounts, a light-mode fix verified only in `#exp/v2` and never re-checked in `#exp/stock` is not actually verifying the shared surface.
- Separate, unrelated attribute: `data-cat` (`triad`/`mono`) — a color-CATEGORY fork, not a light/dark theme. Set in `Shell.tsx:219-226` from `?cat=` query param or `localStorage['wb-cat']`. `triad` is the boot default; `mono` is reachable but undocumented. This is v2c-only (`.wb{…}` vs `:root[data-cat='triad'] .wb{…}` selectors) and does not exist in `#exp/stock`.

---

## 9. Viewport breakpoint registry (grep-derived, `@media`/`@container`/`matchMedia`/`*Width`)

JS-level (the only ones that branch component OUTPUT, not just CSS):

| Breakpoint | File:line | Governs |
|---|---|---|
| `(min-width: 1000px)` | `Shell.tsx:97,103,111` (`MQ_DESKTOP`) | mobile → desktop canvas |
| `(min-width: 1320px)` | `Shell.tsx:98,102,112` (`MQ_WIDE`) | desktop → wide canvas (2-peer capacity) |
| `(min-width: 1000px)` | `src/hooks/useDesktop.ts:3-4` | **stock shell's own** desktop/mobile fork (`App.tsx`'s `Shell()`) — independent of the workbench's `useCanvas`, same pixel value, two separate implementations |
| `(max-width: 767px)` | `FilterRow.tsx:30,34,36` (`MOBILE_MQ`) | filter-row's own mobile layout, independent of `useCanvas` |
| `(prefers-reduced-motion: reduce)` | `ReviewActions.tsx:15` | disables the 200ms approve/skip beat animation |
| `(display-mode: standalone)` | `src/screens/SettingsScreen.tsx:17` | PWA-installed detection (shared screen) |

CSS-level breakpoints in the workbench's own stylesheets (not exhaustively annotated per rule — this is the registry a later phase should re-grep against `src/exp/v2c/styles.css`, `faithful.css`, `wb2026.css`):

- `styles.css`: 700, 1000 (×2), 1180 (×2), 1700px min-width; 430 (×2), 1179.98px max-width.
- `faithful.css`: 768, 1200, 1000 (×5), 1560, 1100px min-width; 767 (×8), 480 (×3), 420, 999, 760px max-width; combined range 1000-1299.98 and 768-1559.98; `(hover:hover) and (pointer:fine)`; `(prefers-reduced-motion: reduce)` (×2); two `@container ctmid (max-width:340px)` rules (`faithful.css:798,3613`).
- `wb2026.css`: 1000, 1900, 2400, 1600px min-width; 767px max-width; three `@container work` rules keyed to the WORK PANE's own width, not the window (`min-width:1560px`, `max-width:999.98px`, `1000-1299.98px`, `min-width:1300px` — `wb2026.css:496,546,558,573`). Comment at `wb2026.css:455-467` explicitly documents why a `@media` query would be wrong for this element (it lives inside a peer-narrowed pane, not full window width) — a later phase changing this from `@media` to `@container` (or vice versa) anywhere nearby should be checked against that reasoning.

---

## 10. Raw internal identifier / internal system name hits

Hunted for: `urn:`, raw uuid/id rendering, snake_case/SCREAMING_SNAKE strings rendered as user-facing text, column names used as labels, unmapped enum values, `JSON.stringify` in JSX, hardcoded internal-mechanism labels. `src/lib/labels.ts` is the shared label map (`label()`, `inlineLabel()`, `typeLabel()`) — noted per row whether it was available and used, available and bypassed, or not applicable.

`JSON.stringify` in JSX: **zero hits** repo-wide (confirmed by grep across all `.tsx`). The nearest equivalent risk — an agent-written jsonb value reaching a JSX child raw — is handled by `<Val>` (`src/exp/v2c/ContentBits.tsx:11-38`), a structural renderer built specifically after a confirmed live crash from pushing `source_detail` straight into JSX (comment `ContentBits.tsx:3-9`). `KeyRows` (`ContentBits.tsx:69-71`) humanizes arbitrary jsonb keys with `k.replace(/_/g, ' ')` only — no title-casing, no `labels.ts` pass, so an arbitrary key like `error_flipped_at` renders as `error flipped at`, not `Error Flipped At`. Low-severity partial mitigation, not a full label mapping.

| # | Severity | What's printed | File:line | Label map available? |
|---|---|---|---|---|
| 1 | **CRITICAL — matches goal's named defect #1 verbatim** | `d.source_post_id` — a raw `urn:li:activity:…` value (confirmed by its own field comment, `src/lib/content.ts:42`: *"urn:li:activity:... stamped by the publisher once the post is really live"*) — pushed straight into the "Spun from post" row with no formatting. | `src/exp/v2c/DraftPane.tsx:994`: `if (d.source_post_id) source.push(['Spun from post', d.source_post_id])` | No — `labels.ts` has no URN/URL formatter. Needs a new helper (e.g. truncate + link to the live post) or an explicit "internal id, do not print raw" decision. |
| 2 | **CRITICAL — matches goal's named defect #2 verbatim** | Section header text is `Backend depth`, and CSS forces it to render as **"BACKEND DEPTH"**. | `src/exp/v2c/DraftPane.tsx:187`: `<span>Backend depth</span>` inside `InspRail`; uppercase forced by `src/exp/v2c/faithful.css:3359-3361` (`text-transform:uppercase` on `.dw-insp-h`, shared with `.res-hdr`/`.dw-queue-h`). | N/A — this is a copy/IA problem, not a missing map. The literal string names the app's own internal structure at the user. |
| 3 | High | `<span className="ct-ref">status: {d.status}</span>` — raw `lm_drafts_v2.status` enum value printed with the literal column-name prefix `status:` whenever it disagrees with the mapped stage label. | `src/exp/v2c/MagnetWindow.tsx:376` | `label()` exists and IS used elsewhere in this same file for the equivalent field (`detail.kind` via `label(detail.kind)`, `src/exp/v2c/DraftPane.tsx:1310`, the sibling draft window's identical "Source kind" tab) — this one specific line bypasses it and also keeps the raw column name as a text prefix. |
| 4 | Medium | Tooltip prints the raw column name as a literal prefix: `` title={`scheduled_at ${d.scheduled_at}`} ``. Appears twice, same pattern. | `src/exp/v2c/ContentList.tsx:249` and `src/exp/v2c/DraftPane.tsx:1067` | N/A — value itself (an ISO date) doesn't need `labels.ts`, but the column-name prefix (`scheduled_at`) is a raw DB name in a user-visible tooltip. |
| 5 | Medium | Tooltip: `` title={`updated_at ${d.updated_at}`} `` — same column-name-as-tooltip-prefix pattern. | `src/exp/v2c/DraftPane.tsx:1076` | same as #4 |
| 6 | Medium | Column-header tooltips print the raw taxonomy path with a literal dot, e.g. `` title={`pillar ${pillar}`} ``, `` title={`funnel_stage ${funnel}`} ``, `` title={`taxonomy.source ${src}`} `` — three raw column/path names as tooltip prefixes on the same row. | `src/exp/v2c/ContentList.tsx:278,279,280` | The VALUES are correctly passed through `tagLabel()`/`sourceLabel()` in the visible chip text (`ContentList.tsx:278-280` main content) — only the tooltip prefixes are raw. |
| 7 | Medium | `title={`stage: ${stage}`}` — raw column-name prefix `stage:` in a tooltip, on both the "off" and normal ladder states. | `src/exp/v2c/ThreadPeer.tsx:23,35` | Partial — the visible ladder label DOES go through `label()` for unknown stages (`ThreadPeer.tsx:32`), but the tooltip prefix is still the bare column name `stage`. |
| 8 | Low | `title={`${p.key}: ${p.n}`}` in `StackBar` — `p.key` is caller-supplied and can be a raw lane/stage key (e.g. `risedtc`) rather than its label, depending on caller. | `src/exp/v2c/Surface.tsx:316` | Depends on caller passing an already-labeled key; the primitive itself does not guard it. |
| 9 | Low | `modelLabel()` falls back to the raw container-supplied model id (e.g. a dated build stamp like `claude-haiku-4-5-20251001`) when no known family prefix matches. | `src/exp/v2c/ChatPane.tsx:25-34` | Explicit, intentional fallback per the comment ("fall back to the raw id rather than inventing a name") — flagged for completeness, not necessarily a bug. |
| 10 | Resolved (verify no regression) | Historical: `ThreadScreen`'s header used to render the raw capitalized stage column (comment in `src/exp/v2c/stage.ts:4-6` describes this as the reason `Ladder`/`stage.ts` were built: *"ThreadScreen's own header renders `stageLabel(thread.stage)`... the raw column with its first letter upper-cased"*). Current code at `src/screens/ThreadScreen.tsx:229` already calls `label(thread.stage)`, not a raw print. No live hit — listed so a later phase does not re-flag it from the stale comment alone. | `src/screens/ThreadScreen.tsx:229` | Already uses `label()`. |

### Fields with NO map entry that a design pass will likely surface next
`d.client_idea_id`, `d.workflow_file_id`, `d.campaign_id`, `d.gate_keyword`, `d.vertical_slug` (all rendered as raw IDs/slugs under plain labels like "Idea"/"Workflow file"/"Campaign" in `DraftPane.tsx:990-993` and `MagnetWindow.tsx:338-345`) — these are internal identifiers by nature (not enums), so a `labels.ts` fix does not apply; the open question for a later phase is whether they belong on this operator-facing surface at all, or should move behind the existing "Fields"/`Fold` disclosure the way `extras`/`ig_caption` already do (`DraftPane.tsx:1382-1394`).

---

## 11. Summary

- **Distinct addressable jobs (rail lanes):** 9 (`today, dms, content, magnets, styles, strategy, sends, ops, settings`) + Claude as a non-job peer.
- **Content-job internal tabs/views:** Flow (10 stage tabs on Ivan's lane, composite group×stage tabs on client lanes) + Calendar = 2 primary views, plus 3 embedded sub-sections (Ideas, Pillar mix, Publish queue).
- **Takeover windows:** 2 (Draft window, Magnet window).
- **Context peers:** 2 (Thread peer, Chat peer).
- **Command-layer surfaces:** 3 (palette, shortcut sheet, bulk bar) + 1 selection primitive (`RowSelect`, partially live in stock).
- **Chat/voice surfaces:** 5 live (`ChatPane`, `VoiceControl`, `VoiceStrip`, `HandsFreeSheet`, `VoiceDock`) + 1 retired-but-in-tree (`LiveSheet.tsx` — do not verify against it).
- **Menus/sheets/toasts:** 9 distinct (Confirm sheet, Push-later sheet, Context sheet, Restore strip, Stale-draft strip, Seat-health banner, System-alert strip, Filter disclosure, Swap-image picker).
- **Themes:** 1 light/dark axis (`data-theme`, root-level, shared) + 1 unrelated color-category axis (`data-cat`, workbench-only).
- **Components confirmed to render in BOTH `#exp/v2` and `#exp/stock`:** 11 — `InboxScreen`, `DraftsScreen` (+ its exports `DraftCard`/`PushedBar`/`StaleBar`), `ThreadScreen`, `OpsScreen`'s `OpsGroups`/`PendingCard`, `SendsScreen`, `TodayScreen` (+ its child `SystemAlertStrip`), `SettingsScreen`, `SeatHealthBanner`, `ConfirmSheet`/`ConfirmProvider`, `PushLaterSheet`/`PushLaterProvider`, `ContextSheet`, and — the least obvious one — `RestoreStrip.tsx`, which physically lives under `src/exp/v2c/` but is imported into the shared `ThreadScreen.tsx` and therefore renders inside `#exp/stock` despite its file path.
- **Raw-internal-identifier / internal-name hits:** 10 logged (2 critical, exact matches to the owner's own named complaints; 1 high; 4 medium; 2 low; 1 resolved/historical), plus a named list of 5 further identifier-bearing fields with no label-map entry for a later phase to judge.
