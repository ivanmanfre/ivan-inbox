## A1 · COLOUR TOKENS, BOTH THEMES, WITH RELATIVE LUMINANCE

| token | dark value | dark L | light value | light L |
|---|---|---|---|---|
| `--canvas` | `#0c0c0b` | 0.0037 | `#f7f7f5` | 0.9289 |
| `--surface1` | `#1f1f1f` | 0.0137 | `#fff` | 1 |
| `--surface2` | `#2a2a29` | 0.0231 | `#efefed` | 0.862 |
| `--surface3` | `#353533` | 0.0354 | `#e3e3e0` | 0.7665 |
| `--hairline` | `#303030` | 0.0296 | `#dbdbd8` | 0.7068 |
| `--hairline-strong` | `#4c4c4c` | 0.0723 | `#b5b5b2` | 0.4609 |
| `--text` | `#fff` | 1 | `#131313` | 0.0065 |
| `--text2` | `#c7c7c7` | 0.5711 | `#3d3d3b` | 0.0465 |
| `--text3` | `#949494` | 0.2961 | `#5c5c5a` | 0.1067 |
| `--text4` | `#7e7e7e` | 0.2086 | `#6e6e6e` | 0.1559 |
| `--ground` | `#c5e1a5` | 0.6844 | `#c5e1a5` | 0.6844 |
| `--accent` | `#b8ff66` | 0.8267 | `#b8ff66` | 0.8267 |
| `--accent-ui` | `#b8ff66` | 0.8267 | `#5a8a00` | 0.2035 |
| `--accent-soft` | `#b8ff6624` | 0.8267 | `#b8ff6624` | 0.8267 |
| `--ink` | `#171717` | 0.0086 | `#171717` | 0.0086 |
| `--sev-clear` | `#10a37f` | 0.2784 | `#10a37f` | 0.2784 |
| `--sev-attention` | `#ff9f0a` | 0.4608 | `#ff9f0a` | 0.4608 |
| `--sev-urgent` | `#ff453a` | 0.2582 | `#ff453a` | 0.2582 |
| `--bg` | `#0c0c0b` | 0.0037 | `#f7f7f5` | 0.9289 |
| `--surface` | `#1f1f1f` | 0.0137 | `#fff` | 1 |
| `--sep` | `#303030` | 0.0296 | `#dbdbd8` | 0.7068 |
| `--blue` | `#c7c7c7` | 0.5711 | `#3d3d3b` | 0.0465 |
| `--delta-up` | `#b8ff66` | 0.8267 | `#b8ff66` | 0.8267 |
| `--delta-down` | `#ff9b22` | 0.4482 | `#ff9b22` | 0.4482 |
| `--cat-1` | `#b8ff66` | 0.8267 | `#b8ff66` | 0.8267 |
| `--cat-2` | `#ff9b22` | 0.4482 | `#ff9b22` | 0.4482 |
| `--cat-3` | `#fff` | 1 | `#fff` | 1 |
| `--cat-4` | `#707070` | 0.162 | `#707070` | 0.162 |

## A2 · WHAT IS ACTUALLY PAINTED, PER SCREEN

| screen | distinct painted bg colours | top 4 by element count |
|---|---|---|
| today | 14 | rgb(42, 42, 41) x48<br>rgb(31, 31, 31) x24<br>rgba(255, 159, 10, 0.1) x9<br>rgb(255, 159, 10) x9 |
| dms-list | 11 | rgb(42, 42, 41) x24<br>rgb(12, 12, 11) x4<br>rgb(184, 255, 102) x4<br>rgb(53, 53, 51) x3 |
| content-list | 8 | rgb(42, 42, 41) x16<br>rgb(12, 12, 11) x6<br>rgb(53, 53, 51) x6<br>rgb(16, 163, 127) x2 |
| content-calendar | 6 | rgb(31, 31, 31) x27<br>rgb(42, 42, 41) x13<br>rgb(12, 12, 11) x7<br>rgb(53, 53, 51) x3 |
| ops | 6 | rgb(42, 42, 41) x21<br>rgb(31, 31, 31) x16<br>rgb(12, 12, 11) x8<br>rgb(184, 255, 102) x2 |
| sends | 11 | rgb(255, 255, 255) x29<br>rgb(42, 42, 41) x17<br>rgb(31, 31, 31) x17<br>rgb(53, 53, 51) x15 |
| strategy | 6 | rgb(42, 42, 41) x6<br>rgb(12, 12, 11) x4<br>rgb(53, 53, 51) x2<br>rgb(255, 255, 255) x1 |
| settings | 6 | rgb(12, 12, 11) x6<br>rgb(31, 31, 31) x4<br>rgb(42, 42, 41) x3<br>rgb(255, 255, 255) x2 |
| thread-open | 13 | rgb(42, 42, 41) x30<br>rgb(184, 255, 102) x11<br>rgb(12, 12, 11) x6<br>rgb(53, 53, 51) x4 |
| draft-open | 14 | rgb(42, 42, 41) x40<br>rgb(31, 31, 31) x33<br>rgb(12, 12, 11) x14<br>rgb(184, 255, 102) x9 |

