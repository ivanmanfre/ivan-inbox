import type { ComponentType, ReactNode } from 'react'
import type { ChatHandle } from '../v2c/useChat'
import type { Job } from '../v2c/layout'
import type { Subject } from '../v2c/chat/paneContext'

// The tournament seam for goal run inbox-brain-app-2026-09-04.
//
// A candidate owns two things and nothing else: the PHONE chrome (Ask-first
// entry, the feed one swipe away, the tab bar) and the ASK pane on desktop.
// Every lane keeps rendering through the Shell exactly as today; the candidate
// receives the rendered work surface and places it inside its own frame. That
// is what lets three candidates be built in parallel without one of them
// touching Shell.tsx, Rail.tsx or layout.ts.

export type BrainId = 'a' | 'b' | 'c'

export interface BrainMobileProps {
  chat: ChatHandle
  job: Job
  goJob: (j: Job) => void
  counts: Partial<Record<Job, number>>
  sev: Partial<Record<Job, 'attention' | 'urgent'>>
  /** The Ops health alarm the ribbon shows today: n = open alerts, note = title. */
  health: { n: number; note: string }
  /** How fresh the inbox read is; the ribbon prints it. */
  loadedAt: string | null
  inboxError: string | null
  refresh: () => void
  /** The lane for `job`, already rendered by the Shell. Place it, do not rebuild it. */
  workSurface: ReactNode
  /** The takeover windows (draft / magnet / call). Render them last, outside any plate. */
  windows: ReactNode
  /** A DM thread opened on the phone (the old wb-take-thread branch), or null. When set, show it as the takeover it is. */
  peerView: ReactNode | null
  /** What the chat pane would be told it is next to. */
  about: string | null
  aboutContext: string | null
  subjects: Subject[]
  /** Deep-link state parsed from the hash on boot (route.ts): open this thread / turn / the feed. */
  boot: { job: Job; focus: string | null; thread?: string; turn?: string; feed?: boolean }
}

export interface BrainAskPaneProps {
  chat: ChatHandle
  job: Job
  about: string | null
  aboutContext: string | null
  subjects: Subject[]
  onClose: () => void
  onOpenAbout: (() => void) | null
  mobile: boolean
}

export interface BrainCandidate {
  id: BrainId
  /** Phone entry. Owns the whole 390 screen except the takeover windows. */
  Mobile: ComponentType<BrainMobileProps>
  /** Desktop Ask pane, docked where ChatPane docks today. Same props as ChatPane. */
  AskPane: ComponentType<BrainAskPaneProps>
}
