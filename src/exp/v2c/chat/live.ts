// live — the pure logic of the LIVE CONVERSATION loop.
//
// The loop itself (mic → fast lane → speech → mic) is driven by useLive.ts on
// top of the EXISTING voice reducer in voice.ts — that machine did not change,
// which is the point of having one: SPEAKING still has no path that arms the
// mic, and the tests that assert it keep passing. This file owns what the
// loop DECIDES, so every decision is unit-tested without a browser:
//
//   - the fast lane's SSE frames (raw Anthropic Messages stream, relayed
//     verbatim by supabase/functions/inbox-fast) → text deltas
//   - the <<ESCALATE: …>> contract — detecting it, splitting the spoken
//     acknowledgment from the machine-read task
//   - history trimming, turn caps, and how a completed pipeline result is
//     fed back for the fast lane to speak

export type LiveMsg = { role: 'user' | 'assistant'; content: string }

// Cap the running loop conversation. ~12 turns is minutes of talk; the fn
// enforces its own ceiling too, this keeps the paid prompt small.
export const LIVE_HISTORY_TURNS = 12

// The loop auto-disarms after this many completed turns — a voice loop left
// open in a pocket must not talk to a paid API forever.
export const LIVE_TURN_CAP = 30

// End-of-utterance: this much silence after speech commits the utterance.
export const EOU_SILENCE_MS = 800

// A completed escalation result is trimmed to this before the fast lane is
// asked to speak a summary — the full text is already in the chat pane.
export const RESULT_FEED_CHARS = 600

/** Keep the newest turns, never splitting below one user turn. */
export function trimHistory(msgs: LiveMsg[], cap = LIVE_HISTORY_TURNS): LiveMsg[] {
  const out = msgs.slice(-cap)
  // The API requires the first message to be a user turn.
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

/**
 * The escalation contract, exactly as the fast lane's system prompt states
 * it: one line `<<ESCALATE: task>>`, plus a short spoken acknowledgment
 * around it. Returns the task and the reply with the machine line REMOVED —
 * the token must never be spoken and never rendered.
 */
export function detectEscalation(reply: string): { spoken: string; task: string } | null {
  const m = reply.match(/<<ESCALATE:\s*([\s\S]*?)>>/)
  if (!m) return null
  const task = m[1].trim()
  if (!task) return null
  const spoken = reply.replace(/<<ESCALATE:[\s\S]*?>>/g, ' ').replace(/\s+/g, ' ').trim()
  return { spoken, task }
}

/**
 * A finished pipeline turn, shaped for the fast lane to summarize aloud.
 * Prefixed with the marker its system prompt names, and hard-capped —
 * a 4,000-char CLI answer read back verbatim is the failure mode.
 */
export function resultFeed(text: string, cap = RESULT_FEED_CHARS): string {
  const t = text.replace(/```[\s\S]*?```/g, ' (code omitted) ').replace(/\s+/g, ' ').trim()
  return `[work result] ${t.length <= cap ? t : `${t.slice(0, cap)}…`}`
}

// ---------------------------------------------------------------------------
// The fast lane's SSE stream. inbox-fast relays Anthropic's Messages stream
// verbatim (event:/data: frames); the only shapes the loop needs are
// content_block_delta→text_delta and message_stop. Everything else is ignored
// rather than guessed at.
// ---------------------------------------------------------------------------

export type FastEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; detail: string }
  | { kind: 'ignore' }

/** One SSE frame (the text between blank lines) → one event. */
export function parseFastFrame(frame: string): FastEvent {
  const dataLines = frame.split('\n')
    .filter(l => l.startsWith('data:'))
    .map(l => l.slice(5).trim())
  if (!dataLines.length) return { kind: 'ignore' }
  let obj: Record<string, unknown>
  try { obj = JSON.parse(dataLines.join('')) } catch { return { kind: 'ignore' } }
  const type = typeof obj.type === 'string' ? obj.type : ''
  if (type === 'content_block_delta') {
    const delta = obj.delta as { type?: string; text?: string } | undefined
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return { kind: 'delta', text: delta.text }
    }
    return { kind: 'ignore' }
  }
  if (type === 'message_stop') return { kind: 'done' }
  if (type === 'error') {
    const err = obj.error as { message?: string } | undefined
    return { kind: 'error', detail: err?.message ?? 'stream error' }
  }
  return { kind: 'ignore' }
}

/**
 * Incremental SSE buffer: feed raw chunks, get complete frames back plus the
 * unfinished remainder. Same discipline as claude.ts — a frame straddling two
 * network reads must never be shredded.
 */
export function splitSseBuffer(buf: string): { frames: string[]; rest: string } {
  const frames = buf.split('\n\n')
  const rest = frames.pop() ?? ''
  return { frames: frames.filter(f => f.trim()), rest }
}
