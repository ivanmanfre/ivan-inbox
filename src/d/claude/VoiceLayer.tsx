import { Suspense } from 'react'
import type { ChatHandle } from '../../exp/v2c/useChat'
import { LiveVoice } from '../../wb/ask/claudeState'

// Live voice is TODAY'S screen (wb/ask/voice/LiveVoice: the realtime session
// through `inbox-rt-session`, captions, Mute / End / Type, and spoken task
// hand-offs that land here as normal chat turns through `chat.send`). D only
// decides when it opens: the drawer's Talk key, phone ⌘D, ⌘K "Talk to Claude",
// and the home-screen "Talk to Claude" shortcut (`#claude/voice`).

export function VoiceLayer({ chat, onClose }: { chat: ChatHandle; onClose: () => void }) {
  if (!LiveVoice) return null
  const Voice = LiveVoice
  return (
    <div className="dcl-voice" role="dialog" aria-label="Talk to Claude">
      <Suspense fallback={<div className="dcl-voice-wait">Starting live voice…</div>}>
        <Voice onClose={onClose} send={text => void chat.send(text)} turns={chat.turns} />
      </Suspense>
    </div>
  )
}

/** Live voice exists in this build (today's voice module is present). */
export const hasLiveVoice = !!LiveVoice
