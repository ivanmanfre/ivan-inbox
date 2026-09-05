/* ==========================================================================
   src/wb/dir-a/dms/DmHistory.tsx — S02-30 to S02-32, the receipt.

   Rebuilt from src/exp/v2c/DmHistory.tsx. The membership rule, the persisted
   open flag, the deliberately unpersisted 20-row window, the counts and every
   string are untouched; the section is now a Group of dense rows with a mono
   date column, and the chevron is an IconButton with a spoken label.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Button, IconButton } from '../../../ds'
import { Group, Row, Rows } from '../kit'
import { Face, Pill } from './parts'
import { useSectionState } from '../../../hooks/useSectionState'
import { eventTime, isLeadMagnet, threadKind, type Thread } from '../../../lib/inbox'
import { clientBadge } from '../../../lib/labels'
import { relTime } from '../../../exp/v2c/fmt'
import './dms.css'

// The kind marks, restated per Ivan's ask ("like before we mark inmails and dm
// differently"). Email keeps its own mark; a plain LinkedIn thread says DM
// rather than staying unlabelled, so the three channels read apart at a glance.
const KIND_LABEL = { inmail: 'INMAIL', email: 'EMAIL', linkedin: 'DM' } as const

function manualCount(t: Thread): number {
  return t.messages.filter(m => m.direction === 'outbound' && m.ai_model === 'manual_mirror').length
}

// THE WINDOW, and why it is 20. One click used to inline all 213 conversations,
// and because the open flag is persisted the surface came back that way on every
// reload. Twenty is about the last month of replies on current volume. Nothing
// is hidden without saying so: the head keeps the full total and the footer
// states exactly how many are still folded.
const PAGE = 20

export function DmHistory({ threads, onOpen }: {
  threads: Thread[]
  onOpen: (id: string) => void
}) {
  const [sect, setSect] = useSectionState('dms.history')
  const open = sect.open.includes('history')
  // The WINDOW is deliberately NOT persisted, unlike the open flag beside it: a
  // reload is the one moment where "show me everything" is certainly stale.
  const [shown, setShown] = useState(PAGE)
  useEffect(() => { if (!open) setShown(PAGE) }, [open])
  // Lead-magnet deliveries belong here too. They carry no inbound row — the
  // person commented the keyword on a POST rather than writing back — so the raw
  // "had any response" rule hid every one of them.
  const answered = threads
    .filter(t => t.messages.some(m => m.direction === 'inbound') || isLeadMagnet(t))
    .sort((a, b) => eventTime(b.last).localeCompare(eventTime(a.last)))
  if (answered.length === 0) return null

  const replies = answered.reduce((n, t) => n + t.messages.filter(m => m.direction === 'inbound').length, 0)
  // Counted apart: a magnet delivery is not a reply, and rolling it into the
  // replies number would overstate what the engine got back.
  const magnets = answered.filter(isLeadMagnet).length

  function toggle() {
    setSect(s => ({
      ...s,
      open: s.open.includes('history') ? s.open.filter(k => k !== 'history') : [...s.open, 'history'],
    }))
  }

  return (
    <Group
      label="DM history"
      tail={<>
        <span className="a-mono a-dim a-nowrap">
          {answered.length} conversations · {replies} replies
          {magnets > 0 && ` · ${magnets} lead magnet${magnets === 1 ? '' : 's'}`}
        </span>
        <IconButton
          icon={open ? 'discloseUp' : 'disclose'}
          label="DM history"
          size="sm"
          active={open}
          aria-expanded={open}
          onClick={toggle}
        />
      </>}
      foot={open && answered.length > shown
        ? (
          /* What is still folded, counted, with the way to get it. A "show more"
             that does not say how much more is behind it is a guess. */
          <>
            <Button variant="quiet" icon="disclose" onClick={() => setShown(n => n + PAGE)}>
              Show {Math.min(PAGE, answered.length - shown)} more
            </Button>
            <span className="a-mono a-dim">{answered.length - shown} older still folded</span>
          </>
        )
        : undefined}
    >
      {open && (
        <Rows>
          {answered.slice(0, shown).map(t => {
            const kind = threadKind(t)
            const manual = manualCount(t)
            const last = t.last
            const snip = last.direction === 'outbound'
              ? `You: ${last.message_text}`
              : last.message_text
            return (
              <Row
                key={t.prospect_id}
                onClick={() => onOpen(t.prospect_id)}
                lead={<Face name={t.prospect_name} size="sm" />}
                title={
                  <span className="a-dms-titleline">
                    <span className="a-nowrap">{t.prospect_name}</span>
                    <Pill>{clientBadge(t.client_id)}</Pill>
                    <Pill>{KIND_LABEL[kind]}</Pill>
                    {/* A hand-typed reply is the one thing in this list no
                        automation did, so it is marked rather than blended in. */}
                    {manual > 0 && <Pill>BY HAND</Pill>}
                    {/* They commented the gate keyword and the engine sent them
                        the resource. Marked so a delivery never reads as a cold
                        send. */}
                    {isLeadMagnet(t) && <Pill>LEAD MAGNET</Pill>}
                  </span>
                }
                sub={snip}
                tail={<span className="a-mono">{relTime(eventTime(last))}</span>}
              />
            )
          })}
        </Rows>
      )}
    </Group>
  )
}
