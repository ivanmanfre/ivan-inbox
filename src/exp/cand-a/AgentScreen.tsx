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

// An alert body is a machine-written paragraph — the pipeline_stall ones run to
// several sentences. Unclamped they push the ack button off a phone screen and
// the list stops being scannable. Four lines, tap to open; nothing is lost.
const CLAMP_LINES = 4
const clamped: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: CLAMP_LINES,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
}
const unclamped: React.CSSProperties = { whiteSpace: 'pre-wrap' }

// Alerts/reminders reuse Settings' .group/.grow row idiom (a list row with a
// trailing pill button) — the same shape already used for the push/chime
// toggles, just with a button instead of a switch.
function AlertRow({ a, onAck }: { a: AgentAlert; onAck: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
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
        {a.body && (
          <div className="gs" style={open ? unclamped : clamped} onClick={() => setOpen(o => !o)}>
            {a.body}
          </div>
        )}
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
  const { messages, alerts, olderUnsent, reminders, summaries, loading, error, acknowledgeAlert, completeReminder, refresh } = agent
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const unsent = unsentAlerts(alerts)
  const lastMsg = messages[messages.length - 1]

  return (
    // OpsHost now renders the "Ops" title + Cards|Agent switch above this —
    // no own nav/title here (that was the double-header this candidate's fix
    // pass corrected; see OpsHost.tsx).
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

      {error ? (
        // D10: a failed fetch and a genuinely quiet inbox must never share
        // copy. alerts/reminders sit at their last-known values (often empty)
        // when useAgent's refresh() rejects, so without this branch a broken
        // load falls straight into "Nothing needs you right now." below —
        // "all clear" instead of "couldn't load". Quiet card, red tier —
        // distinct from the empty-state's neutral copy.
        <div className="ag-broken">Couldn&rsquo;t load the agent feed — {error}</div>
      ) : loading && alerts.length === 0 && reminders.length === 0 ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
            {(unsent.length > 0 || olderUnsent > 0) && (
              <>
                <div className="grouphdr">Alerts</div>
                {unsent.length > 0 && (
                  <div className="group">
                    {unsent.map(a => <AlertRow key={a.id} a={a} onAck={acknowledgeAlert} />)}
                  </div>
                )}
                {/* The fetch windows to 14 days (lib/agent.ts). Older unsent
                    rows are summarised, not hidden — a silent filter would make
                    a real backlog look like a clean slate (D10). */}
                {olderUnsent > 0 && (
                  <div className="gs" style={{ padding: '8px 22px 0', color: 'var(--text3)' }}>
                    {olderUnsent} older alert{olderUnsent === 1 ? '' : 's'} outside the last 14 days
                  </div>
                )}
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
  )
}
