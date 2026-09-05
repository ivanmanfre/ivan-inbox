/* ==========================================================================
   S41 System alert strip, Direction A.

   The view is rebuilt on `Banner` (one banner per open group, tone by
   severity, its action in the banner's action slot and its dismiss in the
   banner's tail). The DECISION half is untouched: `alertStripView`,
   `toggleAlertStrip` and `INITIAL_STRIP_STATE` are imported from the module
   that already owns them, so the auto-open state machine is byte for byte
   the same code, not a copy that can drift.
   ========================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banner, Icon, IconButton, type IconName } from '../../../ds'
import { Dot, Group, Row, Rows } from '../kit'
import {
  alertStripView, toggleAlertStrip, INITIAL_STRIP_STATE,
  type AlertAutoOpen, type AlertStripState,
} from '../../../components/SystemAlertStrip'
import {
  alertSummary, bodyPreview, dismissSystemAlert, fetchSystemAlerts, groupHeadline, shapeAlerts,
  type AlertGroup, type AlertMember, type Severity, type SystemAlert,
} from '../../../lib/systemAlerts'
import './today.css'

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

// The three severities, as system tones rather than the three hexes the old
// strip inlined: critical is the urgent token, warn the attention token, info
// the clear token, which are the same three values under a name.
type AlertTone = 'urgent' | 'attention' | 'clear'

const TONE: Record<Severity, { label: string; tone: AlertTone; icon: IconName }> = {
  critical: { label: 'Critical', tone: 'urgent', icon: 'error' },
  warn: { label: 'Warning', tone: 'attention', icon: 'alert' },
  info: { label: 'Note', tone: 'clear', icon: 'dot' },
}

// The drawn severity mark. Colour is never the only signal: the text label
// sits right beside the dot, both here and at the bar.
function SevMark({ severity }: { severity: Severity }) {
  const t = TONE[severity] ?? TONE.warn
  return (
    <span className="a-today-sev">
      <Dot tone={t.tone} />
      <span className={`a-mono a-sev-${t.tone}`}>{t.label}</span>
    </span>
  )
}

// Whatever bodyPreview() didn't put on the visible line — the rest of a
// multi-bullet scan warning, the outreach lane's stat dump — parked behind
// its own disclosure. Nothing here is deleted, only one tap further away.
function RawBody({ rest }: { rest: string[] }) {
  if (rest.length === 0) return null
  return (
    <details className="a-today-fold">
      <summary><Icon name="disclose" size={16} />Full detail</summary>
      <pre className="a-today-pre">{rest.join('\n')}</pre>
    </details>
  )
}

function ActionLink({ url, label }: { url: string; label: string | null | undefined }) {
  return (
    <a className="a-link a-wrapline" href={url} target="_blank" rel="noreferrer">
      {label || 'Open'}
      <Icon name="external" size={16} />
    </a>
  )
}

// One underlying alert, rendered inside a group's disclosure. Carries its own
// dismiss — collapsing six stores into one row does not mean giving up the
// ability to clear one of them.
function MemberRow({ m, onDismiss }: { m: AlertMember; onDismiss: (ids: string[]) => void }) {
  const { preview, rest } = bodyPreview(m.body)
  return (
    <Row
      title={m.title}
      titleWrap
      actions={<IconButton icon="close" label="Dismiss" size="sm" onClick={() => onDismiss(m.ids)} />}
    >
      {(preview || rest.length > 0 || m.action_url) && (
        <span className="a-today-body">
          {preview && <span className="a-body-t">{preview}</span>}
          <RawBody rest={rest} />
          {m.action_url && <ActionLink url={m.action_url} label={m.action_label} />}
        </span>
      )}
    </Row>
  )
}

function AlertBanner({ g, onDismiss }: { g: AlertGroup; onDismiss: (ids: string[]) => void }) {
  const rep = g.members[0]
  const allIds = useMemo(() => g.members.flatMap(m => m.ids), [g.members])
  const grouped = g.count > 1
  const { preview, rest } = bodyPreview(rep.body)
  const t = TONE[g.severity] ?? TONE.warn

  return (
    <Banner
      tone={t.tone}
      icon={t.icon}
      title={
        <span className="a-today-headline">
          {grouped && <span className="a-figure-t">{g.count}</span>}
          <SevMark severity={g.severity} />
          <span>{grouped ? groupHeadline(g) : rep.title}</span>
        </span>
      }
      action={!grouped && rep.action_url
        ? <ActionLink url={rep.action_url} label={rep.action_label} />
        : undefined}
      onDismiss={() => onDismiss(allIds)}
    >
      {!grouped && (preview || rest.length > 0) && (
        <span className="a-today-body">
          {preview && <span className="a-body-t">{preview}</span>}
          <RawBody rest={rest} />
        </span>
      )}

      {grouped && (
        <details className="a-today-fold">
          <summary>
            <Icon name="disclose" size={16} />
            {g.count} {g.count === 1 ? 'alert' : 'alerts'}, same shape
          </summary>
          <Rows className="a-today-members">
            {g.members.map(m => <MemberRow key={m.ids.join(',')} m={m} onDismiss={onDismiss} />)}
          </Rows>
        </details>
      )}
    </Banner>
  )
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
    <div className="a-today-alerts">
      <Group>
        <Rows>
          <Row
            lead={<span className="a-mono a-ink">{groups.length}</span>}
            title={alertSummary(members)}
            titleWrap
            tail={<Icon name={allShown ? 'disclose' : 'forward'} size={16} />}
            onClick={() => setStrip(cur => toggleAlertStrip(groups, autoOpen, cur))}
          />
        </Rows>
      </Group>
      {visible.map(g => <AlertBanner key={g.key} g={g} onDismiss={dismiss} />)}
    </div>
  )
}
