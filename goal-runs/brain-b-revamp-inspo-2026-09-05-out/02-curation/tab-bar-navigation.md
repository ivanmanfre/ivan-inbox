# tab-bar-navigation — curation

Surface: the six-place bottom bar with counts and severity badges, active indicators, docks, segmented controls, mobile navbars.

Pool size looked at: 24 candidates (by-surface.json's `tab-bar-navigation` list, ranked by usage, plus keyword grep over references.json for dock/segmented/badge/bottom nav/navbar; capped at 24 per pacing rule).

## Picks (5)

1. **Tabs 07 (Icon Only Tabs / Tabs with Count Badges)** · felipemenezes098 · usage n/a
   Move: each tab label carries an inline count-badge pill right next to it ("Inbox 12", "Drafts 3"), and rows below use a plain dot for unread state.
   Lands: the six place-names in the bottom bar each get a small pill showing their live count, read at a glance without opening the place.
   Risk: light-theme pill chips need repainting to lime-on-dark or they'll read as a foreign, un-canon accent.
   Preview: `01-refs/previews/felipemenezes098__tabs-07.png` · Video: none

2. **Segmented Button Group** · ruixen.ui · usage 28
   Move: a sliding dark active-pill segmented control whose segment labels are severity tiers (Low/Medium/High/Critical).
   Lands: could reframe the six places (or a filter row above them) as a severity-ordered segmented control instead of plain tabs, so urgency is baked into the control itself.
   Risk: four-way severity segments won't map cleanly onto six places; better as a secondary filter than the primary bar. Keep the sliding-pill mechanic, not the label set.
   Preview: `01-refs/previews/ruixen.ui__segmented-button-group.png` · Video: none

3. **Magnetic Dock** · componentry · usage n/a
   Move: a slotted icon dock (7 squares) where one slot carries a small numeric badge in its corner and a separate dot below the home slot marks the active page.
   Lands: solves both counts (badge) and active-state (dot) on the same six-place dock without adding a third visual language.
   Risk: rounded-square "app icon" slots read iOS-skeuomorphic; needs flattening to match the pistachio plate frame, and the badge color (currently red) must move to lime or an intentional severity palette.
   Preview: `01-refs/previews/componentry__magnetic-dock.png` · Video: none

4. **Animated Tab Bar** · abxlfazl__ · usage n/a
   Move: the active tab lifts into a circular bump that punches through the bar's top edge, instead of just highlighting in place.
   Lands: gives Ivan's tap on a place a genuinely new-feeling motion (the bar itself deforms), which is what "reads as new at a glance" needs beyond a color swap.
   Risk: the warm orange skin fights canon hard; only the bump/notch geometry and its transition are worth porting, the palette must be fully replaced.
   Preview: `01-refs/previews/abxlfazl____animated-tab-bar.png` · Video: none

5. **Bottom Nav Bar** · arunachalam · usage n/a
   Move: the active item alone expands to show icon+label in a rounded highlight; every other item stays icon-only, so the bar breathes instead of always showing six labels.
   Lands: keeps the six places legible while active, and quiet when not, cutting visual noise on a 390px screen.
   Risk: on a bar this narrow six labels won't all fit if two are ever active/expanding at once; needs a hard rule that only one expands at a time.
   Preview: `01-refs/previews/arunachalam__bottom-nav-bar.png` · Video: none

## Runners-up (5)

- **Notification Button** · ruixen.ui · usage 31 — a small numeric badge sits in the corner of a dark icon pill; the plainest version of the count-badge idea, kept as a fallback if the dock/tab picks prove too complex to port.
- **Segmented Control** · ddoemonn · usage 29 — a sliding black active-segment pill across Day/Week/Month/Quarter; the clean baseline version of the sliding-indicator move without the severity framing.
- **Animated Tabs** · preetsuthar17 · usage 199 — dark active-background morphs and slides between text tab labels; the archetypal "shared layout" tab transition, high usage but visually generic next to pick 4's bump.
- **Message Dock** · isaiahbjork · usage 436 — dark bg, avatar icons each carrying a small green online-status dot; the status-dot-on-icon idea as a backup active-indicator language.
- **Agent Dock** · dqnamo · usage n/a — a dark pill pairing an identity/status block with keyboard-shortcut-labeled action chips ("Voice V", "Chat C"); interesting control-surface hybrid, but not a direct six-place nav fit.
