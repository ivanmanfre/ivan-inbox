import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  alertSummary, bodyPreview, dismissSystemAlert, fetchSystemAlerts, groupHeadline, shapeAlerts,
  type AlertGroup, type AlertMember, type Severity, type SystemAlert,
} from '../lib/systemAlerts'

// Today's note says a system zone was deliberately cut from this surface, and
// that ruling stands for the thing it was aimed at: a permanent shelf of n8n
// workflow errors nobody acts on. This is not that. It renders NOTHING when
// there is nothing open, every row names a dated consequence, and dismissing
// one is final — the writer's unique dedupe_key means no warning can come back
// after it has been read.
//
// The briefing pass (2026-08-21): the strip used to render one row per raw
// database row, unfiltered — a byte-identical duplicate rendered twice, six
// warnings that only differ by store name never grouped, and a CRITICAL card
// concatenated a WARN block into its own string. shapeAlerts() (lib/systemAlerts)
// fixes the shaping, not the source: dedupe on identical body, group by shape
// with a count, split the concatenated card. Nothing here is deleted — grouped
// members and the raw body text are one tap away behind a <details>.

const TONE: Record<Severity, { label: string; dot: string; color: string; bg: string; border: string }> = {
  critical: { label: 'Critical', dot: 'urgent', color: '#FF453A', bg: 'rgba(255,69,58,.10)', border: 'rgba(255,69,58,.32)' },
  warn: { label: 'Warning', dot: 'attention', color: '#FF9F0A', bg: 'rgba(255,159,10,.10)', border: 'rgba(255,159,10,.30)' },
  info: { label: 'Note', dot: 'clear', color: '#10A37F', bg: 'rgba(16,163,127,.10)', border: 'rgba(16,163,127,.30)' },
}

// The drawn severity mark this pass replaces 🔴/⚠ with. `.wb-sech-dot` is the
// same dot the workbench already draws for section-head severity (Surface.tsx)
// — reused rather than forked, so there is one drawn-severity vocabulary in
// the app, not two. Color is never the only signal: the text label sits right
// beside it, both here and at the bar.
function SevMark({ severity }: { severity: Severity }) {
  const t = TONE[severity] ?? TONE.warn
  return (
    <span className="sa-sevmark">
      <span className={`wb-sech-dot ${t.dot}`} />
      <span className="sa-sev" style={{ color: t.color }}>{t.label}</span>
    </span>
  )
}

// Whatever bodyPreview() didn't put on the visible line — the rest of a
// multi-bullet scan warning, the outreach lane's stat dump — parked behind
// its own disclosure. Nothing here is deleted, only one tap further away.
function RawBody({ rest }: { rest: string[] }) {
  if (rest.length === 0) return null
  return (
    <details className="sa-raw">
      <summary>Full detail</summary>
      <pre className="sa-raw-pre">{rest.join('\n')}</pre>
    </details>
  )
}

// One underlying alert, rendered inside a group's disclosure. Carries its own
// dismiss — collapsing six stores into one row does not mean giving up the
// ability to clear one of them.
function MemberRow({ m, onDismiss }: { m: AlertMember; onDismiss: (ids: string[]) => void }) {
  const { preview, rest } = bodyPreview(m.body)
  return (
    <div className="sa-member">
      <div className="sa-member-head">
        <span className="sa-member-t">{m.title}</span>
        <button type="button" className="sa-x sa-member-x" onClick={() => onDismiss(m.ids)} title="Dismiss">✕</button>
      </div>
      {preview && <div className="sa-member-b">{preview}</div>}
      <RawBody rest={rest} />
      {m.action_url && (
        <a className="sa-act" href={m.action_url} target="_blank" rel="noreferrer">{m.action_label || 'Open'} ↗</a>
      )}
    </div>
  )
}

function Row({ g, onDismiss }: { g: AlertGroup; onDismiss: (ids: string[]) => void }) {
  const rep = g.members[0]
  const allIds = useMemo(() => g.members.flatMap(m => m.ids), [g.members])
  const grouped = g.count > 1
  const { preview, rest } = bodyPreview(rep.body)

  return (
    <div className="sa-row" style={{ background: TONE[g.severity].bg, borderColor: TONE[g.severity].border }}>
      <div className="sa-head">
        {grouped && <span className="sa-figure wb-figure">{g.count}</span>}
        <div className="sa-headmid">
          <SevMark severity={g.severity} />
          <span className="sa-title">{grouped ? groupHeadline(g) : rep.title}</span>
        </div>
        <button type="button" className="sa-x" onClick={() => onDismiss(allIds)} title="Dismiss">✕</button>
      </div>

      {!grouped && (
        <>
          {preview && <div className="sa-body">{preview}</div>}
          <RawBody rest={rest} />
          {rep.action_url && (
            <a className="sa-act" href={rep.action_url} target="_blank" rel="noreferrer">
              {rep.action_label || 'Open'} ↗
            </a>
          )}
        </>
      )}

      {grouped && (
        <details className="sa-groupd">
          <summary>{g.count} {g.count === 1 ? 'alert' : 'alerts'}, same shape</summary>
          {g.members.map(m => <MemberRow key={m.ids.join(',')} m={m} onDismiss={onDismiss} />)}
        </details>
      )}
    </div>
  )
}

export function SystemAlertStrip() {
  const [rows, setRows] = useState<SystemAlert[]>([])
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    fetchSystemAlerts()
      .then(r => setRows(r))
      // A read that fails must not paint a false all-clear, but it also must not
      // break Today. Stay silent and let the next poll try again.
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => clearInterval(t)
  }, [load])

  // dedupe/group/split all run off the SAME `rows` state, so dismissing any
  // real id — whether it backs a singleton row, one half of a split card, or
  // one member of a six-store group — just drops that id from the source
  // list and the shape recomputes underneath it.
  const groups = useMemo(() => shapeAlerts(rows), [rows])
  // The bar's own headline counts the SHAPED members (post-split, post-dedupe)
  // rather than the raw rows: the raw count still carries the byte-identical
  // duplicate and the un-split concatenated card, and "1 critical · 19
  // warnings" should mean nineteen distinct warnings, not nineteen rows.
  const members = useMemo(() => groups.flatMap(g => g.members), [groups])

  const dismiss = useCallback((ids: string[]) => {
    const idSet = new Set(ids)
    setRows(cur => cur.filter(r => !idSet.has(r.id)))
    Promise.all(ids.map(id => dismissSystemAlert(id))).catch(() => load())
  }, [load])

  if (groups.length === 0) return null
  // Anything critical opens on sight. A silent grant expiry is not a thing to
  // make someone click for.
  const isOpen = open || groups.some(g => g.severity === 'critical')

  return (
    <div className="sa">
      <button type="button" className="sa-bar" onClick={() => setOpen(!isOpen)}>
        <span className="sa-n">{groups.length}</span>
        <span className="sa-sum">{alertSummary(members)}</span>
        <span className="sa-chev">{isOpen ? '⌄' : '›'}</span>
      </button>
      {isOpen && groups.map(g => <Row key={g.key} g={g} onDismiss={dismiss} />)}
    </div>
  )
}
