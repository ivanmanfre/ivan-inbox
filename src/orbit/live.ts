// src/orbit/live.ts — the thing that makes /orbit read as ALIVE, not a
// static plot with a play button (Ivan's rejection of v3). Two kinds of
// motion:
//
//  1. CONTINUOUS, stateless, driven purely by (id, wall-clock now): ambient
//     breathing, the fresh-signal pulse, the 24h spark. These never need
//     stored state — they're pure functions of time, so restarting the RAF
//     loop or missing a frame costs nothing.
//  2. ONE-SHOT, diff-triggered: stage-change travel, new-person fade-in,
//     new-post blink. These DO need state (when did it start), tracked by
//     LiveAnimations.sync() from a (prev, next) graph diff and pruned once
//     finished.
//
// This module owns the animation MATH and the fx-canvas drawing; the RAF
// loop itself and the sigma reducers that call into these functions live in
// OrbitCanvas.tsx (both are mine — the split is about what's pure vs what
// touches React/sigma lifecycle, not a seat boundary).

import type { Attributes } from 'graphology-types';
import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import { hashUnit, type LayoutPoint } from './layout';
import type { OrbitPerson, OrbitPost } from './types';
import type { OrbitTheme } from './theme';
import { withAlpha } from './theme';

// ─── graph attribute shapes (the sigma/graphology side of the contract) ───

export interface OrbitNodeAttrs extends Attributes {
  kind: 'you' | 'person' | 'post';
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  /** name's headline (person: title · company; post: excerpt) — read by the hover drawer. */
  headline?: string;
  hidden?: boolean;
  zIndex?: number;
}

export interface OrbitEdgeAttrs extends Attributes {
  /** 'reaction' | 'comment' */
  kind: string;
  color: string;
  size: number;
  hidden?: boolean;
  zIndex?: number;
  /** True when this content-engagement happened within the last 24h — drives the ambient spark. */
  recent: boolean;
}

// ─── continuous, stateless motion ──────────────────────────────────────────

/** Ambient breathing: a size multiplier oscillating ±8% on a 4-6s period,
 *  phase seeded from the id so nodes don't pulse in lockstep. */
export function breatheScale(id: string, nowMs: number): number {
  const period = 4000 + hashUnit(id, 101) * 2000;
  const phase = hashUnit(id, 103) * Math.PI * 2;
  return 1 + Math.sin((nowMs / period) * Math.PI * 2 + phase) * 0.08;
}

/** 0..1 looping phase for the fresh-signal ring pulse, ~3s period. */
export function freshPulsePhase(id: string, nowMs: number, periodMs = 3000): number {
  const phase = hashUnit(id, 107);
  const t = nowMs / periodMs + phase;
  return t - Math.floor(t);
}

/** 0..1 looping phase for a spark travelling along a recent edge/spoke. */
export function sparkPhase(key: string, nowMs: number, periodMs = 2200): number {
  const phase = hashUnit(key, 109);
  const t = nowMs / periodMs + phase;
  return t - Math.floor(t);
}

function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

// ─── one-shot, diff-triggered animations ──────────────────────────────────

export interface TravelAnim {
  from: LayoutPoint;
  to: LayoutPoint;
  start: number;
  duration: number;
  person: OrbitPerson;
}
interface OneShotAnim { start: number; duration: number }

export type LiveEvent = { kind: 'stage'; person: OrbitPerson };

export interface SyncDiffParams {
  nowMs: number;
  people: readonly OrbitPerson[];
  peopleLayout: Map<string, LayoutPoint>;
  posts: readonly OrbitPost[];
  postsLayout: Map<string, LayoutPoint>;
  prevById: Map<string, OrbitPerson> | null;
  prevPeopleLayout: Map<string, LayoutPoint> | null;
  prevPostIds: Set<string> | null;
  onLiveEvent?: (ev: LiveEvent) => void;
}

/** Tracks the one-shot animations triggered by a (prev, next) graph diff:
 *  stage-change travel, new-person fade-in, new-post blink. Continuous
 *  motion (breathing/pulse/spark) needs none of this — it's computed
 *  straight from (id, now) above. */
