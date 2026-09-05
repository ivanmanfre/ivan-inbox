# S01 Today — Direction B ("surface")

Files: `Today.tsx` (the screen), `today.css` (glue only), `index.tsx` (`export { Today }`).
Props are byte-identical to `TodayScreen` (`src/screens/TodayScreen.tsx:997`), which is
how `src/exp/v2c/Shell.tsx:627` mounts it (`onOpenDrafts`, `onOpenOps`, `threads`,
`opsDrafts`, `onOpenThread`, `onOpenContent`, `onOpenCall`, all optional, default `{}`).

## What did NOT change

Every hook and its call order (`useToday`, `usePullToRefresh`, the three opt-in
`useEffect` reads with their exact `[threads !== undefined]` dependency arrays and their
`alive` guards), every derivation (`countsFromBrief` / `todayPlate` / `rankQueue` /
`callStats` / `segmentCalls`), every early return, every prop gate (`threads === undefined`
is still the single discriminator for the work queue, both call zones and
`SystemAlertStrip autoOpen`), every navigation target, and every user-visible string
including singular/plural forms, the `title=` tooltips on the bar segments, and the
`'–'` placeholder that stands in for an unverified zero. `SystemAlertStrip` is
imported, not copied, so S01-34 to S01-38 are untouched. No mutating control was added:
the hand-off rows are still a count, a preview and a way in.

## What changed, and where the move comes from

| Move | Reference |
|---|---|
| Masthead is a figure card; the number counts up on a motion value, the stacked bar springs each segment's `scaleX` | dir-b masthead brief; `.dirb-mast*`, `.dirb-legend*` |
| Zones are blocks of cards, not hairline rows; payload set in `.dirb-quote` | Notifications Menu (ahmedmayara), Activity Feed (felipemenezes098) |
| Two densities: a person gets the full card (avatar, badges, quote, mono age); a read-only pile gets the quiet card with its count badge and a mono age | Activity Feed (felipemenezes098) |
| Empty and loading states are `EmptyState` with `ghosts` | Empty Notifications State (7ovr) |
| A lane that sent this week, and a call that is starting soon, wear `.dirb-working` with `data-live` | Card Status List (isaiahbjork) |
| KPI figures are `StatTile` in `.dirb-tiles`, figures animate on a 30ms stagger | dir-b tile band |
| Zone heads stick and condense on scroll | `.dirb-sticky` |

The three hex severities (`SEV`) became the system's tone names
(`clear` / `attention` / `urgent`), so `Badge`, `Banner` and the tinted figures all read
off `--ds-sev-*` and this screen carries no colour literal. The masthead's fourth colour
(the blue "going out") is now `--ds-text-3`, which is what `dir-b.css` publishes for
`[data-k="going"]`.

## Motion table

| Rule | State change | Selector or animation | Property | Duration | Easing | Continuous |
|---|---|---|---|---|---|---|
| Figure count-up | mount, or a new reading | `animate(motionValue, n, spring)` in `Figure` | text value (no layout) | spring 400/32 | spring | no |
| Masthead bar | mount | `motion.span.dirb-mast-seg` `scaleX` 0 to 1 | `transform` | spring 400/32 | spring | no |
| Legend / tile figures | mount | `Figure delay={stagger(i)}` | text value | spring + 30ms stagger | spring | no |
| Card mount | list mount | `variants={list}` on `.dirb-cards`, `rise` per `Item` | `opacity`, `transform: y` | spring, 30ms stagger | spring | no |
| Card lift into detail | tap | `layoutId` on `Item` | shared layout `transform` | spring 400/32 | spring | no |
| Banner in / out | auth, degraded, stale error | `AnimatePresence` + `rise` | `opacity`, `transform: y` | spring in, 180ms out | spring / `--ds-ease` | no |
| Pull indicator | pull, refreshing | `AnimatePresence` + `fade`; height tracks the finger, untweened | `opacity` | 180ms | `--ds-ease` | no |
| Auto-reply reveal | `showAuto` toggle | `AnimatePresence` + `list`/`rise` | `opacity`, `transform: y` | spring, 30ms stagger | spring | no |
| "more in this list" | `full` toggle | `AnimatePresence` + `rise` | `opacity`, `transform: y` | spring | spring | no |
| Lane meter | mount | `motion.div.tdb-bar-f` `scaleX` 0 to value | `transform` | spring 400/32 | spring | no |
| Head condense | scroll past 8px | `.dirb-surface[data-condensed] .tdb-zc` | `opacity` | 180ms | `--ds-ease` | no |
| Card hover / focus | pointer | `.dirb-lift` (CSS only) | `background-color`, `border-color`, `transform` | 120ms | `--ds-ease` | no |
| Running lane / starting-soon call | live state | `.dirb-working[data-live="true"]` | `transform` sweep | 1400ms | `--ds-ease` | yes (the one loop) |

