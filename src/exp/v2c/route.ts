import { JOBS, type Job, type PeerKey } from './layout'

// #exp/ is read at mount only (src/exp/index.tsx). Every candidate before this
// one therefore had exactly one reachable-by-URL surface: its default tab. Every
// inner screen could only be reached by clicking, which is also why verifying
// one needs a click script.
//
// v2c carries its own state in the experiment hash instead:
//   #exp/v2c              → inbox, nothing focused
//   #exp/v2c/content      → the Content job
//   #exp/v2c/inbox/chat   → Inbox with Claude focused (a mobile takeover)
// The gate's regex tolerates the trailing path (\b after the id), so each of
// these is a real fresh-load URL. Unknown segments fall back rather than throw.

export type WbRoute = { job: Job; focus: PeerKey | null }

export const DEFAULT_ROUTE: WbRoute = { job: 'inbox', focus: null }

export function parseWbHash(hash: string): WbRoute {
  const m = hash.match(/^#exp\/v2c(?:\/([^/]*))?(?:\/([^/]*))?/)
  if (!m) return DEFAULT_ROUTE
  const job = (JOBS as string[]).includes(m[1] ?? '') ? (m[1] as Job) : DEFAULT_ROUTE.job
  // Only 'chat' is addressable as a focus: a thread/draft peer key is a database
  // id, and a URL that pretends to restore one would 404 into an empty pane.
  const focus = m[2] === 'chat' || m[1] === 'chat' ? 'chat' : null
  // '#exp/v2c/chat' means "chat over the default job", not "a job named chat".
  return { job, focus }
}

export function wbHash(job: Job, focus: PeerKey | null): string {
  const tail = focus === 'chat' ? '/chat' : ''
  return `#exp/v2c/${job}${tail}`
}
