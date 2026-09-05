import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Avatar, Button, Chip, Icon, list, rise, spring } from '../../../ds'
import { useSectionState } from '../../../hooks/useSectionState'
import { eventTime, isLeadMagnet, threadKind, type Thread } from '../../../lib/inbox'
import { clientBadge } from '../../../lib/labels'
import { relTime } from '../../../exp/v2c/fmt'
import './dms.css'

// DM HISTORY — the receipt. Direction B copy of src/exp/v2c/DmHistory.tsx.
//
// Ivan, 2026-08-03: "on dms on a collapsible arrow u should add dm history and
// thats where the chats history should be (the ones that had any response) so i
// know this is working".
//
// The membership rule is unchanged and still the RAW one: an inbound message
// exists, or the thread is a lead-magnet delivery. The window is still 20 and
// still not persisted, the open flag is still `useSectionState('dms.history')`,
// and the head still carries the full total. Only the paint moved: rows are
// cards, and the two chevrons are lucide icons rather than glyphs.

const KIND_LABEL = { inmail: 'INMAIL', email: 'EMAIL', linkedin: 'DM' } as const

function manualCount(t: Thread): number {
  return t.messages.filter(m => m.direction === 'outbound' && m.ai_model === 'manual_mirror').length
}

const PAGE = 20

export function DmHistory({ threads, onOpen }: {
  threads: Thread[]
  onOpen: (id: string) => void
}) {
  const [sect, setSect] = useSectionState('dms.history')
  const open = sect.open.includes('history')
  const [shown, setShown] = useState(PAGE)
  useEffect(() => { if (!open) setShown(PAGE) }, [open])
  const answered = threads
    .filter(t => t.messages.some(m => m.direction === 'inbound') || isLeadMagnet(t))
    .sort((a, b) => eventTime(b.last).localeCompare(eventTime(a.last)))
  if (answered.length === 0) return null

  const replies = answered.reduce((n, t) => n + t.messages.filter(m => m.direction === 'inbound').length, 0)
  const magnets = answered.filter(isLeadMagnet).length

  return (
    <div className="dirb-block">
      <button
        type="button"
        className="dirb-histhead"
        aria-expanded={open}
        onClick={() => setSect(s => ({
          ...s,
          open: s.open.includes('history') ? s.open.filter(k => k !== 'history') : [...s.open, 'history'],
        }))}
      >
        <Icon name={open ? 'disclose' : 'forward'} size={16} />
        <span className="ds-t-eyebrow">DM history</span>
        <span className="ds-t-meta dirb-dim">
          {answered.length} conversations · {replies} replies
          {magnets > 0 && ` · ${magnets} lead magnet${magnets === 1 ? '' : 's'}`}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="dirb-cards"
            variants={list}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            {answered.slice(0, shown).map(t => {
              const kind = threadKind(t)
              const manual = manualCount(t)
              const last = t.last
              const snip = last.direction === 'outbound'
                ? `You: ${last.message_text}`
                : last.message_text
              return (
                <motion.button
                  type="button"
                  key={t.prospect_id}
                  className="dirb-histrow dirb-lift"
                  variants={rise}
                  transition={spring}
                  onClick={() => onOpen(t.prospect_id)}
                >
                  <Avatar name={t.prospect_name} tint={3} />
                  <span className="dirb-grow dirb-col">
                    <span className="dirb-row-wrap">
                      <span className="ds-t-title dirb-truncate">{t.prospect_name}</span>
                      <Chip tone="quiet">{clientBadge(t.client_id)}</Chip>
                      <Chip tone="quiet">{KIND_LABEL[kind]}</Chip>
                      {/* A hand-typed reply is the one thing in this list no
                          automation did, so it is marked rather than blended in. */}
                      {manual > 0 && <Chip tone="quiet">BY HAND</Chip>}
                      {/* They commented the gate keyword and the engine sent them the
                          resource. Marked so a delivery never reads as a cold send. */}
                      {isLeadMagnet(t) && <Chip tone="quiet">LEAD MAGNET</Chip>}
                    </span>
                    <span className="dirb-quote dirb-truncate ds-t-body">{snip}</span>
                  </span>
                  <span className="ds-t-mono dirb-dim">{relTime(eventTime(last))}</span>
                </motion.button>
              )
            })}
            {/* What is still folded, counted, with the way to get it. A "show
                more" that does not say how much more is behind it is a guess. */}
            {answered.length > shown && (
              <Button
                variant="quiet"
                block
                icon="disclose"
                onClick={() => setShown(n => n + PAGE)}
              >
                Show {Math.min(PAGE, answered.length - shown)} more
                <span className="ds-t-meta dirb-dim"> · {answered.length - shown} older still folded</span>
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
