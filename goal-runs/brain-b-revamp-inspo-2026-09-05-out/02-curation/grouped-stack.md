# grouped-stack — 21st.dev curation

Surface: repeats folded into one, stacks, decks, expandable groups.
Pool built: 227 candidates (grep over references.json on stack / stacked / deck / fan-out / collapse / collapsible / expandable / group / folded / pile / accordion / show all / expand, plus the by-surface.json grouped-stack seed of 151). Previews opened and judged: 18.

What the current build does wrong (`../../brain-b-design-elevation-2026-09-04-out/01-build/b/shots/feed-grouped.png`): a group is just a taller card with the words "3 drafts waiting" and a "Hide these" button, with the children rendered as flat indented rows below. Nothing shows depth, nothing shows count as a physical fact, and the only action offered is to make it go away.

---

## Picks

### 1. Tool Group · serafimcloud · usage 8
- **Move:** the collapsed group is one quiet line that names the count and the kind ("Exploring · 7 files, 5 searches"); expanding it drops an indented child list whose top edge fades under the header rather than jumping open.
- **Lands in the inbox:** "3 drafts waiting · Vicky Langdon" becomes "3 drafts · Vicky Langdon · latest 00:13" as a single line, and the three children live under it at half weight. The group stops being the loudest object on the screen.
- **Risk:** the header must name what the children ARE, not just how many. "5 items" is worse than what exists today.
- **Preview:** `../01-refs/previews/serafimcloud__tool-group.png`
- **Video:** https://cdn.21st.dev/21st.dev/tool-group/streaming/video.1777646307311.mp4

### 2. Sidebar News · dubinc · usage 305
- **Move:** a literal deck — the peeked top edges of the cards behind the front one make the count physical, and advancing pops the next card forward instead of scrolling a list.
- **Lands in the inbox:** a repeat group renders as one card with two or three peeked edges behind it. Ivan sees "there are more" without reading a number, and the group occupies one card's height no matter how many it holds.
- **Risk:** peeked edges on a dark ground need a real border, not a shadow — shadows vanish on black and the deck reads as a single card with a rendering bug.
- **Preview:** `../01-refs/previews/dubinc__sidebar-news.png`
- **Video:** https://cdn.21st.dev/user_dubinc/sidebar-news/1038/video.mp4

### 3. Tool Calls Section · heygaia · usage 0
- **Move:** the collapsed group's glyph is a row of overlapping type-icons — one per kind of thing inside — so the composition of the group reads before the count does; expanding turns that row into a connected timeline with per-item expanders.
- **Lands in the inbox:** a mixed group ("4 events on RISE") shows an overlapping cluster of family glyphs, so Ivan can tell a group of three replies from a group of two failures and a booking without opening it.
- **Risk:** overlapping icons at 390px go below the legibility floor fast; cap at four and let a "+2" carry the rest.
- **Preview:** `../01-refs/previews/heygaia__tool-calls-section.png`
- **Video:** none

### 4. Stacked Activity Cards · spydiecy · usage 43
- **Move:** the stack collapses to a single card with a "Show All" chevron sitting just under it, and expanding scales and re-positions each card out of the pile with a spring rather than reflowing the list.
- **Lands in the inbox:** gives the group an expand affordance that is not the destructive "Hide these" button currently offered, and the spring-out is the single most legible piece of "smooth motion" Ivan asked for.
- **Risk:** a spring on six cards at once on a mid-range phone drops frames; stagger and cap the animated set, and honour prefers-reduced-motion.
- **Preview:** `../01-refs/previews/spydiecy__stacked-activity-cards.png`
- **Video:** https://cdn.21st.dev/user_2x7qNq1R4V3iv559IOTNyUIojOy/stacked-activity-cards/default/video.1786737333370.mp4

### 5. Stacked Dialog · reuno-ui · usage 45
- **Move:** dark layered outline cards you page through in place with Previous / Next, so a group of N is reviewed one at a time inside one fixed footprint instead of being expanded into a list.
- **Lands in the inbox:** for the drafts group this is the right interaction — Ivan reads draft 1, taps next, reads draft 2, and never leaves the feed or grows the screen. Depth is shown by the outline edges, which survive a dark ground.
- **Risk:** paging hides how far through you are unless the count is on the card; and it is wrong for groups Ivan only wants to dismiss, so it must be reserved for actionable families.
- **Preview:** `../01-refs/previews/reuno-ui__stacked-dialog.png`
- **Video:** https://cdn.21st.dev/larsen66/stacked-dialog/default/video.1750556415134.mp4

---

## Runners-up

- **Activity Dropdown · minhxthanh · 0** — dark one-line summary row ("5 New Activities") with a rotating chevron and a staggered reveal of the children. `../01-refs/previews/minhxthanh__activity-dropdown.png`
- **Animated List · aghasisahakyan1 · 0** — a single dark card sitting on ghost cards fading downward; the depth is pure edge, no shadow. `../01-refs/previews/aghasisahakyan1__animated-list.png`
- **AI Sources · educalvolpz · 0** — overlapping favicon cluster plus a "Sources" toggle whose entries expand in place rather than opening a dialog. `../01-refs/previews/educalvolpz__ai-sources.png`
- **AI Chain of Thought · elements- · 0** — group header carrying a progress fraction (2/3) with a spine down the expanded children. `../01-refs/previews/elements-__chain-of-thought.png`
- **Morphing Card Stack · koustubhayadiyala36 · 256** — the same group rendered in three densities (stack / grid / list) behind one segmented toggle, swipe to navigate. `../01-refs/previews/koustubhayadiyala36__morphing-card-stack.png`
