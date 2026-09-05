# notes — motion-system (batch verdicts)

Pool: 24 candidates from grep over references.json tags (motion, spring, micro-interaction, physics, stagger, in-view, smooth, morph, fluid, transition, animated) + name/description hits on page transition, shared layout, layout animation, morph, spring physics, expandable, reorder, magnetic.

## Batch 1
- motiondotdev/motion-shared-layout-animation — KEEP. Tab bar with a shared underline sliding via layoutId between selections (from the Motion library authors themselves). This is the canonical shared-element/layout-animation reference. Light-mode food-emoji demo but the mechanic is exactly what a segmented control or tab switch in the inbox needs.
- ibelick/animated-group — REJECT for pick, preview is a marketing splash (two promo cards for a paid kit), not a demo of the actual stagger. Move is real (wrapper for staggered group transitions) but nothing to look at.
- isaiahbjork/animated-project-cards — WEAK. Preview is a plain light list of job-style cards, no visible motion, no stagger shown in the still. Keep as runner-up only, usage 84 is decent.
- spydiecy/stacked-activity-cards — KEEP, strong. A single stacked card on dark ground with a "Show All" pill below it, implying fan-out from stack to list. Directly transferable to a grouped-notification cluster morphing into its list.
- ibelick/morphing-dialog — KEEP. Static still just shows a button, but the described move (trigger element morphs via layout animation into the focused dialog) is exactly the tap-to-open-thread move; ibelick/Motion-Primitives is a reliable, well-documented source.
- ibelick/morphing-popover — WEAK/borderline, near-duplicate move to morphing-dialog (trigger morphs into content). Keep morphing-dialog as the pick, drop this one as pure duplicate risk.

## Batch 2
- moumensoliman/expanding-search-dock-shadcnui — KEEP. Dark ground already, clean search pill. Move: an icon collapses/expands into a full input with blur behind it, directly usable for a search-in-inbox affordance.
- Codehagen/use-expandable — WEAK, generic light-mode card, static toggle demo, nothing distinctive to look at beyond a bullet list. Runner-up only.
- victorwelander/expandable-tabs — BORDERLINE. Icon-only pills that expand to icon+label on selection. Legitimate move but overlaps tab-bar-navigation surface territory more than app-wide motion. Runner-up.
- ruixen.ui/pill-morph-tabs — REJECT as duplicate of the shared-underline/pill-select move already covered by motiondotdev's pick; adds nothing new.
- molecule-lab-rushil/expandable-button — REJECT. Preview is a plain black icon square, no visible state, not informative.
- anubra266/timeline-animation — REJECT. Preview is a landing-page section gallery (Hero/Pricing/Testimonial blocks), a marketing block completely mismatched to the "in-view timeline" description.

## Batch 3
- nikhiljainsam/draggable-priority-list — KEEP, strong. Dark ground already, numbered rank rows with a grip handle, keyboard hint bar (Space grab / arrows move / Esc cancel). Real drag-reorder-with-spring move, accessible affordance shown explicitly. Ignore the serif "Priority Queue" headline in the demo, that is not canon and would not port.
- preetsuthar17/draggable-list — REJECT. Plain light generic rows, static, nothing to look at beyond a hamburger-handle icon. Redundant with the stronger nikhiljainsam pick.
- patrick-xin/vercel-notification-popover — BORDERLINE keep as runner-up. Still is a plain white list, no visible transition, but the underlying move (same content renders as a desktop popover vs a mobile drawer/full-screen) is a genuine place-transition idea worth naming even without a strong image.
- jahed/shared-element-gallery — KEEP, strongest so far. Dark ground, explicit copy: "seamless shared-element transitions, tap any image to expand, drag vertically to dismiss." Exactly the canonical shared-element-expand + drag-to-dismiss gesture, directly portable to attachment/image previews in the inbox.
- dhileepkumargm/fluid-text-morph — REJECT, preview file is corrupt (not a valid image, likely a mis-saved video), cannot verify visually per rule.
- isaiahbjork/message-dock — KEEP moderate. Dark ground floating pill dock with avatar bubbles and live status dots, morphs open on tap. Usage 436. Somewhat adjacent to tab-bar-navigation territory but the pill-morph-into-dock mechanic is a genuine motion-system move.

## Batch 4
- anurag-mishra22/dock-two — REJECT. Plain light icon dock, static, no discernible move beyond a generic hover-grow dock.
- ruixen.ui/gooey-pagination — REJECT. Static dot pagination, no gooey liquid effect visible or describable beyond a buzzword.
- dhileepkumargm/magnetic-dock — REJECT as a pick (cursor-proximity "magnetic" expand needs a mouse, does not transfer to touch), but dark-ground pill-dock aesthetic itself is close to canon; noted only.
- arihantcodes_1f7b8c4d/ink — REJECT. Decorative hero-style particle text morph, heavy canvas effect, wrong register for a utility inbox used 10x/day; a visual skin, not a transferable interaction.
- daiwiikharihar/neo-brutalist-kinetic-deck — REJECT. Visual style (bright sticker-brutalist colours, "right click to interact") fights canon hard; a desktop-only gimmick despite a real physics-drag mechanic underneath.
- ibelick/animated-tabs — REJECT as duplicate. Same pill/underline segmented-control move as the motiondotdev pick, adds nothing new.

## Final pool size looked at: 24
