import { useState } from 'react'
import { OpsScreen } from '../../screens/OpsScreen'
import { AgentScreen } from './AgentScreen'

type OpsSeg = 'cards' | 'agent'

const SEGS: { key: OpsSeg; label: string }[] = [
  { key: 'cards', label: 'Cards' },
  { key: 'agent', label: 'Agent' },
]

// Ops tab, expanded. Cards is the existing <OpsScreen/> untouched — same
// dispatcher-backed approve/discard paths, same freshness-gated comment
// replies, same section grouping. Agent is n8nClaw's chat/alerts/reminders,
// the one of three things under the dashboard's old "Agent" heading that is
// actually live and daily-used (AUDIT.md "What AgentOps actually is"); the
// retired $2k Blueprint pipeline is deliberately absent from this build.
export function OpsHub() {
  const [seg, setSeg] = useState<OpsSeg>('cards')
  return (
    <>
      <div className="seg" style={{ margin: '14px 16px 0' }}>
        {SEGS.map(s => (
          <div key={s.key} className={`sg ${seg === s.key ? 'on' : ''}`} onClick={() => setSeg(s.key)}>
            {s.label}
          </div>
        ))}
      </div>
      {seg === 'cards' ? <OpsScreen /> : <AgentScreen />}
    </>
  )
}
