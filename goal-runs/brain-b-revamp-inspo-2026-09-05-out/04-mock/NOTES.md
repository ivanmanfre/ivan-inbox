# 04-mock notes

One file, `revamp-mock.html`, opens from `file://` in Chrome or Safari. Two CDN scripts only:
React 18 UMD and `framer-motion@11` UMD (global `Motion`, verified in Playwright:
`Object.keys(window).filter(k=>/motion/i.test(k))` returns `['Motion']`, and it carries `motion`,
`AnimatePresence`, `LayoutGroup`, `MotionConfig`, `useMotionValue`, `useTransform`,
`useDragControls`, `animate`). If it fails to load, a shim maps every `motion.*` to a plain element
and the page renders static with a red line at the top saying so.

Everything on screen comes from `src/exp/brain/b/mockNotifications.ts` or the answer text in
`ask-thread.png`, re-headlined as state then subject. No em dashes, no emoji marks, no internal names.

Ivan can drive it: `?state=` for the seven screens, and a dev strip under the phone with Reset,
Inject 2 rows, Simulate answer and a reduced-motion toggle.

---

## Ported, and from which source file

Every path below is under `01-refs/source/`.

| # | Move | Source file | Where it lands |
|---|---|---|---|
| 1 | Two densities in one list | `felipemenezes098__comment-thread-3.json` | System events are a quiet line (glyph, mono time, one sentence); human and failure events keep a card. Six of the fifteen rows are lines. |
| 2 | State · subject headline, payload quoted inset, the one action inline | `ahmedmayara__notifications-menu.json` | `New comment · Anna Romaniuk` carries her sentence in an inset with Reply on the row. |
| 3 | Sticky day headers, title condenses on scroll | `bundui__scroll-area4.json`, `ddoemonn__sticky-header.json` | Today / Yesterday pin; `Feed` scales to 0.74 and `15 unread` fades out past 18 px of scroll. |
| 4 | Running row wears its state as motion | `isaiahbjork__card-status-list.json` | One lime wash sweeps under a mono `RUNNING`. Exactly one row runs at a time. |
| 5 | New items land staggered, a floating pill when you are scrolled down | `ddoemonn__new-items-pill.json` | Source spring 540/34 and a 24 px anchor threshold; re-tuned to the one spring, threshold 70 px. Dev strip injects the rows. |
| 6 | A cluster is a physical deck | `dubinc__sidebar-news.json`, `spydiecy__stacked-activity-cards.json` | Three peeked edges behind the front card, real borders (`--hairline-strong`) because shadows die on black. Tap fans four children out with a 30 ms stagger. |
| 7 | Group header names count AND kind, overlapping glyphs | `serafimcloud__tool-group.json`, `heygaia__tool-calls-section.json` | `4 new replies · Mattan campaigns` with a four-glyph overlapping cluster, capped at four. |
| 8 | Swipe reveals, row resolves in place, rows settle, one undo | `serafimcloud__to-do-item.json`, `tool-ui__message-draft.json` | Source commits at `offset.x > 50` with `dragElastic .12`; a 342 px row needs more, so 90 px and `.06`. A strike line draws (scaleX 0 to 1), the row dims, then it pops out of layout and the rest spring up. Undo toast holds 4.2 s. |
| 9 | The card grows into the thread, a drag down returns it | `ibelick__morphing-dialog.json`, `jahed__shared-element-gallery.json`, `uniquesonu__draggable-modal-component.json` | `layoutId="card-<id>"` moves from the row to the overlay. Close on a fixed pixel threshold (source 100 px, here 120) or velocity, never a percentage. |
| 10 | Word by word fade with a cursor riding the tail | `ibelick__response-stream.json`, `elements-__streaming-text.json` | Source splits on `/(\s+)/` and sets `animationDelay: idx * segmentDelay`; here the tokens arrive one at a time so the interval IS the stagger, 32 ms per token, 180 ms fade per word, caret at 900 ms. A per-word delay on top of an appending stream makes later words land before earlier ones, which is a bug the source cannot have because it renders every segment at once. |
| 11 | One shimmering status line, flat the instant it resolves | `serafimcloud__text-shimmer.json`, `serafimcloud__tool-group.json` | `Reading 4 memory files` sweeps while streaming, becomes `answered in 4.1s · $0.2186`. Under it, `read 4 files, 2 searches` opens to six rows. |
| 12 | Citations inline right after the claim | `educalvolpz__ai-response.json` | Two lime numbered marks; tapping one drops a quoted source card under the answer. |
| 13 | One round control swapping send / typing / stop; the bar springs its height | `serafimcloud__send-button.json`, `stackingsu__family-signin-drawer.json` | Idle, lime when there is text, grey square while streaming. The bar springs between text, voice and link with `layout`. |
| 15 | Voice: timer, live meter, streaming transcript, then a waveform bubble | `kokonutd__ai-voice-input.json`, `uicapsule__voice-dictator.json`, `ruixen.ui__voice-message-bubble.json` | Mono timer, 18 bars driven by `scaleY` only, transcript streams under it. Stop produces a bubble with play, a 26 bar waveform and a duration; playback fills the waveform lime. |
| 16 | A pasted URL collapses into a nested inset card | `kokonutd__social-card.json`, `tool-ui__citation.json` | Favicon tile, `LINK` badge, `youtube.com · 04 Sep`, bold title, remove control. The inset is flatter than the bar it sits in so two radii do not read as a bug. |
| 17 | The status capsule is a dynamic island; a dot with a ripple ring marks live | `educalvolpz__dynamic-island.json`, `edwinvakayil__status-dot.json` | `1 alarm` idle, tap morphs it to the seat alarm with Reconnect and Mute 1h, snaps back after 4.2 s. Two tones only, urgent and lime. |
| 18 | Active place expands to icon and label, one sliding highlight, count pills | `arunachalam__bottom-nav-bar.json`, `motiondotdev__motion-shared-layout-animation.json`, `felipemenezes098__tabs-07.json` | Source ran width at 350/32 and opacity at 190 ms; normalised to the one spring and 180 ms. The highlight is a single `layoutId="tabhl"` travelling. |
| 19 | Snap points, finger tracked 1:1, scrim fades with drag, flick dismisses | `animbits__specials-magnetic-drawer.json`, `uniquesonu__draggable-modal-component.json` | Snaps at 0.30 / 0.62 / 0.96 of the canvas, `dragElastic .05`, `dragMomentum false`, nearest-snap on release, dismiss on velocity or below a 0.14 ratio. Source used ±500 velocity, raised to ±700 because a mouse flicks harder than a thumb. The handle and the header are the drag control (`dragListener:false` plus `useDragControls`) so the list still scrolls. Scrim opacity is `useTransform(y, [fullY, closedY], [.66, 0])`. |
| 20 | Ghost rows instead of a void | `shadcnui-blocks__empty-state-04.json`, plus `pacekit__ai-suggestions.json` and `educalvolpz__ai-suggestions.json` | Eight skeleton rows at 0.22 opacity drifting on a 26 s loop under a mask. The starters moved off the dead middle onto a chip rail on the composer, and after an answer lands the rail carries follow-ups derived from it. |
| 21 | The motion system | `motiondotdev__motion-shared-layout-animation.json` | See the table below. |

