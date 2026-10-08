import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useChat, type ChatHandle } from '../../exp/v2c/useChat'
import { abortTurn } from '../../lib/turns'
import { useSavedAt } from '../../wb/ask/claudeState'
import { useClaudeKeys } from './useClaudeKeys'
import { VoiceLayer } from './VoiceLayer'
import { EMPTY_SEE, type SeeState } from '../../exp/v2c/chat/paneContext'
import { useFrame } from '../shell/frame'
import { useSkin } from '../../ds/useSkin'
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
  /** The moment the transcript was last known good (the offline line prints it; kept across reloads). */
  savedAt: number | null
  /** Stop the turn on screen: this tab's stream, or a turn running elsewhere (today's abortTurn). */
  stop: () => void
  /** Live voice (today's LiveVoice), open or not. */
  voiceOpen: boolean
  setVoiceOpen: (o: boolean) => void
  /** ⌘D with the drawer closed opens it and starts dictation: the composer reads this once. */
  dictateOnOpen: boolean
  clearDictateOnOpen: () => void
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

/** Tests only: hand the drawer a prepared value instead of a live chat. */
export const ClaudeValueProvider = Ctx.Provider

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
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [dictateOnOpen, setDictateOnOpen] = useState(false)
  const steps = useRef(new Map<string, number>())
  const wasBusy = useRef(chat.busy)
  const { setClaudeOpen, claudeOpen, route } = f
  // Brief 4 `claude` section: on desktop the Claude place IS the workspace, so arriving there opens the
  // chat in the page and leaves the drawer flag alone (else the drawer would pop open on the next place).
  const workspace = useSkin('claude') && f.layout === 'desktop'
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace

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
    if (q.get('voice') === '1') setVoiceOpen(true)
    if (!workspaceRef.current) setClaudeOpen(true)
    // chat.openThread is stable (useCallback); only the address decides this.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, setClaudeOpen])

  // A "Draft it" hand-off from DMs starts the field with today's quick-ask words.
  // A plain ask leaves the field alone (the placeholder names the person).
  const handoffAt = handoff?.at ?? null
  useEffect(() => {
    if (!handoff) return
    setSee(EMPTY_SEE)
    // A person gets a fresh chat when the open one is idle and already about
    // something else (today's rb rule, wb/ask/Mobile.tsx), so the replay does
    // not carry the previous topic into the question about them.
    if (!chat.busy && !chat.runningElsewhere && chat.turns.length > 0) chat.newThread()
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

  // When the thread was last known good while online (today's claudeState, localStorage).
  const savedAt = useSavedAt(online, chat.turns.length, chat.busy)

  // A turn found running with no stream here counts from when it was asked.
  const openAsk = chat.runningElsewhere ? [...chat.turns].reverse().find(t => t.role === 'user' && t.status === 'running') : undefined
  const since = busySince ?? (openAsk?.at ? Date.parse(openAsk.at) : null)

  const clearFocus = useCallback(() => setFocusTurn(null), [])
  const clearLanded = useCallback(() => setLanded(null), [])
  const stepAt = useCallback((id: string) => steps.current.get(id), [])
  const clearDictateOnOpen = useCallback(() => setDictateOnOpen(false), [])
  const lastAsk = chat.runningElsewhere ? openAsk?.turnId ?? null : null
  const stop = useCallback(() => {
    if (chat.busy) { chat.abort(); return }
    // Running elsewhere (started on the phone): today writes the stop down on the row.
    if (lastAsk) void abortTurn(lastAsk)
  }, [chat, lastAsk])

  useClaudeKeys({ chat, claudeOpen, setClaudeOpen, layout: f.layout, setVoiceOpen, setDictateOnOpen })

  const value = useMemo<ClaudeCtx>(() => ({
    chat, online, text, setText, see, setSee, focusTurn, clearFocus, since, stepAt, landed, clearLanded, savedAt,
    stop, voiceOpen, setVoiceOpen, dictateOnOpen, clearDictateOnOpen,
  }), [chat, online, text, see, focusTurn, clearFocus, since, stepAt, landed, clearLanded, savedAt, stop, voiceOpen, dictateOnOpen, clearDictateOnOpen])

  return (
    <Ctx.Provider value={value}>
      {children}
      {voiceOpen && <VoiceLayer chat={chat} onClose={() => setVoiceOpen(false)} />}
    </Ctx.Provider>
  )
}
