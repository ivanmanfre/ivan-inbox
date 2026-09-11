// src/orbit/theme.ts — canvas cannot read var(--ds-*), so this reads the
// design-system tokens from the live DOM once per mount (getComputedStyle)
// and hands the canvas layer plain colour strings. This is the ONLY place
// in /orbit allowed to name a colour literal — the one new colour (outbound,
// a cool blue; nothing in tokens.css covers "a message we sent") is defined
// here, once, per the brief's colour budget.
//
// Both themes work because this reads whatever the cascade resolved at
// mount time (light/dark, compact/phone) rather than hardcoding either
// ladder.

/** The one new colour /orbit introduces: outbound (we reached out). Tokens
 *  cover inbound (--ds-sev-attention, orange) and live/booked (--ds-accent,
 *  lime) already; nothing covers "a DM or invite we sent". Chosen to read
 *  as cool/neutral next to lime and orange in both themes. */
const OUTBOUND_DARK = '#4FB3D9';
const OUTBOUND_DARK_DIM = '#2F6F8A';
const OUTBOUND_LIGHT = '#1C6E92';
const OUTBOUND_LIGHT_DIM = '#5FA0BC';

export interface OrbitTheme {
  /** True when the resolved root carries data-theme="light". */
  light: boolean;
  canvas: string;
  surface1: string;
  surface2: string;
  surface3: string;
  hairline: string;
  hairlineStrong: string;
  text: string;
  text2: string;
  text3: string;
  text4: string;
  /** THE accent — reserved for live/converted state (booked ring, fresh pulse). */
  accent: string;
  accentInk: string;
  accentSoft: string;
  accentLine: string;
  accentRing: string;
  /** Inbound = --ds-sev-attention (orange): they moved first. */
  inbound: string;
  inboundSoft: string;
  /** Outbound = the one new colour (cool blue): we reached out. */
  outbound: string;
  outboundDim: string;
  /** Posts = neutral (--ds-text-3). */
  post: string;
  /** A dead/inert line — rings, ticks, the unlit ladder. */
  dead: string;
  font: string;
  fontMono: string;
}

function readVar(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = cs.getPropertyValue(name).trim();
  return v || fallback;
}

/** Parse a hex or rgb()/rgba() colour into [r,g,b,a]. Best-effort: unknown
 *  formats fall back to opaque mid-grey rather than throwing, since this
 *  only ever feeds a canvas fill/stroke, never a correctness-critical path. */
function parseColor(input: string): [number, number, number, number] {
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 1];
  return [148, 148, 148, 1];
}

/** Re-express any theme colour at a given alpha, for 2D-canvas drawing
 *  (underlay.ts, live.ts's fx overlay) where the browser's canvas alpha
 *  compositing is spec-correct. DO NOT feed this into a sigma node/edge
 *  colour: sigma's WebGL context defaults to premultipliedAlpha:true while
 *  its shaders output straight (non-premultiplied) colour, so a low-alpha
 *  rgba() there renders near its FULL base brightness instead of fading —
 *  confirmed by instrumenting the reducer (it returns the correct
 *  'rgba(76,76,76,0.12)') and observing the rendered pixel stay bright.
 *  Use blendOver() below for anything sigma paints. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The WebGL-safe alternative to withAlpha(): pre-composites `fg` at
 *  `alpha` over `bg` and returns an OPAQUE rgb() string. Sigma's node/edge
 *  colours must use this, never withAlpha() — see the comment above. */
export function blendOver(fg: string, alpha: number, bg: string): string {
  const [fr, fg_, fb] = parseColor(fg);
  const [br, bgc, bb] = parseColor(bg);
  const a = Math.max(0, Math.min(1, alpha));
  const r = Math.round(fr * a + br * (1 - a));
  const g = Math.round(fg_ * a + bgc * (1 - a));
  const b = Math.round(fb * a + bb * (1 - a));
  return `rgb(${r},${g},${b})`;
}

/** THE stage-ring colour ramp — the ONE place that decides it, so lime never
 *  leaks onto anything but the booked ring. Neutral (signal) through cool
 *  (reached/connected, the outbound direction that got them there) to warm
 *  (replied — the "getting close" signal, orange, not lime) and only THEN
 *  lime at st===4 (booked) — the single converted state. The fresh-pulse
 *  ring/spark (live.ts) shares this budget: lime, for the same reason. */
export function stageColor(theme: OrbitTheme, st: number): string {
  if (st >= 4) return theme.accent;
  if (st === 3) return theme.inbound;
  if (st === 2) return theme.outbound;
  if (st === 1) return theme.outboundDim;
  return theme.text4;
}

export function readOrbitTheme(root: HTMLElement = document.documentElement): OrbitTheme {
  const cs = getComputedStyle(root);
  const light = root.getAttribute('data-theme') === 'light'
    || (root.closest('[data-theme]')?.getAttribute('data-theme') === 'light');
  const v = (name: string, fallback: string) => readVar(cs, name, fallback);
  return {
    light,
    canvas: v('--ds-canvas', '#0C0C0B'),
    surface1: v('--ds-surface-1', '#1F1F1F'),
    surface2: v('--ds-surface-2', '#2A2A29'),
    surface3: v('--ds-surface-3', '#353533'),
    hairline: v('--ds-hairline', '#303030'),
    hairlineStrong: v('--ds-hairline-strong', '#4C4C4C'),
    text: v('--ds-text', '#FFFFFF'),
    text2: v('--ds-text-2', '#C7C7C7'),
    text3: v('--ds-text-3', '#949494'),
    text4: v('--ds-text-4', '#8E8E8E'),
    accent: v('--ds-accent', '#B8FF66'),
    accentInk: v('--ds-accent-ink', '#171717'),
    accentSoft: v('--ds-accent-soft', 'rgba(184,255,102,.14)'),
    accentLine: v('--ds-accent-line', 'rgba(184,255,102,.35)'),
    accentRing: v('--ds-accent-ring', 'rgba(184,255,102,.55)'),
    inbound: v('--ds-sev-attention', '#FF9F0A'),
    inboundSoft: v('--ds-sev-attention-soft', 'rgba(255,159,10,.14)'),
    outbound: light ? OUTBOUND_LIGHT : OUTBOUND_DARK,
    outboundDim: light ? OUTBOUND_LIGHT_DIM : OUTBOUND_DARK_DIM,
    post: v('--ds-text-3', '#949494'),
    dead: v('--ds-hairline-strong', '#4C4C4C'),
    font: v('--ds-font', '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'),
    fontMono: v('--ds-font-mono', 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace'),
  };
}
