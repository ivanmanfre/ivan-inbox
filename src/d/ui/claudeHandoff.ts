// THE CLAUDE HAND-OFF. A page attaches a subject (today's `Subject` from exp/v2c/chat/paneContext,
// the same one the old drawer builds for a thread) and opens the ⌘J slot. The Claude drawer
// (src/d/claude/Drawer.tsx, the Claude agent's file) reads it with `useClaudeHandoff()` and shows
// it as the removable subject chip. Nothing is sent: the person is attached, never asked about.
//
//   const f = useFrame()
//   handOffToClaude({ subject: subjectForThread(t), intent: 'ask' }); f.setClaudeOpen(true)
import { useSyncExternalStore } from 'react'
import type { Subject } from '../../exp/v2c/chat/paneContext'

export type ClaudeHandoff = {
  subject: Subject
  /** 'ask' = Ask Claude about this person; 'draft' = the no-draft thread's "Draft it" key. */
  intent: 'ask' | 'draft'
  at: number
}

let current: ClaudeHandoff | null = null
const subs = new Set<() => void>()

export function handOffToClaude(h: Omit<ClaudeHandoff, 'at'>): void {
  current = { ...h, at: Date.now() }
  for (const f of subs) f()
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('d-claude-handoff', { detail: current }))
}

export function clearClaudeHandoff(): void {
  current = null
  for (const f of subs) f()
}

export function readClaudeHandoff(): ClaudeHandoff | null {
  return current
}

export function useClaudeHandoff(): ClaudeHandoff | null {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => current, () => null)
}
