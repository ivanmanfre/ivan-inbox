# empty-state — 21st.dev curation

Surface: the empty feed and the empty Ask thread.
Pool built: 47 candidates after rejecting 404 pages and marketing blocks (grep over references.json on empty state / no data / inbox zero / zero state / no results / suggestion chip / starter prompt / prompt suggestion / conversation starter / welcome screen / all caught up, plus the by-surface.json empty-state seed of 50). Previews opened and judged: 14.

What the current build does wrong (`../../brain-b-design-elevation-2026-09-04-out/01-build/b/shots/ask-empty.png`): "Ask anything." plus a three-line explanation plus three static full-width pills, and then roughly 500px of dead black between the last pill and the composer. Nothing marks where content will appear, nothing moves, and the pills never change no matter what happened today.

---

## Picks

### 1. Empty State with Marquee · shadcnui-blocks · usage 92
- **Move:** the empty state is the ghost of the thing that would be there — skeleton rows of real list items scrolling as a slow vertical marquee, fading out at the top, with the message and the action sitting beneath them.
- **Lands in the inbox:** kills the dead void. An empty feed shows drifting ghost feed rows; an empty Ask thread shows ghost message bubbles. The screen tells Ivan what SHAPE of thing goes here, and it is the only pick in this pool that moves.
- **Risk:** ghost rows can read as a stuck loading state. They must be visibly slower and dimmer than a real skeleton, and the message must sit ON them, not after them.
- **Preview:** `../01-refs/previews/shadcnui-blocks__empty-state-04.png`
- **Video:** https://cdn.21st.dev/shadcnui-blocks/empty-state-04/default/video.1783732164200.mp4

### 2. Empty · shadcn · usage 256
- **Move:** the empty block is BOUNDED — a dotted rule above and below marks exactly where the list lives — with a small icon tile, a short title, one line of sub, and one action centred inside it. It reads as a section with nothing in it, not as a page that failed.
- **Lands in the inbox:** the reference is already dark and already on canon. Gives the Ask thread a defined empty region instead of an unbounded black field, and the dotted rules give the composer something to sit against.
- **Risk:** dotted borders are one of the loudest AI-slop tells if they show up anywhere else in the app. Use them here and nowhere else, at very low contrast.
- **Preview:** `../01-refs/previews/shadcn__empty.png`
- **Video:** none

### 3. AI Suggestions · educalvolpz · usage 0
- **Move:** the suggestion chips stagger in AFTER a reply lands, are derived from what was just said, and clear themselves the moment one is chosen. They are a consequence of the conversation, not furniture parked on the empty screen.
- **Lands in the inbox:** Ivan's three static questions become live follow-ups — after Claude answers "what broke today", the chips offer "which lane", "show the exec", "retry it". The empty thread stops being the only place suggestions exist.
- **Risk:** generated follow-ups that are vague ("tell me more") are worse than three good fixed ones. If the chips are not specific to the answer, keep the fixed set.
- **Preview:** `../01-refs/previews/educalvolpz__ai-suggestions.png`
- **Video:** none

### 4. AI Suggestions · pacekit · usage 0
- **Move:** the suggestions are a horizontally scrollable chip rail docked directly on top of the composer, chips animating in and out, so they cost one row of height instead of a third of the screen.
- **Lands in the inbox:** moves the three full-width pills out of the dead middle and onto the composer where the thumb already is, and lets six suggestions live where three used to. That alone changes the Ask screen at a glance.
- **Risk:** a horizontal scroller hides its overflow on a phone; the last chip must be visibly clipped at the right edge or Ivan never learns to scroll it.
- **Preview:** `../01-refs/previews/pacekit__ai-suggestions.png`
- **Video:** none

### 5. Empty Notifications State · 7ovr · usage 90
- **Move:** inbox-zero stated as an achieved RESULT with one forward action — "You're all caught up", and the only button takes you onward rather than asking you to create something.
- **Lands in the inbox:** the empty feed is a good outcome for Ivan, not a failure, and the current build has no design for it at all. One soft icon tile, one line, one action into Today.
- **Risk:** the plainest pick here; on its own it is exactly the generic centred-icon empty state the last run already got marked down for. It only earns its place layered under pick 1 or bounded by pick 2.
- **Preview:** `../01-refs/previews/7ovr__empty-states-1.png`
- **Video:** none

---

## Runners-up

- **Interactive Empty State · remcostoeten · 213** — a fanned trio of icon tiles as the glyph plus a single Try again; the fan is the reusable bit. `../01-refs/previews/remcostoeten__interactive-empty-state.png`
- **Empty State · serafimcloud · 774** — dashed container with the same fanned icon-tile cluster; the most-used empty state on the site. `../01-refs/previews/serafimcloud__empty-state.png`
- **Email Inbox Skeleton · cnippet.dev · 0** — inbox-shaped skeleton rows with unread indicators; the honest source for pick 1's ghost rows. `../01-refs/previews/cnippet.dev__v-skeleton-13.png`
- **Prompt Suggestion · ibelick · 0** — chip grid above the input with a second mode that highlights matching text as you type. `../01-refs/previews/ibelick__prompt-suggestion.png`
- **Error Empty State · 7ovr · 0** — the failed-load variant with a destructive accent and retry plus contact actions, so empty and broken are not the same screen. `../01-refs/previews/7ovr__empty-states-4.png`
