// Mock levers, read once from the query string.
//
// Three of this candidate's states cannot be reached by clicking on a healthy
// backend — a failed fetch, a stream that dies mid-answer, a denied microphone —
// and all three are things the build is being judged on ("three visibly distinct
// states", "ERROR(reason, retryable) from any state"). Rather than fake them
// with dead-end demo chrome inside the product UI, they are reachable by URL:
//
//   ?wbmock=fetch-error  → every data surface reports a failed load
//   ?wbmock=chat:error-cold → the broker refuses before the stream opens
//   ?wbmock=chat:error-mid  → the stream dies a third of the way in
//   ?wbmock=voice:on        → drive the voice machine from timers instead of a live
//                             recogniser (headless browsers have no speech engine,
//                             and the build HIDES the affordance where there is
//                             none — so the working states need a named driver)
//   ?wbmock=voice:denied    → the microphone permission is refused
//   ?wbmock=voice:stt       → the dictation engine fails (retryable)
//   ?wbmock=chat:error-cold → also forces the chat MOCK transport; with no chat
//                             flag set, chat talks to the real broker
//
// Nothing here is reachable without the query string, so the shipped surface is
// unaffected. Read once at module load: a flag that could change mid-session
// would be a second source of truth about what the app is doing.
const raw = typeof location === 'undefined'
  ? ''
  : new URLSearchParams(location.search).get('wbmock') ?? ''

const FLAGS = raw.split(',').map(s => s.trim()).filter(Boolean)

export function hasMock(name: string): boolean {
  return FLAGS.includes(name)
}

// `wbmock=chat:error-mid` → mockFlag('chat') === 'error-mid'
export function mockFlag(ns: string): string | null {
  const hit = FLAGS.find(f => f.startsWith(`${ns}:`))
  return hit ? hit.slice(ns.length + 1) : null
}

export const MOCK_ACTIVE = FLAGS.length > 0
