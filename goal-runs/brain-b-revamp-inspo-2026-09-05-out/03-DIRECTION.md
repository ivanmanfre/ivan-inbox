# 03-DIRECTION — the revamp, in Ivan's words

**Thesis.** The inbox becomes one physical surface that moves like an app: things arrive, stack, fan open, get swiped away, and grow into the thread you tap. Nothing is a static box any more. Every move below is taken from a named 21st.dev reference whose source sits in `01-refs/source/`; the skin (colours, radii, fonts) is ours, the MOVE is theirs. Canon stays: dark ground, pistachio frame, lime as the one accent, no serif.

## The moves, by surface (reference → what Ivan sees)

**Feed**
1. Two densities in one list (Activity Feed, felipemenezes098): system events are one quiet line with a mono time; human events (a reply, a comment, a booking) get the full card with the quote. The feed stops looking like a wall of equal boxes.
2. Actor · verb · object headline with the payload quoted inset and the one action inline on the row (Notifications Menu, ahmedmayara, 152 uses).
3. Sticky day headers, the title and live count condense into a compact bar on scroll (Notification Scroll Area, bundui; Sticky Header, ddoemonn).
4. A running row wears its state as motion: a soft wash sweeps under a mono state label while a lane is working, and settles flat when it stops (Card Status List, isaiahbjork, 71).
5. New items land at the top with a stagger; a floating "3 new" pill appears only when something arrives while you are scrolled down and jumps you to it (Animated List, dillionverma, 298; New Items Pill, ddoemonn).

**Repeats**
6. A cluster is a physical deck: peeked edges behind the front card make the count visible, tap fans it out with a spring, the front card advances (Sidebar News, dubinc, 305; Stacked Activity Cards, spydiecy, 43).
7. A collapsed group header names count AND kind with overlapping type glyphs ("4 replies", "3 drafts waiting"), children fade in under it (Tool Group, serafimcloud; Tool Calls Section, heygaia).

**Dismiss**
8. Swipe reveals the action under the card, the card resolves in place (a tick draws) before it leaves, the rows below settle with a spring, one undo toast (Todo List Item, uiverse; Swipe Row, molecule-lab-rushil; BeUI Swipeable List).

**Thread**
9. Tapping a feed card grows into the thread: the card itself is the thing that expands, and a vertical drag brings it back (Morphing Dialog, ibelick; Shared Element Gallery, jahed).
10. The answer reveals word by word as a fade, a cursor rides the tail while streaming (Response Stream, ibelick, 253; AI Streaming Text, elements).
11. One status line shimmers while Claude works ("reading 4 memory files") and goes flat the instant it resolves; under the answer, a collapsible "read 4 files · 2 searches" group lists what it touched (Text Shimmer + Tool Group, serafimcloud).
12. Citations sit inline right after the claim as small numbered marks, never a list at the bottom; the sources chip becomes those marks (AI Response, educalvolpz).

**Composer**
13. One round control that swaps between send, typing and stop (Send Button, serafimcloud); the bar springs its height as it changes mode: text, voice, link (Family Sign-in Drawer, stackingsu).
14. Attachments are type-badged previews (IMAGE, PDF, PASTED) with the remove control on the chip (Claude Style AI Input, suraj-xd; File Attachment, serafimcloud).
15. Voice: the mic becomes a recording state with a mono timer and a live level meter, the transcript streams in under it, and a sent note is a compact waveform bubble with play and duration (AI Voice Input, kokonutd, 763; Voice Dictator, uicapsule; Voice Message Bubble, ruixen).

**Links**
16. A pasted URL collapses into a nested inset card inside the bubble while the prose stays first (Social Card, kokonutd, 123); an imageless page gets the favicon · domain · date · bold title shape (Citation, tool-ui); a blocked link is a compact tinted error card sized like a bubble (Error Message, serafimcloud).

**Header**
17. The status capsule is a dynamic island: idle it shows one glyph (seat alarm, automation running, unread); a tap or an event morphs it open into the alert with its actions, then it snaps back (Dynamic Island, educalvolpz). A single dot with a ripple ring marks live (Status Dot, edwinvakayil).

**Tab bar**
18. The active place expands to icon + label in a rounded highlight, the other five stay icon-only; the highlight slides between places with a shared layout animation; counts are small pills (Bottom Nav Bar, arunachalam; Motion Shared Layout Animation, motiondotdev; Tabs 07, felipemenezes098).

**Feed sheet**
19. The sheet has snap points (peek, half, full), tracks the finger 1:1, springs to the nearest, and the scrim fades with drag distance; a flick down dismisses (Magnetic Drawer, animbits; Draggable Modal, uniquesonu).

**Empty state**
20. Ghost rows instead of a void: three faint skeleton rows with the promise on top (Empty State with Marquee, the curated pick).

**Motion system**
21. The `motion` library (framer-motion or its `motion` successor, used by 36 of the 101 sources; lucide icons by 41) with ONE spring (stiffness 400, damping 32) for layout and drag, one duration (180 ms) for opacity, AnimatePresence for everything that leaves, 30 ms stagger on list mount, every rule under reduced-motion with an instant fallback. Layout animation and shared elements replace the CSS transitions of the last run.

## What this is not
Not a re-skin. The type ramp, the card forms by family, the state · subject headline and the lime plate from the last run stay because the panel scored them. What changes is that the surface now behaves like a physical thing.

## Order of build (skin c, `?skin=c`, not default until Ivan sees it)
Mock first (`04-mock/`), then the real skin with `motion` added as a dependency.
