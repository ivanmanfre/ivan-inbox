import { useMemo, useState } from 'react'
import { useFeedData } from '../../exp/brain/b/useFeedData'
import { lookOf } from '../../wb/ask/alertLook'
import { routableHash, type Notification, type NotificationGroup } from '../../lib/turns'
import { cleanTitle, groupHeadline, resolveAllSystemAlerts, undoResolveAll, type AlertGroup } from '../../lib/systemAlerts'
import { useFrameCounts } from '../counts/useFrameCounts'
import { toDHash } from '../route'
import { DIcon, type DIconName } from '../ui/icons'
import { Btn } from '../ui/Key'
import { Empty, Failed, Skeleton } from '../ui/states'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDow, warsawHm } from '../ui/time'
import { useFrame } from './frame'
import { bodyLine, cleanLine, feedDays } from './feedShape'

// ---------------------------------------------------------------------------
// THE BELL. The button (desktop: right end of the answer row; phone: top bar)
// and the feed it opens (desktop: a panel under the answer row, right; phone:
// a sheet dropped under the top bar, which stays visible).
//
// Count (coordinator ruling): unread GROUPS, see counts/bell.ts. The badge is a
// white count; it turns lime only while a CRITICAL system alert is open (the
// answer row gets the critical tint, a red top rule, at the same time).
//
// Feed: today's data hook (exp/brain/b/useFeedData) and today's verbs:
//   Clear all  -> dismissAllNotifications(stamp)  PATCH inbox_notifications
//                 set dismissed_at=<stamp> where dismissed_at is null (every
//                 open row, not only the 200 loaded; db/056 supersede path)
//   its Undo   -> restoreDismissedAt(stamp)       PATCH ... dismissed_at=null where dismissed_at=<stamp>
//   row ×      -> dismissOne / dismissGroupRows, Undo -> restore
//   row tap    -> markRead + open its deep link inside D
//   Clear alerts (system box) -> resolveAllSystemAlerts, Undo -> undoResolveAll
// ---------------------------------------------------------------------------

export function BellButton() {
  const f = useFrame()
  const c = useFrameCounts()
  const n = c.bell.value?.unreadGroups ?? null
  const crit = c.alerts.value?.critical ?? 0
  // Final ruling: a WHITE count of unread groups; the badge turns lime only
  // while a critical system alert (today's rule: an open critical group in
  // system_alerts, 14 days) is open. With nothing unread but a critical open,
  // the lime badge says "!".
  const badge = n == null ? (c.bell.failed ? '?' : crit > 0 ? '!' : null) : n > 0 ? (n > 99 ? '99+' : String(n)) : crit > 0 ? '!' : null
  const label = [
    'Alerts',
    n == null ? (c.bell.failed ? 'count could not be read' : null) : `${n} unread`,
    crit > 0 ? `${crit} critical alert${crit === 1 ? '' : 's'} open` : null,
  ].filter(Boolean).join(', ')
  return (
    <button
      type="button"
      className={`d-bell${f.bellOpen ? ' d-on' : ''}${crit > 0 ? ' d-crit' : ''}`}
      aria-label={label} aria-expanded={f.bellOpen} data-verb="bell"
      onClick={() => f.setBellOpen(!f.bellOpen)}
    >
      <DIcon name="bell" />
      {badge != null && <b className="d-bell-n">{badge}</b>}
    </button>
  )
}

const KIND_ICON: Record<string, DIconName> = {
  needs_you: 'person', failed: 'alert', reply: 'dms', booking: 'time', reminder: 'time', done: 'check', seen: 'eye', digest: 'sum',
}
const KIND_TONE: Record<string, string> = { needs_you: 'd-k-hl', failed: 'd-k-bad', booking: 'd-k-hl' }
const TENANT: Record<string, string> = { arch: 'Arch', rise: 'Rise', risedtc: 'Rise', ivan: 'Ivan' }

const SEV_WORD: Record<string, string> = { critical: 'critical', warn: 'warning', info: 'note' }

