# Notes — tab-bar-navigation (pacing log)

Pool (24 candidates), reviewed in batches of 6.

## Batch 1
- anurag-mishra22/dock-two (597) — static light pill dock, generic icon row, no badge/motion visible worth porting. REJECT.
- isaiahbjork/message-dock (436) — dark bg, avatar bubbles with green online-status dot per icon. Chat-launcher not a 6-place nav, but the status-dot-on-icon idea is transferable. WEAK KEEP (backup).
- ruixen.ui/dock (218) — clean light pill, 5 plain icons, no badges in this shot. Too plain, no distinct move. REJECT.
- preetsuthar17/animated-tabs (199) — pill tab bar where the dark active background morphs/slides to the selected tab. Strong active-indicator move. KEEP.
- ahmedmayara/notifications-menu (152) — segmented tabs with inline COUNT BADGES in the label ("View all 6 / Verified 2 / Mentions 1"). Exactly the counts+severity idea from the brief. KEEP.
- preetsuthar17/animated-dock (111) — minimal circular icon dock, one highlighted circle, no clear badge/count move. REJECT.

## Batch 2
- cnippet.dev/cnippet-toggle-group (104) — Monthly/Yearly segmented control with a black "Save 20%" pill riding inline on one segment. Shows a badge-on-segment placement. WEAK KEEP (backup for badge placement).
- serafimcloud/filter-badge (99) — dismissible avatar+name filter chips, not a tab bar. REJECT (wrong surface).
- jatin-yadav05/minimal-dock (91) — dark squarish icon dock with a mirrored reflection row underneath (macOS-glossy). Reflection effect fights the flat instrument canon. REJECT.
- ruixen.ui/dock-morph (79) — plain light pill, 5 icons, no badges or active state visible. Too generic. REJECT.
- karthikmudunuri/animated-badge (75) — announcement pill with blinking dot + chevron, not a tab/nav element. REJECT for this surface.
- badtzx0/dock (65) — macOS-style brand-icon launcher dock, generic marketing skin. REJECT.

## Batch 3
- ruixen.ui/tilted-dock (49) — plain light pill, 5 icons, redundant with dock-morph, no tilt visible in static shot, no badges. REJECT.
- dhileepkumargm/magnetic-dock (43) — dark pill, 4 muted circular social icons (github/linkedin/x/mail). Clean spacing but social-icon-dock framing, not an info nav. REJECT (weak fit).
- ruixen.ui/notification-button (31) — dark pill buttons each carrying a small numeric badge in the corner (5, 12). Exactly the "count badge on an icon" move. KEEP.
- ruixen.ui/gooey-dock (29) — 5 loose circular icons, no container/badges visible, generic. REJECT.
- ddoemonn/segmented-control (29) — Day/Week/Month/Quarter segmented control, black active pill slides to selection. Clean sliding-active-segment move. KEEP.
- ruixen.ui/segmented-button-group (28) — two stacked segmented controls; the second uses SEVERITY TIER LABELS (Low/Medium/High/Critical) with sliding active pill. Directly matches the "severity badges" brief language. STRONG KEEP.

## Batch 4
- componentry/magnetic-dock (usage None) — dark rounded-square app-icon dock, 7 slots; mail icon carries a RED numeric badge "3"; small active-page dot below home icon. Covers count-badge AND active-indicator in one dock. STRONG KEEP.
- dqnamo/agent-dock (usage None) — dark pill: avatar+name/status left, "Voice [V]" / "Chat [C]" keyboard-shortcut chips right. Interesting control-surface pattern but not a 6-place nav. WEAK KEEP (backup).
- abxlfazl/animated-tab-bar (usage None) — bottom bar where the active tab lifts into a circular bump breaking the bar's top edge (camera-app notch move). Strong motion/layout idea; orange skin fights canon but move is portable. STRONG KEEP.
- arunachalam/bottom-nav-bar (usage None) — dark pill nav where the active item expands to icon+label, others stay icon-only. Clean, dark, on-canon. STRONG KEEP.
- 0xUrvish/bottom-menu (usage None) — plain grey icon-only pill, no badges, redundant with earlier docks. REJECT.
- felipemenezes098/tabs-07 (usage None) — literal "Inbox 12 / Drafts 3 / Archive" tabs with count-badge pills inline per label, list rows below carry unread dots. Exactly the counts+badges brief language. STRONG KEEP.

## Final picks (5)
1. felipemenezes098/tabs-07 — count badge inline per tab label
2. ruixen.ui/segmented-button-group — severity-tier (Low/Medium/High/Critical) segmented control
3. componentry/magnetic-dock — count badge + active-page dot on a slotted dock
4. abxlfazl__/animated-tab-bar — active tab lifts into a circular bump
5. arunachalam/bottom-nav-bar — active item expands to icon+label, rest icon-only

## Runners-up (5)
- ruixen.ui/notification-button — numeric badge on corner of icon pill
- ddoemonn/segmented-control — sliding active-segment pill
- preetsuthar17/animated-tabs — sliding dark active background across text tabs
- isaiahbjork/message-dock — status dot on avatar icon
- dqnamo/agent-dock — identity + shortcut-chip control bar

Pool size looked at: 24 (capped per pacing).
