/* ==========================================================================
   src/d/home/Tasks.tsx — "Tasks" on Home.

   The same rows and order as Ops' list (lib/ops pendingTasks: overdue, today,
   tomorrow, later, then undated), the same writes: Done = completeTask,
   Remove = discardOpsDraft behind the shared danger confirm, with Ops' own
   sentences. Add = createInboxTask (the one task insert in lib/ops, shared
   with Claude's createBotTask): a title and an optional day, Tomorrow is one tap.
   ========================================================================== */
import { useRef, useState, type FormEvent } from 'react'
import { useOps } from '../../hooks/useOps'
import { useStalled } from '../ui/timeout'
import { completeTask, createInboxTask, discardOpsDraft, dueLabel, localDay, pendingTasks, taskDue, taskTitle, type OpsDraft } from '../../lib/ops'
import { dHash } from '../route'
import { SEAT_NAME, seatOf } from '../seats'
import { useDConfirm } from '../ui/confirm'
import { Btn } from '../ui/Key'

const SHOWN = 6
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const tomorrow = (now = Date.now()) => localDay(now + 864e5)

function Row({ d, refresh }: { d: OpsDraft; refresh: () => void }) {
  const confirm = useDConfirm()
  const [busy, setBusy] = useState(false)
  const [ticked, setTicked] = useState(false)
  const [err, setErr] = useState('')
  const title = taskTitle(d.body)
  const due = taskDue(d)
  const dl = due ? dueLabel(due) : null
  const seat = seatOf(d.client_id)
  async function tick() {
    if (busy || ticked) return
    setBusy(true); setErr(''); setTicked(true)
    try { await completeTask(d); setTimeout(refresh, 420) }
    catch (e) { setTicked(false); setErr(errText(e)) }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!(await confirm({ title: 'Remove this task?', message: 'It comes off the board for good. Nothing else happens.', confirmText: 'Remove', danger: true }))) return
    setBusy(true); setErr('')
    try { await discardOpsDraft(d.id, d.kind); refresh() }
    catch (e) { setErr(errText(e)) }
    finally { setBusy(false) }
  }
  return (
    <li className={`gt-row${ticked ? ' gt-done' : ''}`} data-task={d.id}>
      <Btn verb="tick" disabled={busy || ticked} onClick={() => void tick()} aria-label={`Done: ${title}`}>{ticked ? 'Done ✓' : 'Done'}</Btn>
      <span className="gt-t">{title}{err && <small className="gt-err">{err}</small>}</span>
      <span className="gt-m">
        {dl && <b className={`gt-${dl.tone}`}>{dl.tone === 'over' ? 'overdue' : dl.text}</b>}
        {seat && seat !== 'ivan' && <span>{SEAT_NAME[seat]}</span>}
        <button type="button" className="gt-rm" data-verb="remove" disabled={busy} onClick={() => void remove()} aria-label={`Remove: ${title}`}>remove</button>
      </span>
    </li>
  )
}

function Add({ refresh }: { refresh: () => void }) {
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)
  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true); setErr('')
    const ok = await createInboxTask(text, due || null)
    setBusy(false)
    if (!ok) { setErr('Could not add the task. Nothing was saved.'); return }
    setText(''); setDue(''); refresh(); input.current?.focus()
  }
  const tm = tomorrow()
  return (
    <form className="gt-add" onSubmit={e => void submit(e)}>
      <input ref={input} className="gt-in" value={text} onChange={e => setText(e.target.value)} placeholder="Add a task…" aria-label="New task" maxLength={300} />
      <input className="gt-date" type="date" value={due} min={localDay()} onChange={e => setDue(e.target.value)} aria-label="Due day (optional)" />
      <Btn verb="due-tomorrow" className={due === tm ? 'gt-on' : undefined} onClick={() => setDue(due === tm ? '' : tm)} aria-pressed={due === tm}>Tomorrow</Btn>
      <Btn primary verb="add-task" type="submit" disabled={busy || !text.trim()}>{busy ? 'Adding…' : 'Add'}</Btn>
      {err && <span className="gt-err" role="alert">{err}</span>}
    </form>
  )
}

export function HomeTasks() {
  const ops = useOps()
  const [all, setAll] = useState(false)
  const tasks = pendingTasks(ops.drafts)
  const shown = all ? tasks : tasks.slice(0, SHOWN)
  // 12 s without a first answer = the quiet "?" with Retry (and a quiet re-read every 20 s).
  const stalled = useStalled(!ops.loadedAt && !ops.error, ops.refresh)
  const reading = ops.loading && !ops.loadedAt && !stalled
  const failed = (ops.error || stalled) && !ops.loadedAt
  return (
    <section className="gt" aria-label="Tasks">
      <h2 className="hm-h"><a href={dHash('ops')}>Tasks</a>{ops.loadedAt && tasks.length > 0 && <span className="hm-hn">{tasks.length}</span>}</h2>
      {reading ? <p className="gt-q" aria-label="Reading your tasks">…</p>
        : failed ? <p className="gt-q" title={ops.error ?? 'no answer after 12 s'}><span className="hm-q">?</span> <button type="button" className="gt-rm" data-verb="retry" onClick={ops.refresh}>Retry</button></p>
        : tasks.length === 0 ? <p className="gt-q">Nothing open.</p>
        : <ul className="gt-list">{shown.map(d => <Row key={d.id} d={d} refresh={ops.refresh} />)}</ul>}
      {tasks.length > SHOWN && <button type="button" className="gt-rm gt-more" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Fewer' : `${tasks.length - SHOWN} more`}</button>}
      <Add refresh={ops.refresh} />
    </section>
  )
}
