# sheet-drawer — curated picks

Pool looked at: 24 candidates (from by-surface.json's sheet-drawer bucket plus a keyword grep of references.json for drawer/sheet/vaul/snap point/drag handle/bottom sheet/finger/gesture terms). Previews viewed in 4 batches of 6, verdicts logged live to `notes-sheet-drawer.md`.

## Picks

### 1. Drawer · shadcn · usage n/a
Move: the sheet rises with a visible drag handle to a fixed height and shows a hero numeric stat (a stepper counter) over a small bar-chart row, with two stacked full-width actions (primary + cancel) pinned at the bottom.
Lands: a per-thread quick-settings or single-metric sheet in the inbox — handle top-center, one big number Ivan can nudge, a tiny history strip under it, Save/Cancel stacked below — instead of today's flat list of controls.
Risk: this is the famous Vaul "Move Goal" demo; ship it recolored fully into the dark/pistachio/lime canon or it reads as unmodified boilerplate.
Preview: `01-refs/previews/shadcn__drawer.png`
Video: none

### 2. v-drawer-15 · cnippet.dev · usage n/a
Move: the bottom sheet opens onto a labeled grid of icon+label quick actions, with the destructive action visually called out (outlined, off-color) and a single full-width Cancel row beneath the grid.
Lands: the long-press / "..." menu on a feed card or thread becomes this exact action-grid (Reply, Archive, Snooze, Delete) instead of a plain stacked list.
Risk: a 4-column icon grid can read as a generic OS share-sheet if the icons aren't drawn in Ivan's own line language; keep it small (max 8 actions) so it doesn't feel like a dashboard.
Preview: `01-refs/previews/cnippet.dev__v-drawer-15.png`
Video: none

### 3. Magnetic Drawer · animbits · usage n/a
Move: the sheet is physically draggable up or down by hand and spring-snaps to the nearest of several configured heights; a flick down or a backdrop tap dismisses it.
Lands: the thread/turn sheet gets a half-height "peek" state and a full-height state Ivan can drag between with one thumb, instead of a binary open/closed.
Risk: needs real spring tuning (stiffness, velocity threshold) or it reads as janky rather than premium; underlying content must reflow at each snap point, not just get clipped.
Preview: `01-refs/previews/animbits__specials-magnetic-drawer.png`
Video: none

### 4. Draggable Modal Component · uniquesonu · usage n/a
Move: the drag handle itself is the dismiss control, tracked continuously via Framer Motion, and the sheet closes once dragged past a fixed pixel threshold (not a percentage of height).
Lands: gives the drawer handle real physical weight — tie sheet position 1:1 to the finger and fade the scrim opacity with drag distance, so the close feels finger-tracked rather than triggered.
Risk: none stylistically — already demoed on a dark ground, the easiest of the five to port as-is.
Preview: `01-refs/previews/uniquesonu__draggable-modal-component.png`
Video: none

### 5. Family Sign-in Drawer · stackingsu · usage n/a
Move: the bottom sheet's height animates with a spring as its internal content swaps between sub-views (a segmented tab switches the form embedded inside the same sheet).
Lands: switching the inbox composer between modes (quick reply vs voice note vs link) reflows the sheet height with a spring instead of a hard cut or a second sheet.
Risk: the segmented pill-tab control reads close to stock iOS chrome; needs restyling in the lime accent so it doesn't look like unmodified system UI.
Preview: `01-refs/previews/stackingsu__family-signin-drawer.png`
Video: none

## Runners-up

- **drawer-base · base-ui** — swipe-to-dismiss bottom sheet with a visible drag handle and plain confirm/cancel actions; clean generic baseline, no distinct move beyond what's already in picks 3-4.
- **8bit-drawer · theorcdev** — dark-ground pixel-art bottom sheet with drag handle and an inventory panel; already dark-canon-adjacent but the retro pixel skin fights the canon aesthetic.
- **drawer · ddoemonn** — drag-to-dismiss side panel with scrim, scroll lock and focus trap; sound engineering but the preview shows a static form with no drag state visible.
- **code-editor-sheet · bankkroll** — dark right-side sheet with a docked code editor over a card grid; fits the dark canon tonally but the editor-tabs move doesn't map to inbox content.
- **drawer · coss.com** — description promises snap points, swipe gestures and nested drawers, but the preview only shows a bare trigger-button rail with no drawer visible, so it couldn't be judged on image and was held out of the top 5 on that basis alone.

Pool size looked at: 24.
