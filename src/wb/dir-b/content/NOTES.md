# Direction B — S03 Content flow · S04 Content calendar

Files written (all under `src/wb/dir-b/content/`):

| File | What it holds |
|---|---|
| `index.tsx` | `ContentList` (the override, same props), `IvanLane`, `MattanLane`, `CommandStrip`, `PipelineStats`, `StageDeck`, `DraftCard`, `useStageTab` |
| `sections.tsx` | `IdeasSection` + `IdeaCard`, `ClientIdeasSection` + `ClientIdeaCard`, `InFlight`, `QueueStrip` + `QueueRow`, `PillarMix` |
| `calendar.tsx` | `ContentCalendar` + `CalChip` (S04 and the S25 popover/day dialog) |
| `actions.tsx` | `ReviewActions`, `RetryDraft`, `PromoteRow`, `RowDelete` |
| `rowSelect.tsx` | `RowSelect` (copied: the shipped one looks for `.ct-card`) |
| `bits.tsx` | `FilteredEmpty`, `Figure`, `Failed`, `CalmEmpty` |
| `content.css` | the classes `dir-b.css` does not already carry |

Imported, not copied (data layer and pure helpers, unchanged paths):
`hooks/useContent`, `hooks/usePullToRefresh`, `hooks/useSectionState`, `lib/content`,
`lib/contentFilters`, `lib/clientIdeas`, `lib/calendarItems`, `lib/studioActions`,
`lib/labels`, `components/ConfirmSheet`, `components/PullIndicator`,
`exp/v2c/FilterRow`, `exp/v2c/fmt`, `exp/v2c/contentIdeas`, `exp/v2c/commandStore`,
`exp/v2c/mock`, `exp/v2c/Surface` (`relAge` only), `exp/v2c/CalPopover`, and
`chipDescription` / `waitedFor` / `VISIBLE_CHIPS` from `exp/v2c/ContentCalendar`
(pure, unit-tested, so the description sentence cannot drift).

## S03 — what changed

- **The board is a DECK.** One stage on screen (the tabs are unchanged), drawn as
  a `Block` with a dot-coded stage header and a round count `Badge`, with two
  inert `.dirb-deck-peek` edges behind the column once a stage holds more than
  two rows. Ref: Kanban (haydenbleasel), Kanban Board (arihantcodes) — the
  count-badge-next-to-title convention appeared independently in 3 of 4 kanban
  candidates. The stage strip is ds `Tabs`; `mark: true` on Review becomes
  `sev: 'attention'`, so the dot is the Badge's own severity tone.
- **A row is a `Card`** with `.dirb-lift` and `layoutId={dirb-draft-<id>}`. Lead:
  the selection mark, the thumb as a small `Avatar` (only where the source has
  one), and the QA dot. Title bold, the lane/kind line as chips (QA verdict in
  slot 1, format, the clock when the row is dated), the excerpt on the review
  deck only, the source line with its dealt hue, the three facts (pillar /
  funnel / source) as chips, the failure sentence and Retry sharing a line, and
  the write controls in the card foot.
- **The three facts stopped being desktop-only columns.** They were `.ct-colv`
  spans that folded away below 1300px; as chips they read at every width. Their
  `title` tooltips and their `—` absence marker are unchanged.
- **`STAGE_COLOR` (a hex map) is gone**, replaced by `data-st` plus severity/text
  tokens in `content.css`. The census forbids a colour literal; what a colour
  MEANS is unchanged.
