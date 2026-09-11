// src/orbit/types.ts — shared contract for the /orbit surface.
//
// Mirrors the jsonb shapes returned by the `signal_graph` / `signal_person`
// Postgres RPCs verbatim (db/058_signal_orbit_events.sql). Field names are
// the RPC's own short keys (n, ti, st, sd, …) — do not rename them, the
// payload is ~1MB at 30d and every renamed key is a client-side remap cost.
//
// Both /orbit seats import from this file and never redefine these shapes.

/** Stage index: 0 signal · 1 reached · 2 connected · 3 replied · 4 booked. */
export type OrbitStage = 0 | 1 | 2 | 3 | 4;

/** Human labels for the five rings, outermost (0) to innermost (4). Shared
 *  by the canvas underlay (ring labels) and the shell's stage ladder. */
export const STAGE_LABEL: readonly [string, string, string, string, string] = [
  'Signal',
  'Reached',
  'Connected',
  'Replied',
  'Booked',
];

export type OrbitTenant = 'ivan' | 'arch' | 'risedtc';

/** One dated touch in a person's history (`ev` on OrbitPerson, and the
 *  fuller `events` list from signal_person). */
export interface OrbitEvent {
  /** Event kind, e.g. 'dm_in' | 'reaction' | 'comment' | 'connected' | 'booked' | … */
  t: string;
  /** ISO timestamptz. */
  d: string;
  /** Text excerpt (message body / comment / reaction type), truncated server-side. */
  x: string;
  /** Post id (social id) this event touched, or null. */
  p: string | null;
}

/** Which of the three never-reached buckets a person falls in (db/062). `null`
 *  once `reached` is true — the three are mutually exclusive and exhaustive
 *  over the never-reached population (see OrbitStats' matching counts). */
export type OrbitNeverReached = 'judged_out' | 'icp_unasked' | 'unjudged' | null;

/** One resolved identity in the window (a row of `people`). */
export interface OrbitPerson {
  /** contacts.id — the stable node id for this person. */
  id: string;
  /** Name. */
  n: string;
  /** Company. */
  c: string;
  /** Title / headline. */
  ti: string;
  /** ICP score, or null when never scored. */
  i: number | null;
  /** LinkedIn profile URL. */
  url: string;
  /** LinkedIn member id, or null. */
  mid: string | null;
  /** outreach_prospects.id for the most recent link, or null (never a prospect row). */
  pid: string | null;
  /** outreach_campaigns.id for that prospect row, or null. */
  camp: string | null;
  /** lane_of(campaign name); 'content' when the person has no prospect row. */
  lane: string;
  /** outreach_prospects.stage (the funnel stage string), or null. */
  pstage: string | null;
  /** outreach_prospects.skip_state, or null. */
  skip: string | null;
  /** Ring index: 0 signal, 1 reached, 2 connected, 3 replied, 4 booked. */
  st: OrbitStage;
  /** Earliest timestamp each of the 5 stages was reached, index-aligned with `st`; null = not yet. */
  sd: (string | null)[];
  /** First event timestamp in the window. */
  t0: string;
  /** Last event timestamp in the window. */
  t1: string;
  /** Count of this person's events within the last 24h at generation time — drives the "fresh" pulse. */
  fresh: number;
  /** True when they moved first (reacted/commented/viewed before any outreach). */
  inb: boolean;
  /** True when outreach (invite/DM/InMail/email) was sent. */
  reached: boolean;
  /** Never-reached bucket, or null once reached. See OrbitNeverReached. */
  nr: OrbitNeverReached;
  /** Human-readable reason for `nr`, or null once reached — e.g. "Judged out:
   *  engager rubric 4/10" or "ICP 8, never asked". Server-computed so the UI
   *  never re-derives the judgement logic. */
  nrw: string | null;
  /** True when they viewed your profile. */
  v: boolean;
  /** True when they reacted to or commented on a post. */
  pg: boolean;
  /** Inbound DM/email count. */
  dmi: number;
  /** Outbound DM/InMail count. */
  dmo: number;
  /** Up to 40 most recent events, most-recent-first. */
  ev: OrbitEvent[];
}

