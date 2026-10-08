// All sends: the seat's send log at the very bottom of the list, folded by default (remembered).
// Every message that went out in the last 30 days, newest first, tagged Invite / DM1-DM5 / Recycle /
// Follow-up / Reply / InMail / Email / By hand (sendLog.ts), with a filter per tag. A tap unfolds the
// conversation inline (read only), as All conversations does. No writes here.
import { useEffect, useMemo, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { Btn } from '../ui/Key'
import { History } from './History'
import { flat } from './model'
import { Quiet, Row } from './Row'
import { Section, type Folds } from './Section'
import { LOG_DAYS, TOUCH_LABEL, TOUCH_ORDER, readSteps, sentIn, touchOf, type Touch } from './sendLogModel'
import { when, type RowCtx } from './threadRows'

const PAGE = 30
const TONE: Partial<Record<Touch, 'info' | 'ok' | 'neutral' | 'warn'>> = { invite: 'neutral', reply: 'ok', followup: 'warn', recycle: 'warn', delivery: 'ok' }

export function SendLog({ threads, c, folds, v4 = false }: { threads: Thread[]; c: RowCtx; folds: Folds; v4?: boolean }) {
  const sent = useMemo(() => sentIn(threads, c.now), [threads, c.now])
  const open = folds.isOpen('sends', false)
  const [steps, setSteps] = useState<ReadonlyMap<string, number | null> | null>(null)
  const [failed, setFailed] = useState(false)
  const [tag, setTag] = useState<Touch | 'all'>('all')
  const [n, setN] = useState(PAGE)
  const [x, setX] = useState<string | null>(null)
  // Steps are read only once the log is opened (ids + steps, kept for the session).
  useEffect(() => {
    if (!open || steps) return
    let live = true
    readSteps().then(s => { if (live) { setSteps(new Map(s)); setFailed(false) } }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [open, steps])
  const rows = useMemo(() => sent.map(r => ({ ...r, touch: touchOf(r.m, steps?.get(r.m.id)) })), [sent, steps])
  const counts = useMemo(() => {
    const k = new Map<Touch, number>()
    for (const r of rows) k.set(r.touch, (k.get(r.touch) ?? 0) + 1)
    return k
  }, [rows])
  const list = tag === 'all' ? rows : rows.filter(r => r.touch === tag)
  const shown = list.slice(0, n)
  const left = list.length - shown.length
  return (
    <Section id="sends" foldable defaultOpen={false} label={`All sends, ${LOG_DAYS} days`} n={sent.length} folds={folds} rows={[]}
      before={<>
        {failed && <Quiet>The DM numbers could not be read, so DMs show as Other. <button type="button" className="d-link" onClick={() => { setFailed(false); setSteps(null) }}>Retry</button></Quiet>}
        {!steps && !failed && <Quiet>Reading which DM each send was…</Quiet>}
        <div className="dm-sends-tags" role="group" aria-label="Filter sends by type">
          <button type="button" aria-pressed={tag === 'all'} onClick={() => { setTag('all'); setN(PAGE) }}>All <b>{rows.length}</b></button>
          {TOUCH_ORDER.filter(t => counts.get(t)).map(t => (
            <button type="button" key={t} aria-pressed={tag === t} onClick={() => { setTag(t); setN(PAGE) }}>{TOUCH_LABEL[t]} <b>{counts.get(t)}</b></button>
          ))}
        </div>
        {shown.map(({ m, t, touch }) => {
          const open1 = x === m.id
          return (
            <div key={m.id} className="dm-xrow" data-send={touch}>
              <Row v4={v4} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} conversation={false}
                pill={{ text: TOUCH_LABEL[touch], tone: TONE[touch] ?? 'info' }} tags={v4 ? undefined : [{ text: TOUCH_LABEL[touch], kind: 'route' }]}
                line={flat(m.message_text)} right={when(m.sent_at!, c.now)} selected={open1}
                onOpen={() => setX(o => (o === m.id ? null : m.id))} />
              {open1 && (
                <div className="dm-xlog" data-log={t.prospect_id}>
                  <History t={t} cap={40} now={c.now} />
                  <div className="dm-xlog-k"><Btn verb="open-thread" onClick={() => c.open(t)}>Open</Btn></div>
                </div>
              )}
            </div>
          )
        })}
        {!list.length && <Quiet>{sent.length ? 'Nothing of this type in the last 30 days.' : 'Nothing sent from this seat in the last 30 days.'}</Quiet>}
        {left > 0 && <button type="button" className="dm-note dm-showall" data-verb="sends-more" onClick={() => setN(v => v + PAGE)}>
          Show {Math.min(PAGE, left)} more · {left} left</button>}
      </>} />
  )
}
