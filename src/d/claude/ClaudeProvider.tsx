import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useChat, type ChatHandle } from '../../exp/v2c/useChat'
import { EMPTY_SEE, type SeeState } from '../../exp/v2c/chat/paneContext'
import { useFrame } from '../shell/frame'
import { useOnline } from '../ui/useOnline'
import { useClaudeHandoff } from '../ui/claudeHandoff'
import { draftStarter, firstLine, subjectMeta, uuidOrNull } from './model'

// ONE chat state for the whole D app (today's rule, useChat.ts: "mounted once,
// never inside the pane"). The ⌘J drawer mounts and unmounts; this does not,
// so closing the drawer never tears down a turn that is still streaming, and
// the status pill can say Claude is working while he is somewhere else.
//
// Hooks rule: every hook runs on every render; nothing returns early.

export type Landed = { title: string; line: string; failed: boolean }

export type ClaudeCtx = {
  chat: ChatHandle
  online: boolean
  /** The composer's text, kept here so closing the drawer does not lose it. */
  text: string
  setText: (v: string) => void
  /** Which attached subjects are switched to "whole conversation". */
  see: SeeState
  setSee: (s: SeeState) => void
  /** The turn a push link named: scrolled to once, then cleared. */
  focusTurn: string | null
  clearFocus: () => void
  /** When the turn on screen started (this tab's send, or the open row found running). */
  since: number | null
  /** When each streamed tool call first arrived, by call id. */
  stepAt: (id: string) => number | undefined
  /** A turn finished while the drawer was closed: the card says so until he answers it. */
  landed: Landed | null
  clearLanded: () => void
  /** The moment the transcript was last known good (the offline line prints it). */
  savedAt: number | null
}

const Ctx = createContext<ClaudeCtx | null>(null)

export function useClaude(): ClaudeCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useClaude outside the ClaudeProvider')
  return c
}

export function useClaudeMaybe(): ClaudeCtx | null {
  return useContext(Ctx)
}

export function ClaudeProvider({ children }: { children: ReactNode }) {
  const chat = useChat()
  const f = useFrame()
  const online = useOnline()
  const handoff = useClaudeHandoff()
  const [text, setText] = useState('')
  const [see, setSee] = useState<SeeState>(EMPTY_SEE)
  const [focusTurn, setFocusTurn] = useState<string | null>(null)
  const [landed, setLanded] = useState<Landed | null>(null)
  const [busySince, setBusySince] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const steps = useRef(new Map<string, number>())
  const wasBusy = useRef(chat.busy)
  const { setClaudeOpen, claudeOpen, route } = f

  // Push landing and the Claude place: `#exp/d/claude?thread=<id>&turn=<id>`
  // (today's `#exp/brain-b/ask?thread=…` maps here) opens that chat in the
  // drawer and scrolls to the turn. Keyed on the address, so it runs once per arrival.
  const qs = route.place === 'claude' ? route.query.toString() : null
  useEffect(() => {
    if (qs === null) return
    const q = new URLSearchParams(qs)
    const thread = uuidOrNull(q.get('thread'))
    if (thread) {
      chat.openThread(thread)
      setFocusTurn(uuidOrNull(q.get('turn')))
    }
    setClaudeOpen(true)
    // chat.openThread is stable (useCallback); only the address decides this.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, setClaudeOpen])

  // A "Draft it" hand-off from DMs starts the field with today's quick-ask words.
  // A plain ask leaves the field alone (the placeholder names the person).
  const handoffAt = handoff?.at ?? null
  useEffect(() => {
    if (!handoff) return
    setSee(EMPTY_SEE)
    if (handoff.intent === 'draft') setText(t => (t.trim() ? t : draftStarter(subjectMeta(handoff.subject))))
    // one run per hand-off
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffAt])

  // Busy edges: start the clock, and when a turn lands while the drawer is
  // closed, hold a card that says so (it stays until he opens or dismisses it).
  useEffect(() => {
    const before = wasBusy.current
    wasBusy.current = chat.busy
    if (chat.busy && !before) { setBusySince(Date.now()); steps.current.clear(); setLanded(null) }
    if (!chat.busy && before) {
      setBusySince(null)
      if (claudeOpen) return
      const last = [...chat.turns].reverse().find(t => t.role === 'assistant')
      if (!last || last.aborted) return
      setLanded(last.error
        ? { title: 'Claude could not finish', line: firstLine(last.error.message), failed: true }
        : { title: 'Claude answered', line: firstLine(last.text), failed: false })
    }
  }, [chat.busy, chat.turns, claudeOpen])

  // Opening the drawer is reading the answer.
  useEffect(() => { if (claudeOpen) setLanded(null) }, [claudeOpen])

  // Arrival times of streamed tool calls (the "+9s" on each step).
  useEffect(() => {
    const now = Date.now()
    for (const t of chat.streamTools) if (!steps.current.has(t.id)) steps.current.set(t.id, now)
  }, [chat.streamTools])

  // The last moment the transcript on screen was a fresh, settled read.
  useEffect(() => {
    if (online && !chat.busy && !chat.turnsLoading && !chat.turnsStale) setSavedAt(Date.now())
  }, [online, chat.busy, chat.turnsLoading, chat.turnsStale, chat.turns.length])

  // A turn found running with no stream here counts from when it was asked.
  const openAsk = chat.runningElsewhere ? [...chat.turns].reverse().find(t => t.role === 'user' && t.status === 'running') : undefined
  const since = busySince ?? (openAsk?.at ? Date.parse(openAsk.at) : null)

  const clearFocus = useCallback(() => setFocusTurn(null), [])
  const clearLanded = useCallback(() => setLanded(null), [])
  const stepAt = useCallback((id: string) => steps.current.get(id), [])

  const value = useMemo<ClaudeCtx>(() => ({
    chat, online, text, setText, see, setSee, focusTurn, clearFocus, since, stepAt, landed, clearLanded, savedAt,
  }), [chat, online, text, see, focusTurn, clearFocus, since, stepAt, landed, clearLanded, savedAt])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
