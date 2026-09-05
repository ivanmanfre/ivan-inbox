/* =========================================================================
   Ops (Direction B) — THE TASK LIST, as a checklist card.

   Copied from src/screens/OpsScreen.tsx. The two interactions stay exactly
   as asymmetric as they are there:
     TICK is SAFE and INSTANT — optimistic paint, reverted if the write
     fails, 420ms of leave before the queue is re-read.
     REMOVE is DESTRUCTIVE and keeps its confirm sheet.

   Direction B: one Card holding a checklist. `Icon name="checked"` for a
   done row, an empty circle for a todo, and a row whose write is in flight
   wears `.dirb-working data-live="true"` so it visibly works and settles
   flat the moment its result lands (Card Status List, isaiahbjork). A row
   waiting on something outside this app — a due date that has arrived or
   passed — keeps a PERSISTENT status pill instead of borrowing the spinner
   (Push Approval Card, felipemenezes098).
   ========================================================================= */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useConfirm } from '../../../components/ConfirmSheet'
import {
  completeTask, discardOpsDraft, doneTodayTasks, dueLabel, pendingTasks,
  taskDetails, taskDue, taskSource, taskTitle,
  type OpsDraft,
} from '../../../lib/ops'
import { Card, Chip, Icon, IconButton, cx, fadeT, rise, spring, stagger } from '../../../ds'
import { errText, timeAgo, type PushToast } from './util'
import './ops.css'

const TICK_LEAVE_MS = 420

// A due chip is a live signal about a deadline, so it is the one place in this
// folder a severity tone is legitimate. The four tones the library already
// returns map straight onto the system's four.
const DUE_TONE = { over: 'urgent', now: 'attention', soon: 'neutral', later: 'quiet' } as const

function Tick({ on, onClick, label }: { on: boolean; onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="opsb-tick"
      data-on={on}
      onClick={onClick}
      aria-label={label}
      aria-pressed={onClick ? on : undefined}
      disabled={!onClick}
    >
      {on ? <Icon name="checked" size={20} /> : <span className="opsb-circle" />}
    </button>
  )
}

function TaskRow({ draft, refresh, onLeaving, onToast }: {
  draft: OpsDraft
  refresh: () => void
  onLeaving: () => void
  onToast?: PushToast
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
      onToast?.({ src: 'Your list', detail: title })
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
    <motion.div
      className={cx('opsb-checkrow', 'dirb-tap', busy && 'dirb-working')}
      data-done={ticked}
      data-live={busy || undefined}
      data-ops-id={draft.id}
      variants={rise}
      initial="hidden"
      animate="show"
      exit="exit"
      layout
      transition={spring}
    >
      <Tick on={ticked} onClick={onTick} label={`Mark done: ${title}`} />
      <div className="opsb-mid">
        <div
          className="opsb-title ds-t-body"
          data-expandable={Boolean(details)}
          onClick={details ? () => setOpen(o => !o) : undefined}
        >
          {title}
        </div>
        {details && (
          <div
            className={cx('opsb-details ds-t-meta', !open && 'opsb-details-clamped')}
            onClick={() => setOpen(o => !o)}
          >
            {details}
          </div>
        )}
        <div className="dirb-row-wrap">
          {dl && <Chip tone={DUE_TONE[dl.tone]} icon="time">due {dl.text}</Chip>}
          {src && <Chip tone="quiet">{src}</Chip>}
          <Chip tone="quiet">{timeAgo(draft.created_at)}</Chip>
        </div>
        {error && (
          <span className="opsb-inline ds-t-meta">
            <Icon name="error" size={16} />
            {error}
          </span>
        )}
      </div>
      <IconButton
        icon="remove"
        label={`Remove: ${title}`}
        variant="danger"
        size="sm"
        onClick={busy ? undefined : onRemove}
      />
    </motion.div>
  )
}

// Exported for the same reason PendingCard is: the workbench owns the FRAME,
// this owns what a task IS. `flush` is kept in the signature because the host
// still passes it, but it is inert in Direction B: the list is a Card inside a
// Surface that already owns the gutter, so there is no inline padding left to
// turn off.
export function TaskList({ drafts, refresh, flush: _flush = false, onToast }: {
  drafts: OpsDraft[]
  refresh: () => void
  flush?: boolean
  onToast?: PushToast
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
    <Card
      className="dirb-lift"
      title={tasks.length > 0 ? `Your list · ${tasks.length}` : undefined}
    >
      <div className="opsb-list">
        <AnimatePresence initial={false}>
          {tasks.map(d => (
            <TaskRow key={d.id} draft={d} refresh={refresh} onLeaving={leaveThen} onToast={onToast} />
          ))}
        </AnimatePresence>
      </div>
      {doneToday.length > 0 && (
        <>
          <button type="button" className="opsb-deckhead" onClick={() => setDoneOpen(o => !o)}>
            <span className="opsb-deckhead-n">Done today · {doneToday.length}</span>
            <Icon name={doneOpen ? 'discloseUp' : 'disclose'} size={16} />
          </button>
          <AnimatePresence initial={false}>
            {doneOpen && (
              <motion.div
                className="opsb-list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: fadeT }}
                exit={{ opacity: 0, transition: fadeT }}
              >
                {doneToday.map((d, i) => (
                  <motion.div
                    key={d.id}
                    className="opsb-checkrow"
                    data-done="true"
                    data-ops-id={d.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { ...spring, delay: stagger(i) } }}
                  >
                    <Tick on />
                    <div className="opsb-mid">
                      <div className="opsb-title ds-t-body">{taskTitle(d.body)}</div>
                    </div>
                    <span className="ds-t-meta dirb-dim">{timeAgo(d.sent_at!)}</span>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </Card>
  )
}
