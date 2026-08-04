// Candidate v2c — "Workbench". THE layout resolver.
//
// Phase 0 found the desktop/mobile fork copy-pasted into four files
// (App.tsx:148-192 + three candidate shells), each of which re-derives
// "does this tab get the split or the full width" inline, in JSX, from
// `desktop ? … : …` plus a hardcoded list of tab names. Every layout change
// therefore lands in four places.
//
// This candidate has exactly one branch on width, and it is this pure function.
// Shell.tsx renders whatever plan it returns; no component below Shell reads a
// viewport. That is testable in node (below) instead of only in a browser, and
// it is why the workbench can add a third region without a fifth fork.

// 2026-08-03, Ivan (twice): "the inbox section u can remove it i see no purpose
// on it having dms and sends". The census (phase1-census.json) found the DMs
// lane rendering ZERO rows — it only ever held threads with a pending draft —
// while all 135 conversations, 70 of them waiting on him, lived in Inbox alone.
// So Inbox was not deleted, it was ABSORBED: `dms` is now the conversation list
// (the old `drafts` job, renamed because the surface is no longer a draft
// queue), and the approve/discard cards became one status inside it.
//
// The removal freed a mobile slot, which is what lets DMs be a destination
// again instead of half of a "Work" tab. WORK_JOBS is now what it always
// described — the two CONTENT lanes.
export type Job = 'today' | 'dms' | 'content' | 'magnets' | 'styles' | 'sends' | 'ops' | 'settings'

// Three canvases, two media queries, one hook (useCanvas). 'wide' is where the
// workbench can hold the working list AND two context peers at once — 1440px is
// exactly rail(200) + list(400) + peer(420) + peer(420).
export type Canvas = 'mobile' | 'desktop' | 'wide'

// A context peer: what the right-hand region can hold. Not a tab, not a modal —
// a peer of the working list, and of each other.
export type Peer =
  // `label` is what the chat pane says it is asking ABOUT. It travels with the
  // peer because the surface that OPENED the peer is the one that knows the
  // human name for it — the list has the draft's title, the pane only has an id.
  | { kind: 'thread'; id: string; label?: string }
  | { kind: 'draft'; id: string; label?: string }
  | { kind: 'chat' }

export type PeerKey = string

export function peerKey(p: Peer): PeerKey {
  return p.kind === 'chat' ? 'chat' : `${p.kind}:${p.id}`
}

// Rail order. Jobs first (they set the working surface), Claude last — it is
// deliberately NOT a job (see dockChat below).
export const JOBS: Job[] = ['today', 'dms', 'content', 'magnets', 'styles', 'sends', 'ops', 'settings']

export const JOB_LABEL: Record<Job, string> = {
  today: 'Today', dms: 'DMs', content: 'Content',
  magnets: 'Magnets', styles: 'Styles', sends: 'Sends', ops: 'Ops', settings: 'Settings',
}

// Unicode glyphs only, matching TabBar.tsx:9-30 — no icon set, no SVG sprite.
// DMs inherits the Inbox glyph, not the old drafts sparkle: it is a
// conversation list now, and the glyph is the honest one.
export const JOB_ICON: Record<Job, string> = {
  today: '☼', dms: '◉', content: '▤', magnets: '▦', styles: '▧',
  sends: '↑', ops: '◈', settings: '⚙︎',
}

// Jobs whose working surface is a LIST that can hand a row to a context peer.
// Everything else is a whole-canvas reading/monitoring surface. This replaces
// App.tsx:152's inline `tab === 'sends' || tab === 'ops' || tab === 'today'`.
const LIST_JOBS: Job[] = ['dms', 'content', 'magnets']

export function jobHasList(job: Job): boolean {
  return LIST_JOBS.includes(job)
}