Move 14 (attachment chips) is only half here: the `LINK` type badge survives, the image and PDF tray does not. See below.

## Dropped, and why

- **Chrono Board rail** (`dhileepkumargm__chrono-board.json`). A 28 px spine costs 7 percent of the width and the two densities plus sticky day headers already make time readable. It would have been decoration.
- **Stacked Dialog paging** (`reuno-ui__stacked-dialog.json`). It fights the fan-out. Two ways to review the same group is one too many on a 390 px screen.
- **Swipe Button full traverse** (`badtzx0__swipe-button.json`). Nothing in this mock is irreversible. The move belongs on Send both and Dismiss all, and rationing it is the whole point.
- **Per-card auto-dismiss timer bar** (`maxim.bort.devel__splashed-push-notifications.json`). A clock on a row is a data-model promise, not a mock decision.
- **Markdown hierarchy** (`serafimcloud__markdown.json`). Ivan's real answers are two or three sentences of prose. Headings and code fences would invent structure that is not in the answer and make plain answers look broken.
- **Interactive Logs Table five-column grid** (`moumensoliman__interactive-logs-table-shadcnui.json`). Folded into the two-line card instead. At 390 px the columns become a horizontal scroller.
- **Attachment tray with IMAGE / PDF / PASTED chips** (`serafimcloud__file-attachment.json`, `suraj-xd__claude-style-ai-input.json`). No real files here, so the chips would be props. Only the type badge idea survived, on the link chip.
- **Blocked-link error card, LinkedIn post screenshot, domain fan** (`serafimcloud__error-message.json`, `preetsuthar17__post-card.json`, `ziegfiroyt__browser28.json`). The bug Ivan can actually see is the raw URL sitting in the composer, so the collapse is the move worth mocking.
- **Thinking Orbs** (`larsen66__thinking-orbs.json`). A canvas particle loop is neither transform nor opacity, and the shimmer line already says the same thing for free.
- **Magnetic Dock and the tab-bar bump** (`componentry__magnetic-dock.json`, `abxlfazl____animated-tab-bar.json`). One active-state language only; the expanding pill won.
- **Draggable Priority List** (`nikhiljainsam__draggable-priority-list.json`). Nothing in the feed is reorderable.
- **Action-grid and move-goal drawers** (`cnippet.dev__v-drawer-15.json`, `shadcn__drawer.json`). The sheet here holds a list, not a control panel. Only the physics from picks 3 and 4 were taken.
- **Collapsible Banner's third state** (`ddoemonn__collapsible-banner.json`). Fold-not-delete needs somewhere to live in the row, or folded cards resurrect on the next poll. Worth doing in the real build, not worth faking here.

