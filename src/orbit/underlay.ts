// src/orbit/underlay.ts — the 2D canvas painted BEHIND sigma (wired to its
// `afterRender` event by OrbitCanvas), ported from the seed's drawUnder():
// the five stage rings, month ticks on the rim, a soft radial glow at the
// centre, and — new here — the scrub-cursor line for `time`.
//
// Ring LABELS ("SIGNAL"/"REACHED"/…) are deliberately NOT drawn here even
// though they're conceptually part of the same underlay: this canvas sits
// BELOW sigma's own node canvas in the stacking order, so a label painted
// here — however opaque its plate — is always covered by node dots drawn on
// top of it. drawRingLabels() below is called from OrbitCanvas's TOP (fx)
// layer instead, so the labels sit above every node unconditionally.

import type { OrbitTheme } from './theme';
import { withAlpha } from './theme';
import { STAGE_RING, angleForDay, type OrbitWindow } from './layout';
import { STAGE_LABEL } from './types';

export interface ViewportPoint { x: number; y: number }

/** Resize the underlay canvas to match its container's CSS size at the
 *  current device pixel ratio, and return a context pre-scaled for that
 *  ratio (so all drawing below is in CSS pixels). No-ops when the size
 *  hasn't changed, to avoid clearing + relayout on every afterRender. */
export function fitUnderlayCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('underlay: 2d context unavailable');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export interface DrawUnderlayParams {
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size of the viewport (post-fitUnderlayCanvas, pre-scaled). */
  width: number;
  height: number;
  theme: OrbitTheme;
  win: OrbitWindow;
  /** Graph-space (normalised, centre 0,0, rim ~1) -> viewport CSS pixels, i.e. sigma's renderer.graphToViewport. */
  graphToViewport: (pt: ViewportPoint) => ViewportPoint;
  /** Today's ordinal day, for the faint "now" spoke. */
  nowDay: number;
  /** Scrub cursor ordinal day, or null when scrubbing is at "now" (no extra cursor drawn). */
  cursorDay: number | null;
}

export function drawUnderlay(p: DrawUnderlayParams): void {
  const { ctx, width, height, theme, win, graphToViewport, nowDay, cursorDay } = p;
  ctx.clearRect(0, 0, width, height);

  const c = graphToViewport({ x: 0, y: 0 });
  const edge = graphToViewport({ x: 1, y: 0 });
  const R = Math.hypot(edge.x - c.x, edge.y - c.y);
  if (!Number.isFinite(R) || R <= 0) return;

  // Soft radial glow at the centre ("you").
  const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R * 0.22);
  glow.addColorStop(0, withAlpha(theme.accent, theme.light ? 0.16 : 0.12));
  glow.addColorStop(1, withAlpha(theme.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(c.x - R * 0.22, c.y - R * 0.22, R * 0.44, R * 0.44);

  // Five stage rings.
  ctx.lineWidth = 1;
  STAGE_RING.forEach((rr, i) => {
    ctx.beginPath();
    ctx.arc(c.x, c.y, R * rr, 0, Math.PI * 2);
    ctx.strokeStyle = i === 4 ? withAlpha(theme.accent, 0.4) : theme.hairline;
    ctx.stroke();
  });

  // Rim (dashed).
  ctx.beginPath();
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
  ctx.setLineDash([2, 5]);
  ctx.strokeStyle = theme.hairlineStrong;
  ctx.stroke();
  ctx.setLineDash([]);

  // Month ticks around the rim.
  ctx.font = '500 10px ' + theme.fontMono;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const first = new Date(win.fromDay * 86400000);
  first.setUTCDate(1);
  first.setUTCMonth(first.getUTCMonth() + 1);
  let guard = 0;
  for (let d = Math.round(first.getTime() / 86400000); d <= win.toDay && guard < 36; guard++) {
    const a = angleForDay(d, win);
    const x1 = c.x + Math.cos(a) * R * 0.985, y1 = c.y + Math.sin(a) * R * 0.985;
    const x2 = c.x + Math.cos(a) * R * 1.03, y2 = c.y + Math.sin(a) * R * 1.03;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = theme.text4;
    ctx.stroke();
    ctx.fillStyle = theme.text3;
    const label = new Date(d * 86400000).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase();
    ctx.fillText(label, c.x + Math.cos(a) * R * 1.085, c.y + Math.sin(a) * R * 1.085);
    const nd = new Date(d * 86400000);
    nd.setUTCMonth(nd.getUTCMonth() + 1);
    d = Math.round(nd.getTime() / 86400000);
  }

  // "Now" spoke — faint, always present.
  const an = angleForDay(nowDay, win);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + Math.cos(an) * R * 0.985, c.y + Math.sin(an) * R * 0.985);
  ctx.strokeStyle = withAlpha(theme.text, 0.08);
  ctx.stroke();

  // Scrub cursor spoke — brighter, only while actively scrubbed off "now".
  if (cursorDay !== null && cursorDay !== nowDay) {
    const ac = angleForDay(cursorDay, win);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(ac) * R * 1.03, c.y + Math.sin(ac) * R * 1.03);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.text2;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c.x + Math.cos(ac) * R * 1.03, c.y + Math.sin(ac) * R * 1.03, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = theme.text;
    ctx.fill();
  }

}

export interface DrawRingLabelsParams {
  ctx: CanvasRenderingContext2D;
  theme: OrbitTheme;
  graphToViewport: (pt: ViewportPoint) => ViewportPoint;
}

/** The five ring labels ("SIGNAL"/"REACHED"/…), each on its own opaque
 *  ground plate. Called from the TOP (fx) canvas layer — see the module
 *  header — so they're never hidden behind a node, however busy that ring
 *  is. Fixed at the top-left diagonal (matches the seed); the opaque plate
 *  already guarantees legibility there regardless of what's underneath, so
 *  a per-render "quietest angle" search isn't needed on top of it. */
export function drawRingLabels(p: DrawRingLabelsParams): void {
  const { ctx, theme, graphToViewport } = p;
  const c = graphToViewport({ x: 0, y: 0 });
  const edge = graphToViewport({ x: 1, y: 0 });
  const R = Math.hypot(edge.x - c.x, edge.y - c.y);
  if (!Number.isFinite(R) || R <= 0) return;
  ctx.font = '500 10px ' + theme.fontMono;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const al = -Math.PI / 2 - 0.32;
  STAGE_RING.forEach((rr, i) => {
    const x = c.x + Math.cos(al) * R * rr, y = c.y + Math.sin(al) * R * rr;
    const text = STAGE_LABEL[i].toUpperCase();
    const w = ctx.measureText(text).width;
    ctx.fillStyle = theme.surface1;
    ctx.fillRect(x - w / 2 - 7, y - 8, w + 14, 16);
    ctx.fillStyle = i === 4 ? theme.accent : theme.text3;
    ctx.fillText(text, x, y);
  });
}
