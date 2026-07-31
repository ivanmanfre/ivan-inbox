import { useRef, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { unsentAlerts, type AgentAlert, type AgentReminder, type AgentSummary } from '../../lib/agent'
import type { useAgent } from '../../hooks/useAgent'

type Agent = ReturnType<typeof useAgent>

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// Alerts/reminders reuse Settings' .group/.grow row idiom (a list row with a
// trailing pill button) — the same shape already used for the push/chime
// toggles, just with a button instead of a switch.
function AlertRow({ a, onAck }: { a: AgentAlert; onAck: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  async function ack() {
    const ok = await confirm({
      title: 'Acknowledge this alert?',
      message: 'Marks it seen. Nothing else changes.',
      confirmText: 'Ack',
    })
    if (!ok) return
    setBusy(true)
    try { await onAck(a.id) } finally { setBusy(false) }
  }
  return (
    <div className="grow">
      <div className="gtxt">
        <div className="gt">{a.title}</div>
        {a.body && <div className="gs">{a.body}</div>}
        <div className="gs">{relTime(a.created_at)}</div>
      </div>
      <button className="gbtn" disabled={busy} onClick={ack}>{busy ? '…' : 'Ack'}</button>
    </div>
  )
}

function ReminderRow({ r, onDone }: { r: AgentReminder; onDone: (id: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  async function done() {
    const ok = await confirm({
      title: 'Mark this reminder done?',
      message: 'Clears it from the list.',
      confirmText: 'Done',
    })
    if (!ok) return
    setBusy(true)
    try { await onDone(r.id) } finally { setBusy(false) }
  }
  return (
    <div className="grow">
      <div className="gtxt">
        <div className="gt">{r.reminder_text}</div>
        <div className="gs">{relTime(r.remind_at)}</div>
      </div>
      <button className="gbtn" disabled={busy} onClick={done}>{busy ? '…' : 'Done'}</button>
    </div>
  )
}

// Same collapsible header idiom as OpsScreen's Section (ops-sechdr/chev).
function SummarySection({ summaries }: { summaries: AgentSummary[] }) {
  const [open, setOpen] = useState(false)
  if (summaries.length === 0) return null
  return (
    <>
      <div className="ops-sechdr" onClick={() => setOpen(o => !o)}>
        <span>Daily summaries · {summaries.length}</span>
        <span className="chev">{open ? '⌄' : '›'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 16px' }}>
          {summaries.map(s => (
            <div className="log-r" key={s.id} style={{ alignItems: 'flex-start' }}>
              <div className="log-mid">
                <div className="log-top"><span className="log-nm">{s.date}</span></div>
                <div className="log-snip" style={{ whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip' }}>
                  {s.summary}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function AgentScreen({ agent, onOpenChat }: { agent: Agent; onOpenChat: () => void }) {
  const { messages, alerts, reminders, summaries, loading, acknowledgeAlert, completeReminder, refresh } = agent
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const unsent = unsentAlerts(alerts)
  const lastMsg = messages[messages.length - 1]

  return (
    <>
      <div className="nav">
        <div className="row-top"><h2>Agent</h2><div className="avatar-me">IM</div></div>
      </div>
      <div className="rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        <div className="draftbanner" onClick={onOpenChat}>
          <div className="ic">◐</div>
          <div>
            <div className="t">Chat</div>
            <div className="s">{lastMsg ? lastMsg.content.slice(0, 60) : 'Message the assistant'}</div>
          </div>
          <div className="go">›</div>
        </div>

        {loading && alerts.length === 0 && reminders.length === 0 ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            {unsent.length > 0 && (
              <>
                <div className="grouphdr">Alerts</div>
                <div className="group">
                  {unsent.map(a => <AlertRow key={a.id} a={a} onAck={acknowledgeAlert} />)}
                </div>
              </>
            )}
            {reminders.length > 0 && (
              <>
                <div className="grouphdr">Reminders</div>
                <div className="group">
                  {reminders.map(r => <ReminderRow key={r.id} r={r} onDone={id => completeReminder(id)} />)}
                </div>
              </>
            )}
            {unsent.length === 0 && reminders.length === 0 && (
              <div className="empty">Nothing needs you right now.</div>
            )}
            <SummarySection summaries={summaries} />
          </>
        )}
      </div>
    </>
  )
}
