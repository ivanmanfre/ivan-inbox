// All conversations: the seat's full log at the bottom of the list, folded by default (remembered).
// Every conversation, newest activity first, a status word each (status.ts), the last line and when.
// A tap unfolds the whole conversation INLINE under the row (the thread's own bubbles, read-only)
// with an Open key for the pane; a second tap folds it. A filter field and 30 rows a page keep a
// seat with hundreds of threads fast. It replaces Sent waiting / Older than 2 weeks / Auto-replies.
// No writes here.
import { useState } from 'react'
import { eventTime, searchThreads, type Thread } from '../../lib/inbox'
import { Btn } from '../ui/Key'
import { History } from './History'
import { flat } from './model'
import { Quiet, Row } from './Row'
import { Section, type Folds } from './Section'
import { statusOf } from './status'
import { extras, when, type RowCtx } from './threadRows'

export const ALL_PAGE = 30

export function AllConvos({ threads, c, folds, dated }: { threads: Thread[]; c: RowCtx; folds: Folds; dated: ReadonlyMap<string, string> }) {
  const [q, setQ] = useState('')
  const [n, setN] = useState(ALL_PAGE)
  const [open, setOpen] = useState<string | null>(null)
  const list = q.trim() ? searchThreads(threads, q.trim()) : threads
  const shown = list.slice(0, n)
  const left = list.length - shown.length
  return (
    <Section id="all" foldable defaultOpen={false} label="All conversations" n={threads.length} folds={folds} rows={[]}
      before={<>
        <div className="dm-all-f">
          <input type="search" value={q} aria-label="Filter all conversations" placeholder="Filter by name, company or words"
            onChange={e => { setQ(e.target.value); setN(ALL_PAGE) }} />
        </div>
        {shown.map(t => {
          const st = statusOf(t, c.now, dated.get(t.prospect_id) ?? null)
          const ours = t.last.direction === 'outbound'
          const x = open === t.prospect_id
          const ex = extras(t, c)
          return (
            <div key={t.prospect_id} className="dm-xrow" data-status={st.kind}>
              <Row {...ex} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} dim={st.kind === 'waiting' || st.kind === 'auto'}
                line={<><span className={`dm-st dm-st-${st.kind}`}>{st.word}</span>{ours ? 'You: ' : ''}{flat(t.last.message_text)}</>}
                right={when(eventTime(t.last), c.now)} selected={x || c.selected === t.prospect_id}
                onOpen={() => setOpen(o => (o === t.prospect_id ? null : t.prospect_id))} />
              {x && (
                <div className="dm-xlog" data-log={t.prospect_id}>
                  <History t={t} cap={40} now={c.now} />
                  <div className="dm-xlog-k"><Btn verb="open-thread" onClick={() => c.open(t)}>Open</Btn></div>
                </div>
              )}
            </div>
          )
        })}
        {!list.length && <Quiet>{q.trim() ? 'No conversation matches.' : 'No conversations on this seat yet.'}</Quiet>}
        {left > 0 && <button type="button" className="dm-note dm-showall" data-verb="all-more" onClick={() => setN(v => v + ALL_PAGE)}>
          Show {Math.min(ALL_PAGE, left)} more · {left} left</button>}
      </>} />
  )
}