**Union across all 10 surfaces:**

| painted colour | elements | share |
|---|---|---|
| `rgb(42, 42, 41)` | 218 | 34.3% |
| `rgb(31, 31, 31)` | 128 | 20.2% |
| `rgb(12, 12, 11)` | 67 | 10.6% |
| `rgb(53, 53, 51)` | 46 | 7.2% |
| `rgb(255, 255, 255)` | 45 | 7.1% |
| `rgb(184, 255, 102)` | 42 | 6.6% |
| `rgb(255, 159, 10)` | 15 | 2.4% |
| `rgb(255, 69, 58)` | 12 | 1.9% |
| `rgb(112, 112, 112)` | 11 | 1.7% |
| `rgb(255, 155, 34)` | 10 | 1.6% |
| `rgb(16, 163, 127)` | 10 | 1.6% |
| `rgba(255, 159, 10, 0.1)` | 9 | 1.4% |
| `rgba(184, 255, 102, 0.14)` | 6 | 0.9% |
| `rgba(120, 140, 170, 0.12)` | 2 | 0.3% |
| `rgb(255, 214, 10)` | 2 | 0.3% |
| `rgba(255, 155, 34, 0.18)` | 2 | 0.3% |
| `rgba(18, 18, 20, 0.9)` | 2 | 0.3% |
| `rgba(255, 69, 58, 0.1)` | 1 | 0.2% |
| `rgb(48, 48, 48)` | 1 | 0.2% |
| `rgba(0, 0, 0, 0.55)` | 1 | 0.2% |
| `rgba(31, 31, 31, 0.92)` | 1 | 0.2% |
| `rgb(55, 143, 233)` | 1 | 0.2% |
| `rgb(223, 112, 77)` | 1 | 0.2% |
| `rgb(245, 187, 92)` | 1 | 0.2% |
| `rgba(255, 69, 58, 0.08)` | 1 | 0.2% |

## A3 · NESTED PAIRS WITH IDENTICAL COMPUTED BACKGROUND-COLOR

Distinct `child||parent` shapes: **25**. Live instances across the 10 surfaces: **58**.

| child selector | on parent selector | shared bg (L) | what separates them | box? | seen on |
|---|---|---|---|---|---|
| `div.cal-chip.cal-chip-lock.cal-chip-queue` | `div.cal-day` | `rgb(31, 31, 31)` (0.0137) | border 3px rgb(255, 255, 255) | r12 p0 | content-calendar, draft-open |
| `div.cal-chip.cal-chip-lock` | `div.cal-day` | `rgb(31, 31, 31)` (0.0137) | border 3px rgb(255, 255, 255) | r12 p0 | content-calendar, draft-open |
| `div.dd-card` | `div.dd-card` | `rgb(31, 31, 31)` (0.0137) | **NOTHING** | r20 p14 | ops |
| `div.cal-chip.cal-chip-lock` | `div.cal-day.cal-day-out` | `rgb(31, 31, 31)` (0.0137) | border 3px rgb(255, 255, 255) | r12 p0 | content-calendar, draft-open |
| `div.rows.ct-rows` | `div.wb-work.wide.wb-solo` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | r0 p32 | content-list, content-calendar |
| `div.cal-chip` | `div.cal-day` | `rgb(31, 31, 31)` (0.0137) | border 3px rgb(255, 255, 255) | r12 p0 | content-calendar, draft-open |
| `div.wb-sech-strip` | `div.rows.ct-rows` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p6 | content-calendar, draft-open |
| `div.wb-sech` | `div.wb-sech-strip` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | r0 p16 | content-calendar, draft-open |
| `div.ops-sechdr` | `div.rows.ops-rows` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | r0 p16 | ops |
| `div.wb-pane-h.slim` | `div.wb-peer.wb-peer-thread.on` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | r0 p16 | thread-open, draft-open |
| `div.rows.td-rows` | `div.wb-work.wide` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p32 | today |
| `div.rows` | `div.wb-work.wide.wb-solo` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p32 | dms-list |
| `div.ct-tabs` | `div.rows.ct-rows` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | r0 p16 | content-list |
| `div.rows.ops-rows` | `div.wb-work.wide` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p32 | ops |
| `div.wb-sech-strip` | `div.rows.ops-rows` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p6 | ops |
| `button.wb-sech.tap` | `div.wb-sech-strip` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | r12 p16 | ops |
| `div.rows.ov` | `div.wb-work.wide` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | r0 p32 | sends |
| `div.rows.ct-rows.wb-strat` | `div.wb-work.wide` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p32 | strategy |
| `div.rows.settings` | `div.wb-work.wide` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p32 | settings |
| `div.rows` | `div.wb-work.list` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p32 | thread-open |
| `div.rows.ct-rows` | `div.wb-work.list` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | r0 p32 | draft-open |
| `div.rows.wb-tk-body.dw-body` | `section.wb-tk` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | r0 p32 | draft-open |
| `div.dw-acts` | `div.rows.wb-tk-body.dw-body` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | r0 p16 | draft-open |
| `div.dw-insp-h` | `div.rows.wb-tk-body.dw-body` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p14 | draft-open |
| `div.dw-queue-h` | `div.rows.wb-tk-body.dw-body` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | r0 p14 | draft-open |

