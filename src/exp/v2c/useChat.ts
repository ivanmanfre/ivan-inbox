import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTransport, isRetryable } from './chat/transport'
import { createPacer } from './chat/pacer'
import type { ChatStatus, ToolCall, Turn } from './chat/events'
import { CLAUDE_ERROR_COPY, type ClaudeErrorCode } from '../../lib/claude'
import {
  abortTurn, getBotThread, getThread, getTurn, isUuid, latestThread, listTurnPage, markBotSeen, TURN_PAGE_SIZE, type TurnCursor,
  setBotPushMuted as writeBotPushMuted,
  type Thread, type TurnRow,
} from '../../lib/turns'
import { emptyOverKnown, keepIds, readThreadCache, writeThreadCache } from '../../lib/threadCache'

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
//
// ---------------------------------------------------------------------------
// db/049 changed what "the conversation" IS.
//
// A turn is now a ROW (`inbox_turns`), written the moment the broker accepts the
// prompt and FINISHED by a webhook that fires whether or not this tab is still
// open. So:
//
//   the stream is the fast path. The ROW is the truth.
//
// Everything below follows from that one sentence. The hook streams because
// watching an answer arrive is the whole feel of the surface, and then it goes
// back for the row and prefers what the row says. A phone that locked mid-answer,
// a tab closed on the train, a dropped connection — none of them lose a turn any
// more, because none of them were ever what was doing the work.
// ---------------------------------------------------------------------------

// Cold-start latency on the Railway container is real. A client-side timer says
// so rather than leaving a spinner to imply nothing is happening.
const SLOW_MS = 4000

// How much transcript travels with a turn WHEN THERE IS NO SESSION TO RESUME.
// This replay used to be the only continuity that existed (the upstream started a
// fresh CLI session every time). It is not any more: once the container holds
// this thread's session, replaying the transcript re-sends — and re-bills —
// something the model already has in front of it, so `send` stops sending it.
export const CONTEXT_TURNS = 6
const CONTEXT_CHARS = 1200

/**
 * The context block, as prose. Exported and pure because the ONE thing that must
 * never drift here is what leaves the browser: no working directory, no client id,
 * no workspace — a transcript and a sentence naming what is on screen.
 */
