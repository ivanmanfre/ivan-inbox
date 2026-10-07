/* ==========================================================================
   src/ds/motion.ts — the motion contract, as exports.

   ONE spring for anything that moves in space (layout, drag, shared layout,
   presence). ONE duration for anything that changes in value (opacity,
   colour). Nothing animates width, height, top or left; nothing uses
   `transition: all`; nothing loops except a single status shimmer.

   Every rule in this file has a row in SYSTEM.md's motion table, which is the
   table the S4 gate parses.

   BRIEF 4 (2026-10-07, SPEC-foundation §2.2): the brief skin's `motion`
   section REPLACES this contract on purpose, for the surfaces it owns. Under
   html[data-skin-on~='motion'] the app moves on Oxygen's ladder: four curves
   plus three linear() springs (tokens.css §10 --ds-e-*), durations
   160/220/240/380/480 ms (--ds-d-*), and the springs below (springCrit /
   springSettle / springPop). Ambient loops are allowed only when tied to live
   work and paused offscreen / hidden / Subtle / Reduce Motion
   (useMotionLevel). Two layout-property transitions are allowed, and only
   these two: the hover pill and the segmented thumb, each on an absolutely
   positioned isolated pseudo-element with no layout siblings. Flag off, the
   original contract above still holds untouched. Do not "fix" the skin back.
   ========================================================================== */
import type { Transition, Variants } from 'motion/react'

/** The one spring. Layout, drag, shared layout (layoutId), presence. */
export const spring: Transition = { type: 'spring', stiffness: 400, damping: 32 }

/** A softer arm of the same spring for a sheet tracking a finger to a snap. */
export const springSoft: Transition = { type: 'spring', stiffness: 300, damping: 34 }

/** The one duration, in seconds, for motion's own transitions. */
export const DUR = 0.18
/** The hover/focus duration. CSS only; JS never animates a hover. */
export const DUR_HOVER = 0.12
/** The ceiling. A shimmer sweep, nothing else. */
export const DUR_SLOW = 0.32
/** List mount stagger. */
export const STAGGER = 0.03

/** The one easing, matching --ds-ease. */
export const ease: [number, number, number, number] = [0.25, 1, 0.5, 1]

/** Opacity and colour only. */
export const fadeT: Transition = { duration: DUR, ease }

/* --- the four named variant sets every primitive reuses ------------------ */

/** Presence: a thing appears and disappears in place. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: fadeT },
  exit: { opacity: 0, transition: fadeT },
}

/** A row, a card, a toast: enters from 8px below, leaves in place. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, y: 4, transition: fadeT },
}

/** A dialog: scales from .96 with the one duration on opacity. */
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.98, transition: fadeT },
}

/** A sheet: travels from the bottom edge and springs to its snap point. */
export const sheet: Variants = {
  hidden: { y: '100%' },
  show: { y: 0, transition: springSoft },
  exit: { y: '100%', transition: springSoft },
}

/** A list container: children mount on a 30ms stagger, leave together. */
export const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER } },
  exit: {},
}

/** Helper: a delay for the nth item in a hand-rolled stagger. */
export const stagger = (i: number): number => i * STAGGER

export const presence = { fade, rise, pop, sheet, list }

/* --- Brief skin motion (owned by the `motion` section) -------------------- */

/** Pointer-tracked: critically damped, about 150ms. */
export const springCrit: Transition = { type: 'spring', visualDuration: 0.15, bounce: 0 }
/** Thumbs and menus: about 1% overshoot (ζ 0.83). */
export const springSettle: Transition = { type: 'spring', stiffness: 420, damping: 34 }
/** Counts and pills: about 5.7% overshoot (ζ 0.67). */
export const springPop: Transition = { type: 'spring', stiffness: 500, damping: 30 }

export const easeContent: [number, number, number, number] = [0.16, 1, 0.3, 1]
export const easeUi: [number, number, number, number] = [0.2, 0.7, 0.2, 1]
export const easePanel: [number, number, number, number] = [0.22, 1, 0.36, 1]
export const easeExit: [number, number, number, number] = [0.23, 1, 0.32, 1]
export const easeIn: [number, number, number, number] = [0.4, 0, 1, 1]

/** The tween ladder, in seconds (matches --ds-d-*). */
export const D = { fast: 0.16, nav: 0.22, ui: 0.24, content: 0.38, slow: 0.48, exit: 0.12 } as const
