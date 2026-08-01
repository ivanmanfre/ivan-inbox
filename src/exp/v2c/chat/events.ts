// The wire contract, normalized. Phase 1's chat-port spec (§2.1) fixes the frame
// set the broker will emit: session → status → text deltas → tool_use → done,
// with error and aborted as terminal alternatives. The client never branches on
// CLI internals (sdkMsg.message.content[n].type) — that translation is the
// broker's job, and this union is the only shape any component here knows.

export type ChatEvent =
  | { type: 'session'; sessionId: string; model: string }
  // Between "accepted" and "first token" there is real cold-start latency on the
  // Railway container. A named frame for it beats a spinner that means nothing.
  | { type: 'status'; status: 'queued' | 'started'; note?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; tool: string; input: unknown }
  | { type: 'done'; costUsd: number | null; durationMs: number | null }
  // retryable distinguishes "the broker is down, try again" from "this request
  // will never work" (a 403, a refused prompt) — the composer keeps its text
  // either way (spec §2.3: never clear the draft on error).
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'aborted' }

export type ChatRequest = {
  prompt: string
  sessionId: string | null
  // What Ivan is looking at while he asks, plus the transcript so far. PROSE, and
  // only prose — phase0's fence says the browser may not hand the broker anything
  // that scopes an instance, so there is deliberately no field here for a
  // workspace, a working directory or a client id.
  //
  // It carries the transcript because the upstream `POST /chat/stream` never reads
  // session_id and never passes --resume (main.py:773-866): every turn is a fresh
  // CLI session server-side, so this replay IS the continuity. The surface says so
  // out loud rather than implying a memory that does not exist.
  context?: string
  signal?: AbortSignal
}

// One swappable module. Phase 3 replaces the implementation behind getTransport()
// with the bare-fetch SSE reader against the inbox-claude edge function; nothing
// else in this candidate changes.
export type ChatTransport = (req: ChatRequest) => AsyncGenerator<ChatEvent>

// ---- transcript model ----

export type ToolCall = { id: string; tool: string; input: unknown }

export type Turn = {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolCall[]
  // Assistant turns only. An errored turn keeps whatever text streamed before
  // the failure — throwing away half an answer to show a red box is worse.
  error: { message: string; retryable: boolean } | null
  aborted?: boolean
  // What the turn was asked ABOUT (a thread, a draft). Rendered as a chip on the
  // user turn so the transcript still makes sense a day later.
  about?: string
  // Per-turn telemetry, grafted from v2a. Nobody asked for it; on a Claude Code
  // surface the difference between a 2s answer and a 9s one is the thing you
  // actually feel, and it belongs on the turn rather than on the pane, so an old
  // turn still says what it cost. `costUsd` stays null against the real broker,
  // which reports none — a missing number beats an invented one.
  costUsd?: number | null
  durationMs?: number | null
}

// The outcome of an assistant turn as one value, so the dot, the label and the
// retry affordance cannot disagree about what happened.
export function turnOutcome(t: Turn): 'ok' | 'error' | 'aborted' {
  if (t.error) return 'error'
  if (t.aborted) return 'aborted'
  return 'ok'
}

export type ChatStatus = 'idle' | 'sending' | 'streaming'
