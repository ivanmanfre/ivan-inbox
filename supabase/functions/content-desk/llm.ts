// The desk's one model call. Railway proxy only (no api.anthropic.com, no key
// of our own), instructions in the user turn, no `system` field. A refused or
// empty answer is retried, never used.

const env = (k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k)

import { dropToolBlocks, scan } from './parse.ts'

export const DESK_MODEL = () => env('DESK_MODEL') || 'claude-sonnet-5-5'

const REFUSAL = /\b(usage|session|rate|weekly) limit\b|limit reached|try again later|prompt injection|I can(?:'|no)t (?:follow|comply with) (?:these|those|the) instructions/i

export class LlmError extends Error {
  constructor(public code: string, msg: string) { super(msg) }
}

async function once(f: typeof fetch, base: string, key: string, model: string, prompt: string, maxTokens: number, timeoutMs: number, signal: AbortSignal): Promise<string> {
  const r = await f(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
      // Measured 11-18: thinking off answers a 30k brief in ~2-3 s; the desk's
      // answers are lookups and short calls, not deliberation.
      'x-proxy-thinking': 'off', 'x-proxy-caller': 'content-desk',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  if (!r.ok) throw new LlmError('status', `status ${r.status}`)
  const body = await r.json() as { content?: { type?: string; text?: string }[] }
  const text = (body.content ?? []).filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('').trim()
  if (!text) throw new LlmError('empty', 'empty')
  if (REFUSAL.test(text.slice(0, 400))) throw new LlmError('refused', 'refused')
  return text
}

/**
 * One desk answer. Tail-latency hedge: if the first call has not answered after
 * `hedgeMs`, a second identical call starts and the first good answer wins (the
 * other is aborted). Measured 11-18: the same prompt takes 2.8-6 s run to run,
 * with no queue wait on the proxy, so the slow tail is per call, not per load.
 * A refused or empty answer is never used; up to 3 rounds.
 */
export async function askDesk(prompt: string, opts: { maxTokens?: number; timeoutMs?: number; hedgeMs?: number; fetchImpl?: typeof fetch } = {}): Promise<{ text: string; ms: number; attempts: number; model: string; hedged: boolean }> {
  const base = (env('RAILWAY_CLAUDE_URL') ?? '').replace(/\/$/, '')
  const key = env('RAILWAY_CLAUDE_API_KEY')
  if (!base || !key) throw new LlmError('desk_llm_not_configured', 'The desk model is not configured.')
  const f = opts.fetchImpl ?? fetch
  const model = DESK_MODEL()
  const t0 = Date.now()
  const hedgeMs = opts.hedgeMs ?? Number(env('DESK_HEDGE_MS') ?? 4500)
  let last = ''
  let hedged = false
  for (let round = 1; round <= 3; round++) {
    const ctl = new AbortController()
    const calls: Promise<string>[] = []
    const start = () => calls.push(once(f, base, key, model, prompt, opts.maxTokens ?? 900, opts.timeoutMs ?? 45_000, ctl.signal))
    start()
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      let done = false
      const text = await new Promise<string>((resolve, reject) => {
        let failed = 0
        const hedge = () => { if (!done && calls.length === 1) { hedged = true; start(); settle(calls[1]) } }
        const settle = (p: Promise<string>) => p.then(
          (t) => { if (!done) { done = true; resolve(t) } },
          (e) => {
            last = e instanceof Error ? e.message.slice(0, 120) : String(e)
            failed++
            if (failed === 1 && calls.length === 1 && hedgeMs > 0) { hedge(); return } // fast failure: start the second at once
            if (failed === calls.length && !done) { done = true; reject(e) }
          })
        settle(calls[0])
        if (hedgeMs > 0) timer = setTimeout(hedge, hedgeMs)
      }).finally(() => { done = true; if (timer) clearTimeout(timer) })
      ctl.abort()
      return { text, ms: Date.now() - t0, attempts: round, model, hedged }
    } catch {
      ctl.abort()
    }
  }
  throw new LlmError('desk_llm_unavailable', `The desk model did not answer (${last}).`)
}

/**
 * Streams only what sits inside <reply>…</reply>, as it arrives. The tags after
 * the reply (actions, chips, reads) are parsed from the full text at the end.
 */
export class ReplyStreamer {
  private buf = ''
  private emitted = 0
  private write = false
  /**
   * The stream side of the ONE scanner (parse.ts scan, Sol r9 #2): only the top-level <reply> text is
   * streamed; a "<" not yet closed is held back. When the model acts first (its first top-level block
   * is <actions>), no prose is streamed at all: onWrite fires once and the server's own status line
   * goes out instead (Sol r9 #4).
   */
  constructor(private onText: (t: string) => void, private onWrite?: () => void) {}
  push(chunk: string) {
    this.buf += chunk
    if (this.write) return
    const sc = scan(this.buf)
    if (sc.first && sc.first !== 'reply') {
      if (sc.first === 'actions') { this.write = true; this.onWrite?.() }
      return
    }
    if (sc.reply == null) return
    let r = sc.reply
    const lt = r.lastIndexOf('<')
    if (lt >= 0 && r.indexOf('>', lt) < 0) r = r.slice(0, lt)
    if (this.emitted === 0) { const lead = r.length - r.replace(/^\s+/, '').length; if (lead === r.length) return; this.emitted = lead }
    if (r.length > this.emitted) { this.onText(r.slice(this.emitted)); this.emitted = r.length }
  }
  get text() { return this.buf }
}

/**
 * One streamed desk answer through the proxy's opt-in token stream
 * (body stream:true + X-Proxy-Stream: 1). Hedge on the FIRST delta: if none has
 * arrived after `hedgeMs`, a second call starts and whichever speaks first wins.
 * Any failure before the first delta falls back to the buffered askDesk.
 */
export async function askDeskStream(prompt: string, onReply: (t: string) => void,
  opts: { maxTokens?: number; timeoutMs?: number; hedgeMs?: number; fetchImpl?: typeof fetch; onWrite?: () => void } = {}): Promise<{ text: string; ms: number; ttft_ms: number | null; model: string; hedged: boolean; streamed: boolean }> {
  const base = (env('RAILWAY_CLAUDE_URL') ?? '').replace(/\/$/, '')
  const key = env('RAILWAY_CLAUDE_API_KEY')
  if (!base || !key) throw new LlmError('desk_llm_not_configured', 'The desk model is not configured.')
  const f = opts.fetchImpl ?? fetch
  const model = DESK_MODEL()
  const t0 = Date.now()
  const hedgeMs = opts.hedgeMs ?? Number(env('DESK_STREAM_HEDGE_MS') ?? 3500)
  const ctls: AbortController[] = []
  let winner = -1
  let ttft: number | null = null
  let hedged = false

  const run = (idx: number) => new Promise<string>((resolve, reject) => {
    const ctl = new AbortController(); ctls[idx] = ctl
    const streamer = new ReplyStreamer((t) => { if (winner === idx) onReply(t) }, () => { if (winner === idx) opts.onWrite?.() })
    ;(async () => {
      const r = await f(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
          'x-proxy-thinking': 'off', 'x-proxy-caller': 'content-desk', 'x-proxy-stream': '1',
          // Planning questions reasoned silently for 9-14 s at the proxy's fixed effort "high"
          // (measured 11-18); the desk asks for its own level on the stream path.
          ...(env('DESK_EFFORT') ? { 'x-proxy-effort': env('DESK_EFFORT')! } : {}) },
        body: JSON.stringify({ model, max_tokens: opts.maxTokens ?? 900, stream: true, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(opts.timeoutMs ?? 60_000)]),
      })
      if (!r.ok || !r.body) throw new LlmError('status', `status ${r.status}`)
      if (!(r.headers.get('content-type') ?? '').includes('text/event-stream')) throw new LlmError('not_streamed', 'proxy answered without a stream')
      const reader = r.body.getReader(); const dec = new TextDecoder(); let sbuf = ''; let got = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        sbuf += dec.decode(value, { stream: true })
        let i
        while ((i = sbuf.indexOf('\n\n')) >= 0) {
          const frame = sbuf.slice(0, i); sbuf = sbuf.slice(i + 2)
          const ev = frame.match(/^event: (.+)$/m)?.[1]
          const data = frame.match(/^data: (.+)$/m)?.[1]
          if (!data) continue
          let d: { delta?: { text?: string }; error?: { message?: string } }
          try { d = JSON.parse(data) } catch { continue }
          if (ev === 'error') throw new LlmError('stream_error', d.error?.message ?? 'stream error')
          if (ev === 'content_block_delta' && typeof d.delta?.text === 'string') {
            if (!got) {
              got = true
              if (winner < 0) { winner = idx; ttft = Date.now() - t0; ctls.forEach((c, j) => { if (j !== idx) c?.abort() }) }
            }
            if (winner !== idx) { ctl.abort(); return reject(new LlmError('lost', 'lost the race')) }
            streamer.push(d.delta.text)
          }
        }
      }
      const text = streamer.text.trim()
      if (!text) throw new LlmError('empty', 'empty')
      if (REFUSAL.test(text.slice(0, 400))) throw new LlmError('refused', 'refused')
      resolve(text)
    })().catch(reject)
  })

  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const text = await new Promise<string>((resolve, reject) => {
      let failed = 0, started = 1
      const second = () => { started = 2; hedged = true; run(1).then(resolve, onFail(1)) }
      const onFail = (idx: number) => (e: unknown) => {
        failed++
        if (winner === idx) return reject(e)                                   // the speaker failed mid-answer
        if (started === 1 && hedgeMs > 0 && winner < 0) return second()        // fast failure: try the second at once
        if (failed >= started) reject(e)
      }
      run(0).then(resolve, onFail(0))
      if (hedgeMs > 0) timer = setTimeout(() => { if (winner < 0 && started === 1) second() }, hedgeMs)
    }).finally(() => { if (timer) clearTimeout(timer) })
    return { text, ms: Date.now() - t0, ttft_ms: ttft, model, hedged, streamed: true }
  } catch (e) {
    ctls.forEach((c) => c?.abort())
    if (winner >= 0) throw e // it already spoke; a half answer is an error, not a retry
    const b = await askDesk(prompt, { maxTokens: opts.maxTokens, fetchImpl: opts.fetchImpl })
    // the same rule on the buffered path: a write turn streams no prose
    const sc = scan(b.text)
    if (sc.first === 'actions' || (sc.actions ?? '').trim()) opts.onWrite?.()
    else onReply(parseReply(b.text))
    return { text: b.text, ms: Date.now() - t0, ttft_ms: Date.now() - t0, model, hedged: b.hedged, streamed: false }
  }
}

function parseReply(text: string): string {
  // the one scanner: the top-level reply, else the loose text; an unclosed tool block cuts the rest
  return dropToolBlocks(text).trim()
}