export class LiveAnimations {
  readonly travel = new Map<string, TravelAnim>();
  readonly fadeIn = new Map<string, OneShotAnim>();
  readonly postBlink = new Map<string, OneShotAnim>();

  /** Diff `prev` against `next` and arm the one-shot animations for
   *  whatever changed. Safe to call with prevById === null (first paint —
   *  nothing travels or fades in, the graph just appears). */
  sync(p: SyncDiffParams): void {
    const { nowMs, people, peopleLayout, posts, postsLayout, prevById, prevPeopleLayout, prevPostIds, onLiveEvent } = p;
    if (prevById) {
      for (const person of people) {
        const before = prevById.get(person.id);
        const toPt = peopleLayout.get(person.id);
        if (!toPt) continue;
        if (!before) {
          // New person: fade in with one ripple.
          this.fadeIn.set(person.id, { start: nowMs, duration: 720 });
          continue;
        }
        if (before.st < person.st) {
          const fromPt = prevPeopleLayout?.get(person.id) ?? toPt;
          this.travel.set(person.id, { from: fromPt, to: toPt, start: nowMs, duration: 1200, person });
          onLiveEvent?.({ kind: 'stage', person });
        }
      }
    } else {
      // First paint: nothing travels, but let every node ripple in once —
      // reads as the map coming alive rather than snapping into place.
      for (const person of people) {
        if (peopleLayout.has(person.id)) this.fadeIn.set(person.id, { start: nowMs, duration: 720 });
      }
    }
    if (prevPostIds) {
      for (const post of posts) {
        if (!prevPostIds.has(post.id) && postsLayout.has(post.id)) {
          this.postBlink.set(post.id, { start: nowMs, duration: 900 });
        }
      }
    }
  }

  /** Drop finished one-shots so their maps don't grow unbounded across polls. */
  prune(nowMs: number): void {
    for (const [id, a] of this.travel) if (nowMs - a.start > a.duration) this.travel.delete(id);
    for (const [id, a] of this.fadeIn) if (nowMs - a.start > a.duration) this.fadeIn.delete(id);
    for (const [id, a] of this.postBlink) if (nowMs - a.start > a.duration) this.postBlink.delete(id);
  }

  clear(): void {
    this.travel.clear();
    this.fadeIn.clear();
    this.postBlink.clear();
  }
}

/** Current interpolated position for a travelling person, or null when no
 *  travel animation is active for that id. */
export function travelPointAt(anim: TravelAnim, nowMs: number): { x: number; y: number; t: number } | null {
  const t = (nowMs - anim.start) / anim.duration;
  if (t >= 1) return null;
  const e = easeOutCubic(t);
  return { x: anim.from.x + (anim.to.x - anim.from.x) * e, y: anim.from.y + (anim.to.y - anim.from.y) * e, t };
}

/** Size/opacity envelope (0..1) for an in-progress fade-in. */
export function fadeInEnvelope(a: OneShotAnim, nowMs: number): number {
  return easeOutCubic((nowMs - a.start) / a.duration);
}

/** Two-flash envelope (0..1, 1 = brightest) for a blinking post marker. */
export function blinkEnvelope(a: OneShotAnim, nowMs: number): number {
  const t = (nowMs - a.start) / a.duration;
  if (t >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 2);
}

// ─── label / hover drawing (theme-aware, replaces sigma's disc defaults) ──
//
// Sigma's node reducer contract is "return a total object" (see
// node_modules/sigma/dist/sigma.cjs.dev.js addNode(): the reducer's return
// REPLACES the cached display data, it is not shallow-merged) — so as long
// as OrbitCanvas's reducer spreads the node's own attributes into its
// return value, custom fields like `headline` ride along into the cached
// data these draw functions receive. PartialButFor's catch-all index
// signature (`{[others: string]: any}`) is what makes `data.headline` and
// `data.kind` readable below without redeclaring them.

type LabelData = PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>;

