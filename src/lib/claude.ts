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

// The models the picker offers — the TRUTHFUL working set, probed against the
// deployed container on 2026-08-03 (goal-runs/inbox-usability-and-voice-live-
// 2026-08-03-out/phase4-model-probes.md):
//   - claude-opus-4-8: frames echo it back honestly. opus-4-7 and opus-4-6 map
//     to the SAME CLI "opus" alias upstream, so offering them was offering the
//     same model three times under three names — dropped as duplicates.
//   - claude-sonnet-4-6 and claude-haiku-4-5 (runs -20251001): both honoured.
//   - Claude 5 ids CANNOT run today: the container's MODEL_MAP rejects them on
//     /chat, and the /v1/messages "acceptance" is a cosmetic echo that silently
//     runs Sonnet. They are not offered.
// The broker (supabase/functions/inbox-claude) still allowlists the old 5-id
// set — a harmless SUPERSET of this list, deliberately left alone: the picker
// is the minimal truthful surface, the broker's list only refuses ids, and a
// drifted value would fail visibly with `model_not_allowed`, never silently.
export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', note: 'Most capable' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', note: 'Balanced' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: 'Fastest' },
] as const

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id']

/**
 * `null` means "whatever the container booted with". It is a real, distinct choice
 * and the only one that works today, so it is the default rather than a fallback
 * the UI slides into when a pick fails.
 */
export type ModelChoice = ClaudeModelId | null

export type ClaudeEvent =
  | { kind: 'status'; text: string }
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; name: string; detail?: string }
  // What the turn ACTUALLY ran on, read off the broker's X-Broker-Model response
  // header — never echoed back from what the client asked for. Those are different
  // facts and conflating them is how a silent fallback would hide.
  | { kind: 'model'; model: string; contextChars: number | null; shed: string[] }
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
  // The brain the broker assembles per turn could not be built — a cross-tenant
  // row, MEMORY.md unreachable with nothing cached, or over the char cap after the
  // full shed ladder. All fail closed: no turn runs on a half-assembled context.
  | 'context_assembly_failed'
  | 'context_over_cap'
  // Model plumbing. Three distinct facts, deliberately not one:
  //  - the client offered a model the broker's allowlist does not contain
  //  - the container is KNOWN not to honour a per-request model
  //  - the broker cannot confirm either way, and will not guess
  | 'model_not_allowed'
  | 'model_not_supported_upstream'
  | 'model_support_unknown'
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
  context_assembly_failed: 'Claude’s memory context could not be built, so the turn was not sent.',
  context_over_cap: 'Claude’s memory context is over the size cap and the turn was not sent.',
  model_not_allowed: 'That model is not one the broker will send.',
  // Says what is true and what to do, because this is the state the picker is in
  // today and will stay in until the container change lands.
  model_not_supported_upstream:
    'The container cannot take a per-turn model yet — it would quietly use its own. Switch back to the container default to send.',
  model_support_unknown:
    'The broker cannot confirm the container would honour that model, so it did not send. Switch back to the container default.',
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
    'context_assembly_failed', 'context_over_cap',
    'model_not_allowed', 'model_not_supported_upstream', 'model_support_unknown',
  ]
  if (known.includes(raw as ClaudeErrorCode)) return { code: raw as ClaudeErrorCode, detail }
  if (status === 401) return { code: 'unauthenticated', detail }
  if (status === 403) return { code: 'forbidden_user', detail }
  return { code: 'unknown', detail: detail ?? payload.slice(0, 200) }
}

export type SendOptions = {
  context?: string
  /**
   * `null` (or omitted) sends no `model` at all, which is the container default —
   * the only route that works until the upstream takes a per-request model. Any
   * other value is sent and either honoured or refused with a named error. It is
   * never quietly dropped, because a dropped model choice is indistinguishable
   * from an honoured one from the outside.
   */
  model?: ModelChoice
  signal?: AbortSignal
  onEvent: (e: ClaudeEvent) => void
}

/**
 * Send one turn. Resolves when the stream ends; never throws for expected
 * failures — those arrive as an 'error' event so the UI has exactly one path.
 */
export async function sendToClaude(prompt: string, opts: SendOptions): Promise<void> {
  const { onEvent, context, model, signal } = opts
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return onEvent({ kind: 'error', code: 'not_signed_in' })

  let res: Response
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt, ...(context ? { context } : {}), ...(model ? { model } : {}) }),
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

  // Read off the RESPONSE, before the first token. This is the honest answer to
  // "what am I talking to" — the broker's own account of what it forwarded, not
  // the client repeating its own request back to itself.
  const ranOn = res.headers.get('x-broker-model')
  if (ranOn) {
    const chars = Number(res.headers.get('x-broker-context-chars'))
    const shedHeader = res.headers.get('x-broker-context-shed') ?? 'none'
    onEvent({
      kind: 'model',
      model: ranOn,
      contextChars: Number.isFinite(chars) && chars > 0 ? chars : null,
      shed: shedHeader === 'none' ? [] : shedHeader.split(','),
    })
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
  // A REAL `assistant` frame nests its payload: {type:'assistant', message:
  // {content:[{type:'text',text},{type:'tool_use',name,input}]}}. The old
  // top-level read was written in Feb against a dead endpoint and could never
  // have seen a live frame — it silently dropped every reply.
  if (type === 'assistant') {
    const msg = obj.message as { content?: unknown } | undefined
    const content = Array.isArray(msg?.content) ? msg.content : []
    for (const item of content as Array<Record<string, unknown>>) {
      if (item?.type === 'text' && typeof item.text === 'string' && item.text) {
        onEvent({ kind: 'text', delta: item.text })
      } else if (item?.type === 'tool_use') {
        onEvent({
          kind: 'tool',
          name: String(item.name ?? 'tool'),
          detail: item.input ? JSON.stringify(item.input).slice(0, 200) : undefined,
        })
      }
    }
    return
  }
  if (type === 'text' || typeof obj.text === 'string') {
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
