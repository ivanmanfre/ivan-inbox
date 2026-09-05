# motion-system — 21st.dev curation

Surface: not a screen, the whole-app motion vocabulary for Ivan's inbox — page/place transitions, list stagger, spring physics, layout animation, shared-element moves, morphs.

Pool built: 24 candidates from grep over references.json tags (motion, spring, micro-interaction, physics, stagger, in-view, smooth, morph, fluid, transition, animated) plus name/description hits on page transition, shared layout, layout animation, expandable, drag-reorder, magnetic. Previews opened and judged: 24.

What the current build does wrong (from the elevation-run shots): every screen change is a hard cut. Feed to thread is an instant swap, grouped cards appear and disappear with no continuity, and nothing in the app tells Ivan an element he tapped is the thing that grew into the next screen.

---

## Picks

### 1. Shared Element Gallery · jahed · usage 0
- **Move:** a tapped thumbnail expands in place into a focused full view via a true shared-element transition, and a vertical drag on the focused view dismisses it back to its origin card.
- **Lands in the inbox:** the exact move for opening an attachment, link-preview image, or voice-note waveform from a card. The thumbnail IS the destination view, not a new screen replacing it, and dragging down to close feels physical instead of a back-button tap.
- **Risk:** shared-element transitions are easy to get janky on real devices if the two layouts do not share exact geometry; needs testing on the actual 390px viewport, not just desktop.
- **Preview:** `../01-refs/previews/jahed__shared-element-gallery.png`
- **Video:** none

### 2. Motion Shared Layout Animation · motiondotdev · usage 0
- **Move:** a selection indicator (pill or underline) slides between options using a shared layoutId, so the indicator itself is one continuous element traveling, not two static states cross-fading.
- **Lands in the inbox:** the underline the app already needs on segmented filters, feed/thread tab switches, and any pill-selector treats the indicator as a single moving object across the whole surface, which reads as "new and smooth" at a glance far more than any card redesign.
- **Risk:** this is a library demo from Motion's own authors so the mechanic is solid, but the reference is desktop and light-mode; the discipline (one moving indicator, not per-view redraws) is the whole point, the food-emoji chrome is not.
- **Preview:** `../01-refs/previews/motiondotdev__motion-shared-layout-animation.png`
- **Video:** none

### 3. Stacked Activity Cards · spydiecy · usage 43
- **Move:** a cluster of cards renders as one physical stack (visible edges peeking behind the top card) that fans out into a full list on tap, and can collapse back into the stack.
- **Lands in the inbox:** direct upgrade for the grouped-notification cluster (the "3 more" cases). Instead of a static counter chip, the group looks and behaves like a stack of paper that spreads open, so grouping reads as a physical state rather than a UI label.
- **Risk:** on a dark ground the stack-edge shadows need real contrast to read at all; too subtle and it just looks like one card with a drop-shadow, no perceived stack.
- **Preview:** `../01-refs/previews/spydiecy__stacked-activity-cards.png`
- **Video:** none

### 4. Draggable Priority List · nikhiljainsam · usage 0
- **Move:** rows carry a rank number and a grip handle; dragging one reflows the rest with a spring, and there is a full keyboard/screen-reader path (Space to grab, arrows to move, Esc to cancel) shown right in the UI.
- **Lands in the inbox:** if Ivan ever needs to reorder pinned threads, priority senders, or a manual triage queue, this is the spring-physics reference for it — rows displace with real momentum, not an instant re-sort. The accessibility affordance is worth copying even if touch is the only input that matters here.
- **Risk:** the demo's serif "Priority Queue" headline and light numerals are not canon and should not travel with the pick; only the reorder mechanic and rank-badge layout are the move.
- **Preview:** `../01-refs/previews/nikhiljainsam__draggable-priority-list.png`
- **Video:** none

### 5. Morphing Dialog · ibelick · usage 0
- **Move:** the tapped trigger element itself is the dialog, using a layout animation to grow from its own bounds into the focused overlay rather than a separate modal fading in on top.
- **Lands in the inbox:** this is the canonical "open thread" move — a feed card should feel like it becomes ThreadScreen, not get replaced by it. Same mechanic could carry the composer opening from a plus-button.
- **Risk:** needs a real close-affordance (tap-outside or drag-down) or it reads as a stuck state; also easy to overuse until every tap on the app morphs, which would undercut the one place it should feel special (opening a thread).
- **Preview:** `../01-refs/previews/ibelick__morphing-dialog.png`
- **Video:** none

---

## Runners-up

- **Animated Project Cards · isaiahbjork · usage 84** — expandable cards with stagger-in list entry; preview shows the calm list state, not the motion, but the description and usage are solid. `../01-refs/previews/isaiahbjork__animated-project-cards.png`
- **use-expandable · Codehagen · usage 0** — a reusable spring-based expand/collapse hook (height transition), useful primitive for any accordion-style row. `../01-refs/previews/Codehagen__use-expandable.png`
- **Expandable Tabs · victorwelander · usage 0** — icon-only tabs that expand to icon+label on selection, a lighter-weight cousin of the shared-underline move. `../01-refs/previews/victorwelander__expandable-tabs.png`
- **Vercel Notification Popover · patrick-xin · usage 0** — same content renders as a desktop popover vs. a mobile drawer, a real place-transition idea even though the still shows neither state mid-motion. `../01-refs/previews/patrick-xin__vercel-notification-popover.png`
- **Message Dock · isaiahbjork · usage 436** — a pill that morphs open into a row of live-status avatar bubbles; component-flavored but the pill-morph-into-dock mechanic is a genuine motion-system move. `../01-refs/previews/isaiahbjork__message-dock.png`
