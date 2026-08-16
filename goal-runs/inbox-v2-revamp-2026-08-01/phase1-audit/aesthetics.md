# ivan-inbox — Aesthetic/Craft Audit (baseline, 2026-08-01)

Scope: craft within the existing iOS-dark canon (system font, single accent #10A37F, 3-tier severity, Unicode glyphs, no monospace, no icon/animation library). Not a rebrand review. All claims reference either a screenshot in `goal-runs/inbox-v2-revamp-2026-08-01/baseline/*.png` or a `file:line` in the repo. Anything not directly confirmed is marked INFERRED.

---

## 1. Per-screen hierarchy verdicts

### Today (mobile 390 / desktop 1440)
Primary element: the **Urgent zone** (red dot, "0/3 cleared"). On mobile it correctly lands first — big "3 urgent · 11 approvals · 1 posts" strip (`.td-sum`, styles.css:476) sits directly under the chips, then zone 01 starts immediately. Hierarchy verdict: **correct, well-staged**. The eye goes count-strip → urgent rows → approve cards, which mirrors the operator's actual priority order.
Defects: none major on mobile. On desktop, the two-column split (`#td-z1`/`#td-z3` left, `#td-z2`/`#td-z4` right, styles.css:611-614) creates a real imbalance visible in `today-desktop.png`: the left column's Urgent card (3 rows) ends around mid-viewport and the rest of that column is flat black — nothing else renders below it inside the visible fold, while the right column (Approve) keeps going with card after card past the bottom edge. The two columns read as unequal weight even though the CSS intent ("each column carries content whether the morning is loud or quiet," styles.css:606-610) explicitly tries to avoid this. With only 3 urgent + 1 "today's content" post, the left column is starved next to an 11-item right column.

### Inbox (390 / 1440)
Primary element: the row list. Hierarchy is sound at the row level — bold name, client pill (IVAN/RISE), kind pill (INMAIL), snippet, right-aligned relative time (`.r`, styles.css:58-81) — confirmed in both `inbox-mobile.png` and `inbox-desktop.png`.
**Desktop defect (the single worst hierarchy problem in the set):** at 1440px the list occupies a fixed 400px column (`.dt-list`, styles.css:289) and the remaining ~950px of viewport is 100% empty black with one small centered glyph and the words "Select a conversation" (`.dt-empty`, styles.css:291-292) — confirmed in `inbox-desktop.png`. Nothing competes with the list for primary status because there is nothing else on screen; the primary element is sized correctly, but two-thirds of the canvas is dead.

### Drafts (390 / 1440)
Zero drafts state. Primary element: the segmented control (`All·0 / Ivan·0 / Rise·0`). Mobile shows it correctly sized and positioned (`drafts-mobile.png`), with "No drafts right now." centered ~260px below — appropriately quiet for a genuinely empty queue.
**Desktop defect:** identical to Inbox — Drafts is not in the `dt-full` route list (App.tsx:152: only `sends`/`ops`/`today` get `dt-full`), so it renders through the list+detail split. The result in `drafts-desktop.png` is a 400px list column with "No drafts right now." and a full ~950px black pane with a ghost icon and "Select a conversation." **"Select a conversation" is semantically wrong on a screen that will never have a conversation to select** — Drafts doesn't open a thread detail pane in this build.

### Sends (390 / 1440)
Primary element: the Decision hero row (Accept / Governor / Runway, three tiles). Correctly the largest, boldest numerals on the page (`.ov-tile-big`, 30px/800 weight, styles.css:349) — hierarchy verdict: **correct**, this is the "where do I stand right now" line and it reads first.
**Mobile pixel defect (verified in `sends-mobile.png`):** the Governor tile's overflow label is truncated — "103% of ca" is cut off mid-word (should read "103% of cap"). Source: `.ov-over-lbl{white-space:nowrap...}` (styles.css:402) inside a 3-up grid (`.ov-hero{grid-template-columns:repeat(3,1fr)}`, styles.css:345) at 13px tile padding (styles.css:346) — the pill has no room to wrap or shrink at 390px width. This is a real, currently-shipping clipping bug, not cosmetic nitpicking.
**Mobile rhythm defect:** the three hero tiles have uneven content height — Accept and Governor each carry 2-3 lines of sub-text, Runway carries one ("85 sendable") — so the row's bottom edge is ragged (`sends-mobile.png`) instead of the three cards reading as one clean strip.
Desktop: the same hero row plus Volume+Pipeline duo fills the width well (`sends-desktop.png`) — this is the best-composed desktop screen in the set.

### Ops (390 / 1440)
Primary element (when empty): "Nothing waiting on you." Correctly centered, correctly quiet, correctly deprioritized below the fold-adjacent DONE·2 / BLOCKED·3 rows (`ops-mobile.png`).
**Desktop:** Ops IS in the `dt-full` set (App.tsx:152) so unlike Drafts/Settings it correctly spans full width with no dead "Select a conversation" ghost pane (`ops-desktop.png`) — but because the content is 3 lines total, the result is a 1440×900 canvas with text confined to the top-left ~600px and the remaining ~75% of the surface pure black. Correct hierarchy (nothing competes with "Nothing waiting on you"), but reads as underbuilt for a 1440px monitor.

### Settings (390 / 1440)
Primary element: the NOTIFICATIONS group (`settings-mobile.png`). Correct — it's the first, most detailed group, appropriately sized text blocks inside a rounded card (`.group`, styles.css:148).
**Desktop defect:** Settings is not in `dt-full` (App.tsx:152), so it inherits the list+detail split exactly like Drafts — `settings-desktop.png` shows the settings list capped at 400px next to a full-height black pane with the "Select a conversation" ghost state. This is the same semantic mismatch as Drafts: Settings has no concept of a "conversation," so the empty-detail copy is nonsensical here. This is the clearest sign the desktop shell was built conversation-first and three non-conversation screens (Today, Sends, Ops) were retrofitted with `dt-full`, while two more (Drafts, Settings) were missed.

---

## 2. The desktop problem

Verdict: **desktop looks designed on 3 of 6 screens (Today, Sends, Ops) and looks like a stretched phone with a decorative sidebar on the other 3 (Inbox, Drafts, Settings).**

- Where `.dt-full` is used (App.tsx:148-158), the content genuinely re-flows for width: Sends gets a real Volume+Pipeline+Governor+Campaigns grid (`sends-desktop.png`), Today gets the two-column zone grid (`today-desktop.png`), Ops at least isn't wasted (`ops-desktop.png`, even if under-built).
- Where the list+detail split applies to a screen that structurally never opens a detail pane (Drafts, Settings), the app ships a wrong-context empty state ("Select a conversation") next to content that was never meant to have one. That's not "dead space used well" — it's dead space with an actively misleading label.
- Inbox is the correct use of the list+detail *pattern* (a real detail pane, ThreadScreen, does exist for it — App.tsx:163-171) but at 1440px the split is 400px list / ~954px detail-or-empty, and until a thread is opened that remaining ~66% of the window is one glyph. A 480px-capped mobile canvas simply grew a blank right panel; it wasn't redesigned for the width.

## 3. Density extremes

- **Ops (19 words) / Drafts (22 words):** both are legitimate zero-states with a single reassurance line + counts. At mobile size this reads as intentional calm. At desktop size (identical 19-22 words stretched across 1440px with either 75% dead space [Ops] or a wrong-context "Select a conversation" pane [Drafts]) the same content reads as **under-designed for its own emptiness** — nothing on the desktop canvas confirms "this loaded correctly and is simply empty" versus "this failed to load." See section 4.
- **Today (769 words, 4 zones):** correctly staged density — the operator gets urgent-first, then approvals, then today's content, then campaign health, each zone visually separated (`.td-zh` rule+count+dot header, styles.css:494-498). This is the right density for a daily triage surface.
- **Sends (265 words):** dense but structured — numerals dominate, labels are small caps, this is a KPI dashboard doing KPI-dashboard things correctly.
- **Inbox (49,558 words):** this number is two orders of magnitude above every other screen. Visually only ~9-10 rows are visible per viewport (`inbox-mobile.png`, `inbox-desktop.png`), each row is 2 lines of text — so the rendered *visible* density is normal and matches the rest of the app. The word count almost certainly comes from all 56 threads' row markup existing in the DOM simultaneously rather than a virtualized/windowed list (mobile and desktop word counts are within 3 of each other — 49,558 vs 49,561 — meaning the count doesn't track what's on-screen, it tracks total DOM text). INFERRED: this is a technical/list-virtualization observation, not something visible in the pixels — flagging it here because it's the reason the "49,558" figure looks alarming while the screenshots look ordinary. Not an aesthetic defect by itself, but worth noting so it isn't mistaken for one, and worth flagging for the engineering side of the revamp (scroll perf on a 56+ thread inbox).

## 4. The empty-state problem

What the operator actually sees, quoted directly from the screenshots:

- **Ops (mobile & desktop):** "Nothing waiting on you." + "DONE · 2 ›" + "BLOCKED · 3 ›" — three lines, no visual affordance to distinguish "confirmed zero" from "silently failed to fetch." There's no timestamp, no "checked Xm ago," no sync indicator anywhere on this screen (compare Today, which has `.td-sync` "Synced 00:30 · now" in its count strip, styles.css:484-486, visible in `today-mobile.png`). Ops has nothing equivalent.
- **Drafts (mobile & desktop):** "No drafts right now." under an "All · 0 / Ivan · 0 / Rise · 0" segmented control. The 0-counts in the segmented control do double as a confirmation the fetch succeeded (three independent zero-counts agreeing is a weak but real signal), which is better than Ops. Still no sync/freshness marker.
- Is a genuinely-empty queue distinguishable from a failed load? **Only on Drafts, and only weakly** (via the three-way 0/0/0 in the segment control). On Ops there is nothing distinguishing a real zero from a stalled fetch — same defect the sweep's "zero console errors" measurement can't catch, since a silent stall wouldn't throw. This is the single clearest actionable finding from the density-extreme analysis: Ops needs the same freshness signal Today already has and Drafts partially has.

## 5. Consistency sweep

**Card/surface corner radius — 6 distinct values in active use**, none of them clearly hierarchical (i.e., not "16 for primary cards, 20 for hero cards" — it looks accidental):
- 13px: `.log-r` (styles.css:257)
- 14px: `.group` settings card, `.ld` sends drill-in (styles.css:148, 241)
- 15px: `.sheet-card` action-sheet (styles.css:211)
- 16px: `.draftbanner`, `.seatbanner`, `.ov-tile`, `.sc` (sends lane row), `.td-card`, `.ov-gov`, `.ov-pipe`, `.ov-tbl`, `.td-tile` (styles.css:45, 50, 346, 166, 562, 392, 409, 417, 579)
- 18px: `.td-zone` on desktop (styles.css:615)
- 20px: `.qc` drafts queue card, `.draftcard`, `.ops-card` (styles.css:131, 109, 631)
This is exactly the kind of defect item 1 asked to name — it's real, it's in the CSS, and it's invisible as a single screenshot but obvious once you diff all six.

**Pill/chip radius — 3 different values for the same "small label" family:**
- 6px: `.r .client` (inbox client tag), `.td-kind` (today kind tag), `.dpill` (styles.css:71, 518, 82)
- 7px: `.ops-kind`, `.ov-badge`, `.log-chip` (styles.css:633, 342, 258)
- 99px (pill/capsule): `.chip` filter chips, `.gbtn`, `.stalebtn` (styles.css:40, 155, 269)
The 6-vs-7px split especially is not a deliberate design choice visible in any screenshot — it reads as drift between whichever screen was built last.

**Section-header treatment — 4 different patterns for "this is a themed group of content":**
1. Today's zone header: numbered ("01"), letter-spaced uppercase title, a horizontal rule filling the remaining width, a "N/M cleared" count, and a colored status dot (`.td-zh`, styles.css:494-498) — confirmed in `today-mobile.png` and `today-desktop.png`. The richest, most considered header in the app.
2. Sends' section header: plain uppercase label + right-aligned lighter-weight subtitle, no rule, no count, no dot (`.ov-h`, styles.css:337-338) — confirmed in `sends-mobile.png`/`sends-desktop.png`.
3. Ops' section header: uppercase label + count + a chevron, the whole row clickable to expand/collapse (`.ops-sechdr`, styles.css:647-648) — confirmed in `ops-mobile.png`/`ops-desktop.png`.
4. Settings' group header: plain uppercase label, nothing else (`.grouphdr`, styles.css:147) — confirmed in `settings-mobile.png`.
These aren't wrong individually (Ops needs the chevron because it's collapsible; Settings needs nothing because groups don't have counts) but there's no shared visual DNA between them — no shared color, weight, or spacing rule ties them together as "the app's section header." A 3-tier severity app with one accent color should have one section-header primitive with 2-3 optional slots (count, dot, chevron), not four unrelated implementations.

**Avatar usage — present in Inbox, absent everywhere else a "person" is shown:**
Inbox rows carry a 48px gradient avatar circle with initials (`.av`, styles.css:60-66, 6 gradient variants) — confirmed in `inbox-mobile.png`. Today's Urgent rows (`.td-r`) show the same *conceptual* row — a person, a message snippet, a time — with **no avatar at all** (confirmed in `today-mobile.png`/`today-desktop.png`: "Nour Siakir Oglou," "Ed Hatfield," "Gabriel Amarazeanu" render as bold text only). Today's Approve zone draft cards (`.td-dm`) and Sends' log rows (`.log-r`) likewise have no avatar. This may be intentional (Today is a task list, not a contact list) but it means the operator loses the fastest visual identity cue — color — on the screen where fast triage matters most.

**3-tier severity system — applied consistently where it appears, but its vocabulary is reused for two different meanings without a visual distinction:**
Confirmed consistent: Sends' Governor dot goes amber when over-cap (`govSev`, OverviewView.tsx:34-39, matches `sends-mobile.png`'s orange dot on "GOVERNOR 103/100"); Today's zone-status dot is red for the Urgent zone and amber for the Approve zone (`.td-zmark.hot`/`.pending`, styles.css:500-504, confirmed in `today-mobile.png`). But these are two different signals sharing the same amber: Sends' amber = "a real problem, you're over cap." Today's amber on the Approve zone = "pending, not yet cleared" (there's nothing wrong with having 11 approvals — amber here just means "not done"). Nothing in the pixels distinguishes "amber = warning" from "amber = incomplete-but-normal." An operator scanning fast could read Today's amber zone as a problem when it's routine.

