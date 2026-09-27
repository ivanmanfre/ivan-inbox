import { useEffect, useState } from 'react'
import type { AutomationAlert } from '../../lib/glance'
import { healthNote } from '../counts/glance'
import { useFrameCounts } from '../counts/useFrameCounts'
import { Sheet } from '../ui/Sheet'
import { Empty, Failed, Skeleton } from '../ui/states'
import { warsawDayTime } from '../ui/time'
import { cleanLine } from './feedShape'

// ---------------------------------------------------------------------------
// WORKFLOWS: automation health's own place (parity: frame-today row 8).
// Today's reads and rules (useGlanceCounts): `dashboard_workflow_stats` (last
// n8n execution failed, active) x `scheduled_ops_status` (enabled, overdue or
// erroring), 7-day window, deduped by name. The number on the Workflows key
// and at the top of the bell is today's rail number: CORROBORATED failures
// only (both views agree it failed and has stopped), never every error
// (Ivan 08-23: "always there" is not an alarm). Everything below the bar is
// listed here, in words. Read only, as today.
// ---------------------------------------------------------------------------

const OPEN_EVENT = 'd-workflows-open'

export function openWorkflows() { window.dispatchEvent(new Event(OPEN_EVENT)) }

const KIND_WORD: Record<AutomationAlert['kind'], string> = {
  both: 'Failed and stopped running',
  errored: 'Last run failed, still scheduled',
  stalled: 'Past its interval, not running',
}

function AlertRow({ a }: { a: AutomationAlert }) {
  const where = [a.source, a.category].filter(Boolean).join(' · ')
  return (
    <div className={`d-wf${a.kind === 'both' ? ' d-wf-hot' : ''}`} data-wf-row>
      <div className="d-wf-h">
        <b>{a.name}</b>
        {a.lastAt && <time>{warsawDayTime(a.lastAt)}</time>}
      </div>
      <small>{KIND_WORD[a.kind]}{where ? ` · ${where}` : ''}{a.acknowledged ? ' · acknowledged' : ''}</small>
      {a.detail && <p>{cleanLine(a.detail).slice(0, 280)}</p>}
    </div>
  )
}

export function WorkflowsBody() {
  const c = useFrameCounts()
  const h = c.health.value
  if (!h) {
    return c.health.failed
      ? <Failed what="the automation health" onRetry={() => c.refresh('health')} />
      : <Skeleton lines={4} label="Reading automation health" />
  }
  const other = h.alerts.filter(a => a.kind !== 'both')
  const older = h.olderErrored + h.olderStalled
  return (
    <div className="d-wfs">
      {h.urgent.length > 0 ? (
        <>
          <p className="d-wf-note">{healthNote(h)}</p>
          {h.urgent.map(a => <AlertRow key={a.key} a={a} />)}
        </>
      ) : (
        <Empty title="No automation has failed and stopped."
          reason={`${other.length} errored in the last 7 days and kept running${h.acknowledged ? `, ${h.acknowledged} acknowledged` : ''}. ${older} have not run in a week.`} />
      )}
      {other.length > 0 && (
        <section>
          <div className="d-fday"><span>Errored in the last 7 days, still running</span><span>{other.length}</span></div>
          {other.map(a => <AlertRow key={a.key} a={a} />)}
        </section>
      )}
      {older > 0 && <p className="d-wf-older">{older} more have not run in a week ({h.olderErrored} last failed, {h.olderStalled} past their interval). They are not alarms.</p>}
    </div>
  )
}

/** The sheet the Workflows key opens (desktop panel, phone drawer, the bell's banner). */
export function WorkflowsHost() {
  const [open, setOpen] = useState(false)
  const c = useFrameCounts()
  const { refresh } = c
  useEffect(() => {
    const on = () => { setOpen(true); refresh('health') }
    window.addEventListener(OPEN_EVENT, on)
    return () => window.removeEventListener(OPEN_EVENT, on)
  }, [refresh])
  const n = c.health.value?.urgent.length ?? null
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Workflows" label="Workflows"
      sub={n == null ? (c.health.failed ? 'Could not read' : 'Reading…') : n === 0 ? 'Nothing failed and stopped' : `${n} failed and stopped`}>
      <WorkflowsBody />
    </Sheet>
  )
}

/** The Workflows key's number: corroborated failures, "?" on a failed read, nothing at zero. */
export function workflowsBadge(c: ReturnType<typeof useFrameCounts>): string | null {
  const n = c.health.value?.urgent.length
  if (n == null) return c.health.failed ? '?' : null
  return n > 0 ? String(n) : null
}
