/* ==========================================================================
   src/wb/ask/ActionPills.tsx: the controls under a bot message.

   Spec section 3's four kinds, and nothing else. Three rules hold here:

   1  NOTHING SENDS. `reply` prefills the composer and stops; the operator turn
      that follows runs under the ordinary rules, with his hand on it (D9).
   2  Every write is one the browser already had. `task` writes the ops_drafts
      row the dictation path writes; `fold` uses `dismissGroup` and the SAME
      Undo the feed's toast uses (D8), by id, so the undo really undoes.
   3  A pill that fired says so and stops being a pill. A task added twice
      because the first tap gave no answer is the defect this avoids.
   ========================================================================== */
import { useState } from 'react'
import { Button, Icon } from '../../ds'
import type { ToastItem } from '../../ds'
import { notificationDeepLink, dismissGroup, listGroupRows, restoreNotifications } from '../../lib/turns'
import { createBotTask } from '../../lib/ops'
import type { Action } from './actions'

export type PillsHost = {
  /** The composer's controlled text, so `reply` can prefill it. */
  setText: (v: string) => void
  /** The stack this surface already mounts, so a fold gets a real receipt. */
  pushToast: (t: ToastItem) => void
}

function openUrl(url: string): void {
  if (/^https:/i.test(url)) { window.open(url, '_blank', 'noreferrer'); return }
  location.hash = notificationDeepLink({ url })
}

type Done = { at: number; label: string }

export function ActionPills({ turnId, groupKey, actions, host }: {
  turnId: string
  /** The rows this message folded: `bot:<turn id>`. */
  groupKey: string
  actions: Action[]
  host: PillsHost
}) {
  const [done, setDone] = useState<Done | null>(null)
  const [busyAt, setBusyAt] = useState<number | null>(null)
  if (!actions.length) return null

  const run = (a: Action, i: number) => {
    if (done?.at === i || busyAt === i) return
    if (a.kind === 'open') { openUrl(a.payload.url); return }
    if (a.kind === 'reply') { host.setText(a.payload.prompt); return }
    if (a.kind === 'task') {
      setBusyAt(i)
      void (async () => {
        const ok = await createBotTask(turnId, i, a.payload.title, a.payload.body)
        setBusyAt(null)
        if (ok) setDone({ at: i, label: 'Added to Ops' })
        else host.pushToast({ id: `${turnId}:${i}:task`, message: 'Could not add that task, try again', icon: 'alert', tone: 'urgent' })
      })()
      return
    }
    // fold. The ids are read FIRST (D8): `dismissGroup` closes by group key and
    // an Undo keyed on the same group key would also resurrect rows dismissed
    // weeks ago, which is a different act than the one this toast offers.
    setBusyAt(i)
    void (async () => {
      try {
        const rows = await listGroupRows(groupKey)
        const ids = rows.filter(r => !r.dismissed_at).map(r => r.id)
        await dismissGroup(groupKey)
        setBusyAt(null)
        setDone({ at: i, label: `${ids.length} folded` })
        host.pushToast({
          id: `${turnId}:${i}:fold`,
          message: `${ids.length} folded`,
          icon: 'discard',
          actionLabel: 'Undo',
          onAction: () => { void restoreNotifications(ids); setDone(null) },
        })
      } catch {
        setBusyAt(null)
        host.pushToast({ id: `${turnId}:${i}:fold`, message: 'Could not fold those, try again', icon: 'alert', tone: 'urgent' })
      }
    })()
  }

  return (
    <div className="a-brain-pills" data-pills>
      {actions.map((a, i) => (
        done?.at === i
          ? (
            <span className="a-brain-pill-done" key={`${a.kind}:${i}`} data-pill-done>
              <Icon name="check" size={16} />{done.label}
            </span>
          )
          : (
            <Button
              key={`${a.kind}:${i}`}
              variant="outline" size="sm"
              onClick={() => run(a, i)}
              disabled={busyAt === i}
            >{a.label}</Button>
          )
      ))}
    </div>
  )
}
