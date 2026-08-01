import { useCallback, useEffect, useRef, useState } from 'react'
import { getTransport } from './chat/transport'
import { createPacer } from './chat/pacer'
import type { ChatStatus, ToolCall, Turn } from './chat/events'

// Chat state is owned HERE, mounted once by Shell, never inside the pane.
//
// Spec §2.7: the requirement is the mirror image of the realtime-channel rule.
// There, the rule is "namespace the topic so two mounts don't collide"; here it
// is "mount exactly once, and keep it alive", specifically so switching jobs,
// undocking the pane, or a mobile takeover cannot tear down an in-flight turn.
// If the VIEW unmounts mid-stream the fetch keeps running because it is owned by
// this hook; re-mounting the view re-reads already-current state. No data lost,
// no double request.
//
// It also means the pane and the mobile takeover are the SAME conversation. A
// workbench where the desktop pane and the phone screen held two separate
// transcripts would not be a workbench.

// Cold-start latency on the Railway container is real. A client-side timer says
// so rather than leaving a spinner to imply nothing is happening.
const SLOW_MS = 4000

// How much transcript travels with a turn. The upstream starts a fresh CLI session
// every time, so this replay is the ONLY continuity that exists — and it is also
// billed, so it is bounded rather than unbounded. Six turns is roughly three
// exchanges, which is what "carry on that thought" actually needs.
export const CONTEXT_TURNS = 6
const CONTEXT_CHARS = 1200

/**
 * The context block, as prose. Exported and pure because the ONE thing that must
 * never drift here is what leaves the browser: no working directory, no client id,
 * no workspace — a transcript and a sentence naming what is on screen.
 */
export function buildContext(turns: Turn[], about?: string): string | undefined {
  const lines: string[] = []
  if (about) lines.push(`The operator is looking at: ${about}`)
  const tail = turns.slice(-CONTEXT_TURNS)
  for (const t of tail) {
    const who = t.role === 'user' ? 'Ivan' : 'You'
    const body = t.text.trim().slice(0, CONTEXT_CHARS)
    if (body) lines.push(`${who}: ${body}`)
  }
  return lines.length ? lines.join('\n\n') : undefined
}

let seq = 0
const nextId = () => `t${++seq}`

export type ChatHandle = ReturnType<typeof useChat>

export function useChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [streamText, setStreamText] = useState('')
  const [streamTools, setStreamTools] = useState<ToolCall[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const lastSent = useRef<{ prompt: string; about?: string } | null>(null)
  const alive = useRef(true)
  // `send` is memoised on sessionId, so it cannot close over the current turns.
  // A ref keeps the context block reading the live transcript instead of the one
  // that existed when the callback was built.
  const turnsRef = useRef<Turn[]>(turns)
  turnsRef.current = turns
  useEffect(() => () => { alive.current = false; abortRef.current?.abort() }, [])

  const send = useCallback(async (prompt: string, about?: string) => {
    const text = prompt.trim()
    if (!text || abortRef.current) return
    lastSent.current = { prompt: text, about }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // The transcript replayed as prose IS the continuity — the upstream never
    // resumes a session — and the label of whatever pane Ivan is looking at rides
    // with it as a sentence, never as a structured scoping field.
    const context = buildContext(turnsRef.current, about)
    setTurns(t => [...t, { id: nextId(), role: 'user', text, tools: [], error: null, about }])
    setStreamText('')
    setStreamTools([])
    setStatus('sending')
    setSlow(false)
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS)

    // The pacer holds the authoritative text of the in-flight turn; `acc` is what
    // gets committed to the transcript, so a turn that ends before the pacer has
    // drained never loses characters.
    let acc = ''
    const pacer = createPacer(shown => { if (alive.current) setStreamText(shown) })
    const tools: ToolCall[] = []
    let failed: { message: string; retryable: boolean } | null = null
    let aborted = false
    let landed: { costUsd: number | null; durationMs: number | null } | null = null

    try {
      for await (const ev of getTransport()({ prompt: text, sessionId, context, signal: ctrl.signal })) {
        if (!alive.current) break
        switch (ev.type) {
          case 'session':
            setSessionId(ev.sessionId)
            setModel(ev.model)
            break
          case 'status':
            if (ev.status === 'started') { setStatus('streaming'); setSlow(false) }
            break
          case 'text':
            setStatus('streaming')
            acc += ev.delta
            pacer.push(ev.delta)
            break
          case 'tool_use':
            setStatus('streaming')
            tools.push({ id: ev.id, tool: ev.tool, input: ev.input })
            setStreamTools([...tools])
            break
          case 'error':
            failed = { message: ev.message, retryable: ev.retryable }
            break
          case 'aborted':
            aborted = true
            break
          case 'done':
            landed = { costUsd: ev.costUsd, durationMs: ev.durationMs }
            break
        }
      }
    } catch (e) {
      failed = { message: e instanceof Error ? e.message : 'Chat failed', retryable: true }
    } finally {
      clearTimeout(slowTimer)
      pacer.flush()
      pacer.stop()
      abortRef.current = null
      if (alive.current) {
        // Whatever streamed before a failure is kept. Discarding half an answer
        // to show a red box loses the useful part of the turn.
        if (acc || tools.length || failed || aborted) {
          setTurns(t => [...t, {
            id: nextId(), role: 'assistant', text: acc, tools,
            error: failed, aborted: aborted || undefined,
            // Telemetry lands ON the turn (v2a's graft), so a transcript scrolled
            // back through still says what each answer cost and how long it took.
            costUsd: landed?.costUsd ?? null,
            durationMs: landed?.durationMs ?? null,
          }])
        }
        setStreamText('')
        setStreamTools([])
        setStatus('idle')
        setSlow(false)
      }
    }
  }, [sessionId])

  // Abort is client-side and immediate — spec §2.3: do not wait for a server
  // acknowledgement that may never arrive.
  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const retry = useCallback(() => {
    const last = lastSent.current
    if (!last || abortRef.current) return
    // Drop the failed assistant turn and its user turn, then re-send: a retry
    // that stacked a second copy of the question would be a worse transcript.
    setTurns(t => {
      const out = [...t]
      while (out.length && out[out.length - 1].role === 'assistant') out.pop()
      if (out.length && out[out.length - 1].role === 'user') out.pop()
      return out
    })
    void send(last.prompt, last.about)
  }, [send])

  const busy = status !== 'idle'

  return {
    turns, status, busy, streamText, streamTools, sessionId, model, slow,
    send, abort, retry,
  }
}
