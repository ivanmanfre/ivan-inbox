import { motion } from 'motion/react'
import { Avatar, Button, Chip, Header, IconButton, Stepper, spring, type Step } from '../../../ds'
import { DirB } from '../shell'
import { ThreadScreen } from './Thread'
import type { Thread } from '../../../lib/inbox'
import { label } from '../../../lib/labels'
import { STAGE_LADDER, stageIsOff, stageStep } from '../../../exp/v2c/stage'
import './dms.css'

// A conversation, as a pane peer. Direction B copy of src/exp/v2c/ThreadPeer.tsx.
//
// What the PANE owns rides above the thread: who this is, where they are in the
// pipeline, how to ask Claude about them, and how to close. The ladder is the
// pane's visual encoding and the one fact the thread cannot express — it prints
// the stage string, which says nothing about what came before or what comes next.
//
// Direction B draws the ladder as the design system's `Stepper` (originui/stepper:
// the done steps carry the lime fill), and the header is the element the list
// card GROWS into: it shares the card's `layoutId` on the phone, where the list
// is unmounted the moment the thread takes the screen. On desktop the list and
// this peer are both on screen, so the id is not shared — two live nodes on one
// `layoutId` is a fight, not a shared element.
function Ladder({ stage }: { stage: string }) {
  const step = stageStep(stage)
  const off = stageIsOff(stage)
  if (off) {
    return <span title={`Stage: ${label(stage)}`}><Chip tone="quiet">Archived</Chip></span>
  }
  if (step === null) {
    // A stage this file has not seen. Say so rather than draw a guess, and say
    // it in words, not the raw column.
    return <Chip tone="quiet">{stage ? label(stage) : 'no stage'}</Chip>
  }
  const steps: Step[] = STAGE_LADDER.map((l, i) => ({
    id: l,
    label: l,
    state: i < step ? 'done' : i === step ? 'current' : 'todo',
  }))
  return <Stepper steps={steps} label={`Stage: ${label(stage)}`} />
}

export function ThreadPeer({ thread, refresh, onClose, onAsk, mobile }: {
  thread: Thread
  refresh: () => void
  onClose: () => void
  onAsk: () => void
  mobile: boolean
}) {
  return (
    <DirB className="dirb-th">
      <motion.div
        layoutId={mobile ? `dirb-dm-${thread.prospect_id}` : undefined}
        transition={spring}
      >
        <Header
          lead={<Avatar name={thread.prospect_name} tint={thread.client_id === 'risedtc' ? 2 : 3} live={thread.unread > 0} />}
          tail={<>
            {thread.draft && <Chip tone="accent">DRAFT</Chip>}
            <Button variant="quiet" size="sm" icon="ask" onClick={onAsk}>Ask Claude</Button>
            {!mobile && <IconButton icon="close" label="Close" size="sm" onClick={onClose} />}
          </>}
        >
          <Ladder stage={thread.stage} />
        </Header>
      </motion.div>
      <ThreadScreen thread={thread} onBack={onClose} refresh={refresh} />
    </DirB>
  )
}
