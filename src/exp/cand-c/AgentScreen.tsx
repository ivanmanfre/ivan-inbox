import { useRef, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useAgent } from '../../hooks/useAgent'
import { unsentAlerts, type AgentAlert, type AgentReminder, type AgentSummary } from '../../lib/agent'
import { ChatScreen } from './ChatScreen'

function ago(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function AlertCard({ alert, onAck }: { alert: AgentAlert; onAck: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()

  async function onAckClick() {
    const ok = await confirm({
      title: 'Acknowledge this alert?',
      message: 'Marks it seen. Nothing else changes.',
      confirmText: 'Ack',
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await onAck(alert.id) }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="ops-card">
      <div className="ops-h">
        <span className="ops-kind" style={{ background: 'rgba(255,69,58,.13)', color: '#FF453A' }}>
          {alert.alert_type.toUpperCase()}
        </span>
        <span className="ops-tm">{ago(alert.created_at)}</span>
      </div>
      <div className="ops-ctx"><span>{alert.title}</span></div>
      {alert.body && <div className="ops-ctx"><span>{alert.body}</span></div>}
      {error && <div className="ops-err">{error}</div>}
      <div className="ops-ac">
        <div className="btn p" onClick={busy ? undefined : onAckClick}>{busy ? 'Acking…' : 'Ack'}</div>
      </div>
    </div>
  )
}

function ReminderRow({ reminder, onDone }: { reminder: AgentReminder; onDone: (id: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  async function onDoneClick() {
    const ok = await confirm({
      title: 'Mark this done?',
      message: 'Stops reminding you about it.',
      confirmText: 'Done',
    })
    if (!ok) return
    setBusy(true)
    try { await onDone(reminder.id) } finally { setBusy(false) }
  }

  return (
    <div className="log-r">
      <div className="log-mid">
        <div className="log-nm">{reminder.reminder_text}</div>
        <div className="log-snip">{new Date(reminder.remind_at).toLocaleString()}</div>
      </div>
      <div className="btn s" style={{ flex: 'none', padding: '8px 14px' }} onClick={busy ? undefined : onDoneClick}>
        {busy ? '…' : 'Done'}
      </div>
    </div>
  )
}

function SummaryRow({ summary, open, onToggle }: { summary: AgentSummary; open: boolean; onToggle: () => void }) {
  return (
    <div className="log-r" style={{ cursor: 'pointer', flexDirection: 'column', alignItems: 'stretch' }} onClick={onToggle}>
      <div className="log-top">
        <span className="log-nm">{summary.date}</span>
        <span className="log-tm">{summary.message_count} msgs</span>
      </div>
      {open && <div className="log-snip" style={{ whiteSpace: 'normal', marginTop: 6 }}>{summary.summary}</div>}
    </div>
  )
}

// Agent segment of the Ops tab: n8nClaw only (AUDIT.md "What AgentOps actually
// is" — the retired Agent-Ready blueprint pipeline is deliberately absent, and
// generic AgentLogFeed usage ships elsewhere, not here). Alerts/reminders are
// the two acks the app is allowed to make (D4 — dashboard_action's allowlist
// reaches outreach-arming fields, so lib/agent.ts hardcodes the two field
// names this screen may ever touch); Chat pushes a full-screen thread.
export function AgentScreen() {
  const { alerts, reminders, summaries, loading, error, refresh, acknowledgeAlert, completeReminder } = useAgent()
  const [chatOpen, setChatOpen] = useState(false)
  const [openSummary, setOpenSummary] = useState<string | null>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, refresh)

  if (chatOpen) return <ChatScreen onBack={() => setChatOpen(false)} />

  const pending = unsentAlerts(alerts)

  if (loading && alerts.length === 0 && reminders.length === 0) {
    return (
      <>
        <div className="nav"><div className="row-top"><h2>Agent</h2><div className="avatar-me">IM</div></div></div>
        <div className="ops-rows">
          {Array.from({ length: 2 }).map((_, i) => (
            <div className="ops-card sk-ops" key={i}>
              <div className="sk sk-line" style={{ width: '30%' }} />
              <div className="sk sk-line" style={{ width: '80%', marginTop: 12 }} />
            </div>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="nav"><div className="row-top"><h2>Agent</h2><div className="avatar-me">IM</div></div></div>
      <div className="rows ops-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {error && <div className="empty">{error}</div>}

        <div className="log-r" style={{ cursor: 'pointer' }} onClick={() => setChatOpen(true)}>
          <div className="log-mid">
            <div className="log-nm">Chat</div>
            <div className="log-snip">Talk to the assistant</div>
          </div>
          <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 20 }}>›</span>
        </div>

        {pending.length > 0 && (
          <>
            <div className="ops-sechdr" style={{ cursor: 'default' }}><span>Alerts · {pending.length}</span></div>
            {pending.map(a => <AlertCard key={a.id} alert={a} onAck={acknowledgeAlert} />)}
          </>
        )}

        {reminders.length > 0 && (
          <>
            <div className="ops-sechdr" style={{ cursor: 'default' }}><span>Reminders · {reminders.length}</span></div>
            <div style={{ padding: '0 16px' }}>
              {reminders.map(r => <ReminderRow key={r.id} reminder={r} onDone={id => completeReminder(id)} />)}
            </div>
          </>
        )}

        {pending.length === 0 && reminders.length === 0 && (
          <div className="empty">Nothing waiting on you.</div>
        )}

        {summaries.length > 0 && (
          <>
            <div className="ops-sechdr" style={{ cursor: 'default' }}><span>Daily summaries · {summaries.length}</span></div>
            <div style={{ padding: '0 16px' }}>
              {summaries.map(s => (
                <SummaryRow
                  key={s.id} summary={s}
                  open={openSummary === s.id}
                  onToggle={() => setOpenSummary(o => o === s.id ? null : s.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
