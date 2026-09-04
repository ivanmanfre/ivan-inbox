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
// src/exp/index.tsx), but it is never WRITTEN back to the address bar — two ids
// that both resolve is a compatibility shim, not two routes. `brain-a|b|c` IS
// written back, because those are three live experiments rather than one id's
// history, and a candidate that rewrote its own hash into `v2` would navigate
// out of itself on the first tab click.

// The hash also carries the deep-link state db/049 made addressable: a thread, a
// turn inside it, and the notification feed. Every one of them is OPTIONAL, so a
// caller that only reads { job, focus } is unaffected — which is the whole point,
// because the Shell and every lane read exactly those two today.
//
//   #exp/v2/ask?thread=<uuid>&turn=<uuid>   → the turn a push notification names
//   #exp/v2/dms?feed=1                      → the feed over whatever job is open
export type WbRoute = {
  job: Job
  focus: PeerKey | null
  thread?: string
  turn?: string
  feed?: boolean
}

export const DEFAULT_ROUTE: WbRoute = { job: 'dms', focus: null }

// The three tournament candidates mount behind their own experiment ids
// (src/exp/index.tsx). They share this grammar rather than each inventing one,
// so a deep link written by the service worker resolves whichever candidate is
// loaded — and `wbHash` writes BACK the prefix the page was loaded with, or a
// candidate would rewrite its own address bar into the shipped surface on the
// first tab click.
export type WbPrefix = 'v2' | 'brain-a' | 'brain-b' | 'brain-c'

/**
 * The prefix a hash should be WRITTEN with. `v2c` is read-only compatibility for
 * tournament-era ballot links, so it resolves and is then rewritten as `v2`:
 * two ids that both resolve is a shim, not two routes.
 */
export function prefixOf(hash: string): WbPrefix {
  const m = hash.match(/^#exp\/(brain-[abc])(?:[/?]|$)/)
  return (m?.[1] as WbPrefix) ?? 'v2'
}

// Read ONCE, from the hash the page was loaded with. A later navigation inside
// the app cannot change which candidate is mounted, so neither may this.
export const WB_PREFIX: WbPrefix = prefixOf(
  typeof location === 'undefined' ? '' : location.hash,
)

// A thread or turn id off the address bar is a database id from an untrusted
// string. It is validated here rather than in the hook so a mistyped link
// resolves to the surface with nothing focused instead of issuing a query.
// Deliberately a local copy and not an import from the data layer: the router
// must not drag the supabase client in behind it.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Jobs that no longer exist, and where they went. Both of these were REAL URLs
// Ivan (and any bookmark, any ballot link) could be sitting on when the Inbox
// job was absorbed into DMs, so they resolve instead of silently falling back to
// a default that happens to be right today and wrong after the next rename.
// `wbHash` only ever WRITES the canonical id, so an alias is read-once and then
// rewritten in the address bar.
const JOB_ALIAS: Record<string, Job> = { inbox: 'dms', drafts: 'dms' }

export function parseWbHash(hash: string): WbRoute {
  const m = hash.match(/^#exp\/(?:v2c?|brain-[abc])(?:\/([^/?]*))?(?:\/([^/?]*))?(?:\?([^#]*))?/)
  if (!m) return DEFAULT_ROUTE
  const seg = m[1] ?? ''
  const job = (JOBS as string[]).includes(seg)
    ? (seg as Job)
    : JOB_ALIAS[seg] ?? DEFAULT_ROUTE.job
  // Only 'chat' is addressable as a focus: a thread/draft peer key is a database
  // id, and a URL that pretends to restore one would 404 into an empty pane.
  // 'ask' is what a push notification for a finished turn links to (inbox-turn-run
  // writes ./#exp/v2/ask?thread=…). It is not a job: it means "the Claude pane over
  // the default job", so on desktop the pane docks and on the phone the candidate
  // opens Ask from `thread`/`turn`.
  const focus = m[2] === 'chat' || m[1] === 'chat' || m[1] === 'ask' ? 'chat' : null
  // '#exp/v2c/chat' means "chat over the default job", not "a job named chat".
  const q = new URLSearchParams(m[3] ?? '')
  const thread = q.get('thread')
  const turn = q.get('turn')
  const feed = q.get('feed')
  return {
    job,
    focus,
    // Only present when they are real. An absent key and a key holding garbage
    // must not read the same to a caller doing `if (route.thread)`.
    ...(thread && UUID.test(thread) ? { thread } : {}),
    ...(turn && UUID.test(turn) ? { turn } : {}),
    ...(feed === '1' || feed === 'true' ? { feed: true } : {}),
  }
}

export function wbHash(job: Job, focus: PeerKey | null, prefix: WbPrefix = WB_PREFIX): string {
  const tail = focus === 'chat' ? '/chat' : ''
  return `#exp/${prefix}/${job}${tail}`
}
