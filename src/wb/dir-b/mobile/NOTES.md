# Direction B, phone chrome + feed (S26 / S27 / S28)

Files: `Mobile.tsx` (S26), `Feed.tsx` (S27), `NotificationCard.tsx` (S28),
`mobile.css`, `index.tsx` (exports `Mobile`, props `BrainMobileProps`).

Imports kept at their real paths and never copied: `place.ts`, `useFeedData.ts`,
`v2c/layout.ts`, `v2c/route.ts`, `lib/turns.ts`, `brain/b/families.ts`,
`brain/b/skins/b/forms.ts`, `brain/b/skin.ts`. Only the view changed. The Ask
thread comes in as `import { AskThread } from '../ask/AskThread'`.

## S26, the chrome

- **Move 17, the island.** `bb-head-alarm` and `bb-feedbtn` are now one capsule
  that morphs on the one spring. Idle it is the ops glyph with the unread count
  on it; with a standing automation alarm it expands to carry the alert and a
  `LiveDot` (Status Dot, edwinvakayil), and snaps back to the glyph when the
  alarm clears. Both behaviours and both strings survive: the alert goes to Ops,
  the glyph opens the feed, `Feed, {n} unread` is still the accessible name and
  `{n} automation alert(s)` is still the alert's words. **Decision:** the island
  opens off the ALARM rather than off a tap, because a tap on the capsule is
  already spoken for (it opens the feed) and making the feed a two tap journey
  to gain a morph would be a worse surface. Reference: Dynamic Island,
  educalvolpz.
- **Move 18, the tab bar.** The ds `TabBar` with its shared layout marker;
  `place`/`counts`/`sev` map straight onto `items`, six places, `markerId`
  `dirb-mob-place`. `TAB_ICON`'s unicode is gone: the place ids ARE the lucide
  names.
- **Move 19, snap points.** The horizontal pager is untouched: `SETTLE_AT`,
  `FLICK_PX_PER_MS`, `AXIS_LOCK_PX`, the axis lock, the per touchmove transform
  and `endDrag` are the shipped lines. A SECOND axis sits on top: three snaps
  (full 0, half .46, peek .78 of the pager height), 1:1 tracking, `springSoft`
  to the nearest, a downward flick or a release past .9 dismisses, and the
  scrim's opacity is the drag distance. It only engages from the grip or when
  the feed's own scroller is at its top, and it stops propagation once it owns
  the axis, so the pager (which drops a y gesture anyway) never double counts.
  References: Magnetic Drawer, animbits; Draggable Modal, uniquesonu.
- Glyph census: the back chevron is `Icon name="back"`, the feed mark is
  `Icon name="ops"`, the headline separator is drawn in CSS. 0 unicode in TSX.
- The root keeps `app wb brain-b skin-${SKIN}` and `data-place`; the peerView
  early return keeps `app wb wb-take wb-take-thread brain-b skin-${SKIN}`.

## S27, the feed (7 of 7 kept)

S27-1 error state and `Tap to try again` (now `EmptyState` + `Button`, both
strings verbatim) · S27-2 `Nothing new since {clock}.` · S27-3 `Nothing here
yet.` · S27-4 single row through `openOne` (markRead then the deep link, both
unchanged) · S27-5 the deck, same `openOne` · S27-6 `useArrivals` verbatim, and
the first render is still never an arrival · S27-7 `useLeaving` / `withLeaving`
verbatim: the write still fires on the press, the snapshot still holds the row
for 220ms at its own index, a second press still cannot double fire.

- **Move 3, sticky day headers.** `DayHeader sticky` between days, its `tail`
  the live count for that day in mono. No new copy: the label is `dayWord()`.
- **Move 5, the pill.** `{n} new` appears only when something lands while he is
  more than 120px down, and jumps to the top. References: Animated List,
  dillionverma; New Items Pill, ddoemonn.
- **Move 20, ghost rows.** `EmptyState ghosts` with the promise on top.

## S28, the card and the deck (19 of 19 kept)

S28-1 mark (square/bar/dot, shape carries it) · S28-2 `{word} · {subject}` ·
S28-3 tenant chip · S28-4 timestamp · S28-5 lane action (Reply/Open/lane) ·
S28-6 `Pick this up` · S28-7 dismiss · S28-8 swipe (lock 8, max 108, settle .33,
left only, stopPropagation) verbatim · S28-9 quote · S28-10 time block ·
S28-11 strip edge and detail · S28-12 page snippet and `You asked:` · S28-13
unread · S28-14 raised full width vs flat inset · S28-15 deck with
`groupStateWord` · S28-16 `Show each one` / `Hide these` · S28-17 dismiss all ·
S28-18 nested row with `rowLine`, its own swipe and its own dismiss · S28-19
`latest {time}`.

