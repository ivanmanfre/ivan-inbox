import { Avatar } from '../../components/Avatar'
import { ThreadScreen } from '../../screens/ThreadScreen'
import type { Thread } from '../../lib/inbox'
import { label } from '../../lib/labels'
import { STAGE_LADDER, stageIsOff, stageStep } from './stage'

// A conversation, as a pane peer.
//
// ThreadScreen keeps its own nav — the name in it opens the prospect context
// sheet, which is a real affordance and not chrome. What the PANE owns rides
// above it: who this is (the gradient avatar, which the aesthetics audit found
// the app drops everywhere except the inbox list), where they are in the
// pipeline, how to ask Claude about them, and how to close.
//
// The ladder is the pane's visual encoding. It is also the one fact ThreadScreen
// cannot express: it prints the stage string, which says nothing about what came
// before or what comes next.
function Ladder({ stage }: { stage: string }) {
  const step = stageStep(stage)
  const off = stageIsOff(stage)
  if (off) {
    return (
      <div className="wb-ladder off" title={`stage: ${stage}`}>
        <span className="wb-lad-dot off" />
        <span className="wb-lad-l">Archived</span>
      </div>
    )
  }
  if (step === null) {
    // A stage this file has not seen. Say so rather than draw a guess, and
    // say it in words, not the raw column (phase2).
    return <div className="wb-ladder"><span className="wb-lad-l unknown">{stage ? label(stage) : 'no stage'}</span></div>
  }
  return (
    <div className="wb-ladder" title={`stage: ${stage}`}>
      {STAGE_LADDER.map((label, i) => (
        <span className="wb-lad-s" key={label}>
          {i > 0 && <span className={`wb-lad-bar${i <= step ? ' on' : ''}`} />}
          <span className={`wb-lad-dot${i < step ? ' on' : ''}${i === step ? ' now' : ''}`} />
        </span>
      ))}
      <span className="wb-lad-l">{STAGE_LADDER[step]}</span>
    </div>
  )
}

export function ThreadPeer({ thread, refresh, onClose, onAsk, mobile }: {
  thread: Thread
  refresh: () => void
  onClose: () => void
  onAsk: () => void
  mobile: boolean
}) {
  return (
    <>
      <div className="wb-pane-h slim">
        <Avatar name={thread.prospect_name} client_id={thread.client_id} channel={thread.channel} size={30} />
        <div className="wb-pane-ttl"><Ladder stage={thread.stage} /></div>
        {thread.draft && <span className="dpill">DRAFT</span>}
        <button className="wb-ask" onClick={onAsk}>Ask Claude</button>
        {!mobile && <span className="wb-pane-x" onClick={onClose}>✕</span>}
      </div>
      <ThreadScreen thread={thread} onBack={onClose} refresh={refresh} />
    </>
  )
}
