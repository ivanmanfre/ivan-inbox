/* ==========================================================================
   src/ds/motion.ts — the motion contract, as exports.

   ONE spring for anything that moves in space (layout, drag, shared layout,
   presence). ONE duration for anything that changes in value (opacity,
   colour). Nothing animates width, height, top or left; nothing uses
   `transition: all`; nothing loops except a single status shimmer.

   Every rule in this file has a row in SYSTEM.md's motion table, which is the
   table the S4 gate parses.
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
