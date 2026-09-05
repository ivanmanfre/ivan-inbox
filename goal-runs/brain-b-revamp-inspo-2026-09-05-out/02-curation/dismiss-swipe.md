# dismiss-swipe — 21st.dev curation

Surface: swipe to dismiss, swipe actions, leaving animations, undo.
Pool built: 90 candidates after rejects (grep over references.json on swipe / dismiss / dismissible / undo / drag-to / remove item / snooze / archive / gesture / exit animation / slide out / reveal action / delete / hold-to-confirm, plus the by-surface.json dismiss-swipe seed of 198, which is mostly buttons, tables, badges and file uploaders). Previews opened and judged: 14. This is the thinnest surface in the corpus — genuine swipe-to-dismiss components on 21st.dev are rare.

What the current build does wrong: every card carries an ⊗ in the top-right corner. Tapping it deletes. There is no gesture, no leaving animation, no grace window, and no undo — and the ⊗ is repeated nine times down a 390px screen, which is nine chances to lose something by accident.

---

## Picks

### 1. Todo List Item · serafimcloud · usage 42
- **Move:** the swipe reveals the action rather than performing it, and the row then RESOLVES IN PLACE — a strike-through animates across the text — before the row leaves. The resolution is visible; the removal is a consequence.
- **Lands in the inbox:** dismissing a card strikes it, dims it, holds for a beat, then collapses the row. Ivan sees which card he just killed, which is exactly what the current instant-delete denies him.
- **Risk:** the reference preview is a plain light checklist; port the timing and the resolve-then-leave sequence, none of the look. Hold the beat too long and the feed feels sluggish at ten dismisses a day.
- **Preview:** `../01-refs/previews/serafimcloud__to-do-item.png`
- **Video:** https://cdn.21st.dev/user_2nElBLvklOKlAURm6W1PTu6yYFh/to-do-item/default/video.mp4

### 2. Collapsible Banner · ddoemonn · usage 0
- **Move:** three states, not two — open, folded, dismissed. The detail springs away first and leaves a one-line stub; killing it outright is a separate, second decision.
- **Lands in the inbox:** gives Ivan the move he actually wants ten times a day: quiet this down without losing it. A read error folds to one line instead of vanishing, and the feed shrinks without anything being destroyed.
- **Risk:** a third state needs somewhere to live in the data model or folded cards resurrect on the next poll. And a stub row that never clears is just clutter with extra steps.
- **Preview:** `../01-refs/previews/ddoemonn__collapsible-banner.png`
- **Video:** none

### 3. Swipe Button · badtzx0 · usage 36
- **Move:** a drag-the-handle-across-the-track commit. The action does not fire on tap; it fires when the gesture completes the full traverse, and the track shows the progress.
- **Lands in the inbox:** reserved for the irreversible ones — "Send both", "Dismiss all 19", arming a lane. A tap can be a fat finger; a full traverse cannot.
- **Risk:** it is slow, so it must be rationed to the two or three genuinely irreversible actions. Put it on ordinary dismiss and Ivan will hate the app by Wednesday.
- **Preview:** `../01-refs/previews/badtzx0__swipe-button.png`
- **Video:** https://cdn.21st.dev/user_2wp8OAYJiBVSRas6ezBrlKFw55a/swipe-button/default/video.1787008792387.mp4

### 4. Message Draft · tool-ui · usage 0
- **Move:** the commit runs on a countdown you can cancel, not behind a confirm dialog. Send fires immediately in the UI, and an undo grace period holds the real action for a few seconds.
- **Lands in the inbox:** the correct model for the two-leg draft send and for dismiss alike — no modal, no "are you sure", just an action that has not finished leaving yet. It is also the honest fix for the ⊗ problem: keep the tap, add the window.
- **Risk:** a grace window is a promise the backend has to keep. If the send has already hit n8n, the undo is a lie, and one lie there is worse than no undo at all.
- **Preview:** `../01-refs/previews/tool-ui__message-draft.png`
- **Video:** none

### 5. Splashed Push Notifications · maxim.bort.devel · usage 0
- **Move:** each card carries its own auto-dismiss timer as a bar on its bottom edge, so a low-value card retires itself on a visible clock; the swipe or ⊗ only kills it early.
- **Lands in the inbox:** the ambient families (Ready, Reminder, 1 today) stop needing to be dismissed at all — they expire, and Ivan can see how long they have left. That is the only move in this pool that reduces the number of dismisses rather than improving them.
- **Risk:** the reference is loud — four saturated colours with blob splashes, dead against the canon. Port the timer bar and the self-retire behaviour and nothing else. And nothing that can be actioned may ever expire on a clock.
- **Preview:** `../01-refs/previews/maxim.bort.devel__splashed-push-notifications.png`
- **Video:** none

---

## Runners-up

- **Banner · diceui · 0** — dismissible banners with stacking and priority queueing, so the highest-severity one holds the slot. `../01-refs/previews/diceui__banner.png`
- **Sonner Toast · bundui · 0** — the canonical "done, with Undo" toast; the baseline this surface currently lacks entirely. `../01-refs/previews/bundui__toast1.png`
- **AI Error Handler · preetsuthar17 · 0** — error card where Retry and dismiss sit together, so killing it is not the only exit. `../01-refs/previews/preetsuthar17__ai-error-handler.png`
- **Sidebar News · dubinc · 305** — swipe the front card of a deck away and the next one takes its place, no gap left behind. `../01-refs/previews/dubinc__sidebar-news.png`
- **Drawer · coss.com · 44** — swipe gestures with snap points and nested drawers; the gesture physics reference, not a visual one. `../01-refs/previews/coss.com__drawer.png`
