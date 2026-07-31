import { useState } from 'react'
import { OpsScreen } from '../../screens/OpsScreen'
import { useAgent } from '../../hooks/useAgent'
import { AgentScreen } from './AgentScreen'
import { AgentChatScreen } from './AgentChatScreen'

type Seg = 'cards' | 'agent'

// Ops tab: segmented [Cards|Agent]. Cards is the existing OpsScreen, mounted
// completely unchanged (own header, own realtime, own confirm-gated approves —
// untouched per the danger register's regression guard on the two-mount
// channel collision, 754d32d). It already owns a full "Ops" nav+title, and it
// can't be told to suppress that without editing a shared file outside this
// candidate's scope — so rather than stack a second "Ops" title on top of it,
// the Cards/Agent switch sits in its own slim bar above both children, and
// each child keeps its own title below (Agent's is "Agent").
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
      <div className="seg ops-host-seg">
        <div className={`sg ${seg === 'cards' ? 'on' : ''}`} onClick={() => setSeg('cards')}>Cards</div>
        <div className={`sg ${seg === 'agent' ? 'on' : ''}`} onClick={() => setSeg('agent')}>Agent</div>
      </div>
      {seg === 'cards' ? <OpsScreen /> : <AgentScreen agent={agent} onOpenChat={() => setChatOpen(true)} />}
      {chatOpen && <AgentChatScreen agent={agent} onBack={() => setChatOpen(false)} />}
    </>
  )
}