/** One post on the rim (a row of `posts`). */
export interface OrbitPost {
  /** social_id / post urn — the node id on the rim. */
  id: string;
  /** posted_at / published_at, ISO timestamptz. */
  d: string;
  /** Post text, truncated. */
  txt: string;
  /** Likes / reactions. */
  li: number;
  /** Comments. */
  cm: number;
  /** Impressions. */
  im: number;
  /** Post URL. */
  url: string;
  /** own_posts / client_post_metrics row id. */
  row: string;
}

/** One campaign, from `lanes` — the ONLY source of lane/campaign names. */
export interface OrbitLane {
  id: string;
  name: string;
  lane: string;
  active: boolean;
  /** Distinct people count for this campaign in the window. */
  n: number;
}

/** A person→post reaction/comment edge (a row of `content_edges`). */
export interface OrbitContentEdge {
  /** Person (contact) id — edge source. */
  s: string;
  /** Post id — edge target. */
  t: string;
  /** 'reaction' | 'comment'. */
  k: string;
  /** First-touch ISO timestamptz. */
  d: string;
}

export interface OrbitStats {
  people: number;
  posts: number;
  content_edges: number;
  events: number;
  /** Count of people with nr !== null (never reached), over the full window
   *  population (not the client-side filtered set — see filters.ts'
   *  computeStats for the filtered equivalent). Always equal to
   *  judged_out + icp_unasked + unjudged (db/062 computes all four from the
   *  same per-contact judgement, so they cannot drift apart). */
  never_reached: number;
  /** Never reached AND judged not-ICP (low engager score, failed profile-view
   *  judge, or a disqualified/skipped/archived/blacklisted prospect row). */
  judged_out: number;
  /** Never reached, not judged_out, AND has a positive ICP judgement
   *  somewhere (engager score >=7, profile-view pass, or prospect ICP >=7). */
  icp_unasked: number;
  /** Never reached, not judged_out, and no score anywhere. */
  unjudged: number;
  /** RPC server time, ms. */
  ms: number;
  /** True earliest event timestamp in the window, ISO — NOT the layout domain
   *  start (see t_min): a handful of imported chat histories predate 2026 by
   *  over a decade and would squeeze everything real into a sliver. */
  t_min_abs: string | null;
  /** 1st percentile of event timestamps, UNIX epoch SECONDS. This is the
   *  clock-layout domain start — outlier-resistant, unlike t_min_abs. */
  t_min: number | null;
  /** Latest event timestamp in the window, ISO — the layout domain end. */
  t_max: string | null;
}

/** The full `signal_graph(p_client, p_from, p_to)` payload. */
export interface OrbitGraph {
  tenant: OrbitTenant;
  /** Window start, 'YYYY-MM-DD'. */
  from: string;
  /** Window end, 'YYYY-MM-DD'. */
  to: string;
  /** ISO timestamptz the RPC ran. */
  generated_at: string;
  people: OrbitPerson[];
  posts: OrbitPost[];
  content_edges: OrbitContentEdge[];
  lanes: OrbitLane[];
  stats: OrbitStats;
}

/** One prospect link, from `signal_person`'s `prospects` array. */
export interface OrbitPersonProspect {
  id: string;
  campaign_id: string;
  campaign: string;
  lane: string;
  stage: string;
  icp: number | null;
  skip_state: string | null;
  tenant: OrbitTenant;
}

/** One dated event, from `signal_person`'s `events` array (fuller than OrbitEvent). */
export interface OrbitPersonEvent extends OrbitEvent {
  /** Source table this event came from. */
  src: string;
  /** outreach_prospects.id this event is attributed to, or null. */
  pid: string | null;
}

/** One identity-resolution link, from `signal_person`'s `links` array. */
export interface OrbitPersonLink {
  type: string;
  id: string;
  conf: number | null;
  ref: Record<string, unknown> | null;
}

/** The full `signal_person(p_client, p_contact)` payload. */
export interface OrbitPersonDetail {
  /** Raw `contacts` row (to_jsonb), or null if the contact no longer exists. */
  contact: Record<string, unknown> | null;
  prospects: OrbitPersonProspect[];
  events: OrbitPersonEvent[];
  links: OrbitPersonLink[];
}
