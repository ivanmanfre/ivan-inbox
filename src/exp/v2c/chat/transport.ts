import type { ChatEvent, ChatRequest, ChatTransport } from './events'
import { mockFlag } from '../mock'

// ---------------------------------------------------------------------------
// THE ONE SWAPPABLE MODULE.
//
// Phase 2 judges composition, so this file is a stub: it emits the exact frame
// sequence the real broker will (spec §2.1) with realistic pacing, and nothing
// in this candidate calls Railway, an edge function, or a Supabase function.
// Phase 3 adds httpTransport() below and flips getTransport() — no component,
// hook, or type changes.
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

export function getTransport(): ChatTransport {
  // Phase 3: return httpTransport when the inbox-claude edge function exists.
  return mockTransport
}

// True while chat cannot actually reach Claude, so the surface can say so once,
// quietly, instead of implying a live connection.
export const TRANSPORT_IS_MOCK = true
