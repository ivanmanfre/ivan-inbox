// src/orbit/layout.ts — deterministic, client-side clock layout.
//
// Ported from seed/build_graph.py lines 291-317 (the "clock = when they
// first touched, radius = how far they got" section) and the brief's layout
// spec. Pure geometry only: no DOM, no sigma, no React. Every function here
// is a pure function of its inputs so the same graph always lays out to the
// same pixel — nothing jumps between polls unless a person's own day/stage
// actually changed.

import type { OrbitGraph, OrbitPerson, OrbitPost, OrbitStage } from './types';

/** Radius by stage ring, outermost (0, signal) to innermost (4, booked). */
export const STAGE_RING: readonly [number, number, number, number, number] = [
  0.865, 0.685, 0.505, 0.325, 0.155,
];

/** Posts sit on the rim, just outside the outermost ring. */
export const POST_RING = 0.96;

/** Radial jitter half-band, as a FRACTION OF THAT RING'S OWN RADIUS —
 *  proportional, not absolute. An absolute band (the original build_graph.py
 *  value) is ~40% of the booked ring's tiny radius but only ~7% of the
 *  signal ring's, so every ring except the outermost reads as a dense
 *  painted stripe rather than a spread population. */
export const RADIAL_BAND_FRACTION = 0.045;

/** Bucket population at which the angular slice starts widening (and at
 *  3x this size, hits the 3-slice cap). ~15 people already fills a nominal
 *  one-day slice comfortably at phone width; the real 30d ivan window's
 *  busiest single (day, stage) cell holds 40. */
export const BUCKET_WIDEN_AT = 15;

/** Clock starts at 12 o'clock (-90deg) and doesn't quite close the circle,
 *  so day 0 and the present day are visually distinct wedges. */
export const CLOCK_START = -Math.PI / 2;
export const CLOCK_SWEEP = 0.985;

export interface OrbitWindow {
  /** Ordinal day (days since the Unix epoch, UTC) the clock starts at. */
  fromDay: number;
  /** Ordinal day the clock ends at. */
  toDay: number;
  /** toDay - fromDay, floored at 1 so a same-day window never divides by zero. */
  span: number;
  /** True when the graph carried no dated events at all — fromDay/toDay are a
   *  degenerate 1-day placeholder and callers should render the empty state
   *  rather than trust the domain. */
  empty: boolean;
}

export interface LayoutPoint {
  id: string;
  /** Angle in radians, clock convention (0 = 12 o'clock, clockwise). */
  a: number;
  /** Radius, 0 (centre) .. ~1 (rim), in normalised graph units. */
  r: number;
  x: number;
  y: number;
}

/** Ordinal day (UTC, floor) of an ISO date or timestamp string. Only the
 *  first 10 characters (the date part) matter — timezone offsets on the
 *  RPC's timestamptz values are already normalised to +00:00. */
export function dayOrdinal(iso: string): number {
  return Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86400000);
}

/** The clock's domain is `stats.t_min` (the 1st percentile of event
 *  timestamps) through `stats.t_max`, NOT the raw min/max of every event —
 *  a handful of imported chat histories (RISE carries LinkedIn DMs back to
 *  2013-08-15) would otherwise squeeze 99% of the real data into a sliver
 *  on an all-time window. `t_min` is epoch seconds; `t_min_abs`/`t_max` are
 *  ISO. Falls back to `t_min_abs` when `t_min` is null (RPC's percentile
 *  returns null on an empty window), and reports `empty: true` when there's
 *  no dated event to anchor on at all — callers should render the empty
 *  state rather than trust a degenerate domain. */
export function computeWindow(graph: Pick<OrbitGraph, 'from' | 'to' | 'stats'>): OrbitWindow {
  const stats = graph.stats;
  const fromIso = typeof stats?.t_min === 'number' && Number.isFinite(stats.t_min)
    ? new Date(stats.t_min * 1000).toISOString()
    : stats?.t_min_abs ?? null;
  if (!fromIso) {
    const fallback = dayOrdinal(graph.to || graph.from);
    return { fromDay: fallback, toDay: fallback + 1, span: 1, empty: true };
  }
  const toIso = stats?.t_max ?? graph.to;
  const fromDay = dayOrdinal(fromIso);
  const toDay = Math.max(dayOrdinal(toIso), fromDay + 1);
  return { fromDay, toDay, span: toDay - fromDay, empty: false };
}

/** The clock angle for a given ordinal day within the window. */
export function angleForDay(day: number, win: OrbitWindow): number {
  return CLOCK_START + 2 * Math.PI * ((day - win.fromDay) / win.span) * CLOCK_SWEEP;
}

/** Deterministic unit hash of an id, ported 1:1 from build_graph.py's h().
 *  Never Math.random() — the same id always lands at the same jitter, so a
 *  person never visibly jumps within their (day, stage) bucket across polls. */
export function hashUnit(id: string, salt: number): number {
  let x = 0;
  for (let i = 0; i < id.length; i++) x = (x * 131 + id.charCodeAt(i) + salt) % 1000003;
  return (x % 10007) / 10007;
}

