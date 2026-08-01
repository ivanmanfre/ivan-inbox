import type { ChatEvent, ChatRequest, ChatTransport } from './events'
import { mockFlag } from '../mock'
import { CLAUDE_ERROR_COPY, sendToClaude, type ClaudeErrorCode, type ClaudeEvent } from '../../../lib/claude'

// ---------------------------------------------------------------------------
// THE ONE SWAPPABLE MODULE — now swapped.
//
// Phase 2 judged composition against a stub. Phase 3 points it at the real
// broker: `src/lib/claude.ts` → `POST /functions/v1/inbox-claude`, Supabase-JWT
// gated, Railway key held as an edge secret. Nothing about the components, the
// hook or the event union changed to do it, which was the point of the seam.
//
// Three rules this file exists to keep:
//  1. The browser NEVER talks to Railway, and never sends `working_directory` or
//     `client_id`. Those fields do not exist in the request type; see
//     phase1-audit/skeptic-security.md — the parameter-based cross-tenant request
//     is the one vector the broker's shape actually closes, so nothing here may
//     reopen it. `context` is PROSE and nothing else.
//  2. The broker ships UNARMED on purpose: `RAILWAY_CLAUDE_API_KEY` is unset, so
//     a real turn returns `upstream_not_armed`. That is a distinct, nameable
//     state, and CLAUDE_ERROR_COPY already has the sentence for it. It must never
//     collapse into "something went wrong".
//  3. `retryable` is not decoration. An unarmed broker will not become armed by
//     pressing Retry, so that error must not offer one.
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function sessionId(seed: string): string {
  return hash(seed).toString(16).padStart(8, '0').slice(0, 8)
}

// Which failures a second attempt could plausibly fix. Everything else is a
// standing condition — a missing key, a refused user, a prompt over the limit —
// and offering Retry on one of those teaches the operator to distrust the button.
const RETRYABLE: ReadonlySet<ClaudeErrorCode> = new Set<ClaudeErrorCode>([
  'upstream_timeout', 'upstream_unreachable', 'upstream_error', 'relay_broken', 'unknown',
])

export function isRetryable(code: ClaudeErrorCode): boolean {
  return RETRYABLE.has(code)
}

/**
 * One broker event → zero or one client events. Pure, so the mapping is testable
 * without a network: `startedAt` is passed in rather than read off the clock.
 */
export function toChatEvent(
  e: ClaudeEvent, startedAt: number, now: number, seq: number,
): ChatEvent | null {
  switch (e.kind) {
    case 'status':
      // The broker's own progress lines ("init", a subtype). Named, not a spinner.
      return { type: 'status', status: 'started', note: e.text }
    case 'text':
      return { type: 'text', delta: e.delta }
    case 'tool':
      // /chat/stream forwards tool_use and never tool_result, so the input is
      // whatever detail came with it and there is no output to invent.
      return { type: 'tool_use', id: `${seq}:0`, tool: e.name, input: e.detail ? { detail: e.detail } : {} }
    case 'done':
      // The broker reports no cost. Duration is measured here, honestly, and cost
      // stays null rather than being estimated — an invented number on a
      // telemetry line is worse than a missing one.
      return { type: 'done', costUsd: null, durationMs: now - startedAt }
    case 'error':
      if (e.code === 'aborted') return { type: 'aborted' }
      return {
        type: 'error',
        message: e.detail && e.code === 'unknown'
          ? `${CLAUDE_ERROR_COPY[e.code]} (${e.detail})`
          : CLAUDE_ERROR_COPY[e.code],
        retryable: isRetryable(e.code),
      }
  }
}

/**
 * Turn a callback-style sender into the async generator the hook consumes. The
 * queue is what keeps back-pressure honest: deltas that arrive while the consumer
 * is rendering are buffered, never dropped.
 */
async function* bridge(
  start: (emit: (e: ChatEvent) => void) => Promise<void>,
): AsyncGenerator<ChatEvent> {
  const buf: ChatEvent[] = []
  let wake: (() => void) | null = null
  let finished = false
  const emit = (e: ChatEvent) => { buf.push(e); wake?.(); wake = null }
  const run = start(emit).finally(() => { finished = true; wake?.(); wake = null })
  for (;;) {
    while (buf.length) yield buf.shift()!
    if (finished) break
    await new Promise<void>(r => { wake = r })
  }
  // Surface a genuine throw (sendToClaude reports expected failures as events).
  await run
}

function httpStream(req: ChatRequest): AsyncGenerator<ChatEvent> {
  const startedAt = Date.now()
  return bridge(async emit => {
    // Cold-start latency on the container is real and happens BEFORE the first
    // frame, so the queued state is entered here rather than waiting for a
    // broker frame that only arrives once it is already working.
    emit({ type: 'status', status: 'queued' })
    let seq = 0
    let sawDone = false
    await sendToClaude(req.prompt, {
      context: req.context,
      signal: req.signal,
      onEvent: e => {
        if (e.kind === 'tool') seq += 1
        if (e.kind === 'done') {
          // claude.ts emits done on a clean stream end AND the container emits a
          // result frame; one turn, one done.
          if (sawDone) return
          sawDone = true
        }
        const out = toChatEvent(e, startedAt, Date.now(), seq)
        if (out) emit(out)
      },
    })
  })
}