/** Where to plant a label's ground-plate so it stays inside the canvas: to
 *  the node's right by default, flipped to its left when the right side
 *  would overflow — clamped either way so nothing meant to be read leaves
 *  the frame (the month-tick / post-date labels were clipping at "21 A…"
 *  on the right edge before this). */
function labelPlateX(anchorX: number, nodeSize: number, plateW: number, canvasW: number): { plateX: number; flipped: boolean } {
  const rightX = anchorX + nodeSize + 2;
  const overflowsRight = rightX + plateW > canvasW - 2;
  const leftX = anchorX - nodeSize - 2 - plateW;
  const flipped = overflowsRight && leftX >= 2;
  const plateX = flipped ? leftX : rightX;
  return { plateX: Math.max(2, Math.min(plateX, canvasW - plateW - 2)), flipped };
}

export function makeNodeLabelDrawer(theme: OrbitTheme) {
  return function drawNodeLabel(
    ctx: CanvasRenderingContext2D,
    data: LabelData,
    settings: Settings<OrbitNodeAttrs, OrbitEdgeAttrs, Attributes>,
  ): void {
    if (!data.label) return;
    const size = settings.labelSize;
    ctx.font = '500 ' + size + 'px ' + settings.labelFont;
    const w = ctx.measureText(data.label).width + 8;
    const canvasW = ctx.canvas.clientWidth || ctx.canvas.width;
    const { plateX } = labelPlateX(data.x, data.size, w, canvasW);
    ctx.fillStyle = withAlpha(theme.canvas, 0.85);
    ctx.fillRect(plateX, data.y - size / 2 - 3, w, size + 6);
    ctx.fillStyle = data.kind === 'post' ? theme.text3 : theme.text;
    ctx.fillText(data.label, plateX + 4, data.y + size / 3);
  };
}

/** name + headline, theme fonts — used for defaultDrawNodeHover. Reads
 *  `data.headline`, set by OrbitCanvas as a node attribute at graph build
 *  time (person title·company, or the post excerpt). */
export function makeNodeHoverDrawer(theme: OrbitTheme) {
  return function drawNodeHover(
    ctx: CanvasRenderingContext2D,
    data: LabelData,
    settings: Settings<OrbitNodeAttrs, OrbitEdgeAttrs, Attributes>,
  ): void {
    const headline = typeof data.headline === 'string' && data.headline ? data.headline : null;
    const nameSize = settings.labelSize + 1;
    const subSize = settings.labelSize - 2;
    ctx.font = '600 ' + nameSize + 'px ' + settings.labelFont;
    const nameW = data.label ? ctx.measureText(data.label).width : 0;
    ctx.font = '400 ' + subSize + 'px ' + settings.labelFont;
    const subW = headline ? ctx.measureText(headline).width : 0;
    const w = Math.max(nameW, subW) + 20;
    const h = headline ? nameSize + subSize + 16 : nameSize + 10;
    const canvasW = ctx.canvas.clientWidth || ctx.canvas.width;
    const { plateX: x } = labelPlateX(data.x, data.size + 2, w, canvasW);
    const y = data.y - h / 2;
    ctx.fillStyle = theme.surface2;
    ctx.strokeStyle = theme.hairlineStrong;
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme.text;
    ctx.font = '600 ' + nameSize + 'px ' + settings.labelFont;
    ctx.textBaseline = 'top';
    ctx.fillText(data.label || '', x + 10, y + 6);
    if (headline) {
      ctx.fillStyle = theme.text3;
      ctx.font = '400 ' + subSize + 'px ' + settings.labelFont;
      ctx.fillText(headline, x + 10, y + 6 + nameSize + 2);
    }
  };
}

// ─── spotlight + fx overlay (sparks, pulses, ripples, chords, streaks) ────

export interface OverlayPoint { id: string; pt: LayoutPoint; recentFresh: boolean }
export interface OverlayEdge { key: string; from: LayoutPoint; to: LayoutPoint; recent: boolean }