/** Lay out every person on the clock: angle from their first-touch day,
 *  radius from their stage ring, spread within a (day, stage) bucket so
 *  people who arrived the same day at the same stage don't stack. */
export function layoutPeople(people: readonly OrbitPerson[], win: OrbitWindow): Map<string, LayoutPoint> {
  const buckets = new Map<string, OrbitPerson[]>();
  for (const p of people) {
    // Pin anyone whose first touch predates the domain (stats.t_min) to the
    // domain start rather than wrapping cos/sin at a huge negative angle —
    // a handful of imported chat histories go back to 2013 (see computeWindow).
    const day = Math.max(dayOrdinal(p.t0), win.fromDay);
    const key = day + ':' + p.st;
    let grp = buckets.get(key);
    if (!grp) { grp = []; buckets.set(key, grp); }
    grp.push(p);
  }
  const sliceW = ((2 * Math.PI) / win.span) * CLOCK_SWEEP;
  const out = new Map<string, LayoutPoint>();
  for (const [key, grp] of buckets) {
    const sep = key.indexOf(':');
    const day = Number(key.slice(0, sep));
    const st = Number(key.slice(sep + 1)) as OrbitStage;
    grp.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const a0 = angleForDay(day, win);
    const n = grp.length;
    const band = RADIAL_BAND_FRACTION * STAGE_RING[st];
    // A single busy day can hold 40+ people in one (day, stage) cell — far
    // more than the nominal one-day slice has room for at phone width even
    // with the proportional radial band above (40 dots need roughly 3x the
    // area one day-slice provides at a 390px viewport). Let an over-full
    // bucket borrow angular width from its otherwise-empty neighbours,
    // capped at 3 slices so it never reads as spanning unrelated days.
    const effSliceW = sliceW * Math.min(3, Math.max(1, n / BUCKET_WIDEN_AT));
    for (let j = 0; j < n; j++) {
      const p = grp[j];
      // Spread all the way to the slice's own edges (not just its middle
      // 80%) so a busy day-slice fills the space it actually has.
      const aa = n > 1 ? a0 - effSliceW / 2 + (j / (n - 1)) * effSliceW : a0;
      const rr = STAGE_RING[st] + (hashUnit(p.id, 1) - 0.5) * band * 2 * Math.min(1, 0.4 + n / 30);
      out.set(p.id, { id: p.id, a: aa, r: rr, x: Math.cos(aa) * rr, y: Math.sin(aa) * rr });
    }
  }
  return out;
}

/** Lay out posts on the rim, positioned by the day they went out. */
export function layoutPosts(posts: readonly OrbitPost[], win: OrbitWindow): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  for (const post of posts) {
    const day = Math.max(dayOrdinal(post.d), win.fromDay);
    const a = angleForDay(day, win);
    out.set(post.id, { id: post.id, a, r: POST_RING, x: Math.cos(a) * POST_RING, y: Math.sin(a) * POST_RING });
  }
  return out;
}

/** The centre point, "you". */
export const CENTRE_POINT: LayoutPoint = { id: 'you', a: 0, r: 0, x: 0, y: 0 };

/** ISO cursor normalised to the END of that calendar day, so a scrub cursor
 *  on day X includes everything that happened ON day X (a bare date string
 *  otherwise sorts lexically BEFORE any timestamp on the same day). */
export function endOfDayIso(dateOnly: string): string {
  return dateOnly.length <= 10 ? dateOnly + 'T23:59:59.999Z' : dateOnly;
}

/** Stage as of a given moment, walking the person's stage-date ladder — the
 *  client-side twin of the seed's stageAt(). Returns -1 if they hadn't
 *  appeared yet (before t0). ISO timestamptz strings compare correctly
 *  lexically since the RPC normalises every one to a fixed-width +00:00
 *  offset. */
export function stageAsOf(p: OrbitPerson, cursorIso: string): OrbitStage | -1 {
  let s: OrbitStage | -1 = -1;
  for (let i = 0; i < 5; i++) {
    const d = p.sd[i];
    if (d && d <= cursorIso) s = i as OrbitStage;
  }
  if (s === -1 && p.t0 <= cursorIso) s = 0;
  return s;
}

/** Radius for a person's ring at a given stage, including their fixed jitter
 *  offset from that stage's own ring (so scrubbing to an earlier stage moves
 *  them outward along the same jitter line, never resets it). This is an
 *  approximation of layoutPeople's bucket-scaled jitter (it doesn't know the
 *  historical bucket size at that stage) — close enough for the scrub
 *  animation, which only needs a plausible radius to travel through. */
export function radiusForStage(p: OrbitPerson, st: OrbitStage): number {
  const band = RADIAL_BAND_FRACTION * STAGE_RING[st];
  const jitter = (hashUnit(p.id, 1) - 0.5) * band * 2;
  return STAGE_RING[st] + jitter;
}