- **The lane pills and the view pills keep `ct-cmd-lanes` / `ct-cmd-lane`** and
  their `aria-current`, per the shooter's constraint (`.ct-cmd-lane:has-text
  ("Calendar")` is a required screenshot step). `faithful.css` styles those names
  at four-class specificity, so `content.css` out-specifies rather than renames.
  They are hand-rolled buttons, not `Segmented`, for exactly that reason.
- **Empty states are `EmptyState` with `ghosts`; loading is `SkeletonRows`**
  (`rows={8}`, the shipped count). `Failed` is a `Banner tone="urgent"` and keeps
  both of its footer sentences verbatim.
- **30ms stagger on card mount** (`list` + `rise`), `AnimatePresence` on every
  removal (draft cards, idea cards, queue rows, rail rows, the in-flight pill,
  the move panel, both banners), one spring everywhere something moves.

## S04 — what changed

- **The month is a stack of day cards on the phone and the SAME cards as a
  7-across grid on the desktop** — one component, `.dirb-days` in `dir-b.css`
  does the switch. Each card: the day-of-week eyebrow, the date figure, its items
  as chips, `data-today` for the accent tint, `data-outside` for the dim.
- **The chip cap stays CSS, never JS** (`content.css` hides
  `.dirb-daycard-items > *:nth-child(n+3)` at ≥768px only), so nothing reads a
  viewport — the workbench's rule. `+N more` is `.dirb-desk-only` and opens the
  existing `CalPopover` day dialog, wrapped in `pop`. Ref: fullscreen-calendar.
- **The month change is one spring**: the grid is re-keyed by the step and enters
  from the side the step came from, on transform + opacity only.
- The weekday header row is desktop-only; on the phone the eyebrow rides on each
  card. Empty and outside-month cards are hidden on the phone, which is what the
  shipped `.cal-day-empty { display:none }` agenda list already did.

## Motion table

| Rule | State change | Selector or animation | Property | Duration | Easing | Continuous |
|---|---|---|---|---|---|---|
| Card mount | a deck renders | `list` on `.dirb-cards`, `rise` per card | opacity, transform:y | spring (400/32), 30ms stagger | spring | no |
| Card leave | a row is approved, skipped, deleted, promoted, filtered out | `AnimatePresence` + `rise.exit` | opacity, transform:y | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| Card reorder | a stage re-sorts | `layout` on `.dirb-card` | transform | spring | spring | no |
| Card lift | hover / active | `.dirb-lift` (CSS) | background-color, border-color, transform | 120ms | `--ds-ease` | no |
| Draft window open | a card is tapped | `layoutId="dirb-draft-<id>"` | transform, size | spring | spring | no |
| Tab underline | stage selected | `layoutId="dirb-content-tabs"` (ds `Tabs`) | transform | spring | spring | no |
| The beat | approve lands | `@keyframes dirb-beat` on `.dirb-approving` | transform:y, opacity | 200ms | `--ds-ease` | no |
| Count tick | the beat lands | `@keyframes dirb-tick` on `.dirb-block-tail` | transform:scale | 250ms | `--ds-ease` | no |
| In-flight pill | a run starts / ends | `AnimatePresence` + `rise` | opacity, transform:y | spring in, 180ms out | spring / ease | no |
| Idea body | card expanded | `AnimatePresence` + `fade` | opacity | 180ms | `--ds-ease` | no |
| Month change | prev / next / today | keyed `motion.div` on `.dirb-days` | opacity, transform:x | spring in, 180ms out | spring / ease | no |
| Day dialog + chip tooltip | `+N more` clicked, chip hovered or focused | `pop` inside `CalPopover` | opacity, scale | spring | spring | no |
| Move panel, banners | a write starts / resolves | `AnimatePresence` + `rise` / `fade` | opacity, transform:y | spring / 180ms | spring / ease | no |
| Loading | first fetch | `SkeletonRows` shimmer | background-position | ds-owned | ds-owned | yes — the one loop, and only while loading |

Pointer hover and focus are CSS at 120ms only. Nothing animates width, height,
top, left, margin or padding; nothing uses `transition: all`.

## Ledger items I could not keep byte-for-byte

Every one of the 35 S03 rows and the 26 S04 rows renders, with its write, its
confirm text, its busy word and its keyboard behaviour intact. Five presentation
details changed, all logged rather than silently dropped:

1. **S03-21 / S03-26 / S03-29 — the `↗` in "Source ↗", "Slack ↗", "live ↗".**
   The brief bans a unicode glyph in TSX (a census reads them), so the arrow is
   `<Icon name="external" />` beside the same word. The words are unchanged.
2. **S04-11 / S04-13 / S04-14 / the posted tick — `⇄`, `⇢`, `⚠`, `✓`.** Same
   rule: `Icon name="swap" | "forward" | "alert" | "check"`. The `⇄` button keeps
   both its `title="Move to another day"` and its
   `aria-label="Move {title} to another day"` verbatim.
3. **S03-14 — the Ideas header was `sticky`.** A `Block` head is not a sticky
   strip and `shell.tsx` is not mine to change, so the header scrolls with its
   rows. The count and the toggle are unchanged. `.dirb-sticky` is spent on the
   command strip, which is the one band that has to hold the top.
4. **S03-6 — the seven-column grid and the fixed 28px anchor rail.** Direction B
   is a card, so "every row's primary text at an identical x" is now the card's
   own padding rather than a grid template. The QA mark still spends its slot on
   every row (a chip reading `—` when there is no verdict), which is the property
   that rail was protecting.
5. **S03-4 — `StatChip`'s bar-chart fill.** The stage marks are `Chip`s with a
   dot and a count; the peak-relative bar is gone. Every number, every tone and
   every `title` sentence is unchanged, and on the calendar (the only view that
   draws them) the click still does `setView('flow')` then selects the tab.

Two more decisions, taken rather than asked:

- **`hsl()` survives in `content.css`** for the source hue (`--src-h`). It is not
  a colour literal in the census's sense: the hue is dealt from the data by
  `sourceHues`, so no token can hold it. Every fixed colour is a `var(--ds-*)`.
- **`RowSelect` is copied, not imported.** The shipped one hosts itself with
  `closest('.ct-card, .r')`; a Direction B row is `.dirb-card`, and without the
  extra selector j/k and x would go dead on this screen. The store calls, the
  registration keys and the aria are byte-for-byte.

## Seam requests (only the orchestrator can do these)

1. **The bulk bar.** `BulkBar` is rendered by `CommandLayer`, which `Shell.tsx`
   mounts directly — it is not an override name, so this screen cannot replace
   it and rendering a second bar would put two of them on one page. To get the ds
   `BulkBar` (the partial-eligibility note, the `done of total` progress, the
   `AnimatePresence` pop-in — refs: Floating Action Panel, Codehagen; Action
   Search Bar, kokonutd), the seam needs either a `CommandLayer` override name or
   a direction-aware `BulkBar` inside `exp/v2c/CommandLayer.tsx`. Selection
   itself (x, j/k, the caps a row declares) works today, unchanged.
2. **The morphing draft window.** The card carries
   `layoutId="dirb-draft-<id>"`; the other half of the shared layout has to be on
   the draft window, which lives in `exp/v2c/DraftPane.tsx`. Until something
   there carries the same `layoutId`, the card's handle is inert (harmless — one
   sided `layoutId` animates nothing).
3. **`Surface` cannot take a ref.** Its props are
   `{className, children} & React.HTMLAttributes<HTMLDivElement>`, which has no
   `ref`, and pull-to-refresh needs the scroller element. This screen renders
   `<div className="dirb-surface rows ct-rows" ref={…}>` instead. If `shell.tsx`
   switches to `ComponentPropsWithRef`, this can go back to `<Surface>`.

`npx tsc -p tsconfig.app.json --noEmit` reports no error in any of these files.
