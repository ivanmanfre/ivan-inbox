import { useState } from 'react'
import { OpsScreen } from '../../screens/OpsScreen'
import { useAgent } from '../../hooks/useAgent'
import { AgentScreen } from './AgentScreen'
import { AgentChatScreen } from './AgentChatScreen'

type Seg = 'cards' | 'agent'

// Ops tab: own large title + segmented [Cards|Agent] BELOW it — same anatomy
// as ContentScreen's title-then-Queue|Styles. Cards is the existing OpsScreen,
// mounted completely unchanged (own realtime, own confirm-gated approves —
// untouched per the danger register's regression guard on the two-mount
// channel collision, 754d32d), except its OWN "Ops" nav+title is now redundant
// (this host renders one above the switch) and would otherwise stack a second
// title under the first — so it's hidden via the tightly-scoped `.oh-hide-nav`
// wrapper below (additive CSS only, OpsScreen.tsx itself is untouched and out
// of this candidate's scope). AgentScreen is our own file (in-scope), so its
// matching duplicate title was removed directly in AgentScreen.tsx instead of
// CSS-hidden.
//
// useAgent() is mounted once here, above both the Agent list and the pushed
// chat screen, so realtime keeps flowing under the chat overlay exactly the
// way Shell keeps useInbox alive under a mobile ThreadScreen takeover.
export function OpsHost() {
  const [seg, setSeg] = useState<Seg>('cards')
  const [chatOpen, setChatOpen] = useState(false)
  const agent = useAgent()

  return (
    <>
      <div className="nav">
        <div className="row-top"><h2>Ops</h2><div className="avatar-me">IM</div></div>
      </div>
      <div className="seg ops-host-seg">
        <div className={`sg ${seg === 'cards' ? 'on' : ''}`} onClick={() => setSeg('cards')}>Cards</div>
        <div className={`sg ${seg === 'agent' ? 'on' : ''}`} onClick={() => setSeg('agent')}>Agent</div>
      </div>
      {seg === 'cards' ? (
        <div className="oh-hide-nav"><OpsScreen /></div>
      ) : (
        <AgentScreen agent={agent} onOpenChat={() => setChatOpen(true)} />
      )}
      {chatOpen && <AgentChatScreen agent={agent} onBack={() => setChatOpen(false)} />}
    </>
  )
}
