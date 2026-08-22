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

// How much this strip opens by itself, and whether the reader's collapse is
// allowed to win. Two behaviours travel under one prop because they are one
// decision: a strip that force-opens every group on any critical CANNOT also
// honour a collapse, which is exactly the defect below.
//
//   'all'      the pre-existing behaviour, kept verbatim for #exp/stock: one
//              critical opens every group, and the bar cannot close them.
//   'critical' the workbench: only the CRITICAL groups open on sight, warnings
//              wait behind the summary line, and a collapse sticks until a
//              critical the reader has not already seen arrives.
export type AlertAutoOpen = 'all' | 'critical'

// What the READER last asked of the strip, and what they had already seen when
// they asked it. `choice` is null until they touch the bar at all; `acked`
// holds the keys of the critical groups that were on screen at the moment they
// collapsed.
//
// This is a STATE MACHINE and it is written as one, because the defect it
// replaces was the same machine written as `open || anyCritical`: one boolean
// expression that has no way to represent "the reader closed this", so the
// control did nothing for as long as any critical existed. Kept pure and
// exported so the transitions can be driven by a test instead of a browser.
export type AlertStripState = {
  choice: 'all' | 'collapsed' | null
  acked: string[]
  // 'all' mode's original flag, untouched, so #exp/stock keeps the exact
  // behaviour it shipped with.
  open: boolean
}

export const INITIAL_STRIP_STATE: AlertStripState = { choice: null, acked: [], open: false }

// A group's key is its FAILURE SHAPE (severity + source + digit-stripped
// body), so "a critical the reader has not seen" means a critical whose shape
// is new. A second store failing the same check the reader already collapsed
// is the same alert, not a new one, and must not re-open the strip over them.
function criticalKeysOf(groups: AlertGroup[]): string[] {
  return groups.filter(g => g.severity === 'critical').map(g => g.key)
}

// Which groups render, and whether that is all of them.
//
// 'all' is the pre-existing branch, unchanged: one critical opens everything.
// 'critical' opens ONLY the critical groups on sight. The warnings behind
// them wait at the summary line. The safety property is intact (a critical
// still opens without a click); what is gone is the blast radius, which on
// 2026-08-22 was 1485px of alerts on a work area 780px tall.
export function alertStripView(
  groups: AlertGroup[], autoOpen: AlertAutoOpen, s: AlertStripState,
): { visible: AlertGroup[]; allShown: boolean } {
  const criticalKeys = criticalKeysOf(groups)
  const visible = autoOpen === 'all'
    ? ((s.open || criticalKeys.length > 0) ? groups : [])
    // The reader's own choice is read FIRST, which is the whole fix: a
    // collapse is state, not a term in an expression something else can
    // override.
    : s.choice === 'all' ? groups
    : criticalKeys.some(k => !s.acked.includes(k)) ? groups.filter(g => g.severity === 'critical')
    : []
  // The chevron answers "is there more than this", not "is anything showing".
  // in 'critical' mode some groups render while the warnings stay behind the
  // bar, and that state has to read as more-to-come, not as fully open.
  return { visible, allShown: visible.length > 0 && visible.length === groups.length }
}

// One press of the bar.
export function toggleAlertStrip(
  groups: AlertGroup[], autoOpen: AlertAutoOpen, s: AlertStripState,
): AlertStripState {
  const { allShown } = alertStripView(groups, autoOpen, s)
  if (autoOpen === 'all') return { ...s, open: !(s.open || criticalKeysOf(groups).length > 0) }
  // Acking the criticals currently on screen is what lets a collapse stick
  // without deafening the reader to the next NEW one.
  if (allShown) return { ...s, choice: 'collapsed', acked: criticalKeysOf(groups) }
  return { ...s, choice: 'all' }
}

export function SystemAlertStrip({ autoOpen = 'all' }: { autoOpen?: AlertAutoOpen } = {}) {
  const [rows, setRows] = useState<SystemAlert[]>([])
  const [strip, setStrip] = useState<AlertStripState>(INITIAL_STRIP_STATE)

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
  // make someone click for, and that intent is intact. What changed is the
  // blast radius: opening the critical groups no longer opens the nineteen
  // warnings behind them.
  const { visible, allShown } = alertStripView(groups, autoOpen, strip)

  return (
    <div className="sa">
      <button
        type="button" className="sa-bar"
        onClick={() => setStrip(cur => toggleAlertStrip(groups, autoOpen, cur))}
      >
        <span className="sa-n">{groups.length}</span>
        <span className="sa-sum">{alertSummary(members)}</span>
        <span className="sa-chev">{allShown ? '⌄' : '›'}</span>
      </button>
      {visible.map(g => <Row key={g.key} g={g} onDismiss={dismiss} />)}
    </div>
  )
}