- **Move 1, two densities.** `tile` and `strip` families render as one quiet
  line with a mono time; `quote` and `time` (a reply, a comment, a booking) keep
  the full card. **Decision:** `page` stays a card, because a Claude answer or a
  report is a document you can go back into, not an event, and S28-6/S28-12
  require its snippet and its second control. Reference: Activity Feed,
  felipemenezes098.
- **Move 2.** Actor, verb, object on one headline, the payload in `.dirb-quote`,
  the one action inline on the row. Reference: Notifications Menu, ahmedmayara.
- **Move 4, the working wash.** `.dirb-working data-live` on the state word.
  **Decision:** the predicate reads the row's OWN printed state word, not a
  family list, so the wash can never claim a lane is working while the card says
  something else; and the feed grants it to exactly one row, because the motion
  contract allows one continuous loop per surface. Reference: Card Status List,
  isaiahbjork.
- **Move 6/7, the deck.** `.dirb-deck-peek` edges (up to two, count visible),
  the count and its kind in the headline via `groupStateWord`, children fade in
  under it on the 30ms stagger. References: Sidebar News, dubinc; Stacked
  Activity Cards, spydiecy; Tool Group, serafimcloud.
- **Move 8, swipe.** The action is revealed UNDER the card, a tick draws in
  place before the row leaves, and the rows below settle on `layout` + `spring`.
  **No undo toast:** the source has no un dismiss call, and a toast offering an
  undo that does not exist would be a lie. Logged as a seam request below.
  References: Todo List Item, uiverse; BeUI Swipeable List.

## Motion table

| Rule | State change | Selector or animation | Property | Duration | Easing | Continuous |
|---|---|---|---|---|---|---|
| Island morph | alarm appears or clears | `.dirb-mob-island` `layout` | transform | spring 400/32 | spring | no |
| Island alert | alarm mounts/leaves | `AnimatePresence` on the alert | opacity | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| Live dot | an alarm is standing | `.ds-live-dot` ripple | transform, opacity | ds | ds | YES (chrome, one) |
| Tab marker | place changes | `layoutId="dirb-mob-place"` | transform | spring 400/32 | spring | no |
| Pager settle | release of a horizontal drag | `.dirb-mob-sheet` class transform | transform | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| Pager track | touchmove | inline `transform`, `transition:none` | transform | 0 | none | no |
| Sheet snap | release of a vertical drag | `.dirb-mob-sheet-inner` `animate.y` | transform | springSoft 300/34 | spring | no |
| Sheet track | touchmove | `animate.y`, `duration:0` | transform | 0 | none | no |
| Scrim | sheet distance | `.dirb-mob-scrim` | opacity | springSoft / 180ms out | spring / ease | no |
| Place fade | place changes | `[data-fading=true]` keyframe | opacity | 180ms | `var(--ds-ease)` | no |
| Row arrival | a new group key | slot `initial y:-8` + `delay i*30ms` | opacity, transform | spring 400/32 | spring | no |
| Row settle | a row leaves | slot `layout` | transform | spring 400/32 | spring | no |
| Row leave | dismiss snapshot / presence exit | `animate opacity 0` + `AnimatePresence` | opacity, scale | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| Resolve tick | dismiss pressed | `.dirb-mob-tick` | opacity, scale | spring 400/32 | spring | no |
| Deck peeks | deck opens or closes | `AnimatePresence` on `.dirb-deck-peek` | opacity | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| Deck children | deck opens | `staggerChildren 30ms` | opacity | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| New pill | arrival while scrolled | `.dirb-mob-pill` | opacity, transform | spring 400/32 | spring | no |
| Working wash | state word says running | `.dirb-working[data-live=true]` | transform | 1400ms | `var(--ds-ease)` | YES (feed, one row) |
| Hover lift | pointer | CSS only | background, transform | 120ms | `var(--ds-ease)` | no |

## Seam requests

1. **Move 9, card grows into the thread.** A feed tap navigates: it closes the
   sheet and mounts either `AskThread` or `workSurface`, which live in a
   different subtree this folder does not own. A `layoutId` shared across that
   boundary needs the orchestrator to keep both ends inside one `LayoutGroup`
   and to hold the feed row mounted for the length of the morph. What is here
   today: the card is one `motion` element with `layout`, the deck's own open
   IS the morph, and the vertical drag of move 19 is the gesture that brings the
   surface back. The card to thread half needs that seam.
2. **Move 8, the undo toast.** `useFeedData` exposes `dismissOne` and
   `dismissGroupRows` and nothing that reverses them. An undo needs an
   `undismiss(id)` on the hook (a write clearing `dismissed_at`); with it the
   `ToastStack` here is three lines.
3. `brain-b.css` is statically imported by the screen that mounts this override
   and its `.brain-b button` reset beats every `.ds-*` control class. Section 0
   of `mobile.css` re-states the clobbered properties one level deeper. If the
   seam ever stops loading that sheet, section 0 can be deleted whole.
