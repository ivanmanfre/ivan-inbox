// src/orbit/OrbitCanvas.tsx — the sigma.js clock. This file owns the sigma
// instance lifecycle, the graphology graph, the RAF loop, and composes
// layout.ts + theme.ts + underlay.ts + live.ts into the rendered surface.
// It is its own React.lazy boundary (see src/exp — the shell lazy-imports
// this module) so nothing pays for sigma/graphology until /orbit opens.
//
// Design note on the two motion classes (see live.ts's header): breathing,
// the fresh pulse and the 24h spark are pure functions of (id, now) and
// need no stored state; stage-change travel, new-person fade-in and new-post
// blink are one-shot animations armed by diffing `prev` against `graph` on
// every data sync (LiveAnimations, in live.ts). The sigma reducers below
// read both classes on every refresh — ambient motion advances by re-running
// the reducer at 60fps (`refresh({skipIndexation:true})`), not by mutating
// graph attributes every frame.

import { useEffect, useRef, type JSX } from 'react';
import Sigma from 'sigma';
import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types';
import { MultiDirectedGraph } from 'graphology';

import type { OrbitGraph, OrbitPerson, OrbitPost, OrbitContentEdge } from './types';
import { readOrbitTheme, blendOver, stageColor, type OrbitTheme } from './theme';
import {
  computeWindow, layoutPeople, layoutPosts, CENTRE_POINT, dayOrdinal, endOfDayIso, stageAsOf, radiusForStage,
  type OrbitWindow, type LayoutPoint,
} from './layout';
import { fitUnderlayCanvas, drawUnderlay, drawRingLabels } from './underlay';
import {
  type OrbitNodeAttrs, type OrbitEdgeAttrs, type LiveEvent,
  breatheScale, LiveAnimations, travelPointAt, fadeInEnvelope, blinkEnvelope,
  makeNodeLabelDrawer, makeNodeHoverDrawer, drawLiveOverlay, type OverlayPoint,
} from './live';

export interface OrbitCanvasProps {
  graph: OrbitGraph | null; // current payload
  prev: OrbitGraph | null; // previous poll, for diff animations (null on first paint)
  visible: (p: OrbitPerson) => boolean; // filter predicate from the shell
  selected: { kind: 'person' | 'post'; id: string } | null;
  onSelect: (sel: { kind: 'person' | 'post'; id: string } | null) => void;
  time: string | null; // scrub cursor (ISO date) or null = now
  reducedMotion: boolean;
  /** Optional: fired on a stage advance between polls, so the shell can toast
   *  ("Bobby K. → Connected") — see live.ts's diff-triggered travel animation. */
  onLiveEvent?: (ev: LiveEvent) => void;
}

const ICP_DEFAULT = 5;

function baseNodeSize(person: OrbitPerson): number {
  const icp = typeof person.i === 'number' ? Math.max(0, Math.min(10, person.i)) : ICP_DEFAULT;
  return person.st === 4 ? 8.5 : 3 + icp * 0.55;
}
function basePostSize(post: OrbitPost): number {
  return 3.5 + Math.log10(1 + Math.max(0, post.im || 0)) * 1.6;
}
function personHeadline(p: OrbitPerson): string {
  return [p.ti, p.c].filter(Boolean).join(' · ');
}
const DAY_MS = 86400000;

/** A dense poll (a 30d ivan window can hold >1,100 people) must draw
 *  smaller dots or every ring reads as a painted stripe rather than a
 *  population — this is the OTHER half of the fix alongside layout.ts's
 *  proportional radial band. REF is the population size at which a dot
 *  draws at its full nominal size; floors at 0.32 so a very dense window
 *  still shows something, not a vanishing point. */
const DENSITY_REF = 160;
function densityScale(visibleCount: number): number {
  return Math.max(0.32, Math.min(1, Math.sqrt(DENSITY_REF / Math.max(1, visibleCount))));
}

/** Shortest signed distance between two clock angles (radians), for
 *  thinning post-rim labels by minimum arc separation. */
function angularDist(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}
/** Minimum separation between two shown post labels, in radians (~5.7°) —
 *  enough to keep adjacent date labels from piling into an unreadable mass
 *  at a busy point on the rim (bottom-left of a heavy posting week, e.g.). */
