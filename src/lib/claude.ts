// claude.ts — the real transport to the inbox-claude broker.
//
// Tournament candidates render against a mock that emits this same event shape,
// so wiring the winner means swapping the transport module and nothing else.
//
// Two things about this path are worth knowing before you change it:
//
// 1. Bare fetch(), never supabase.functions.invoke(). invoke() adds an
//    X-Client-Info header that dies in the CORS preflight of functions in this
//    project (the rule and its scar are recorded at src/lib/today.ts:6-8).
// 2. The upstream POST /chat/stream never reads session_id, never touches its
//    session dict and never passes --resume (main.py:773-866), so every turn is
//    a fresh CLI session server-side. The only continuity that exists is the
//    transcript we replay in `context`. Do not present a "session" as if the
//    server remembers one; it does not.
import { supabase } from './supabase'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-claude`

export type ClaudeEvent =
  | { kind: 'status'; text: string }
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; name: string; detail?: string }
  | { kind: 'done' }
  | { kind: 'error'; code: ClaudeErrorCode; detail?: string }

// Distinct codes so the UI can say what actually broke. The reference
// implementation collapsed every failure into one "failed" string, which the
// Phase 1 voice/chat audit flagged as its worst usability defect (V4).
export type ClaudeErrorCode =
  | 'not_signed_in'
  | 'unauthenticated'
  | 'invalid_token'
  | 'forbidden_user'
  | 'broker_not_configured'
  | 'upstream_not_armed'
  | 'upstream_timeout'
  | 'upstream_unreachable'
  | 'upstream_error'
  // Emitted by the broker mid-stream if the relay itself breaks after headers
  // were already sent, so it cannot be reported as an HTTP status.
  | 'relay_broken'
  | 'prompt_too_long'
  | 'empty_prompt'
  | 'aborted'
  | 'unknown'

export const CLAUDE_ERROR_COPY: Record<ClaudeErrorCode, string> = {
  not_signed_in: 'Signed out. Sign in again to use Claude.',
  unauthenticated: 'Signed out. Sign in again to use Claude.',
  invalid_token: 'Your session expired. Sign in again.',
  forbidden_user: 'This account is not allowed to reach Claude.',
  broker_not_configured: 'Claude is not configured yet (broker missing settings).',
  // The expected state until Ivan sets RAILWAY_CLAUDE_API_KEY on the broker.
  // Say exactly that rather than "something went wrong".
  upstream_not_armed: 'Claude is not armed yet: the container key is not set on the broker.',
  upstream_timeout: 'Claude took too long and the turn was cut off.',
  upstream_unreachable: 'Cannot reach the Claude container.',
  upstream_error: 'The Claude container returned an error.',
  prompt_too_long: 'That message is too long to send.',
  empty_prompt: 'Nothing to send.',
  aborted: 'Stopped.',
  relay_broken: 'The connection to Claude dropped mid-answer.',
  unknown: 'Claude failed for an unrecognised reason.',
}

function classify(status: number, payload: string): { code: ClaudeErrorCode; detail?: string } {
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(payload) } catch { /* non-JSON upstream error */ }
  const raw = typeof body.error === 'string' ? body.error : ''
  const detail = typeof body.detail === 'string' ? body.detail : undefined
  // A 401 from the CONTAINER (surfaced by the broker as upstream_error with a
  // 401 in detail) means the broker has no container key — a different problem
  // from OUR caller being unauthenticated, and the user needs to be told which.
  if (raw === 'upstream_error' && detail?.includes('401')) return { code: 'upstream_not_armed', detail }
  const known: ClaudeErrorCode[] = [
    'unauthenticated', 'invalid_token', 'forbidden_user', 'broker_not_configured',
    'upstream_timeout', 'upstream_unreachable', 'upstream_error', 'prompt_too_long', 'empty_prompt',
  ]
  if (known.includes(raw as ClaudeErrorCode)) return { code: raw as ClaudeErrorCode, detail }
  if (status === 401) return { code: 'unauthenticated', detail }
  if (status === 403) return { code: 'forbidden_user', detail }
  return { code: 'unknown', detail: detail ?? payload.slice(0, 200) }
}

export type SendOptions = {
  context?: string
  signal?: AbortSignal
  onEvent: (e: ClaudeEvent) => void
}

/**
 * Send one turn. Resolves when the stream ends; never throws for expected
 * failures — those arrive as an 'error' event so the UI has exactly one path.
 */
export async function sendToClaude(prompt: string, opts: SendOptions): Promise<void> {
  const { onEvent, context, signal } = opts
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return onEvent({ kind: 'error', code: 'not_signed_in' })

  let res: Response
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt, ...(context ? { context } : {}) }),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) return onEvent({ kind: 'error', code: 'aborted' })
    return onEvent({
      kind: 'error', code: 'upstream_unreachable',
      detail: e instanceof Error ? e.message : undefined,
    })
  }

  if (!res.ok || !res.body) {
    const payload = await res.text().catch(() => '')
    const { code, detail } = classify(res.status, payload)
    return onEvent({ kind: 'error', code, detail })
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // SSE frames are separated by a blank line. Keep the trailing partial in
      // the buffer — splitting on every chunk boundary would shred a frame that
      // happens to straddle two network reads.
      const frames = buf.split('\n\n')
      buf = frames.pop() ?? ''
      for (const frame of frames) emit(frame, onEvent)
    }
    if (buf.trim()) emit(buf, onEvent)
    onEvent({ kind: 'done' })
  } catch (e) {
    if (signal?.aborted) onEvent({ kind: 'error', code: 'aborted' })
    else onEvent({
      kind: 'error', code: 'upstream_error',
      detail: e instanceof Error ? e.message : undefined,
    })
  } finally {
    reader.releaseLock()
  }
}

/** Parse one SSE frame into events. Exported for tests. */
export function emit(frame: string, onEvent: (e: ClaudeEvent) => void): void {
  const dataLines = frame.split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
  if (!dataLines.length) return
  const payload = dataLines.join('\n')
  if (payload === '[DONE]') return
  let obj: Record<string, unknown>
  try { obj = JSON.parse(payload) } catch { return onEvent({ kind: 'text', delta: payload }) }

  if (typeof obj.error === 'string') {
    return onEvent({
      kind: 'error',
      code: (obj.error as ClaudeErrorCode) ?? 'unknown',
      detail: typeof obj.detail === 'string' ? obj.detail : undefined,
    })
  }
  // The container streams Claude Code's own stream-json shapes. Map the ones we
  // render and ignore the rest rather than guessing at unknown types.
  const type = typeof obj.type === 'string' ? obj.type : ''
  if (type === 'assistant' || type === 'text' || typeof obj.text === 'string') {
    const delta = typeof obj.text === 'string' ? obj.text
      : typeof obj.delta === 'string' ? obj.delta : ''
    if (delta) onEvent({ kind: 'text', delta })
    return
  }
  if (type === 'tool_use' || obj.tool_name) {
    return onEvent({
      kind: 'tool',
      name: String(obj.tool_name ?? obj.name ?? 'tool'),
      detail: typeof obj.detail === 'string' ? obj.detail : undefined,
    })
  }
  if (type === 'system' || type === 'status') {
    const text = typeof obj.subtype === 'string' ? obj.subtype
      : typeof obj.message === 'string' ? obj.message : ''
    if (text) onEvent({ kind: 'status', text })
    return
  }
  if (type === 'result') onEvent({ kind: 'done' })
}
