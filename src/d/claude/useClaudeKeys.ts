import { useEffect, useMemo, useRef } from 'react'
import type { ChatHandle } from '../../exp/v2c/useChat'
import type { WbCommand } from '../../exp/v2c/commandSource'
import { LiveVoice } from '../../wb/ask/claudeState'
import { useDCommands } from '../shell/commands'
import type { Layout } from '../places'

// The Claude keys that live above the drawer (today: exp/v2c/Shell.tsx):
// ⌘D anywhere (drawer closed: open it and start the mic; phone with live
// voice: open live voice), Escape closes the drawer when focus is in it or it
// is the phone sheet, the drawer's open state is kept like today's `wb-drawer`,
// and ⌘K gets "New Claude thread" and "Talk to Claude".

export const DRAWER_KEY = 'd-claude-open'

export function useClaudeKeys({ chat, claudeOpen, setClaudeOpen, layout, setVoiceOpen, setDictateOnOpen }: {
  chat: ChatHandle
  claudeOpen: boolean
  setClaudeOpen: (o: boolean) => void
  layout: Layout
  setVoiceOpen: (o: boolean) => void
  setDictateOnOpen: (o: boolean) => void
}) {
  const open = useRef(claudeOpen)
  open.current = claudeOpen
  const lay = useRef(layout)
  lay.current = layout

  // Keep the drawer the way he left it (desktop only; the phone sheet starts closed).
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) {
      try { localStorage.setItem(DRAWER_KEY, claudeOpen ? '1' : '0') } catch { /* private mode */ }
      return
    }
    restored.current = true
    try { if (!claudeOpen && layout === 'desktop' && localStorage.getItem(DRAWER_KEY) === '1') setClaudeOpen(true) } catch { /* private mode */ }
  }, [claudeOpen, layout, setClaudeOpen])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        if (lay.current === 'phone' && LiveVoice) { e.preventDefault(); setClaudeOpen(true); setVoiceOpen(true); return }
        if (open.current) return // the composer's own ⌘D handles it
        e.preventDefault()
        setDictateOnOpen(true)
        setClaudeOpen(true)
        return
      }
      if (e.key === 'Escape' && open.current && !e.defaultPrevented) {
        if (document.querySelector('.d-sheet, .d-confirm, .dcl-menu, .dcl-peek')) return
        const inDrawer = (document.activeElement as HTMLElement | null)?.closest?.('[data-claude-drawer]')
        if (inDrawer || lay.current === 'phone') setClaudeOpen(false)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [setClaudeOpen, setVoiceOpen, setDictateOnOpen])

  const { newThread } = chat
  useDCommands(useMemo<WbCommand[]>(() => [
    { id: 'claude.new', title: 'New Claude thread', group: 'Claude', key: null, hint: 'Start a fresh chat in the drawer', ready: true, run: () => { newThread(); setClaudeOpen(true) } },
    ...(LiveVoice ? [{ id: 'claude.voice', title: 'Talk to Claude', group: 'Claude' as const, key: null, hint: 'Live voice', ready: true, run: () => { setClaudeOpen(true); setVoiceOpen(true) } }] : []),
  ], [newThread, setClaudeOpen, setVoiceOpen]))
}
