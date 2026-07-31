import { useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import type { AgentReminder } from '../../lib/agent'

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function RemRow({ r, onDone }: { r: AgentReminder; onDone: (id: number) => Promise<void> }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function complete() {
    const ok = await confirm({
      title: 'Mark this reminder done?',
      message: r.reminder_text,
      confirmText: 'Mark done',
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await onDone(r.id) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update') }
    finally { setBusy(false) }
  }

  return (
    <div className="log-r">
      <div className="log-mid">
        <div className="log-top"><span className="log-nm">{r.reminder_text}</span></div>
        <div className="log-snip">{when(r.remind_at)}{r.recurrence ? ` · ${r.recurrence}` : ''}</div>
        {error && <div className="ops-reason">{error}</div>}
      </div>
      <div
        className="btn s"
        style={{ flex: 'none', padding: '8px 14px', cursor: 'pointer' }}
        onClick={busy ? undefined : complete}
      >
        {busy ? '…' : 'Done'}
      </div>
    </div>
  )
}

// Pushed from the Studio hub's reminders row. Read + one write (mark done),
// same RPC wrapper the hub uses (ackReminder via dashboard_action's fixed
// allowlist, D4) — every completion is confirmed first (D11).
export function RemindersScreen({ reminders, onComplete, onBack }: {
  reminders: AgentReminder[]; onComplete: (id: number) => Promise<void>; onBack: () => void
}) {
  return (
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who"><div className="n">Reminders</div></div>
      </div>
      <div className="rows" style={{ padding: '12px 16px' }}>
        {reminders.length === 0
          ? <div className="empty">Nothing pending.</div>
          : reminders.map(r => <RemRow key={r.id} r={r} onDone={onComplete} />)}
      </div>
    </>
  )
}
