import { useState } from 'react'
import { bodyPreview, cleanTitle, groupHeadline, type AlertGroup, type AlertMember } from '../../lib/systemAlerts'
import { DIcon } from '../ui/icons'
import { warsawDow, warsawHm } from '../ui/time'
import { cleanLine } from './feedShape'

// ---------------------------------------------------------------------------
// SYSTEM ALERTS at the top of the bell (today: wb/today/alerts.tsx on Today and
// the feed). Every group and every member carries what today's strip carried:
//   - its own dismiss (×): system_alerts.resolved_at = now, resolved_by 'inbox',
//     per id (lib/systemAlerts dismissSystemAlert). Final, as today: the
//     writer's unique dedupe_key means a read alert never comes back;
//   - the action link, "Open ↗" (the Instagram reconnect path this table was
//     built for), opened in a new tab;
//   - the body's first line, and the rest behind "Full detail";
//   - a grouped shape ("6 stores, same failure") opens to its members, each
//     with its own body, link and ×.
// Critical groups open with their detail showing; the rest open on a tap.
// Every group is reachable: the list shows four, then "Show N more" in place.
// ---------------------------------------------------------------------------

const SEV_WORD: Record<string, string> = { critical: 'critical', warn: 'warning', info: 'note' }
const FIRST = 4

function ActionLink({ m }: { m: AlertMember }) {
  if (!m.action_url) return null
  return (
    <a className="d-sys-go" href={m.action_url} target="_blank" rel="noreferrer" data-verb="open-link">
      {m.action_label || 'Open'} <DIcon name="external" />
    </a>
  )
}

function Body({ m }: { m: AlertMember }) {
  const { preview, rest } = bodyPreview(m.body)
  if (!preview && rest.length === 0 && !m.action_url) return null
  return (
    <div className="d-sys-body">
      {preview && <p>{cleanLine(preview)}</p>}
      {rest.length > 0 && (
        <details className="d-sys-full"><summary>Full detail</summary><pre>{rest.join('\n')}</pre></details>
      )}
      <ActionLink m={m} />
    </div>
  )
}

function X({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="d-sys-x" data-verb="dismiss-alert" aria-label={label} onClick={onClick}>
      <DIcon name="x" />
    </button>
  )
}

function GroupRow({ g, onDismiss }: { g: AlertGroup; onDismiss: (ids: string[], what: string) => void }) {
  const [open, setOpen] = useState(g.severity === 'critical')
  const rep = g.members[0]
  const grouped = g.count > 1
  const title = grouped ? groupHeadline(g) : cleanLine(cleanTitle(rep.title))
  const all = g.members.flatMap(m => m.ids)
  return (
    <div className={`d-sys-g${open ? ' d-open' : ''}`} data-sys-group>
      <div className="d-sys-a">
        <button type="button" className="d-sys-t" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <i className={`d-sev d-sev-${g.severity}`}>{SEV_WORD[g.severity] ?? g.severity}</i>
          <b>{title}</b>
          <span>{warsawDow(g.newestCreatedAt)} {warsawHm(g.newestCreatedAt)}</span>
        </button>
        <X label={grouped ? `Dismiss all ${g.count}` : `Dismiss ${title}`} onClick={() => onDismiss(all, grouped ? `${g.count} alerts` : 'Alert')} />
      </div>
      {/* The link stays one tap away while folded, on its own line so the title keeps its width. */}
      {!grouped && rep.action_url && !open && <div className="d-sys-golink"><ActionLink m={rep} /></div>}
      {open && !grouped && <Body m={rep} />}
      {open && grouped && (
        <div className="d-sys-members">
          <small>{g.count} alerts, same shape. Each one clears on its own.</small>
          {g.members.map(m => (
            <div key={m.ids.join(',')} className="d-sys-m" data-sys-member>
              <div className="d-sys-mh"><b>{cleanLine(cleanTitle(m.title))}</b><X label={`Dismiss ${cleanTitle(m.title)}`} onClick={() => onDismiss(m.ids, 'Alert')} /></div>
              <Body m={m} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SystemBox({ groups, failed, onRetry, onDismiss }: {
  groups: AlertGroup[] | null; failed: boolean; onRetry: () => void
  onDismiss: (ids: string[], what: string) => void
}) {
  const [all, setAll] = useState(false)
  if (failed) return <p className="d-sysline d-sysline-bad" data-sys-alerts="failed">System alerts could not be read · <button type="button" className="d-sysline-k" data-verb="retry" onClick={onRetry}>Retry</button></p>
  // Never an empty box (final gate 09-27): reading, failed and "none open" are
  // one mono line each; the bordered box is drawn only around real alerts.
  if (groups == null) return <p className="d-sysline" data-sys-alerts="reading" role="status">Reading system alerts…</p>
  if (groups.length === 0) return null
  const crit = groups.filter(g => g.severity === 'critical').length
  const open = groups.reduce((a, g) => a + g.count, 0)
  const shown = all ? groups : groups.slice(0, FIRST)
  return (
    <div className={`d-sys${crit ? ' d-sys-crit' : ''}`} data-sys-alerts>
      <div className="d-sys-h">
        <span>System alerts · {open} open, 14 days</span>
      </div>
      {shown.map(g => <GroupRow key={g.key} g={g} onDismiss={onDismiss} />)}
      {groups.length > FIRST && (
        <button type="button" className="d-sys-more" aria-expanded={all} onClick={() => setAll(a => !a)}>
          {all ? 'Show the first four' : `Show ${groups.length - FIRST} more`}
        </button>
      )}
    </div>
  )
}
