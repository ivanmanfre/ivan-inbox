# feed-cards — 21st.dev curation

Surface: the notification feed and its cards by family (reply, booking, error, Claude answer, seat health, build progress).
Pool built: 283 candidates (by-surface.json seed + grep over references.json on notification / activity feed / activity item / timeline / inbox / event log / log entry / feed item / list item / status card / alert card / update card / changelog / expandable row / animated list / priority / severity). Previews opened and judged: 30.

What the current build does wrong (from `../../brain-b-design-elevation-2026-09-04-out/01-build/b/shots/feed.png`): every family wears the same dark rounded card at the same weight, the same 00:13 timestamp, the same pill row. Severity is a 3px red bar; nothing else changes. Nine cards fill a 390px screen and none of them out-ranks another.

---

## Picks

### 1. Interactive Logs Table · moumensoliman · usage 153
- **Move:** every row is one fixed instrument grid — severity chip, monospace timestamp, source, message, right-aligned result code and duration — with a chevron that opens the detail in place, so severity and outcome read before any prose does.
- **Lands in the inbox:** replaces the free-form card body. `Failed · Gemma Telford` becomes `[FAIL] 00:13 warm-drafter · couldn't write a reply · 502`. Ivan scans the left and right edges of the column and never reads the middle unless he taps.
- **Risk:** it is a desktop table. At 390px the five columns must fold to two lines (chip + mono time + subject / right-aligned result), or it becomes a horizontally scrolling log viewer and dies.
- **Preview:** `../01-refs/previews/moumensoliman__interactive-logs-table-shadcnui.png`
- **Video:** https://cdn.21st.dev/larsen66/interactive-logs-table-shadcnui/demos/default/video.1773289980850.webm

### 2. Activity Feed · felipemenezes098 · usage 0
- **Move:** two densities in one list — a system event is a single quiet grey line with a small round glyph, a human event gets an avatar, a bold name and the full message body at full contrast.
- **Lands in the inbox:** the single biggest fix. Reply / booking / Claude-answer cards keep a body; seat health, "Ready", "Reminder", "1 today" collapse to one dim line with a glyph. The feed stops being nine equal cards and becomes two or three things that matter sitting in a stream of ticks.
- **Risk:** demoting a family is a product decision, not a style one — if a build failure ever gets rendered as a quiet line, the feed lies. Density must be driven by the family, ratified once, not by a heuristic.
- **Preview:** `../01-refs/previews/felipemenezes098__comment-thread-3.png`
- **Video:** none

### 3. Notifications Menu · ahmedmayara · usage 152
- **Move:** actor-verb-object headline, the actual payload quoted inside a nested inset block below it, and the one action that matters sitting inline on the row (Decline / Accept), plus segmented filter tabs carrying their own counts.
- **Lands in the inbox:** the reply family finally shows the reply. `New comment · Anna Romaniuk` carries her sentence in an inset, and Send / Discard sit on the card instead of behind a tap into ThreadScreen.
- **Risk:** an inset quote plus two buttons is tall. At 390px only one family (replies) can afford it; giving every card an inset returns us to nine equal cards, just taller ones.
- **Preview:** `../01-refs/previews/ahmedmayara__notifications-menu.webp`
- **Video:** https://cdn.21st.dev/user_2qwbyfIFugWPE0zPbh0IyehnANf/notifications-menu/default/video.1788404306355.mp4

### 4. Card Status List · isaiahbjork · usage 71
- **Move:** a running row wears its state as motion — a wash sweeping across the row's right side under a small monospace state label (SYNCING) — while settled rows go flat and quiet. State is a property of the row, not a spinner parked next to it.
- **Lands in the inbox:** build-progress and turn-running cards stop needing a separate widget. A lane that is mid-run glows and moves; the second it lands it goes still. Ivan can tell what is live from across the room.
- **Risk:** a moving gradient on a dark ground is one step from neon. Keep the wash to a single low-alpha lime pass at low frequency, and never run more than one at a time or the feed shimmers.
- **Preview:** `../01-refs/previews/isaiahbjork__card-status-list.png`
- **Video:** https://cdn.21st.dev/user_2tkbBPFWYn8YMjZNHwgIuP3yzvd/card-status-list/default/video.1750810727518.mp4

### 5. Chrono Board · dhileepkumargm · usage 0
- **Move:** a continuous vertical spine down the left with a status node per event, so the whole day reads as one thread; the card is a station on the rail rather than a floating object, and per-event actions (Details / Dismiss) hang off the right of each station.
- **Lands in the inbox:** kills the biggest at-a-glance tell of the current build — a column of detached rounded rectangles. One rail, glyph nodes for severity, and the eye follows time instead of hunting card edges.
- **Risk:** a rail eats ~28px of a 390px screen and only earns it if the nodes carry real information (severity, family). If the node is decorative it is pure cost, and the dark-blue treatment in the reference must not come with it.
- **Preview:** `../01-refs/previews/dhileepkumargm__chrono-board.png`
- **Video:** none

---

## Runners-up

- **Live Feed · aghasisahakyan1 · 0** — dark stacked notification tiles that auto-advance, the trailing one fading out at the bottom edge. `../01-refs/previews/aghasisahakyan1__live-feed.png`
- **Dashboard Activities · uniquesonu · 0** — per-family icon chip with a tinted ground; new activity inserts at the top and the oldest retires, both animated. `../01-refs/previews/uniquesonu__dashboard-activities.png`
- **List · haydenbleasel · 0** — items grouped under sticky status headers with a dot glyph carrying the group colour. `../01-refs/previews/haydenbleasel__list.png`
- **AI Task List · educalvolpz · 0** — nested subtasks with pending/running/done/failed transitioning in place, and right-aligned per-row meta ("6 files", "blocked on tests"). `../01-refs/previews/educalvolpz__ai-task-list.png`
- **Notification Scroll Area · bundui · 0** — long feed grouped by date with sticky date headers. `../01-refs/previews/bundui__scroll-area4.png`
