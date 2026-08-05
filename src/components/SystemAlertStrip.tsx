import { useCallback, useEffect, useState } from 'react'
import {
  alertSummary, dismissSystemAlert, fetchSystemAlerts, rankAlerts, type SystemAlert,
} from '../lib/systemAlerts'

// Today's note says a system zone was deliberately cut from this surface, and
// that ruling stands for the thing it was aimed at: a permanent shelf of n8n
// workflow errors nobody acts on. This is not that. It renders NOTHING when
// there is nothing open, every row names a dated consequence, and dismissing
// one is final — the writer's unique dedupe_key means no warning can come back
// after it has been read.

const TONE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: 'Critical', color: '#FF453A', bg: 'rgba(255,69,58,.10)', border: 'rgba(255,69,58,.32)' },
  warn: { label: 'Warning', color: '#FF9F0A', bg: 'rgba(255,159,10,.10)', border: 'rgba(255,159,10,.30)' },
  info: { label: 'Note', color: '#10A37F', bg: 'rgba(16,163,127,.10)', border: 'rgba(16,163,127,.30)' },
}

function Row({ a, onDismiss }: { a: SystemAlert; onDismiss: (id: string) => void }) {
  const t = TONE[a.severity] ?? TONE.warn
  return (
    <div className="sa-row" style={{ background: t.bg, borderColor: t.border }}>
      <div className="sa-head">
        <span className="sa-sev" style={{ color: t.color }}>{t.label}</span>
        <span className="sa-title">{a.title}</span>
        <button type="button" className="sa-x" onClick={() => onDismiss(a.id)} title="Dismiss">✕</button>
      </div>
      {a.body && <div className="sa-body">{a.body}</div>}
      {a.action_url && (
        // The connect link is a capability the account owner clicks, so it opens
        // out rather than trying to do anything from in here.
        <a className="sa-act" href={a.action_url} target="_blank" rel="noreferrer">
          {a.action_label || 'Open'} ↗
        </a>
      )}
    </div>
  )
}

export function SystemAlertStrip() {
  const [rows, setRows] = useState<SystemAlert[]>([])
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    fetchSystemAlerts()
      .then(r => setRows(rankAlerts(r)))
      // A read that fails must not paint a false all-clear, but it also must not
      // break Today. Stay silent and let the next poll try again.
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => clearInterval(t)
  }, [load])

  const dismiss = useCallback((id: string) => {
    setRows(cur => cur.filter(r => r.id !== id))
    dismissSystemAlert(id).catch(() => load())
  }, [load])

  if (rows.length === 0) return null
  // Anything critical opens on sight. A silent grant expiry is not a thing to
  // make someone click for.
  const isOpen = open || rows.some(r => r.severity === 'critical')

  return (
    <div className="sa">
      <button type="button" className="sa-bar" onClick={() => setOpen(!isOpen)}>
        <span className="sa-n">{rows.length}</span>
        <span className="sa-sum">{alertSummary(rows)}</span>
        <span className="sa-chev">{isOpen ? '⌄' : '›'}</span>
      </button>
      {isOpen && rows.map(a => <Row key={a.id} a={a} onDismiss={dismiss} />)}
    </div>
  )
}