const POST_LABEL_MIN_ARC = 0.1;

/** Floor for a node's FINAL rendered size, after density scaling and every
 *  other multiplier — a dense poll must not shrink dots past the point
 *  they're visible and roughly targetable. Selection itself no longer
 *  depends on hitting this exact radius (see findNearestSelectable below),
 *  but a node nobody can see is still a node nobody can tap. */
const MIN_RENDER_SIZE = 2.5;

/** A realistic fingertip on a phone, in CSS px — the search radius for
 *  tap-to-select. Sigma's own exact-hit test (getNodeAtPosition) requires
 *  landing within the rendered node's own radius, which at ~1,100 visible
 *  people (densityScale shrinks dots to a few px) is untappable; worse,
 *  that hit test reads a spatial index that refresh({skipIndexation:true})
 *  — called every RAF frame for the ambient/travel animations — never
 *  rebuilds, so it can go stale even for a normally-sized node. Selection
 *  is decided in JS against the CURRENT layout instead, independent of
 *  both problems. */
const TAP_RADIUS_PX = 17;

export default function OrbitCanvas(props: OrbitCanvasProps): JSX.Element {
  const propsRef = useRef(props);
  propsRef.current = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sigmaContainerRef = useRef<HTMLDivElement | null>(null);
  const underlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const rendererRef = useRef<Sigma<OrbitNodeAttrs, OrbitEdgeAttrs> | null>(null);
  const graphRef = useRef<MultiDirectedGraph<OrbitNodeAttrs, OrbitEdgeAttrs> | null>(null);
  const themeRef = useRef<OrbitTheme | null>(null);
  const winRef = useRef<OrbitWindow | null>(null);

  const peopleByIdRef = useRef<Map<string, OrbitPerson>>(new Map());
  const postsByIdRef = useRef<Map<string, OrbitPost>>(new Map());
  const peopleLayoutRef = useRef<Map<string, LayoutPoint>>(new Map());
  const postsLayoutRef = useRef<Map<string, LayoutPoint>>(new Map());
  const contentEdgesRef = useRef<OrbitContentEdge[]>([]);
  const freshFlagRef = useRef<Map<string, boolean>>(new Map());
  const overlayPeopleRef = useRef<OverlayPoint[]>([]);
  const visibleCountRef = useRef<number>(0);
  const postLabelIdsRef = useRef<Set<string>>(new Set());

  const animationsRef = useRef<LiveAnimations>(new LiveAnimations());
  const hoverRef = useRef<string | null>(null);
  const neighborsRef = useRef<Set<string>>(new Set());
  const nowRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  const computeNeighbors = (id: string | null) => {
    const set = new Set<string>();
    const g = graphRef.current;
    if (id && g && g.hasNode(id)) {
      set.add(id);
      g.forEachNeighbor(id, (n) => set.add(n));
    }
    neighborsRef.current = set;
  };

  /** Tap-to-select, independent of sigma's own hit test (see TAP_RADIUS_PX).
   *  `vx`/`vy` are container-relative CSS pixels — the same space sigma's
   *  click events and graphToViewport/viewportToFramedGraph already use. */
  const findNearestSelectable = (vx: number, vy: number): { kind: 'person' | 'post'; id: string } | null => {
    const renderer = rendererRef.current;
    if (!renderer) return null;
    const click = renderer.viewportToFramedGraph({ x: vx, y: vy });
    // Graph-space length of a TAP_RADIUS_PX screen segment at this zoom.
    const a = renderer.viewportToFramedGraph({ x: vx + TAP_RADIUS_PX, y: vy });
    const graphRadius = Math.hypot(a.x - click.x, a.y - click.y);
    if (!Number.isFinite(graphRadius) || graphRadius <= 0) return null;

    const p = propsRef.current;
    const cursorIso = p.time ? endOfDayIso(p.time) : null;
    let bestKind: 'person' | 'post' | null = null;
    let bestId: string | null = null;
    let bestD = graphRadius;

    for (const [id, pt] of peopleLayoutRef.current) {
      const person = peopleByIdRef.current.get(id);
      if (!person || !p.visible(person)) continue;
      let px = pt.x, py = pt.y;
      if (cursorIso) {
        if (person.t0 > cursorIso) continue;
        const s = stageAsOf(person, cursorIso);
        if (s === -1) continue;
        const r = radiusForStage(person, s);
        px = Math.cos(pt.a) * r;
        py = Math.sin(pt.a) * r;
      }
      const d = Math.hypot(px - click.x, py - click.y);
      if (d <= bestD) { bestD = d; bestKind = 'person'; bestId = id; }
    }
    for (const [id, pt] of postsLayoutRef.current) {
      const post = postsByIdRef.current.get(id);
      if (!post) continue;
      if (cursorIso && post.d > cursorIso) continue;
      const d = Math.hypot(pt.x - click.x, pt.y - click.y);
      if (d <= bestD) { bestD = d; bestKind = 'post'; bestId = id; }
    }
    return bestKind && bestId ? { kind: bestKind, id: bestId } : null;
  };

  const recomputeOverlayPeople = () => {
    const out: OverlayPoint[] = [];
    const visible = propsRef.current.visible;
    for (const [id, pt] of peopleLayoutRef.current) {
      const person = peopleByIdRef.current.get(id);
      if (!person || !visible(person)) continue;
      out.push({ id, pt, recentFresh: freshFlagRef.current.get(id) === true });
    }
    overlayPeopleRef.current = out;
    // Drives densityScale() in the node reducer — a dense window draws
    // smaller dots so a busy ring doesn't read as one painted stripe.
    visibleCountRef.current = out.length;
  };

  // The underlay (rings, month ticks, scrub cursor) is static
  // relative to the camera — it only needs to repaint when the camera moves
  // (pan/zoom), the window/theme/cursor changes, or the container resizes.
  // Running it on every RAF tick was the single biggest cost in an early
  // profile (canvas text measurement for ~20 tick + 5 ring labels, 60x/sec,
  // dragged the page from 60fps to ~23fps at 1,100 nodes) — it buys nothing
  // since nothing in it changes frame-to-frame under ambient motion alone.
  const drawUnderlayLayer = () => {
    const renderer = rendererRef.current;
    const theme = themeRef.current;
    const win = winRef.current;
    const wrap = wrapRef.current;
    if (!renderer || !theme || !win || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cursor = propsRef.current.time;
    const underCtx = fitUnderlayCanvas(underlayCanvasRef.current!, rect.width, rect.height);
    drawUnderlay({
      ctx: underCtx, width: rect.width, height: rect.height, theme, win,
      graphToViewport: (pt) => renderer.graphToViewport(pt),
      nowDay: dayOrdinal(new Date().toISOString()),
      cursorDay: cursor ? dayOrdinal(cursor) : null,
    });
  };

  // The fx layer (ambient sparks, fresh pulses, travel streaks, fade-in
  // ripples, spotlight chords) runs every RAF frame — that motion is the
  // whole point.
  const drawFxLayer = () => {
    const renderer = rendererRef.current;
    const theme = themeRef.current;
    const wrap = wrapRef.current;
    if (!renderer || !theme || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const graphToViewport = (pt: { x: number; y: number }) => renderer.graphToViewport(pt);

    const fxCtx = fitUnderlayCanvas(fxCanvasRef.current!, rect.width, rect.height);
    let spotlight: { origin: LayoutPoint; neighbors: LayoutPoint[]; toCentre: boolean } | null = null;
    const sel = propsRef.current.selected;
    if (sel) {
      const origin = (sel.kind === 'person' ? peopleLayoutRef.current : postsLayoutRef.current).get(sel.id);
      if (origin) {
        const neighborPts: LayoutPoint[] = [];
        for (const ce of contentEdgesRef.current) {
          if (sel.kind === 'person' && ce.s === sel.id) {
            const p = postsLayoutRef.current.get(ce.t);
            if (p) neighborPts.push(p);
          } else if (sel.kind === 'post' && ce.t === sel.id) {
            const p = peopleLayoutRef.current.get(ce.s);
            if (p) neighborPts.push(p);
          }
        }
        spotlight = { origin, neighbors: neighborPts, toCentre: sel.kind === 'person' };
      }
    }
    drawLiveOverlay({
      ctx: fxCtx, width: rect.width, height: rect.height, theme, nowMs: nowRef.current,
      reducedMotion: propsRef.current.reducedMotion, graphToViewport, centre: CENTRE_POINT,
      people: overlayPeopleRef.current, animations: animationsRef.current, spotlight,
    });
    // Ring labels draw LAST, on this same top layer, so "REACHED"/"CONNECTED"
    // sit above every node regardless of how busy that ring is (the
    // underlay canvas they used to live on is BELOW sigma's own node canvas).
    drawRingLabels({ ctx: fxCtx, theme, graphToViewport });
  };

  const drawOverlays = () => { drawUnderlayLayer(); drawFxLayer(); };

  const nodeReducer = (node: string, data: OrbitNodeAttrs): Partial<NodeDisplayData> => {
    const theme = themeRef.current;
    const p = propsRef.current;
    const now = nowRef.current;
    if (!theme) return { ...data, hidden: true } as Partial<NodeDisplayData>;

    if (data.kind === 'you') {
      const scale = p.reducedMotion ? 1 : breatheScale('you', now);
      return { ...data, x: 0, y: 0, size: data.size * scale, hidden: false, zIndex: 10 } as Partial<NodeDisplayData>;
    }

    const cursorIso = p.time ? endOfDayIso(p.time) : null;

    if (data.kind === 'post') {
      const post = postsByIdRef.current.get(node);
      if (!post) return { ...data, hidden: true } as Partial<NodeDisplayData>;
      if (cursorIso && post.d > cursorIso) return { ...data, hidden: true } as Partial<NodeDisplayData>;
      const layoutPt = postsLayoutRef.current.get(node);
      let size = data.size;
      let color = theme.post;
      if (!p.reducedMotion) size *= breatheScale(node, now);
      const blink = animationsRef.current.postBlink.get(node);
      if (blink && !p.reducedMotion) {
        const env = blinkEnvelope(blink, now);
        if (env > 0.5) color = theme.text;
        size += env * 2;
      }
      const isSel = p.selected?.kind === 'post' && p.selected.id === node;
      const isHover = hoverRef.current === node;
      const lit = !p.selected || isSel || neighborsRef.current.has(node);
      // blendOver, never withAlpha, for anything sigma paints — see the
      // comment on withAlpha() in theme.ts (WebGL premultipliedAlpha bug).
      if (p.selected && !lit) color = blendOver(theme.dead, 0.12, theme.canvas);
      if (isSel || isHover) { size += 2.5; color = theme.text; }
      size = Math.max(p.selected && !lit ? 1.2 : MIN_RENDER_SIZE, size);
      return {
        ...data,
        x: layoutPt?.x ?? data.x, y: layoutPt?.y ?? data.y,
        size, color, label: postLabelIdsRef.current.has(node) || isSel || isHover ? data.label : '',
        hidden: false, zIndex: isSel ? 9 : 3,
      } as Partial<NodeDisplayData>;
    }

    // person
    const person = peopleByIdRef.current.get(node);
    if (!person) return { ...data, hidden: true } as Partial<NodeDisplayData>;
    if (!p.visible(person)) return { ...data, hidden: true } as Partial<NodeDisplayData>;
    if (cursorIso && person.t0 > cursorIso) return { ...data, hidden: true } as Partial<NodeDisplayData>;

    const basePt = peopleLayoutRef.current.get(node) ?? { id: node, a: 0, r: 0, x: data.x, y: data.y };
    let effStage = person.st;
    let px = basePt.x, py = basePt.y;
    if (cursorIso) {
      const s = stageAsOf(person, cursorIso);
      if (s === -1) return { ...data, hidden: true } as Partial<NodeDisplayData>;
      effStage = s;
      const r = radiusForStage(person, s);
      px = Math.cos(basePt.a) * r;
      py = Math.sin(basePt.a) * r;
    }

    let size = baseNodeSize(person) * densityScale(visibleCountRef.current);
    let color = stageColor(theme, effStage);
    if (person.inb && effStage <= 0) color = theme.inbound;

    const fresh = freshFlagRef.current.get(node) === true;
    if (fresh) size += 1.1;

    if (!p.reducedMotion) {
      size *= breatheScale(node, now);
      const travel = animationsRef.current.travel.get(node);
      if (travel) {
        const cur = travelPointAt(travel, now);
        if (cur) { px = cur.x; py = cur.y; }
      }
      const fadeIn = animationsRef.current.fadeIn.get(node);
      if (fadeIn) size *= Math.max(0.12, fadeInEnvelope(fadeIn, now));
    }

    const isSel = p.selected?.kind === 'person' && p.selected.id === node;
    const isHover = hoverRef.current === node;
    const lit = !p.selected || isSel || neighborsRef.current.has(node);
    // Default (nothing selected/hovered): only label people who replied or
    // booked, same restraint the seed used — ~1,100 nodes at once otherwise
    // overlaps into noise. A selection labels the ENTIRE spotlight (below).
    let label = !p.selected && effStage >= 3 ? person.n : '';
    if (p.selected && lit) label = person.n;
    // blendOver, never withAlpha, for anything sigma paints — see the
    // comment on withAlpha() in theme.ts (WebGL premultipliedAlpha bug: a
    // low-alpha rgba() there renders near its full base brightness instead
    // of fading, which is why the spotlight previously read as "everything
    // is selected").
    if (p.selected && !lit) { color = blendOver(theme.dead, 0.12, theme.canvas); label = ''; size = Math.max(1.2, size * 0.85); }
    if (isSel || isHover) { size += 2.5; color = theme.text; label = person.n; }
    // Visibility floor — see MIN_RENDER_SIZE. Deliberately below the dim
    // branch above: a spotlighted-away node is ALLOWED to shrink further,
    // it's meant to recede, not disappear entirely.
    size = Math.max(p.selected && !lit ? 1.2 : MIN_RENDER_SIZE, size);

    return {
      ...data,
      x: px, y: py, size, color, label,
      headline: personHeadline(person),
      hidden: false,
      zIndex: isSel ? 9 : effStage >= 3 ? 6 : 4,
    } as Partial<NodeDisplayData>;
  };

  const edgeReducer = (edge: string, data: OrbitEdgeAttrs): Partial<EdgeDisplayData> => {
    const theme = themeRef.current;
    const g = graphRef.current;
    const p = propsRef.current;
    if (!theme || !g) return { ...data, hidden: true } as Partial<EdgeDisplayData>;
    const s = g.source(edge), t = g.target(edge);
    const person = peopleByIdRef.current.get(s);
    const post = postsByIdRef.current.get(t);
    if (!person || !post || !p.visible(person)) return { ...data, hidden: true } as Partial<EdgeDisplayData>;
    const cursorIso = p.time ? endOfDayIso(p.time) : null;
    if (cursorIso && (person.t0 > cursorIso || post.d > cursorIso)) return { ...data, hidden: true } as Partial<EdgeDisplayData>;

    const hover = hoverRef.current;
    const sel = p.selected;
    const focus = (sel?.kind === 'person' && sel.id === s) || (sel?.kind === 'post' && sel.id === t) || hover === s || hover === t;
    if (focus) return { ...data, color: theme.inbound, size: data.size + 0.6, hidden: false, zIndex: 9 } as Partial<EdgeDisplayData>;
    if (sel) return { ...data, color: blendOver(theme.inbound, 0.04, theme.canvas), hidden: false } as Partial<EdgeDisplayData>;
    return { ...data, hidden: false } as Partial<EdgeDisplayData>;
  };

  // ── mount: create graph + sigma once ──────────────────────────────────
  useEffect(() => {
    const container = sigmaContainerRef.current;
    if (!container) return;

    const theme = readOrbitTheme();
    themeRef.current = theme;
    const g = new MultiDirectedGraph<OrbitNodeAttrs, OrbitEdgeAttrs>();
    graphRef.current = g;
    g.addNode('you', { kind: 'you', x: 0, y: 0, size: 8, color: theme.text, label: 'You', hidden: false, zIndex: 10 });

    const renderer = new Sigma<OrbitNodeAttrs, OrbitEdgeAttrs>(g, container, {
      allowInvalidContainer: true,
      zIndex: true,
      renderEdgeLabels: false,
      labelFont: theme.font,
      labelSize: 11,
      labelColor: { color: theme.text },
      labelRenderedSizeThreshold: 5.2,
      labelDensity: 0.55,
      labelGridCellSize: 80,
      stagePadding: 34,
      minCameraRatio: 0.12,
      maxCameraRatio: 1.6,
      defaultDrawNodeLabel: makeNodeLabelDrawer(theme),
      defaultDrawNodeHover: makeNodeHoverDrawer(theme),
      nodeReducer,
      edgeReducer,
    });
    rendererRef.current = renderer;

    renderer.on('enterNode', ({ node }) => {
      if (node === 'you') return;
      hoverRef.current = node;
      computeNeighbors(propsRef.current.selected?.id ?? node);
      renderer.refresh({ skipIndexation: true });
    });
    renderer.on('leaveNode', () => {
      hoverRef.current = null;
      computeNeighbors(propsRef.current.selected?.id ?? null);
      renderer.refresh({ skipIndexation: true });
    });
    renderer.on('clickNode', ({ node }) => {
      // Fast path: sigma's own exact hit landed on something. Still routed
      // through findNearestSelectable's toggle semantics via the shared
      // helper below for one code path, not two divergent ones.
      if (node === 'you') { propsRef.current.onSelect(null); return; }
      const kind: 'person' | 'post' = postsByIdRef.current.has(node) ? 'post' : 'person';
      const cur = propsRef.current.selected;
      propsRef.current.onSelect(cur && cur.kind === kind && cur.id === node ? null : { kind, id: node });
    });
    // The primary path: sigma's exact-radius hit test misses almost every
    // tap once dots are a few px (dense poll) or its spatial index has gone
    // stale under continuous skipIndexation refreshes (see TAP_RADIUS_PX) —
    // so MOST taps land here, not in clickNode. Select the nearest visible
    // node within a fingertip-sized radius instead; a true empty tap (no
    // node within radius) clears the selection.
    renderer.on('clickStage', ({ event }) => {
      const hit = findNearestSelectable(event.x, event.y);
      if (!hit) { propsRef.current.onSelect(null); return; }
      const cur = propsRef.current.selected;
      propsRef.current.onSelect(cur && cur.kind === hit.kind && cur.id === hit.id ? null : hit);
    });
    // Camera pans/zooms reposition the rings/ticks (they're drawn in
    // viewport space via graphToViewport) — repaint the underlay when that
    // happens, not on every ambient frame.
    renderer.getCamera().on('updated', () => drawUnderlayLayer());

    const wrap = wrapRef.current;
    if (wrap && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { renderer.refresh({ skipIndexation: true }); drawOverlays(); });
      ro.observe(wrap);
      resizeObsRef.current = ro;
    }

    const loop = (t: number) => {
      nowRef.current = t;
      animationsRef.current.prune(t);
      renderer.refresh({ skipIndexation: true });
      drawFxLayer();
      rafRef.current = requestAnimationFrame(loop);
    };
    drawUnderlayLayer();
    if (!propsRef.current.reducedMotion) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      drawFxLayer();
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      resizeObsRef.current?.disconnect();
      renderer.kill();
      rendererRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── reduced-motion toggling mid-session: start/stop the RAF loop ──────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (props.reducedMotion) {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      renderer.refresh({ skipIndexation: true });
      drawOverlays();
    } else if (rafRef.current === null) {
      const loop = (t: number) => {
        nowRef.current = t;
        animationsRef.current.prune(t);
        renderer.refresh({ skipIndexation: true });
        drawFxLayer();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reducedMotion]);

  // ── data sync: rebuild the graphology graph whenever `graph`/`prev` change ─
  useEffect(() => {
    const g = graphRef.current;
    const renderer = rendererRef.current;
    const theme = themeRef.current;
    const graph = props.graph;
    if (!g || !renderer || !theme || !graph) return;

    const win = computeWindow(graph);
    winRef.current = win;
    const peopleLayout = layoutPeople(graph.people, win);
    const postsLayout = layoutPosts(graph.posts, win);
    const nowMs = Date.now();
    const cutoff = nowMs - DAY_MS;
    const freshFlags = new Map<string, boolean>();
    for (const person of graph.people) {
      const flag = person.fresh > 0 || person.ev.some((e) => Date.parse(e.d) >= cutoff);
      freshFlags.set(person.id, flag);
    }

    // Rebuild the graph fresh each poll — simplest correct approach at this
    // scale (~1,100 nodes / ~1,500 edges) and it runs on data-sync cadence
    // (poll/realtime), never inside the 60fps RAF hot path.
    g.clear();
    g.addNode('you', { kind: 'you', x: 0, y: 0, size: 8, color: theme.text, label: 'You', hidden: false, zIndex: 10 });
    for (const person of graph.people) {
      const pt = peopleLayout.get(person.id);
      if (!pt) continue;
      g.addNode(person.id, {
        kind: 'person', x: pt.x, y: pt.y, size: baseNodeSize(person),
        color: stageColor(theme, person.st), label: person.n, headline: personHeadline(person),
        hidden: false, zIndex: 4,
      });
    }
    // Thin post-rim labels by minimum arc separation before creating the
    // nodes: a busy posting week otherwise piles half a dozen date labels
    // into one unreadable mass. Always keep the first and last post of the
    // window regardless of spacing, so the rim's actual span stays legible.
    const sortedPosts = [...graph.posts].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const labelIds = new Set<string>();
    if (sortedPosts.length > 0) {
      labelIds.add(sortedPosts[0].id);
      labelIds.add(sortedPosts[sortedPosts.length - 1].id);
      let lastAngle: number | null = postsLayout.get(sortedPosts[0].id)?.a ?? null;
      for (let i = 1; i < sortedPosts.length - 1; i++) {
        const pt = postsLayout.get(sortedPosts[i].id);
        if (!pt) continue;
        if (lastAngle === null || angularDist(pt.a, lastAngle) >= POST_LABEL_MIN_ARC) {
          labelIds.add(sortedPosts[i].id);
          lastAngle = pt.a;
        }
      }
    }
    postLabelIdsRef.current = labelIds;

    for (const post of graph.posts) {
      const pt = postsLayout.get(post.id);
      if (!pt) continue;
      g.addNode(post.id, {
        // Full label always stored on the node — thinning happens in the
        // reducer (postLabelIdsRef), which also always shows it for the
        // selected/hovered post regardless of thinning.
        kind: 'post', x: pt.x, y: pt.y, size: basePostSize(post), color: theme.post,
        label: new Date(post.d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
        headline: post.txt.slice(0, 90), hidden: false, zIndex: 3,
      });
    }
    graph.content_edges.forEach((ce, i) => {
      if (!g.hasNode(ce.s) || !g.hasNode(ce.t)) return;
      const recent = nowMs - Date.parse(ce.d) < DAY_MS;
      g.addEdgeWithKey('ce' + i, ce.s, ce.t, {
        kind: ce.k,
        // blendOver, never withAlpha — see theme.ts (WebGL premultipliedAlpha bug).
        color: blendOver(theme.inbound, ce.k === 'comment' ? 0.42 : 0.16, theme.canvas),
        size: ce.k === 'comment' ? 1.1 : 0.6,
        recent, hidden: false,
      });
    });

    const prevById = props.prev ? new Map(props.prev.people.map((p) => [p.id, p])) : null;
    const prevPeopleLayout = props.prev ? layoutPeople(props.prev.people, computeWindow(props.prev)) : null;
    const prevPostIds = props.prev ? new Set(props.prev.posts.map((x) => x.id)) : null;
    animationsRef.current.sync({
      nowMs, people: graph.people, peopleLayout, posts: graph.posts, postsLayout,
      prevById, prevPeopleLayout, prevPostIds,
      onLiveEvent: props.onLiveEvent,
    });

    peopleByIdRef.current = new Map(graph.people.map((p) => [p.id, p]));
    postsByIdRef.current = new Map(graph.posts.map((p) => [p.id, p]));
    peopleLayoutRef.current = peopleLayout;
    postsLayoutRef.current = postsLayout;
    contentEdgesRef.current = graph.content_edges;
    freshFlagRef.current = freshFlags;
    computeNeighbors(propsRef.current.selected?.id ?? null);
    recomputeOverlayPeople();

    renderer.refresh();
    drawOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.graph, props.prev]);

  // ── selection / hover-affecting props: refresh without a full data rebuild ─
  useEffect(() => {
    computeNeighbors(props.selected?.id ?? null);
    rendererRef.current?.refresh({ skipIndexation: true });
    drawOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selected]);

  useEffect(() => {
    recomputeOverlayPeople();
    rendererRef.current?.refresh({ skipIndexation: true });
    drawOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible, props.time]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas ref={underlayCanvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div ref={sigmaContainerRef} style={{ position: 'absolute', inset: 0 }} />
      <canvas ref={fxCanvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    </div>
  );
}
