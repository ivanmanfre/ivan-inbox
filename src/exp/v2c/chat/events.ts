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
  // What Ivan is looking at while he asks. Sent as PROSE inside the prompt by
  // the caller, never as a structured field the broker forwards: phase0's fence
  // says the browser may not hand the broker anything that scopes an instance.
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
}

export type ChatStatus = 'idle' | 'sending' | 'streaming'