// On mobile the bottom bar cannot carry every job, so the two CONTENT lanes
// share one slot and the segmented control inside it sets the SAME job state the
// desktop rail sets. One state, two renderings — not a second router. The mobile
// bar does NOT grow when a job joins this list.
//
// DMs left this group when Inbox was absorbed into it: it is the conversation
// list now, it is what the badge counts, and the freed slot is exactly what lets
// it be one tap away again.
export const WORK_JOBS: Job[] = ['content', 'magnets', 'styles']

export function isWorkJob(job: Job): boolean {
  return WORK_JOBS.includes(job)
}

export type Plan = {
  // 'list'  — the working surface is a fixed-width column beside its peers
  // 'wide'  — the working surface takes the whole remaining canvas
  // 'hidden'— mobile only: a peer has taken the screen over
  work: 'list' | 'wide' | 'hidden'
  // Peers to render, left to right. Never longer than the canvas can hold.
  peers: Peer[]
  // Applied to the working region when it is sharing the canvas with a peer:
  // the app's own desktop grids (Today's two columns, Sends' duos) key off the
  // VIEWPORT, so a 400px-wide region at a 1440px viewport would still try to
  // run two columns. This flag collapses them back.
  narrow: boolean
}

export const MAX_PEERS = 2

// How many peers a canvas can hold at once.
export function peerCapacity(canvas: Canvas): number {
  return canvas === 'wide' ? MAX_PEERS : 1
}

/**
 * The whole viewport fork, in one place.
 *
 * mobile — one region at a time. A focused peer takes the screen over (the
 *          convention ThreadScreen already established, App.tsx:179-185); with
 *          no focused peer the job owns the screen.
 * desktop— rail + one region + at most one peer (the focused one).
 * wide   — rail + region + up to two peers side by side.
 *
 * With NO peers at all the working surface always goes 'wide'. That is the
 * structural fix for the ghost pane (A1): there is no empty second region to
 * label, because when nothing is in it, it does not exist.
 */
export function planWorkbench(
  job: Job, canvas: Canvas, peers: Peer[], focus: PeerKey | null,
): Plan {
  const focused = peers.find(p => peerKey(p) === focus) ?? null
  if (canvas === 'mobile') {
    return focused
      ? { work: 'hidden', peers: [focused], narrow: false }
      : { work: 'wide', peers: [], narrow: false }
  }
  const cap = peerCapacity(canvas)
  // Below 'wide' only the focused peer fits; if nothing is focused, the last
  // peer added is the one on screen.
  const shown = peers.length <= cap
    ? peers
    : focused ? [focused] : peers.slice(-cap)
  if (shown.length === 0) return { work: 'wide', peers: [], narrow: false }
  return {
    work: jobHasList(job) ? 'list' : 'wide',
    peers: shown,
    narrow: !jobHasList(job),
  }
}

// ---- peer set transitions (pure, so the Shell holds no set logic) ----
//
// The invariant: at most ONE context peer (a thread or a draft) plus Claude,
// and Claude is always rightmost. A workbench that could stack five panes would
// just be a tab bar rotated 90°.

export function addPeer(peers: Peer[], p: Peer): Peer[] {
  const chat = peers.find(x => x.kind === 'chat') ?? null
  if (p.kind === 'chat') {
    const ctx = peers.filter(x => x.kind !== 'chat')
    return [...ctx, { kind: 'chat' }]
  }
  return chat ? [p, chat] : [p]
}

export function dropPeer(peers: Peer[], key: PeerKey): Peer[] {
  return peers.filter(p => peerKey(p) !== key)
}

export function hasChat(peers: Peer[]): boolean {
  return peers.some(p => p.kind === 'chat')
}

// The context peer Claude is being asked about, if any. This is what makes the
// pair real rather than decorative: the chat pane names it, and on mobile —
// where there is no third region — it is the ONLY thing that survives the
// takeover, rendered as a context card at the top of the chat.
export type ContextPeer = Exclude<Peer, { kind: 'chat' }>

export function contextPeer(peers: Peer[]): ContextPeer | null {
  return (peers.find((p): p is ContextPeer => p.kind !== 'chat')) ?? null
}
