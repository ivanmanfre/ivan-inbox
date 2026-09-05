# header-status — curation

Surface: the header with the place title, the unread count, the automation-alert pill, the seat health alarm, dynamic-island style status capsules, status indicators. Pool looked at: 24 (built from by-surface.json's 596-entry header-status pool plus targeted grep over the full 2,117-entry references.json for dynamic island, status dot/pill/capsule/badge, sticky/collapsing/scroll-hide header, notification center/badge/count, alert banner, system status).

## Top 5

1. **Dynamic Island** · educalvolpz · usage n/a
   Move: a black capsule morphs between a compact status-icon state and an expanded state that reveals a row of quick-action pills, the exact Apple dynamic-island shape-shift.
   Lands: the header's status capsule itself — idle it shows one glyph (unread mail, automation running, seat alarm), tap or event expands it into the specific alert with its actions, then it snaps back.
   Risk: needs a real reason to expand or it is just a decorative pill; if every state looks the same size it loses the point.
   Preview: `01-refs/previews/educalvolpz__dynamic-island.png` · Video: none

2. **Sticky Header** · ddoemonn · usage n/a
   Move: a large title with a live count subtitle ("8 messages") that condenses into a compact single-line bar as the feed scrolls.
   Lands: "Inbox" as the place title with the unread count riding the subtitle, both shrinking together into the compact header once Ivan starts scrolling the feed.
   Risk: light theme in the demo; the condensing math (font-size + opacity crossfade) is the thing to port, not the paper-white skin.
   Preview: `01-refs/previews/ddoemonn__sticky-header.png` · Video: none

3. **Status Dot** · edwinvakayil · usage n/a
   Move: one small dot token with a soft pulsing ripple ring on active states, swapped by semantic tone across a fixed state set (building/ready/error/queued/live).
   Lands: the seat health alarm — a single dot beside the title that pulses lime when a seat is healthy/running and switches to a flat warn tone when it needs attention, no extra chrome.
   Risk: keep it to two or three tones max (healthy, alarm, idle); the demo's five-color legend is a palette overreach for a canon that wants lime as the only accent.
   Preview: `01-refs/previews/edwinvakayil__status-dot.png` · Video: none

4. **New Items Pill** · ddoemonn · usage n/a
   Move: a floating capsule appears over the content when new items arrive and jumps the view to the newest item on tap.
   Lands: the automation-alert pill — instead of a static badge, it surfaces only when something new lands (a reply, a finished turn) and disappears once acknowledged or tapped through.
   Risk: if it never disappears it becomes a permanent bar, which turns the "new" signal into decoration; the appear/disappear timing is the whole point.
   Preview: `01-refs/previews/ddoemonn__new-items-pill.png` · Video: none

5. **Animated Badge** · karthikmudunuri · usage 75
   Move: a capsule pill on a near-black ground — accent dot, divider, label text, chevron — with a soft glow arc animating in above it before the pill settles.
   Lands: the automation-alert / seat-health announcement pill sitting under or beside the title, its entrance glow is the one bit of motion that announces "something changed" without a modal.
   Risk: the glow-arc entrance is easy to overdo into a lens-flare cliche; keep it a single quick low-opacity sweep, once, not looping.
   Preview: `01-refs/previews/karthikmudunuri__animated-badge.png` · Video: https://cdn.21st.dev/karthikmudunuri/animated-badge/default/video.1759924180722.mp4

## Runners-up

- **Dynamic Island** · aghasisahakyan1 · usage 44 — same capsule idiom but demos the expanded state with real content (a music player), useful as the second reference for how much detail an expanded capsule can carry. `01-refs/previews/aghasisahakyan1__dynamic-island.png`
- **Alert Banner** · lavikatiyar · usage n/a — dark-native dismissible toast (check icon, title, subtitle, inline Dismiss/View actions) already close to canon ground, good fallback if a capsule reads as too small for a real alert. `01-refs/previews/lavikatiyar__alert-banner.png`
- **Card Status List** · isaiahbjork · usage 71 — a "SYNCING" row with a glowing gradient trailing edge and spinner is a strong syncing-state affordance, though the surface itself is a list not a header bar. `01-refs/previews/isaiahbjork__card-status-list.png`
- **HeroUI Badge** · hero_ui · usage 11 — a swatch sheet of numbered count badges in three weights (Primary/Secondary/Soft), useful only as a sizing/placement reference for the unread-count token. `01-refs/previews/hero_ui__heroui-badge.png`
- **Status Badge** · arihantcodes_1f7b8c4d · usage n/a — seven semantic pills (Pending/Failed/Success/In progress/In review/Expired/Submitted), each icon+label on a tinted background; steal the icon+label formula, not the seven-hue palette. `01-refs/previews/arihantcodes_1f7b8c4d__status-badge.png`
