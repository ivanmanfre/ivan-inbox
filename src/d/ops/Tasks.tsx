import { useEffect, useRef, useState } from 'react'
import {
  completeTask, discardOpsDraft, discardPendingTasks, doneTodayTasks, dueLabel, pendingTasks,
  taskDetails, taskDue, taskSource, taskTitle, type OpsDraft,
} from '../../lib/ops'
import { seatOf, SEAT_NAME } from '../seats'
import { useDConfirm } from '../ui/confirm'
import { Btn } from '../ui/Key'
import { warsawHm } from '../ui/time'

// YOUR LIST. A task is a row, never a card (Ivan 08-29): a small Done key, the
// title (two lines), the detail, and one mono line "due · source · seat ·
// remove" where remove is always drawn (never hover-only). Clear all asks with
// the count. Done today folds under the list. Writes are today's (lib/ops):
// Done = completeTask (the double stamp), remove = discardOpsDraft, Clear all
// = discardPendingTasks, with today's confirm sentences.

const SHOWN = 5
const LEAVE_MS = 420
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function Row({ d, refresh, onLeaving }: { d: OpsDraft; refresh: () => void; onLeaving: () => void }) {
  const confirm = useDConfirm()
  const [busy, setBusy] = useState(false)
  const [ticked, setTicked] = useState(false)
  const [err, setErr] = useState('')
  const title = taskTitle(d.body)
  const detail = taskDetails(d.body)
  const due = taskDue(d)
  const dl = due ? dueLabel(due) : null
  const src = taskSource(d)
  const seat = seatOf(d.client_id)

  async function tick() {
    if (busy || ticked) return
    setBusy(true); setErr(''); setTicked(true)
    try { await completeTask(d); onLeaving() }
    catch (e) { setTicked(false); setErr(errText(e)) }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!(await confirm({ title: 'Remove this task?', message: 'It comes off the board for good. Nothing else happens.', confirmText: 'Remove' }))) return
    setBusy(true); setErr('')
    try { await discardOpsDraft(d.id, d.kind); refresh() }
    catch (e) { setErr(errText(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className={`op-tk${ticked ? ' op-tk-done' : ''}`} data-task={d.id}>
      <div className="op-tt">
        <b>{title}</b>
        {detail && <small>{detail}</small>}
        <div className="op-tm2">
          {dl && <b className={dl.tone === 'over' || dl.tone === 'now' ? 'op-hot' : ''}>due {dl.text}</b>}
          {src && <span>{src === 'WA' ? 'WhatsApp' : src}</span>}
          {seat && seat !== 'ivan' && <span>{SEAT_NAME[seat]}</span>}
          <button type="button" className="op-rm" data-verb="remove" disabled={busy} onClick={() => void remove()} aria-label={`Remove: ${title}`}>remove</button>
        </div>
        {err && <div className="op-err">{err}</div>}
      </div>
      <Btn verb="tick" disabled={busy || ticked} onClick={() => void tick()} aria-label={`Done: ${title}`}>{ticked ? 'Done ✓' : 'Done'}</Btn>
    </div>
  )
}

export function Tasks({ drafts, refresh }: { drafts: OpsDraft[]; refresh: () => void }) {
  const confirm = useDConfirm()
  const [all, setAll] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [err, setErr] = useState('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])
  const tasks = pendingTasks(drafts)
  const done = doneTodayTasks(drafts)
  const shown = all ? tasks : tasks.slice(0, SHOWN)

  async function clearAll() {
    const n = tasks.length
    if (!(await confirm({
      title: n === 1 ? 'Delete the 1 pending task?' : `Delete all ${n} pending tasks?`,
      message: 'They come off the board for good. Nothing is sent and nothing else happens.',
      confirmText: n === 1 ? 'Delete it' : `Delete all ${n}`,
    }))) return
    setClearing(true); setErr('')
    try { await discardPendingTasks(tasks.map(t => t.id)); refresh() }
    catch (e) { setErr(errText(e)) }
    finally { setClearing(false) }
  }

  return (
    <section className="op-list" aria-label="Your list">
      <div className="op-sec">
        <span>Your list <b className={tasks.length ? '' : 'op-dim'}>{tasks.length}</b></span>
        {tasks.length > 0 && <Btn verb="clear-all" disabled={clearing} onClick={() => void clearAll()}>{clearing ? 'Clearing…' : 'Clear all'}</Btn>}
      </div>
      {err && <div className="op-err op-pad">{err}</div>}
      {tasks.length === 0 && <div className="op-quiet">Nothing on your list. A task lands here when you dictate one to WhatsApp or a Claude session writes one.</div>}
      {shown.map(d => <Row key={d.id} d={d} refresh={refresh} onLeaving={() => { timers.current.push(setTimeout(refresh, LEAVE_MS)) }} />)}
      {tasks.length > SHOWN && (
        <button type="button" className="op-fold" aria-expanded={all} onClick={() => setAll(a => !a)}>
          <span>{all ? 'Show fewer' : `${tasks.length - SHOWN} more on the list`}</span>
        </button>
      )}
      {done.length > 0 && (
        <button type="button" className="op-fold" aria-expanded={doneOpen} onClick={() => setDoneOpen(o => !o)}>
          <span>Done today</span><b>{done.length}</b>
        </button>
      )}
      {doneOpen && done.map(d => (
        <div className="op-tk op-tk-dn" key={d.id}>
          <div className="op-tt">
            <b>{taskTitle(d.body)}</b>
            <div className="op-tm2"><span>done {warsawHm(d.sent_at!)}</span>{taskSource(d) && <span>{taskSource(d) === 'WA' ? 'WhatsApp' : taskSource(d)}</span>}</div>
          </div>
        </div>
      ))}
    </section>
  )
}
