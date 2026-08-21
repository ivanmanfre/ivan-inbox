import { useEffect, useState } from 'react'
import { useSectionState } from '../../hooks/useSectionState'
import { Avatar } from '../../components/Avatar'
import { eventTime, isLeadMagnet, threadKind, type Thread } from '../../lib/inbox'
import { relTime } from './fmt'

// DM HISTORY — the receipt.
//
// Ivan, 2026-08-03: "on dms on a collapsible arrow u should add dm history and
// thats where the chats history should be (the ones that had any response) so i
// know this is working".
//
// The pending list is 0 rows on a good day, and a surface that is empty on a
// good day proves nothing about whether the engine still works. This is the
// other half: every conversation that ever got a reply, newest first, behind one
// arrow so it never competes with the work.
//
// "Had any response" is the membership rule and it is deliberately the RAW one —
// an inbound message exists. None of the closure logic that decides the pending
// list applies here: an out-of-office, a "no thanks", a 👍 are all evidence that
// a human on the other end answered, which is exactly what this section is for.

// The kind marks, restated per Ivan's ask ("like before we mark inmails and dm
// differently"). Email keeps its own mark; a plain LinkedIn thread says DM
// rather than staying unlabelled, so the three channels read apart at a glance.
const KIND_LABEL = { inmail: 'INMAIL', email: 'EMAIL', linkedin: 'DM' } as const
// threadKind's key is 'linkedin'; the CHIP is called DM everywhere else, so the
// class has to be too. Emitting `kind-linkedin` here is what left the DM chip
// wearing the neutral default while INMAIL and EMAIL carried their colours —
// caught by reading computed styles off the deploy, not by looking at it.
const KIND_CLASS = { inmail: 'kind-inmail', email: 'kind-email', linkedin: 'kind-dm' } as const

function manualCount(t: Thread): number {
  return t.messages.filter(m => m.direction === 'outbound' && m.ai_model === 'manual_mirror').length
}

// THE WINDOW, and why it is 20.
//
// One click used to inline all 213 conversations: body text went 2,499 to
// 59,452 characters, controls 12 to 225, none of it virtualised, and because
// the open flag is persisted (`useSectionState`) the surface came back that way
// on every reload. That is a receipt turned into a wall.
//
// The size comes from what the surface is FOR. Ivan's ask was "so i know this
// is working": it is scanned, newest first, to confirm the engine still gets
// replies. Twenty rows is about the last month of them on current volume, it is
// one screen and a bit at 390 rather than seventeen, and it holds the expanded
// body under the 10,000-character gate with room to spare. Nothing is hidden
// from view without saying so: the head keeps the full total, and the footer
// states exactly how many are still folded and adds them a page at a time.
const PAGE = 20

export function DmHistory({ threads, onOpen }: {
  threads: Thread[]
  onOpen: (id: string) => void
}) {
  const [sect, setSect] = useSectionState('dms.history')
  const open = sect.open.includes('history')
  // The WINDOW is deliberately NOT persisted, unlike the open flag beside it: a
  // reload is the one moment where "show me everything" is certainly stale, and
  // a remembered 200-row window would put the wall straight back.
  const [shown, setShown] = useState(PAGE)
  useEffect(() => { if (!open) setShown(PAGE) }, [open])
  // 2026-08-15 (Ivan): lead-magnet deliveries belong here too. They carry no inbound
  // row — the person commented the keyword on a POST rather than writing back — so the
  // raw "had any response" rule hid every one of them. Commenting to ask for something
  // is the same evidence of a human on the other end that this section exists to show.
  const answered = threads
    .filter(t => t.messages.some(m => m.direction === 'inbound') || isLeadMagnet(t))
    .sort((a, b) => eventTime(b.last).localeCompare(eventTime(a.last)))
  if (answered.length === 0) return null

  const replies = answered.reduce((n, t) => n + t.messages.filter(m => m.direction === 'inbound').length, 0)
  // Counted apart: a magnet delivery is not a reply, and rolling it into the replies
  // number would overstate what the engine got back.
  const magnets = answered.filter(isLeadMagnet).length

  return (
    <div className={`dmh${open ? ' on' : ''}`}>
      <button
        type="button"
        className="dmh-h"
        aria-expanded={open}
        onClick={() => setSect(s => ({
          ...s,
          open: s.open.includes('history') ? s.open.filter(k => k !== 'history') : [...s.open, 'history'],
        }))}
      >
        <span className="dmh-c" aria-hidden>{open ? '⌄' : '›'}</span>
        <span className="dmh-n">DM history</span>
        <span className="dmh-m">
          {answered.length} conversations · {replies} replies
          {magnets > 0 && ` · ${magnets} lead magnet${magnets === 1 ? '' : 's'}`}
        </span>
      </button>

      {open && (
        <div className="dmh-rows">
          {answered.slice(0, shown).map(t => {
            const kind = threadKind(t)
            const manual = manualCount(t)
            const last = t.last
            const snip = last.direction === 'outbound'
              ? `You: ${last.message_text}`
              : last.message_text
            return (
              <button type="button" className="dmh-r" key={t.prospect_id} onClick={() => onOpen(t.prospect_id)}>
                <Avatar name={t.prospect_name} client_id={t.client_id} channel={t.channel} />
                <div className="mid">
                  <div className="top">
                    <span className="name">{t.prospect_name}</span>
                    <span className={`client ${t.client_id === 'risedtc' ? 'rise' : ''}`}>
                      {t.client_id === 'risedtc' ? 'RISE' : 'IVAN'}
                    </span>
                    <span className={`client ${KIND_CLASS[kind]}`}>{KIND_LABEL[kind]}</span>
                    {/* A hand-typed reply is the one thing in this list no
                        automation did, so it is marked rather than blended in. */}
                    {manual > 0 && <span className="client kind-manual">BY HAND</span>}
                    {/* They commented the gate keyword and the engine sent them the
                        resource. Marked so a delivery never reads as a cold send. */}
                    {isLeadMagnet(t) && <span className="client kind-lm">LEAD MAGNET</span>}
                  </div>
                  <div className="snip">{snip}</div>
                </div>
                <span className="time">{relTime(eventTime(last))}</span>
              </button>
            )
          })}
          {/* What is still folded, counted, with the way to get it. A "show
              more" that does not say how much more is behind it is a guess. */}
          {answered.length > shown && (
            <button
              type="button"
              className="dmh-more"
              onClick={() => setShown(n => n + PAGE)}
            >
              <span className="dmh-more-l">
                Show {Math.min(PAGE, answered.length - shown)} more
              </span>
              <span className="dmh-more-n">
                {answered.length - shown} older still folded
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