export const httpTransport: ChatTransport = httpStream

// ---------------------------------------------------------------------------
// The stub is KEPT, behind a query flag, for exactly one reason: three of this
// surface's states cannot be produced by clicking against a healthy backend (a
// broker that dies before the stream opens, a stream that dies a third of the way
// in), and they are states the build is judged on. `?wbmock=chat:error-cold`
// reaches them. Nothing here is reachable without the query string.
// ---------------------------------------------------------------------------

// Three canned replies. Each exercises a different renderer path (prose only /
// prose + list + inline code / prose + a fenced block) so the pane can be judged
// on the shapes it will actually have to hold, not on lorem ipsum.
const REPLIES: { tools: { tool: string; input: unknown }[]; text: string }[] = [
  {
    tools: [
      { tool: 'Read', input: { file_path: 'src/hooks/useInbox.ts' } },
      { tool: 'Grep', input: { pattern: 'supabase.channel', glob: 'src/**/*.ts' } },
    ],
    text: `Two things are going on in that hook.

**The channel topic is a constant.** \`supabase.channel('inbox')\` hands back the *existing* channel for a topic, so a second mount binds \`postgres_changes\` to an already-subscribed channel and the effect throws. Every other hook namespaces with \`useId()\`.

**The refresh is unbounded.** \`fetchMessages()\` pages up to 20,000 rows in sequential 1,000-row requests, and it runs on mount, on every realtime event, and on every window focus.

The cheap half is one line; the expensive half is a cursor.`,
  },
  {
    tools: [
      { tool: 'Glob', input: { pattern: 'src/screens/**/*.tsx' } },
      { tool: 'Read', input: { file_path: 'src/screens/kpi/OverviewView.tsx', offset: 96, limit: 40 } },
      { tool: 'Edit', input: { file_path: 'src/styles.css', old_string: 'white-space:nowrap', new_string: 'white-space:normal' } },
    ],
    text: `Found it. The pill is \`.ov-over-lbl\` and it sits inside a hero tile that is one third of 390px minus padding — about 86px of measure.

- \`white-space:nowrap\` means it cannot break, so "103% of cap" clips to "103% of ca"
- the tile has \`min-width:0\`, so nothing else absorbs the overflow
- the gauge itself is fine — this is only the label

Giving it its own line under the sub-text costs nothing and keeps the honest over-cap hatching intact.`,
  },
  {
    tools: [{ tool: 'Bash', input: { command: 'npm run build', description: 'Type-check and bundle' } }],
    text: `Build is clean. The one thing worth knowing about that migration:

\`\`\`sql
-- an RPC's parameter list cannot be altered in place
drop function if exists inbox_range_kpis(text, date, date);
create function inbox_range_kpis(...)
\`\`\`

A \`create or replace\` with a changed signature silently leaves the old overload in place, and PostgREST then picks whichever one it feels like.`,
  },
]

async function* mockStream(req: ChatRequest): AsyncGenerator<ChatEvent> {
  const failMode = mockFlag('chat')
  const aborted = () => req.signal?.aborted === true

  yield { type: 'status', status: 'queued' }
  await sleep(120)
  if (aborted()) { yield { type: 'aborted' }; return }

  // The error path a real broker has BEFORE any stream opens: a 502 from
  // upstream, a 401 from the gateway. Spec §2.9: do not open a stream just to
  // error into it.
  if (failMode === 'error-cold') {
    yield { type: 'error', message: 'Broker unreachable (502). Nothing was sent.', retryable: true }
    return
  }

  yield { type: 'session', sessionId: sessionId(req.prompt + String(req.sessionId)), model: 'claude-opus-5' }
  await sleep(180)
  yield { type: 'status', status: 'started' }

  const pick = REPLIES[hash(req.prompt) % REPLIES.length]

  for (const [i, t] of pick.tools.entries()) {
    await sleep(260)
    if (aborted()) { yield { type: 'aborted' }; return }
    yield { type: 'tool_use', id: `${i}:0`, tool: t.tool, input: t.input }
  }

  // Deltas arrive in word-ish chunks, the way a token stream does. The pacer
  // (chat/pacer.ts) is what makes them read smoothly; the transport does not
  // pretend to be smooth.
  const chunks = pick.text.match(/\S+\s*/g) ?? []
  for (let i = 0; i < chunks.length; i++) {
    await sleep(i === 0 ? 220 : 14)
    if (aborted()) { yield { type: 'aborted' }; return }
    if (failMode === 'error-mid' && i === Math.floor(chunks.length / 3)) {
      // The other real error path: the stream died halfway. Whatever arrived
      // stays on screen.
      yield { type: 'error', message: 'Stream ended early — the broker dropped the connection.', retryable: true }
      return
    }
    yield { type: 'text', delta: chunks[i] }
  }

  await sleep(120)
  yield { type: 'done', costUsd: 0.0412, durationMs: 4180 }
}

export const mockTransport: ChatTransport = mockStream

// The stub only runs when a URL asked for it by name.
export function transportIsMock(): boolean {
  return mockFlag('chat') !== null
}

export function getTransport(): ChatTransport {
  return transportIsMock() ? mockTransport : httpTransport
}