export interface DrawLiveOverlayParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  theme: OrbitTheme;
  nowMs: number;
  reducedMotion: boolean;
  graphToViewport: (pt: { x: number; y: number }) => { x: number; y: number };
  centre: LayoutPoint;
  /** People currently rendered (post-visibility/time-scrub filter), for ambient spark + fresh pulse. */
  people: OverlayPoint[];
  animations: LiveAnimations;
  /** The selected person/post's layout point, if any, plus the layout points of its content-edge neighbours. */
  spotlight: { origin: LayoutPoint; neighbors: LayoutPoint[]; toCentre: boolean } | null;
}

export function drawLiveOverlay(p: DrawLiveOverlayParams): void {
  const { ctx, width, height, theme, nowMs, reducedMotion, graphToViewport, centre, people, animations, spotlight } = p;
  ctx.clearRect(0, 0, width, height);
  const cv = graphToViewport(centre);

  if (!reducedMotion) {
    // 24h spark: a dot travelling from a recently-active person toward the
    // centre. Lime (theme.accent) — the fresh/live signal, same budget as
    // the booked ring, never the stage-progress warm ramp.
    ctx.fillStyle = theme.accent;
    for (const person of people) {
      if (!person.recentFresh) continue;
      const phase = sparkPhase(person.id, nowMs);
      const a = graphToViewport(person.pt);
      const sx = a.x + (cv.x - a.x) * phase;
      const sy = a.y + (cv.y - a.y) * phase;
      const fade = Math.sin(phase * Math.PI); // 0 at both ends, 1 mid-flight
      ctx.globalAlpha = 0.15 + fade * 0.55;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Fresh pulse: an expanding, fading ring every ~3s.
    for (const person of people) {
      if (!person.recentFresh) continue;
      const phase = freshPulsePhase(person.id, nowMs);
      const a = graphToViewport(person.pt);
      const edge = graphToViewport({ x: person.pt.x + 0.01, y: person.pt.y });
      const pxPerUnit = Math.max(1, Math.hypot(edge.x - a.x, edge.y - a.y) * 100);
      const radius = 3 + phase * pxPerUnit * 0.03;
      ctx.globalAlpha = (1 - phase) * 0.5;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Stage-change travel: trailing streak from the old ring toward the new one.
    for (const anim of animations.travel.values()) {
      const cur = travelPointAt(anim, nowMs);
      if (!cur) continue;
      const from = graphToViewport(anim.from);
      const curPt = graphToViewport({ x: cur.x, y: cur.y });
      const grad = ctx.createLinearGradient(from.x, from.y, curPt.x, curPt.y);
      grad.addColorStop(0, withAlpha(theme.inbound, 0));
      grad.addColorStop(1, withAlpha(theme.inbound, 0.85 * (1 - cur.t * 0.3)));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(curPt.x, curPt.y);
      ctx.stroke();
    }
  }

  // Ripples for fade-in people (drawn in both motion modes at reduced cost, since it's a one-shot, not continuous).
  for (const person of people) {
    const anim = animations.fadeIn.get(person.id);
    if (!anim) continue;
    const env = fadeInEnvelope(anim, nowMs);
    const a = graphToViewport(person.pt);
    ctx.globalAlpha = (1 - env) * 0.6;
    ctx.strokeStyle = theme.text2;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3 + env * 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Spotlight chords: selected <-> centre, selected <-> engaged posts.
  if (spotlight) {
    const o = graphToViewport(spotlight.origin);
    ctx.lineWidth = 1.2;
    if (spotlight.toCentre) {
      ctx.strokeStyle = withAlpha(theme.accent, 0.6);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(cv.x, cv.y);
      ctx.stroke();
    }
    ctx.strokeStyle = withAlpha(theme.inbound, 0.7);
    for (const n of spotlight.neighbors) {
      const np = graphToViewport(n);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      // A gentle curve reads better than a straight chord across a dense clock face.
      const midx = (o.x + np.x) / 2 - (np.y - o.y) * 0.08;
      const midy = (o.y + np.y) / 2 + (np.x - o.x) * 0.08;
      ctx.quadraticCurveTo(midx, midy, np.x, np.y);
      ctx.stroke();
    }
  }
}