export function buildContext(turns: Turn[], about?: string, see?: string): string | undefined {
  const lines: string[] = []
  // `see` is the ATTACHED-CONTEXT block (chat/paneContext.ts): the chips Ivan
  // has left switched on, rendered verbatim so that what the pane prints and
  // what the pane sends are the same string. It supersedes the one-line `about`
  // label, which said only which pane was open; sending both would state the
  // same fact twice in two registers.
  if (see) lines.push(see)
  else if (about) lines.push(`The operator is looking at: ${about}`)
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

// A turn id is minted HERE, before the request, so the row the broker is about to
// write already has the name this tab will use to go looking for it.
export function mintTurnId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  // Insecure contexts (and old Safari) have no randomUUID. A v4-shaped id from
  // Math.random is weak as a secret and does not need to be one: it names a row
  // the database already scopes to this user.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16)
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// The localStorage projection, in the today.ts idiom: a WHITELIST, never a copy.
// Exactly one field of a thread is ever written here — its id — and it is
// validated as a uuid on the way back in. Nothing about a thread's contents (a
// title is the first 80 chars of a prompt, and prompts are Ivan's business) ever
// touches storage on this origin.
export const THREAD_KEY = 'wb-ask-thread'

export function readThreadKey(): string | null {
  try {
    const v = localStorage.getItem(THREAD_KEY)
    return isUuid(v) ? v : null
  } catch { return null }
}

function writeThreadKey(id: string | null): void {
  try {
    if (id) localStorage.setItem(THREAD_KEY, id)
    else localStorage.removeItem(THREAD_KEY)
  } catch { /* quota / private mode */ }
}

// ---------------------------------------------------------------------------
// rows → transcript (pure, so the hydration is testable without React)
// ---------------------------------------------------------------------------

export type Grounding = { session: 'new' | 'resumed'; groundedOn: string | null }

export function groundingOf(row: TurnRow): Grounding {
  const g = row.grounding as { summary_date?: unknown } | null
  return {
    session: row.resumed ? 'resumed' : 'new',
    groundedOn: typeof g?.summary_date === 'string' ? g.summary_date : null,
  }
}

const toolsOf = (row: TurnRow): ToolCall[] =>
  (row.tool_events ?? []).map((e, i) => ({
    id: `${row.id}:${i}`,
    tool: e?.name ?? 'tool',
    input: e?.summary ? { detail: e.summary } : {},
  }))

/** The assistant half of a row. A named error code becomes the sentence the pane already has for it. */
export function assistantFromRow(row: TurnRow): Turn {
  const code = (row.error_code ?? 'unknown') as ClaudeErrorCode
  return {
    id: nextId(),
    role: 'assistant',
    text: row.answer ?? '',
    tools: toolsOf(row),
    error: row.status === 'error'
      ? { message: CLAUDE_ERROR_COPY[code] ?? CLAUDE_ERROR_COPY.unknown, retryable: isRetryable(code) }
      : null,
    aborted: row.status === 'aborted' || undefined,
    costUsd: row.cost_usd ?? null,
    durationMs: row.duration_ms ?? null,
    turnId: row.id,
    status: row.status,
    sources: row.sources ?? [],
    origin: row.origin,
    // `finished_at` is when the ANSWER landed, which is the day the day
    // separator should count a turn under; a row still open has no
    // `finished_at` yet, so it falls back to when it was created.
    at: row.finished_at ?? row.created_at,
  }
}

/**
 * A thread's rows as a transcript. A row that is still queued or running
 * contributes its QUESTION only: there is no answer yet, and an empty assistant
 * bubble reads as a failure rather than as work in progress.
 */
export function turnsFromRows(rows: TurnRow[]): Turn[] {
  const out: Turn[] = []
  for (const row of rows) {
    out.push({
      id: nextId(), role: 'user', text: row.prompt, tools: [], error: null,
      turnId: row.id, status: row.status, origin: row.origin, at: row.created_at,
    })
    if (row.status === 'queued' || row.status === 'running') continue
    out.push(assistantFromRow(row))
  }
  return out
}

/**
 * Reconcile a row onto the transcript. The row wins on everything it HAS — it is
 * the truth, and the webhook writes the final answer the stream may have missed
 * the end of — but it never blanks something the stream already delivered: an
 * error row that carries no answer keeps the half-answer that streamed before
 * the failure, which is the rule this file has held since it was written.
 */
export function mergeRow(turns: Turn[], row: TurnRow): Turn[] {
  return putAnswer(turns, assistantFromRow(row), 'saved')
}

function putAnswer(turns: Turn[], answer: Turn, source: 'saved' | 'stream'): Turn[] {
  const at = turns.findIndex(t => t.role === 'assistant' && t.turnId === answer.turnId)
  if (at >= 0) {
    const prev = turns[at]
    // A completed database row can arrive on either side of the stream finalizer.
    const saved = source === 'saved' ? answer : prev
    const streamed = source === 'saved' ? prev : answer
    const out = [...turns]
    out[at] = {
      ...saved,
      id: prev.id,
      text: saved.text || streamed.text,
      tools: saved.tools.length ? saved.tools : streamed.tools,
      sources: saved.sources?.length ? saved.sources : streamed.sources,
      costUsd: saved.costUsd ?? streamed.costUsd ?? null,
      durationMs: saved.durationMs ?? streamed.durationMs ?? null,
    }
    return out
  }
  const ask = turns.findIndex(t => t.role === 'user' && t.turnId === answer.turnId)
  if (ask >= 0) {
    const out = [...turns]
    out.splice(ask + 1, 0, answer)
    return out
  }
  return [...turns, answer]
}

const OPEN = (s: string): boolean => s === 'queued' || s === 'running'

// The webhook usually lands within a second of the stream ending; 2 s is fast
// enough to feel immediate and slow enough not to hammer PostgREST from a phone.
// The ceiling matches the broker's own watchdog, which marks a turn `lost` at 15
// minutes — polling past the point where the server has given up would be the
// client telling itself a story.
const POLL_MS = 2000
export const POLL_MAX_MS = 15 * 60_000

export type ChatHandle = ReturnType<typeof useChat>

// P1 speed: the thread a cold open is about to hydrate, so its last-known turns
// paint in the first render (src/lib/threadCache.ts). An Ask push link names it.
function bootThreadId(): string | null {
  const m = typeof location === 'undefined' ? null : location.hash.match(/\/ask\?(?:.*&)?thread=([0-9a-f-]{36})/i)
  return m && isUuid(m[1]) ? m[1] : readThreadKey()
}
const cachedTurns = (id: string | null): Turn[] => readThreadCache(id, turnsFromRows)?.turns.slice(-2 * TURN_PAGE_SIZE) ?? []

type History = { threadId: string; headIds: string[]; before: TurnCursor | null; older: Turn[]; linked: Turn[] }

export function useChat() {
  const [turns, setTurns] = useState<Turn[]>(() => cachedTurns(bootThreadId()))
  // The turns on screen are the saved copy and the last read of the rows failed.
  const [history, setHistory] = useState<History | null>(null)
  const historyRef = useRef(history)
  historyRef.current = history
  const pendingFocus = useRef<{ threadId: string; turnId: string; reading: boolean } | null>(null)
  const [earlierState, setEarlierState] = useState<'idle' | 'loading' | 'error'>('idle')
  const olderRequest = useRef<symbol | null>(null)
  const [turnsStale, setTurnsStale] = useState(false)
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [streamText, setStreamText] = useState('')
  const [streamTools, setStreamTools] = useState<ToolCall[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Two different things, deliberately two states:
  //   `model`  — what the last turn ACTUALLY ran on, per the broker's response.
  //   `wanted` — what the operator has selected, null meaning container default.
  // Collapsing them is exactly how a silent fallback would hide: the picker would
  // keep showing Haiku while every turn ran on Opus.
  const [model, setModel] = useState<string | null>(null)
  const [wanted, setWanted] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  // ---- db/049 state ----
  const [threadId, setThreadId] = useState<string | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [turnsLoading, setTurnsLoading] = useState(false)
  const [grounding, setGrounding] = useState<Grounding | null>(null)
  // A turn is running that this tab is NOT streaming: hydration found it open.
  // The phone was locked, the tab was closed, the answer is still being written.
  const [runningElsewhere, setRunningElsewhere] = useState(false)
  // ---- db/060 state ----
  // The one bot thread, pinned in the shelf. Null until the tick has ever run,
  // and the chip is not rendered at all in that case: a pinned thread that does
  // not exist would be a control that leads nowhere.
  const [botThread, setBotThread] = useState<Thread | null>(null)
  // The handler above must not re-bind every time the bot row changes.
  const botRef = useRef<Thread | null>(null)
  botRef.current = botThread

  const abortRef = useRef<AbortController | null>(null)
  const lastSent = useRef<{ prompt: string; about?: string; see?: string; scanAlertTurnId?: string; onAccepted?: () => void } | null>(null)
  const alive = useRef(true)
  // `send` is memoised on sessionId, so it cannot close over the current turns.
  // A ref keeps the context block reading the live transcript instead of the one
  // that existed when the callback was built.
  const turnsRef = useRef<Turn[]>(turns)
  turnsRef.current = turns
  // Same reason, for the thread: `send` needs the CURRENT thread id and the
  // CURRENT session_started_at, not the ones that existed at memoisation.
  const threadIdRef = useRef<string | null>(null)
  const threadRef = useRef<Thread | null>(null)
  const turnIdRef = useRef<string | null>(null)
  const threadVisit = useRef(0)
  const getThreadVisit = useCallback(() => threadVisit.current, [])
  // Mutations observed while the current page read is in flight. A saved row
  // supersedes a stale page, and null marks a local turn without a receipt yet.
  const writesDuringHydrate = useRef<Map<string, TurnRow | null> | null>(null)
  const pollRef = useRef<{ id: string; until: number; timer: number } | null>(null)
  // Hydration generation. A cold boot with a cached id that is not the deep-linked
  // one runs two hydrations at once, and `alive` cannot tell them apart: last to
  // resolve wins setTurns and setThreadId, so the link Ivan tapped loses to the
  // thread he happened to read last. Every hydration takes a number and abandons
  // itself the moment a newer one starts.
  const hydrateGen = useRef(0)
  // ⚠ StrictMode-proof shape: dev double-invoke runs mount→cleanup→mount, and a
  // cleanup-only effect leaves `alive` permanently false after the rehearsal
  // unmount — which silently broke EVERY dev-mode turn (the loop bailed after
  // one event and the finalizer never cleared "Working"). Prod was never
  // affected. Setting it true in the body makes the flag survive the rehearsal.

  const stopPoll = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current.timer)
    pollRef.current = null
  }, [])

  // The thread row carries session_started_at, which is what decides whether the
  // NEXT turn replays the transcript. It is written by the completion webhook, so
  // the copy in state goes stale the moment a turn lands and has to be re-read.
  const refreshThread = useCallback(async () => {
    const id = threadIdRef.current
    if (!id) return
    const visit = threadVisit.current
    const turnId = turnIdRef.current
    try {
      const t = await getThread(id)
      if (!alive.current || visit !== threadVisit.current || turnId !== turnIdRef.current) return
      if (!t || t.id !== threadIdRef.current) return
      threadRef.current = t
      setThread(t)
    } catch { /* offline: the next send just replays a little more than it needs to */ }
  }, [])

  // The bot thread's own row, on its own schedule: the tick writes into it
  // whether or not this tab is looking, so the unread dot is only as honest as
  // the last time this was read. Never throws — an offline phone keeps the dot
  // it had rather than dropping the pin.
  const botRead = useRef<ReturnType<typeof getBotThread> | null>(null)
  const refreshBot = useCallback(async () => {
    const read = botRead.current ??= getBotThread()
    try {
      const b = await read
      if (!alive.current) return
      botRef.current = b
      setBotThread(b)
    } catch { /* offline: the chip keeps whatever it last knew */ }
    finally { if (botRead.current === read) botRead.current = null }
  }, [])

  const land = useCallback((row: TurnRow) => {
    writesDuringHydrate.current?.set(row.id, row)
    stopPoll()
    setTurns(t => mergeRow(t, row))
    setRunningElsewhere(false)
    setGrounding(groundingOf(row))
    if (row.ran_on) setModel(row.ran_on)
    void refreshThread()
  }, [refreshThread, stopPoll])

  /**
   * The ceiling. The server has given up on this row too, so saying nothing would
   * leave the pane telling Ivan forever that the answer will land here on its
   * own. Say it is lost, and let him send it again.
   */
  const giveUp = useCallback((id: string) => {
    stopPoll()
    setRunningElsewhere(false)
    const lost = {
      error: { message: CLAUDE_ERROR_COPY.lost, retryable: true },
      status: 'error' as const,
    }
    setTurns(t => {
      const at = t.findIndex(x => x.role === 'assistant' && x.turnId === id)
      if (at >= 0) {
        const out = [...t]
        out[at] = { ...out[at], ...lost }
        return out
      }
      const bubble: Turn = { id: nextId(), role: 'assistant', text: '', tools: [], turnId: id, ...lost }
      const ask = t.findIndex(x => x.role === 'user' && x.turnId === id)
      if (ask >= 0) {
        const out = [...t]
        out.splice(ask + 1, 0, bubble)
        return out
      }
      return [...t, bubble]
    })
  }, [stopPoll])

  const poll = useCallback(async (id: string, until: number) => {
    // Visibility can request a newer read of the same row while this one is in flight.
    const request = { id, until, timer: 0 }
    pollRef.current = request
    let row: TurnRow | null = null
    try { row = await getTurn(id) } catch { /* transient: try again on the next tick */ }
    if (!alive.current || pollRef.current !== request) return
    if (row?.id === id && row.thread_id === threadIdRef.current && !OPEN(row.status)) return land(row)
    if (Date.now() >= until) { giveUp(id); return }
    request.timer = window.setTimeout(() => {
      if (pollRef.current === request) void poll(id, until)
    }, POLL_MS)
  }, [giveUp, land])

  const armPoll = useCallback((id: string) => {
    stopPoll()
    const until = Date.now() + POLL_MAX_MS
    void poll(id, until)
  }, [poll, stopPoll])

  // One read of the row after the stream ends, whatever ended it. If the webhook
  // has already landed, the row replaces what streamed. If it has not, this arms
  // the poll that will.
  const settle = useCallback(async (id: string) => {
    let row: TurnRow | null = null
    try { row = await getTurn(id) } catch { /* the stream's own text stands */ }
    if (!alive.current || turnIdRef.current !== id || row?.id !== id) return
    if (threadIdRef.current && row.thread_id !== threadIdRef.current) return
    // The SSE connection may have dropped before the first turn frame identified a new chat.
    if (!threadIdRef.current) {
      threadIdRef.current = row.thread_id
      setThreadId(row.thread_id)
      writeThreadKey(row.thread_id)
    }
    if (OPEN(row.status)) { armPoll(id); return }
    land(row)
  }, [armPoll, land])

  const hydrate = useCallback(async (id?: string, focusId?: string) => {
    if (id && focusId) pendingFocus.current = { threadId: id, turnId: focusId, reading: false }
    const focus = pendingFocus.current?.threadId === id ? pendingFocus.current : null
    // A visibility wake may coincide with a notification read. That request
    // already includes the head page and owns the highlighted turn.
    if (focus?.reading) return
    if (focus) focus.reading = true
    const gen = ++hydrateGen.current
    const writes = new Map<string, TurnRow | null>()
    const localId = turnIdRef.current
    if (localId && (abortRef.current || turnsRef.current.some(turn =>
      turn.turnId === localId && turn.role === 'assistant' && !turn.status))) {
      writes.set(localId, null)
    }
    writesDuringHydrate.current = writes
    const stale = () => !alive.current || gen !== hydrateGen.current
    olderRequest.current = null
    setEarlierState('idle')
    setTurnsLoading(true)
    // Every hydrate re-reads the pin. The tick can have written a bot turn since
    // the last one, and the dot is the only thing on the shelf that says so.
    void refreshBot()
    try {
      const [known, firstPage] = id
        ? await Promise.all([getThread(id), listTurnPage(id, undefined, focus?.turnId)])
        : [null, null]
      const t = known ?? await latestThread()
      if (stale()) return
      if (id && t?.id !== id && turnIdRef.current) return
      if (!t) {
        // The cached id points at nothing any more (a thread deleted, another
        // account). Forget it rather than painting an id with no thread behind it.
        writeThreadKey(null)
        threadIdRef.current = null
        threadRef.current = null
        setThreadId(null)
        setThread(null)
        if (turnsRef.current.length > 0) setTurnsStale(true)
        return
      }
      const page = known && firstPage ? firstPage : await listTurnPage(t.id, undefined, t.id === id ? focus?.turnId : undefined)
      if (stale()) return
      if (id && t.id !== id && turnIdRef.current) return
      threadIdRef.current = t.id
      threadRef.current = t
      setThreadId(t.id)
      setThread(t)
      writeThreadKey(t.id)
      const previous = id && t.id !== id ? [] : turnsRef.current
      if (emptyOverKnown(previous, page.rows.length)) { setTurnsStale(true); return }
      const prior = historyRef.current?.threadId === t.id ? historyRef.current : null
      let older: Turn[] = []
      let before = page.before
      if (prior?.older.length) {
        // Only server-confirmed contiguous rows count as an overlap. A pinned
        // notification or a local optimistic send can sit beyond either end.
        const headIds = new Set(prior.headIds)
        const known = [...prior.older, ...previous.filter(turn => turn.turnId && headIds.has(turn.turnId))]
        const knownIds = new Set(known.map(turn => turn.turnId))
        const bridge: TurnRow[][] = []
        let edge = page
        let match = edge.rows.find(row => knownIds.has(row.id))
        const visited = new Set<string>()
        while (!match && edge.before) {
          if (visited.has(edge.before.id)) throw new Error('Repeated chat history cursor')
          visited.add(edge.before.id)
          edge = await listTurnPage(t.id, edge.before)
          if (stale()) return
          bridge.push(edge.rows)
          match = edge.rows.find(row => knownIds.has(row.id))
        }
        const between = bridge.reverse().flat()
        if (match) {
          const prefix = known.slice(0, known.findIndex(turn => turn.turnId === match.id))
          const overlap = between.findIndex(row => row.id === match.id)
          older = [...prefix, ...keepIds(known, turnsFromRows(overlap >= 0 ? between.slice(overlap) : []))]
          before = prior.before
        } else {
          older = turnsFromRows(between)
          before = edge.before
        }
      }
      const rows = page.rows.map(row => writes.get(row.id) ?? row)
      const headIds = new Set(rows.map(row => row.id))
      const fresh = turnsFromRows(rows)
      setHistory({ threadId: t.id, headIds: [...headIds], older, before,
        linked: page.linked ? turnsFromRows([page.linked]) : (!focus ? prior?.linked ?? [] : []) })
      if (focus === pendingFocus.current) pendingFocus.current = null
      setTurns(prev => {
        let head = keepIds(prev, fresh)
        for (const turn of prev) {
          if (!turn.turnId || !writes.has(turn.turnId)) continue
          if (!headIds.has(turn.turnId)) head.push(turn)
          else if (turn.role === 'assistant') head = putAnswer(head, turn, 'stream')
        }
        return head
      })
      setTurnsStale(false)
      const last = writes.get(turnIdRef.current ?? '') ?? rows[rows.length - 1]
      if (last) setGrounding(groundingOf(last))
      // A row still open with no local stream attached IS the "phone was locked"
      // state. Say so, and go and get the answer.
      const open = rows.find(r => OPEN(r.status))
      if (open && !abortRef.current) {
        setRunningElsewhere(true)
        armPoll(open.id)
      } else {
        const polledId = pollRef.current?.id
        if (polledId && rows.some(row => row.id === polledId && !OPEN(row.status))) stopPoll()
        setRunningElsewhere(false)
      }
    } catch {
      // Offline, or the views are not applied yet. The pane keeps whatever it
      // has and the next send still works — hydration is a convenience, not a
      // precondition for talking.
      if (!stale() && turnsRef.current.length > 0) setTurnsStale(true)
    } finally {
      if (writesDuringHydrate.current === writes) writesDuringHydrate.current = null
      if (focus) focus.reading = false
      if (!stale()) setTurnsLoading(false)
    }
  }, [armPoll, refreshBot, stopPoll])

  useEffect(() => {
    alive.current = true
    // The pin is read on mount whichever way this mount was entered: a deep link
    // takes the branch below without calling hydrate here, and the shelf would
    // otherwise have no chip until the next hydration.
    void refreshBot()
    // A deep link may already own this mount. Child effects run before a parent's,
    // so a shell that read `?thread=` has already called openThread and its
    // hydration is in flight. Painting the cached id over it is exactly how the
    // link Ivan tapped loses to the thread he happened to read last.
    if (!threadIdRef.current) {
      // Paint the cached id immediately, verify it over the network second: the
      // today.ts pattern, so a cold launch on a train shows the thread it is about
      // to fill rather than an empty pane that then jumps.
      const cached = readThreadKey()
      if (cached) {
        threadIdRef.current = cached
        setThreadId(cached)
      }
      void hydrate(cached ?? undefined)
    }
    return () => {
      alive.current = false
      abortRef.current?.abort()
      stopPoll()
    }
    // MOUNT ONLY, and the empty dep array is load-bearing rather than lazy: this
    // effect's cleanup aborts the in-flight stream, so a re-run would kill a live
    // turn. hydrate and stopPoll are stable by construction (every callback in
    // that chain has stable deps down to two empty-dep ones), which is what makes
    // omitting them correct instead of merely quiet.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A backgrounded tab's timers are throttled to the point of stopping, so the
  // answer that landed while the phone was in a pocket is fetched the instant it
  // comes back rather than up to two throttled minutes later.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      // db/060: the tick runs on a clock, not on a tap, so coming back to the
      // tab is the moment to ask whether Claude said anything. And if the bot
      // thread is the one on screen, re-read its TURNS as well: a bot turn that
      // landed while the phone was locked has no stream and no poll behind it,
      // so nothing else would ever put it on the glass without a reload.
      void refreshBot()
      const open = threadIdRef.current
      if (open && botRef.current && open === botRef.current.id) void hydrate(open)
      const p = pollRef.current
      if (!p) return
      clearTimeout(p.timer)
      void poll(p.id, p.until)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [hydrate, poll, refreshBot])

  const send = useCallback(async (
    prompt: string, about?: string, see?: string, scanAlertTurnId?: string, onAccepted?: () => void,
  ) => {
    const text = prompt.trim()
    if (!text || abortRef.current) return
    const submission = { prompt: text, about, see, scanAlertTurnId, onAccepted }
    lastSent.current = submission
    stopPoll()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const turnId = mintTurnId()
    turnIdRef.current = turnId
    writesDuringHydrate.current?.set(turnId, null)
    const onThread = threadIdRef.current
    if (!onThread) {
      // A send from a fresh pane owns the thread the broker creates, even if a
      // mount-time read of the last conversation is still pending.
      hydrateGen.current++
      setTurnsLoading(false)
    }
    // THE CONTINUITY SWITCH. Once the container holds this thread's CLI session,
    // the transcript is already in front of the model and replaying it re-sends
    // and re-bills what it can already see. Before that, the replay is still the
    // only continuity there is.
    const replay = threadRef.current?.session_started_at ? [] : turnsRef.current
    const context = buildContext(replay, about, see)
    const sentAt = new Date().toISOString()
    setTurns(t => [...t, {
      id: nextId(), role: 'user', text, tools: [], error: null, about, turnId, status: 'running', at: sentAt,
    }])
    setStreamText('')
    setStreamTools([])
    setStatus('sending')
    setSlow(false)
    setRunningElsewhere(false)
    const ownsStream = () => alive.current && abortRef.current === ctrl && turnIdRef.current === turnId
    const slowTimer = window.setTimeout(() => { if (ownsStream()) setSlow(true) }, SLOW_MS)

    // The pacer holds the authoritative text of the in-flight turn; `acc` is what
    // gets committed to the transcript, so a turn that ends before the pacer has
    // drained never loses characters.
    let acc = ''
    const pacer = createPacer(shown => { if (ownsStream()) setStreamText(shown) })
    const tools: ToolCall[] = []
    let failed: { message: string; retryable: boolean } | null = null
    let aborted = false
    let landed: { costUsd: number | null; durationMs: number | null } | null = null

    try {
      for await (const ev of getTransport()({
        prompt: text, sessionId, context, model: wanted,
        threadId: onThread ?? undefined, turnId, scanAlertTurnId, signal: ctrl.signal,
      })) {
        if (!ownsStream()) break
        switch (ev.type) {
          case 'session':
            // The live broker has no session id to give; it sends an empty string
            // rather than inventing one. Only overwrite when there is something
            // to say.
            if (ev.sessionId) setSessionId(ev.sessionId)
            setModel(ev.model)
            break
          case 'turn':
            if (ev.turnId !== turnId || (onThread && ev.threadId !== onThread)) {
              throw new Error('The reply could not be matched to this conversation.')
            }
            if (submission.onAccepted) {
              const acknowledge = submission.onAccepted
              submission.onAccepted = undefined
              acknowledge()
            }
            setGrounding({ session: ev.session, groundedOn: ev.groundedOn })
            if (ev.threadId !== threadIdRef.current) {
              // The broker minted a thread for the first turn. Read its title and session.
              threadIdRef.current = ev.threadId
              setThreadId(ev.threadId)
              writeThreadKey(ev.threadId)
              void refreshThread()
            }
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
      if (ownsStream()) {
        abortRef.current = null
        // Whatever streamed before a failure is kept. Discarding half an answer
        // to show a red box loses the useful part of the turn.
        if (acc || tools.length || failed || aborted) {
          setTurns(t => putAnswer(t, {
            id: nextId(), role: 'assistant', text: acc, tools,
            error: failed, aborted: aborted || undefined,
            // Telemetry lands ON the turn (v2a's graft), so a transcript scrolled
            // back through still says what each answer cost and how long it took.
            costUsd: landed?.costUsd ?? null,
            durationMs: landed?.durationMs ?? null,
            turnId,
            // The instant the answer actually landed, which can be a real gap
            // after `sentAt` — this is what a day separator has to key on.
            at: new Date().toISOString(),
          }, 'stream'))
        }
        setStreamText('')
        setStreamTools([])
        setStatus('idle')
        setSlow(false)
        // The database also keeps detached turns for the next time their thread opens.
        void settle(turnId)
      }
    }
  }, [refreshThread, sessionId, settle, stopPoll, wanted])

  // Abort is client-side and immediate — spec §2.3: do not wait for a server
  // acknowledgement that may never arrive. But the CONTAINER does not stop when
  // this fetch does (the detached task owns the process), so the stop is also
  // WRITTEN DOWN: without it the row sits `running` until the 15-minute watchdog
  // and every later hydration reports a turn still in flight.
  const abort = useCallback(() => {
    abortRef.current?.abort()
    const id = turnIdRef.current
    if (id) void abortTurn(id)
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
    // A retry re-sends the context the ORIGINAL turn carried, not whatever is
    // attached now. Re-asking the same question against a different screen
    // would be a different question wearing the first one's words.
    void send(last.prompt, last.about, last.see, last.scanAlertTurnId, last.onAccepted)
  }, [send])

  // The clean reset /clear needs: abort anything in flight, empty the
  // transcript, forget the thread and the streamed remnants. The model CHOICE
  // survives on purpose — picking Opus and then clearing the thread should not
  // silently put the pane back on the default.
  //
  // Note what this does NOT do: it does not delete anything. The old thread and
  // its turns stay in the database, reachable with openThread().
  const newThread = useCallback(() => {
    hydrateGen.current++
    olderRequest.current = null
    setTurnsLoading(false)
    setEarlierState('idle')
    setHistory(null)
    pendingFocus.current = null
    threadVisit.current++
    abortRef.current?.abort()
    abortRef.current = null
    stopPoll()
    lastSent.current = null
    turnIdRef.current = null
    threadIdRef.current = null
    threadRef.current = null
    writeThreadKey(null)
    setTurns([])
    setTurnsStale(false)
    setStreamText('')
    setStreamTools([])
    setSessionId(null)
    setModel(null)
    setThreadId(null)
    setThread(null)
    setGrounding(null)
    setRunningElsewhere(false)
    setSlow(false)
    setStatus('idle')
  }, [stopPoll])

  const openThread = useCallback((id: string, focusId?: string) => {
    if (!isUuid(id)) return
    if (id === threadIdRef.current) {
      if (focusId) void hydrate(id, focusId)
      return
    }
    threadVisit.current++
    abortRef.current?.abort()
    abortRef.current = null
    stopPoll()
    lastSent.current = null
    turnIdRef.current = null
    threadIdRef.current = id
    threadRef.current = null
    pendingFocus.current = null
    setHistory(null)
    setTurns(cachedTurns(id))
    setTurnsStale(false)
    setStreamText('')
    setStreamTools([])
    setStatus('idle')
    setSessionId(null)
    setModel(null)
    setSlow(false)
    setGrounding(null)
    setRunningElsewhere(false)
    setThreadId(id)
    setThread(null)
    void hydrate(id, focusId)
  }, [hydrate, stopPoll])

  const loadEarlier = useCallback(async () => {
    if (!history?.before || history.threadId !== threadIdRef.current || turnsLoading || olderRequest.current) return
    const key = Symbol()
    olderRequest.current = key
    setEarlierState('loading')
    try {
      const page = await listTurnPage(history.threadId, history.before)
      if (!alive.current || olderRequest.current !== key || history.threadId !== threadIdRef.current) return
      const prefix = turnsFromRows(page.rows)
      setHistory(h => h !== history ? h : { ...h, before: page.before, older: [...prefix, ...h.older] })
      setEarlierState('idle')
    } catch {
      if (alive.current && olderRequest.current === key) setEarlierState('error')
    } finally { if (olderRequest.current === key) olderRequest.current = null }
  }, [history, turnsLoading])

  const transcript = useMemo(() => {
    if (history?.threadId !== threadId || !history) return turns
    if (!history.linked.length) return history.older.length ? [...history.older, ...turns] : turns
    const joined = [...history.older, ...turns]
    return joined.some(turn => turn.turnId === history.linked[0].turnId) ? joined : [...history.linked, ...joined]
  }, [turns, history, threadId])

  const reset = newThread

  /**
   * Open Claude's own thread and mark it seen.
   *
   * The stamp goes down AFTER the open, not before: the dot means "there is
   * something here you have not read", and the act that makes that false is
   * arriving, not intending to. `markBotSeen` never throws, so a refused or
   * lost write leaves the dot lit for another read rather than breaking the tap.
   */
  const openBot = useCallback(() => {
    const b = botRef.current
    if (!b) return
    openThread(b.id)
    void (async () => {
      await markBotSeen(b.id)
      await refreshBot()
    })()
  }, [openThread, refreshBot])

  // The spec's own sentence: `last_turn_at > coalesce(bot_seen_at, 'epoch')`.
  // Both are ISO-8601 from PostgREST, which sorts lexically the same way it
  // sorts chronologically, so this is a string compare rather than two Date
  // allocations per render.
  const botUnread = !!botThread?.last_turn_at
    && botThread.last_turn_at > (botThread.bot_seen_at ?? '')

  const botPushMuted = !!botThread?.bot_push_muted

  /**
   * D6 / db/065. Optimistic, like every toggle on this surface: the drawer
   * flips the instant he taps it, the write goes down behind it, and
   * `refreshBot` re-reads the row so a refused write (or a second tab) does
   * not leave the bell lying about its own state for long. Never throws —
   * `setBotPushMuted` in turns.ts already swallows a refused write the same
   * way `markBotSeen` does.
   */
  const setBotPushMuted = useCallback((muted: boolean) => {
    const b = botRef.current
    if (!b) return
    const next = { ...b, bot_push_muted: muted }
    botRef.current = next
    setBotThread(next)
    void (async () => {
      await writeBotPushMuted(b.id, muted)
      await refreshBot()
    })()
  }, [refreshBot])

  // Save the settled transcript for the next cold open. Never mid-stream, never
  // mid-hydration, never a copy already known to be stale.
  useEffect(() => {
    if (status !== 'idle' || turnsLoading || turnsStale || !threadId || turns.length === 0) return
    writeThreadCache(threadId, { turns })
  }, [turns, status, turnsLoading, turnsStale, threadId])

  const busy = status !== 'idle'

  return {
    turns: transcript, status, busy, streamText, streamTools, sessionId, model, slow,
    hasEarlier: !!history?.before && history.threadId === threadId, loadEarlier, earlierState,
    wanted, setWanted,
    threadId, thread, turnsLoading, turnsStale, grounding, runningElsewhere,
    botThread, botUnread, refreshBot, openBot, botPushMuted, setBotPushMuted,
    send, abort, retry, reset, newThread, openThread, getThreadVisit,
  }
}