## A4 · CHILD BOXES THAT PAINT NOTHING AT ALL (border does 100% of the work)

Distinct shapes: **20** of 121 no-paint shapes. Live instances: **128**.

| child selector | on parent selector | inherited bg (L) | separator | radius | seen on |
|---|---|---|---|---|---|
| `div.cal-day.cal-day-empty` | `div.rows.ct-rows` | `rgb(12, 12, 11)` (0.0037) | shadow rgb(48, 48, 48) 0px 0px 0px 1px inset | 12px | content-calendar, draft-open |
| `div.cal-day.cal-day-empty.cal-day-out` | `div.rows.ct-rows` | `rgb(12, 12, 11)` (0.0037) | shadow rgb(48, 48, 48) 0px 0px 0px 1px inset | 12px | content-calendar, draft-open |
| `button.cal-chip-t` | `div.cal-chip.cal-chip-lock` | `rgb(31, 31, 31)` (0.0137) | border 2px rgb(0, 0, 0) | 0px | content-calendar, draft-open |
| `button.wb-rail-minbtn` | `div.wb-plate` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | 12px | today, dms-list, content-list, content-calendar, ops, sends, strategy, settings, thread-open, draft-open |
| `div.wb-rail-sync` | `div.wb-plate` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | 999px | today, dms-list, content-list, content-calendar, ops, sends, strategy, settings, thread-open, draft-open |
| `button.ct-tab` | `div.ct-tabs` | `rgb(12, 12, 11)` (0.0037) | **NOTHING** | 12px | content-list |
| `div.wb-rail-grp` | `div.wb-plate` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | 0px | today, dms-list, ops, sends, settings, thread-open |
| `button.dw-qrow` | `div.rows.wb-tk-body.dw-body` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | 12px | draft-open |
| `div.wb-rail-grp.on` | `div.wb-plate` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | 0px | content-list, content-calendar, strategy, draft-open |
| `section.dw-sec` | `div.rows.wb-tk-body.dw-body` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | 0px | draft-open |
| `div.cal-day.cal-day-empty.cal-day-now` | `div.rows.ct-rows` | `rgb(12, 12, 11)` (0.0037) | shadow rgb(76, 76, 76) 0px 0px 0px 1px inset | 12px | content-calendar, draft-open |
| `button.cal-chip-t` | `div.cal-chip` | `rgb(31, 31, 31)` (0.0137) | border 2px rgb(0, 0, 0) | 0px | content-calendar, draft-open |
| `div.wb-cardf` | `div.rows.ov` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(48, 48, 48) | 0px | sends |
| `div.wb-cardf` | `div.ov-pipe` | `rgb(31, 31, 31)` (0.0137) | border 1px rgb(48, 48, 48) | 0px | sends |
| `div.wb-cardf` | `div.ov-tbl` | `rgb(31, 31, 31)` (0.0137) | border 1px rgb(48, 48, 48) | 0px | sends |
| `div.nav.wb-head` | `div.wb-work.wide` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | 0px | strategy |
| `div.ct-card.wb-strat-card.blank` | `div.rows.ct-rows.wb-strat` | `rgb(12, 12, 11)` (0.0037) | shadow rgb(48, 48, 48) 0px 0px 0px 1px inset | 20px | strategy |
| `span.ct-chip.ct-chip-when` | `div.rows.wb-tk-body.dw-body` | `rgb(12, 12, 11)` (0.0037) | shadow rgb(48, 48, 48) 0px 0px 0px 1px inset | 8px | draft-open |
| `aside.dw-insp` | `div.rows.wb-tk-body.dw-body` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | 0px | draft-open |
| `aside.dw-queue` | `div.rows.wb-tk-body.dw-body` | `rgb(12, 12, 11)` (0.0037) | border 1px rgb(255, 255, 255) | 0px | draft-open |