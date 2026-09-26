/* ==========================================================================
   src/wb/ask/askAbout.ts - "Ask Claude about this person", from anywhere.

   The desktop has always done this through the drawer: the thread is docked
   as a peer, Shell builds its subject (`threadSubject`, chat/paneContext) and
   the pane shows it as a removable chip. The phone had nothing: `openDrawer`
   is a no-op there, and going to the Claude place drops the open thread, so
   the subject vanished on the way (rebuild, 2026-09-26).

   So the ask carries its subject WITH it. A DM thread's ⋯ menu and a held DM
   row both call `askAbout(thread)`:
     · phone   -> the subject goes to Mobile, which lands on Claude with that
                  person attached (the same shallow-by-default chip);
     · desktop -> the existing seams: `wb-open` docks the thread as a peer and
                  `wb-cmd chat-open` opens the drawer, so Shell attaches the
                  subject exactly as the head's own Ask Claude button does.

   It builds the subject from data the list already holds. It opens no request
   and it sends nothing: the person is only attached, never asked about.
   ========================================================================== */
import { threadSubject, type Subject } from '../../exp/v2c/chat/paneContext'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import type { Thread } from '../../lib/inbox'

/** The same subject Shell builds for a docked thread (Shell.tsx seeSubjects). */
export function subjectForThread(t: Thread): Subject {
  return threadSubject({
    prospect_id: t.prospect_id,
    prospect_name: t.prospect_name,
    prospect_company: t.prospect_company,
    channel: t.channel,
    stage: t.stage,
    messages: t.messages,
    hasPendingDraft: t.draft != null && t.draftSnoozedUntil === null,
  }, LANE_LABEL[t.client_id as ContentLane] ?? t.client_id)
}

type Listener = (s: Subject) => void
let listener: Listener | null = null
let parked: Subject | null = null

/** Mobile registers here. A parked ask (made before it mounted) runs once. */
export function listenAskAbout(fn: Listener): () => void {
  listener = fn
  if (parked) { const s = parked; parked = null; fn(s) }
  return () => { if (listener === fn) listener = null }
}

/** Same breakpoint Shell uses for its phone canvas. */
function isPhone(): boolean {
  return typeof window === 'undefined' || !window.matchMedia('(min-width: 1000px)').matches
}

/** Attach this person and open Claude. Never sends. */
export function askAbout(t: Thread): void {
  if (isPhone()) {
    const s = subjectForThread(t)
    if (listener) listener(s)
    else parked = s
    return
  }
  window.dispatchEvent(new CustomEvent('wb-open', { detail: { kind: 'thread', id: t.prospect_id } }))
  window.dispatchEvent(new CustomEvent('wb-cmd', { detail: { action: 'chat-open' } }))
}
