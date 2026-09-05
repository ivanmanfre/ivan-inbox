/* ==========================================================================
   src/wb/dir-a/thread/index.tsx — S14, Direction A.

   The peer, with the exact props the shipped ThreadPeer takes. It renders one
   screen: the old pane head and the thread's own nav said the same three things
   twice, so Direction A says them once — the compact sticky head carries the
   avatar, the name that opens the context, the draft marker, the hand-off link,
   Ask Claude and the close; the bar under it carries the stage ladder.
   ========================================================================== */
import { Conversation } from './Conversation'
import type { Thread } from '../../../lib/inbox'
import './thread.css'

export function ThreadPeer({ thread, refresh, onClose, onAsk, mobile }: {
  thread: Thread
  refresh: () => void
  onClose: () => void
  onAsk: () => void
  mobile: boolean
}) {
  return (
    <Conversation
      thread={thread}
      refresh={refresh}
      // The pane's close IS the thread's back: there is one way out of a peer.
      onBack={onClose}
      onClose={onClose}
      onAsk={onAsk}
      mobile={mobile}
    />
  )
}
