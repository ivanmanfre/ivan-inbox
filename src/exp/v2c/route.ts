import { JOBS, type Job, type PeerKey } from './layout'

// #exp/ is read at mount only (src/exp/index.tsx). Every candidate before this
// one therefore had exactly one reachable-by-URL surface: its default tab. Every
// inner screen could only be reached by clicking, which is also why verifying
// one needs a click script.
//
// The workbench carries its own state in the experiment hash instead:
//   #exp/v2              → inbox, nothing focused
//   #exp/v2/content      → the Content job
//   #exp/v2/inbox/chat   → Inbox with Claude focused (a mobile takeover)
// The gate's regex tolerates the trailing path (\b after the id), so each of
// these is a real fresh-load URL. Unknown segments fall back rather than throw.
//
// `v2c` is still READ so tournament-era ballot links keep working (see
// src/exp/index.tsx), but only `v2` is ever WRITTEN back to the address bar —
// two ids that both resolve is a compatibility shim, not two routes.

export type WbRoute = { job: Job; focus: PeerKey | null }

export const DEFAULT_ROUTE: WbRoute = { job: 'dms', focus: null }

// Jobs that no longer exist, and where they went. Both of these were REAL URLs
// Ivan (and any bookmark, any ballot link) could be sitting on when the Inbox
// job was absorbed into DMs, so they resolve instead of silently falling back to
// a default that happens to be right today and wrong after the next rename.
// `wbHash` only ever WRITES the canonical id, so an alias is read-once and then
// rewritten in the address bar.
const JOB_ALIAS: Record<string, Job> = { inbox: 'dms', drafts: 'dms' }

export function parseWbHash(hash: string): WbRoute {
  const m = hash.match(/^#exp\/v2c?(?:\/([^/]*))?(?:\/([^/]*))?/)
  if (!m) return DEFAULT_ROUTE
  const seg = m[1] ?? ''
  const job = (JOBS as string[]).includes(seg)
    ? (seg as Job)
    : JOB_ALIAS[seg] ?? DEFAULT_ROUTE.job
  // Only 'chat' is addressable as a focus: a thread/draft peer key is a database
  // id, and a URL that pretends to restore one would 404 into an empty pane.
  const focus = m[2] === 'chat' || m[1] === 'chat' ? 'chat' : null
  // '#exp/v2c/chat' means "chat over the default job", not "a job named chat".
  return { job, focus }
}

export function wbHash(job: Job, focus: PeerKey | null): string {
  const tail = focus === 'chat' ? '/chat' : ''
  return `#exp/v2/${job}${tail}`
}