function SystemBox({ groups, failed, onRetry, onClear }: {
  groups: AlertGroup[] | null; failed: boolean; onRetry: () => void; onClear: () => void
}) {
  const crit = (groups ?? []).filter(g => g.severity === 'critical').length
  const open = (groups ?? []).reduce((a, g) => a + g.count, 0)
  if (groups == null) {
    return failed
      ? <div className="d-sys"><Failed what="system alerts" onRetry={onRetry} /></div>
      : <div className="d-sys"><Skeleton lines={2} title={false} label="Reading system alerts" /></div>
  }
  return (
    <div className={`d-sys${crit ? ' d-sys-crit' : ''}`} data-sys-alerts>
      <div className="d-sys-h">
        <span>System alerts · {open} open, 14 days</span>
        {open > 0 && <button type="button" className="d-sys-clear" data-verb="clear-alerts" onClick={onClear}>Clear alerts</button>}
      </div>
      {groups.slice(0, 4).map(g => (
        <div key={g.key} className="d-sys-a">
          <i className={`d-sev d-sev-${g.severity}`}>{SEV_WORD[g.severity] ?? g.severity}</i>
          <b>{g.count > 1 ? groupHeadline(g) : cleanLine(cleanTitle(g.members[0].title))}</b>
          <span>{warsawDow(g.newestCreatedAt)} {warsawHm(g.newestCreatedAt)}</span>
        </div>
      ))}
      {groups.length > 4 && <div className="d-sys-ok">{groups.length - 4} more open in today's app.</div>}
      {crit === 0 && <div className="d-sys-ok">{open === 0 ? 'No system alert open in 14 days.' : 'No critical alert open.'} A critical one turns the bell red.</div>}
    </div>
  )
}

function FeedRow({ g, onOpen, onDismiss }: { g: NotificationGroup; onOpen: (n: Notification) => void; onDismiss: (g: NotificationGroup) => void }) {
  const n = g.latest
  const look = lookOf(n.family, n.severity)
  const tenant = TENANT[(n.tenant ?? '').toLowerCase()] ?? ''
  const body = bodyLine(n)
  return (
    <div className={`d-fn${g.unread ? ' d-fn-u' : ''}`} data-feed-row>
      <button type="button" className="d-fn-open" onClick={() => onOpen(n)}>
        <span className={`d-fn-k ${KIND_TONE[look.kind] ?? ''}`}><DIcon name={KIND_ICON[look.kind] ?? 'sum'} /></span>
        <span className="d-fn-m">
          <u>{look.label}{tenant ? ` · ${tenant}` : ''}</u>
          <b>{cleanLine(n.title) || look.label}</b>
          {body && <small>{body}</small>}
        </span>
        <span className="d-fn-r">
          <time>{warsawHm(g.lastSeenAt)}</time>
          {g.count > 1 && <span className="d-fn-ct" aria-label={`${g.count} times`}>{g.count}×</span>}
        </span>
      </button>
      <button type="button" className="d-fn-x" data-verb="dismiss" aria-label={`Dismiss ${cleanLine(n.title)}`} onClick={() => onDismiss(g)}>
        <DIcon name="x" />
      </button>
    </div>
  )
}

export function BellFeed() {
  const f = useFrame()
  const c = useFrameCounts()
  const feed = useFeedData()
  const confirm = useDConfirm()
  const toast = useToast()
  const [clearedAt, setClearedAt] = useState<string | null>(null)
  const days = useMemo(() => feedDays(feed.groups), [feed.groups])
  const open = c.bell.value?.open ?? null
  const unread = c.bell.value?.unreadGroups ?? null

  const close = () => f.setBellOpen(false)

  const openRow = (n: Notification) => {
    feed.markRead(n)
    c.refresh('bell')
    const url = (n.url ?? '').trim()
    if (/^https?:\/\//i.test(url)) { window.open(url, '_blank', 'noopener,noreferrer'); return }
    const h = routableHash(url)
    const d = h ? toDHash(h) : null
    close()
    if (d) f.navigate(d)
  }

  const dismiss = (g: NotificationGroup) => {
    void (async () => {
      const ok = g.items.length > 1 || g.groupKey ? await feed.dismissGroupRows(g) : await feed.dismissOne(g.latest.id, g.latest)
      c.refresh('bell')
      if (!ok) { toast.show({ id: `dismiss-${g.key}`, message: 'Could not dismiss. Nothing changed.', tone: 'failed', action: { label: 'Retry', verb: 'retry', run: () => dismiss(g) } }); return }
      toast.show({
        id: `dismiss-${g.key}`, message: g.count > 1 ? `${g.count} dismissed.` : 'Dismissed.',
        action: { label: 'Undo', verb: 'undo', run: () => { feed.restore(g.items); c.refresh('bell') } },
      })
    })()
  }

  const clearAll = () => {
    void (async () => {
      const n = open
      const ok = await confirm({
        title: 'Clear every notification?',
        message: `${n != null ? `All ${n.toLocaleString('en-US')} open` : 'Every open'} notification${n === 1 ? '' : 's'} go, not only the ones on screen. Undo stays on the receipt for a few seconds.`,
        confirmText: 'Clear all',
      })
      if (!ok) return
      const stamp = await feed.clearAll()
      if (!stamp) {
        toast.show({ id: 'clear-all', message: 'Could not clear. Nothing changed.', tone: 'failed', action: { label: 'Retry', verb: 'retry', run: clearAll } })
        return
      }
      setClearedAt(new Date().toISOString())
      c.refresh('bell')
      toast.show({
        id: 'clear-all',
        message: `Cleared ${n != null ? n.toLocaleString('en-US') + ' ' : ''}notification${n === 1 ? '' : 's'}.`,
        sub: 'Every one, not only the ones on screen.',
        action: { label: 'Undo', verb: 'undo', run: () => { void feed.undoClear(stamp).then(() => { setClearedAt(null); c.refresh('bell') }) } },
      })
    })()
  }

  const clearAlerts = () => {
    void (async () => {
      const n = (c.alerts.value?.groups ?? []).reduce((a, g) => a + g.count, 0)
      const ok = await confirm({
        title: 'Clear the system alerts?',
        message: `The ${n} open in the last 14 days are marked resolved. Undo stays on the receipt for a few seconds.`,
        confirmText: 'Clear alerts', verb: 'confirm',
      })
      if (!ok) return
      let stamp: string
      try { stamp = await resolveAllSystemAlerts() } catch (e) {
        console.error('[d] clear alerts failed', e)
        toast.show({ id: 'clear-alerts', message: 'Could not clear the alerts. Nothing changed.', tone: 'failed' })
        return
      }
      c.refresh('alerts')
      toast.show({
        id: 'clear-alerts', message: `${n} alert${n === 1 ? '' : 's'} cleared.`,
        action: { label: 'Undo', verb: 'undo', run: () => { void undoResolveAll(stamp).catch(e => console.error('[d] undo clear alerts failed', e)).then(() => c.refresh('alerts')) } },
      })
    })()
  }

  const sub = feed.error && !feed.loaded ? 'Could not read the feed'
    : unread == null ? (c.bell.failed ? 'Count could not be read' : 'Reading…')
      : unread === 0 ? 'All read' : `${unread} unread · ${(open ?? 0).toLocaleString('en-US')} open`

  return (
    <div className={`d-bellp d-bellp-${f.layout}`} role="dialog" aria-label="Alerts" data-bell-feed>
      <div className="d-bellp-h">
        <div className="d-bellp-t"><b>Alerts</b><small>{sub}</small></div>
        {feed.groups.length > 0 && <Btn verb="clear-all" onClick={clearAll}>Clear all</Btn>}
        <button type="button" className="d-ib" aria-label="Close alerts" onClick={close}><DIcon name="x" /></button>
      </div>
      <div className="d-bellp-b">
        <SystemBox groups={c.alerts.value?.groups ?? null} failed={c.alerts.failed} onRetry={() => c.refresh('alerts')} onClear={clearAlerts} />
        {!feed.loaded && <Skeleton lines={5} label="Reading notifications" />}
        {feed.loaded && feed.error && feed.groups.length === 0 && <Failed what="the notifications" onRetry={() => void feed.refresh()} />}
        {feed.loaded && !feed.error && feed.groups.length === 0 && (
          <Empty
            title={clearedAt ? `Nothing new since ${warsawHm(clearedAt)}.` : feed.lastEmptySince ? `Nothing new since ${warsawHm(feed.lastEmptySince)}.` : 'Nothing here yet.'}
            reason="New replies, failures and bookings land here and on your phone."
          />
        )}
        {days.map(d => (
          <section key={d.day}>
            <div className="d-fday"><span>{d.day}</span>{d.unread > 0 && <span>{d.unread} unread</span>}</div>
            {d.groups.map(g => <FeedRow key={g.key} g={g} onOpen={openRow} onDismiss={dismiss} />)}
          </section>
        ))}
      </div>
    </div>
  )
}