**Timestamp format — consistent.** Relative "Xh"/"Xd ago" is used uniformly across Inbox rows, Today's urgent/approve rows, and Sends' lane cards (confirmed across `inbox-mobile.png`, `today-mobile.png`, `sends-desktop.png`'s "24h: 4" volume tiles). No inconsistency found here — worth naming as a thing that's already right.

## 6. What's already excellent — must not lose

1. **The honest over-cap gauge.** When usage exceeds the cap, the fill doesn't clamp at 100% — it draws a solid bar to the cap tick, then a diagonally-hatched amber overflow segment for the remainder, with a "103% of cap" pill (`gaugeGeom`, OverviewView.tsx:96-104; `.ov-gauge-over`, styles.css:400). Visible in `sends-mobile.png`/`sends-desktop.png` ("GOVERNOR 103/100"). This is a genuinely sophisticated data-viz decision that tells the truth instead of lying with a capped bar — rare in dashboards this size.
2. **Today's zone header primitive** (`.td-zh`: numbered, ruled, counted, dotted — styles.css:494-498). It's the single richest, most confident piece of typography/layout in the app and instantly orients the operator to "which stage of the day is this."
3. **The Governor/Sends tile system deliberately mirrored across Today and Sends** — same dot colors, same tile radius (16px), same big-number treatment, explicitly called out in code ("Dot / accent colors mirror SendsScreen so the two views read as one system," OverviewView.tsx:16). This is the one place in the codebase where consistency was a stated design goal, not an accident, and it shows.
4. **The zero-state copy voice.** "No drafts right now." / "Nothing waiting on you." / "Select a conversation." are terse, human, un-corporate — no exclamation points, no "Oops!," no mascot. This tone is worth protecting explicitly in any revamp.
5. **Tap/press feedback restraint.** A single shared interaction rule (`transform:scale(.94-.985)`, `filter:brightness(1.1)`, 120-180ms — styles.css:186-199) applied uniformly to rows, chips, buttons, and cards. It's felt, not seen, and it's exactly the kind of native-feeling micro-interaction that a "6 keyframes total, no animation library" constraint should protect — it already achieves iOS-native tactility without one.

## 7. Elevation opportunities, ranked

1. **Give Drafts and Settings a real desktop layout (or at minimum, kill the "Select a conversation" ghost state on both).** File: `src/App.tsx:148-158` — add `'drafts'` and `'settings'` to the `dt-full` condition (or build them a purpose-specific desktop treatment, since Drafts especially has real queue-card content that could run wider, like Sends does). This is the highest-leverage single fix: it removes the app's most visible "wrong screen" moment on two of six routes and directly fixes the desktop-looks-like-a-stretched-phone problem for Drafts and Settings.
2. **Fix the "103% of ca" clipping bug.** File: `src/styles.css:402` (`.ov-over-lbl`) and the `.ov-hero` 3-up grid (`:345`). Either drop `white-space:nowrap` with a shorter fallback string at narrow widths, or move the overflow pill below the number instead of inline. Small, concrete, currently broken.
3. **Consolidate card radius to 2-3 tokens.** Introduce `--r-sm` (14px), `--r-md` (16px), `--r-lg` (20px) in `:root` (styles.css:1-6) and remap the 13/15/18px outliers (`.log-r`, `.sheet-card`, `.td-zone` desktop) onto the nearest token. Same for pill radius (6px vs 7px → pick one). Pure craft cleanup, zero new visual language, but it's the difference between "system" and "assembled over time."
4. **Add a freshness/sync indicator to Ops (and ideally Drafts).** File: `src/styles.css` near `.ops-h`/`.ops-rows` (:630-636) — graft Today's `.td-sync` pattern ("Synced 00:30 · now," styles.css:484-486) onto Ops so "Nothing waiting on you" carries a timestamp. This directly closes the empty-vs-failed ambiguity named in section 4 and reuses an existing, already-correct component instead of inventing a new one.
5. **Unify the section-header primitive.** Build one `.sec-h` component with optional slots (count badge, status dot, chevron) modeled on Today's `.td-zh` (the strongest of the four existing patterns), and reskin Sends' `.ov-h` and Settings' `.grouphdr` onto it, keeping Ops' chevron variant. This is the highest-leverage *typographic* move available — it would make all six screens visibly belong to one app at a glance instead of reading as four different sub-apps stitched together.
6. **Rebalance Today's desktop two-column grid so the left column never strands dead space next to a taller right column.** File: `src/styles.css:604-614`. Options within canon: let a short left column's last card grow to fill remaining height with breathing room (not stretched, just centered/padded), or add a lightweight "you're clear for now" reinforcement panel under a short Urgent zone instead of leaving true black. Confirmed visible gap in `today-desktop.png`.
7. **Give Today's Urgent/Approve rows the same avatar treatment as Inbox.** File: `src/styles.css:511-533` (`.td-r`) and `:536-547` (`.td-dm`) — reuse `.av`/`.av.g1-g6` (styles.css:60-66). Today is the screen where fast person-recognition matters most (it's the triage surface), yet it's the one place that dropped the app's one strong identity cue (gradient avatar + initials). Directly reuses an existing, already-polished component.
8. **Decide and encode a visual difference between "amber = warning" and "amber = pending-but-normal."** Today's Approve-zone dot and Sends' over-cap dot both fire the same amber for different meanings (section 5). Cheapest in-canon fix: keep amber for true warnings only, and give "pending/incomplete" a neutral gray-outline treatment (the ring-only style already exists in `.td-zmark`'s base state, styles.css:500) instead of a filled amber dot. Protects the 3-tier system's honesty, which is one of the app's stated non-negotiables.
9. **Even out the Sends hero row's card heights on mobile.** File: `src/styles.css:346-354` (`.ov-tile`) — give `.ov-tile-sub` a fixed min-height (or always render two lines, using an em-dash placeholder when there's no trend to show) so Accept/Governor/Runway stop reading as a jagged row (visible in `sends-mobile.png`). Small, but it's exactly the "ragged bottom edge" flaw item 1 asked to hunt for, and it's on the app's best-composed screen.
10. **Use Ops' and Drafts' desktop width for something other than margin, once they're in `dt-full`.** Once #1 lands, don't just stretch the existing mobile column — cap prose at the same `max-width:720px` measure Ops' own desktop rule already uses for cards (`app.dt .ops-card{max-width:720px}`, styles.css:653-655) so a wide Drafts queue doesn't turn into one giant horizontal card, and consider a lightweight secondary column (e.g., recently-cleared drafts, or the DONE/BLOCKED disclosure Ops already has data for) so the width earns its keep instead of just being whitespace with a wider left margin.
