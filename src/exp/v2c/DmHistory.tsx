import { useSectionState } from '../../hooks/useSectionState'
import { Avatar } from '../../components/Avatar'
import { eventTime, threadKind, type Thread } from '../../lib/inbox'
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

export function DmHistory({ threads, onOpen }: {
  threads: Thread[]
  onOpen: (id: string) => void
}) {
  const [sect, setSect] = useSectionState('dms.history')
  const open = sect.open.includes('history')
  const answered = threads
    .filter(t => t.messages.some(m => m.direction === 'inbound'))
    .sort((a, b) => eventTime(b.last).localeCompare(eventTime(a.last)))
  if (answered.length === 0) return null

  const replies = answered.reduce((n, t) => n + t.messages.filter(m => m.direction === 'inbound').length, 0)

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
        <span className="dmh-m">{answered.length} conversations · {replies} replies</span>
      </button>

      {open && (
        <div className="dmh-rows">
          {answered.map(t => {
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
                  </div>
                  <div className="snip">{snip}</div>
                </div>
                <span className="time">{relTime(eventTime(last))}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