## Motion table

One spring, one opacity duration, one stagger. Transform and opacity only. Everything below collapses
to `{duration: 0}` when reduced motion is on, either from the system setting or the dev toggle, and
the `.rm` class kills the shimmer, the wash, the ripple, the caret and the ghost drift outright.

| What | Transition | Property |
|---|---|---|
| Layout, drag settle, sheet snap, deck fan, morph | `spring, stiffness 400, damping 32` | transform |
| Anything appearing or leaving | `180 ms, cubic-bezier(.25,1,.5,1)` | opacity |
| List mount, deck children, tool rows, thread messages, starter chips | `30 ms` stagger on the above | opacity + transform |
| Sheet drag | `dragElastic .05`, `dragMomentum false`, constraints top `snapY(full)` to bottom `canvasH` | transform |
| Sheet release | nearest of 0.30 / 0.62 / 0.96; dismiss on `velocity.y > 700` or ratio `< .14`; step up or down on `velocity ∓ 700` | transform |
| Scrim | `useTransform(y, [fullY, closedY], [.66, 0])`, no timer | opacity |
| Row swipe | `dragElastic .06`, constraints left `-130`; commit at `offset.x < -90` or `velocity.x < -600` | transform |
| Resolve in place | strike `scaleX 0 to 1` in 180 ms, hold 420 ms, then `popLayout` exit | transform + opacity |
| Thread close | `offset.y > 120` or `velocity.y > 600`, `dragElastic {top: 0, bottom: .55}` | transform |
| Word stream | 32 ms per token, 180 ms fade per word, caret 900 ms | opacity |
| Shimmer, running wash | `translateX(-100%)` to `115%`, 1500 ms and 2200 ms linear | transform |
| Ripple ring | `scale(.5)` to `scale(1.5)` with fade, 2 s | transform + opacity |
| Ghost drift | `translateY(0)` to `-50%`, 26 s linear | transform |
| New-items pill | `spring 540/34` (the source's own value, the one place the contract bends, because the pill has to arrive faster than the rows it announces) | transform + opacity |

## Taste calls made here, unasked

- The **starters moved off the dead middle** onto the composer rail. The old empty screen spent a third
  of the phone on three pills and 500 px on nothing.
- The **Ask thread bottom-anchors**. A one-turn thread pinned to the top left the same void the last run
  was marked down for.
- **The island snaps back on a timer** (4.2 s) as well as on an action. A capsule that stays open is a banner.
- **Only one thing runs at a time.** One wash, one shimmer, one ripple. The curation warned about this
  three separate times and it is the difference between an instrument and a Christmas tree.
- The **feed is a sheet, not a place**. It opens from the header over whatever place you are in, which
  is why the tab bar keeps all six places and the sheet keeps its own header.
- **Peek edges use a border, not a shadow.** Shadows are invisible on `#0C0C0B`.

## Verified

Playwright at 390 x 844 inside a 430 x 1010 viewport, device scale 2. Seven `?state=` screenshots in
`shots/`. `motion.webm` is 6.4 s: open the sheet, drag it to full, swipe a row away with the undo
toast, fan the deck, tap a card into the thread, drag it back. Every step asserted, not just filmed:
sheet y lands on the snap, `.toast` present, four `.deckchild` rendered, `.tover` opens and closes.
Console and page errors: none. No em dash or en dash anywhere in the file.