`Figure` reads `useReducedMotion()` and sets the value instantly when the OS asks for it,
because an imperative `animate()` is not covered by `MotionConfig`.

## Ledger: all 38 items kept

S01-1 to S01-33 are rebuilt in place; S01-34 to S01-38 live inside the imported
`SystemAlertStrip` and are untouched. Three items are kept with a changed *mechanism*,
logged here rather than silently:

- **S01-22** (call segment tabs): now `Segmented`, which is a `role="tablist"` and marks
  the active option with `aria-selected` instead of the old `aria-pressed`. Same three
  options, same `SEGMENT_LABEL` copy, same counts, same default (`open` when anything is
  open, else `recent`), same `setSeg` + `setFull(false)` handler.
- **S01-15** ("N never opened"): the red bold `.td-empty` line is now a `Banner` with the
  `urgent` tone. String, including both singular forms, is verbatim.
- **S01-17 / S01-24 / S01-18**: the `›` chevron and the `●` bullet became
  `<Icon name="next">` / `<Icon name="dot">`, and the `✓` zone mark became
  `<Icon name="check">`, per the no-glyph rule. `–`, `—` and `·` stay
  because they are copy, not marks.

Nothing was dropped.

## Decisions taken (no questions asked)

1. **Actor-verb-object headline**: the brief asks for one, but the payload carries only a
   name (`item.title`) and no verb, and inventing "replied" or "is waiting" would be new
   copy this screen has not measured. The headline is therefore the name plus its existing
   badges, and the verb stays where the data actually puts it: the quoted payload beneath.
2. **The one inline action per row** is the row itself (the card is the button, exactly as
   before) plus a trailing `next` icon as its affordance. A labelled button would have
   required a new string, and `IconButton` requires a `label` that renders as a tooltip.
3. **`components/Avatar` was dropped for the ds `Avatar`** (it needs `name`, not
   `channel`). Every row on this screen is a LinkedIn row, so the channel mark carried no
   information here.
4. **`PullIndicator` was not imported**; the hook is unchanged and the mark is redrawn with
   `Working` and `Icon`, as the brief asks. Its `height` still tracks the finger inline,
   which is a gesture, not a tween.
5. **`Zone` draws `Block`'s markup instead of calling `Block`** (see the seam request).
   `Block` is used as-is for the two health sub-groups, which need no id and no sticky head.
6. **`layoutId` scoping**: two zones can hold a group with the same title ("DM drafts" is
   both new and carried), so `HandOff` takes a `lid` and the approval groups are scoped
   `new-*` / `carried-*`. A duplicate shared-layout id in one tree is a real bug.
7. **No `Button variant="primary"` anywhere on this screen.** Today has no single primary
   action; the accent budget is spent on the hand-off count badges instead.

## Seam request

`Block` (`src/wb/dir-b/shell.tsx`) cannot carry an `id` on its `<section>` or a class on
its `.dirb-block-head`. Today's zones have had stable anchors (`#td-z0`, `#td-z1`,
`#td-z2`, `#td-z3`, `#td-z4`, `#td-z-call`, `#td-z-calls`) since they shipped, and the
direction asks the zone head to be sticky. Two optional props on `Block` (`id`, and
`headClassName` or simply `sticky`) would let every screen in this direction drop its
private copy of the head. Until then this folder's `Zone` renders the same
`section.dirb-block` + `div.dirb-block-head`-shaped head itself.
