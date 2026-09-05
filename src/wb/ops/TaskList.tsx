/* ==========================================================================
   Direction A · the task list (S12-10 to S12-17).

   2026-08-29, Ivan, on the task card shipped the day before: "u made it a shitty
   text dude make it a more crm thing with thick or something... better
   functioning". "thick" is tick. A task is never sent, so it is never a draft
   card: it is a ROW.

   Direction A keeps that ruling and takes it further — the rows are dense
   hairline rows inside one `Group` with a checkbox lead, the due/source/age meta
   is mono, and Remove is an inline action that appears in the row on hover or
   focus (leads-data-table) instead of sitting permanently in the margin.

   The two interactions stay deliberately asymmetric, which is the app's existing
   rule and not a new one:
     TICK is SAFE and INSTANT. Nothing is sent, nothing is public, and the row is
     still readable in "Done today" underneath.
     REMOVE is DESTRUCTIVE and keeps its sheet.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import {
  completeTask, discardOpsDraft, doneTodayTasks, dueLabel, pendingTasks, taskDetails, taskDue,
  taskSource, taskTitle, type OpsDraft,
} from '../../lib/ops'
import { Icon, IconButton } from '../../ds'
import { Group, Row, Rows, Sep } from '../kit'
import { errText, timeAgo } from './PendingCard'
import './ops.css'

const TICK_LEAVE_MS = 420

/** The checkbox lead. A settled tick is a mark, not a control. */
function TickMark() {
  return <span className="a-ops-tick" data-on=""><Icon name="check" size={16} /></span>
}

function TaskRow({ draft, refresh, onLeaving }: {
  draft: OpsDraft
  refresh: () => void
  onLeaving: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Painted the moment he taps, before the write returns. It is reverted if the
  // write fails, so an optimistic tick can never leave a task looking handled
  // when the row was not stamped.
  const [ticked, setTicked] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()

  const title = taskTitle(draft.body)
  const details = taskDetails(draft.body)
  const due = taskDue(draft)
  const dl = due ? dueLabel(due) : null
  const src = taskSource(draft)

  async function onTick() {
    if (busy || ticked) return
    setBusy(true); setError(''); setTicked(true)
    try {
      await completeTask(draft)
      // The row plays its strike-through and fade where it stands, THEN the
      // queue is re-read. Refreshing immediately would yank it mid-animation
      // and the tick would read as the row simply vanishing.
      onLeaving()
    } catch (e) {
      setTicked(false)
      setError(errText(e))
    } finally { setBusy(false) }
  }

  async function onRemove() {
    const ok = await confirm({
      title: 'Remove this task?',
      message: 'It comes off the board for good. Nothing else happens.',
      confirmText: 'Remove',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await discardOpsDraft(draft.id); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  return (
    <Row
      className={`a-ops-task${ticked ? ' a-ops-task-done' : ''}`}
      id={`ops-${draft.id}`}
      lead={
        <IconButton
          icon="check"
          label={`Mark done: ${title}`}
          variant="ghost"
          size="sm"
          round
          active={ticked}
          className="a-ops-tickbtn"
          onClick={onTick}
        />
      }
      title={
        details
          ? <button type="button" className="a-plain a-ops-tt" onClick={() => setOpen(o => !o)}>{title}</button>
          : title
      }
      titleWrap
      sub={details
        ? <button type="button" className="a-plain a-ops-td" data-open={open ? '' : undefined} onClick={() => setOpen(o => !o)}>{details}</button>
        : undefined}
      subWrap
      meta={
        <>
          {dl && <span className={`a-ops-due a-ops-due-${dl.tone}`}>due {dl.text}</span>}
          {src && <span>{src}</span>}
          <span className="a-dim-2">{timeAgo(draft.created_at)}</span>
        </>
      }
      tail={busy || ticked
        ? <span className="a-mono a-working a-ops-state">Working…</span>
        : undefined}
      actions={
        <IconButton
          icon="close"
          label={`Remove: ${title}`}
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onRemove}
        />
      }
    >
      {error && <span className="a-ops-err a-meta">{error}</span>}
    </Row>
  )
}

// Exported for the same reason PendingCard is: the board owns the FRAME, this
// owns what a task IS.
export function TaskList({ drafts, refresh }: {
  drafts: OpsDraft[]
  refresh: () => void
}) {
  // Ids that have been ticked and are playing out. They are held here rather
  // than in the row so the delayed refresh survives the row unmounting.
  const [doneOpen, setDoneOpen] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const tasks = pendingTasks(drafts)
  const doneToday = doneTodayTasks(drafts)
  if (tasks.length === 0 && doneToday.length === 0) return null

  const leaveThen = () => {
    timers.current.push(setTimeout(refresh, TICK_LEAVE_MS))
  }

  return (
    <div className="a-stack" data-tight>
      {tasks.length > 0 && (
        <Group label={<>Your list<Sep />{tasks.length}</>}>
          <Rows>
            {tasks.map(d => (
              <TaskRow key={d.id} draft={d} refresh={refresh} onLeaving={leaveThen} />
            ))}
          </Rows>
        </Group>
      )}
      {doneToday.length > 0 && (
        <Group
          label={<>Done today<Sep />{doneToday.length}</>}
          tail={
            <IconButton
              icon={doneOpen ? 'disclose' : 'forward'}
              label={doneOpen ? 'Hide done today' : 'Show done today'}
              variant="ghost"
              size="sm"
              onClick={() => setDoneOpen(o => !o)}
            />
          }
        >
          {doneOpen && (
            <Rows>
              {doneToday.map(d => (
                <Row
                  key={d.id}
                  className="a-ops-task"
                  id={`ops-${d.id}`}
                  lead={<TickMark />}
                  title={taskTitle(d.body)}
                  titleWrap
                  tail={<span className="a-dim-2">{timeAgo(d.sent_at!)}</span>}
                />
              ))}
            </Rows>
          )}
        </Group>
      )}
    </div>
  )
}
