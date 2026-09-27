import { useEffect, useMemo, useRef, useState } from 'react'
import { useFeedData } from '../../exp/brain/b/useFeedData'
import { ALERT_LOOK, kindOf } from '../../wb/ask/alertLook'
import { getTurn, routableHash, type Notification, type NotificationGroup } from '../../lib/turns'
import { dismissSystemAlert, resolveAllSystemAlerts, undoResolveAll } from '../../lib/systemAlerts'
import { healthNote } from '../counts/glance'
import { useFrameCounts } from '../counts/useFrameCounts'
import { dHash, toDHash } from '../route'
import { DIcon } from '../ui/icons'
import { Btn } from '../ui/Key'
import { Empty, Failed, Skeleton } from '../ui/states'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawHm } from '../ui/time'
import { useFrame } from './frame'
import { feedDays } from './feedShape'
import { FeedGroup, inChatTurnId } from './FeedRows'
import { SystemBox } from './SystemAlerts'
import { WorkQueue } from './WorkQueue'
import { openWorkflows } from './Workflows'

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
//   member ×   -> dismissOne (one row inside an opened group), Undo -> restore
//   row tap    -> markRead + open its deep link inside D; a row Claude folded
//                 (`bot:<turn>`) opens that Claude turn; a url nothing routes -> Lanes
//   Clear alerts (system box) -> resolveAllSystemAlerts, Undo -> undoResolveAll
//   alert ×    -> dismissSystemAlert per id (resolved_by 'inbox'), final as today
// Above the feed: the Workflows alarm (corroborated failures, opens Workflows),
// Waiting on you (WorkQueue.tsx) and the system alerts (SystemAlerts.tsx).
// Digests fold under "Routine updates"; a row landing while scrolled shows "N new".
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

/** A group that is a routine digest (today's "Routine updates" fold). */
const isRoutine = (g: NotificationGroup) => ALERT_LOOK[kindOf(g.family, g.latest.severity)].routine

/** Keys that arrived after the first paint (today's arrival pill). */
function useArrivals(keys: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const sig = keys.join('|')
  useEffect(() => {
    if (seen.current == null) { if (keys.length) seen.current = new Set(keys); return }
    const add = keys.filter(k => !seen.current!.has(k))
    for (const k of add) seen.current.add(k)
    if (add.length) setFresh(prev => new Set([...prev, ...add]))
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  return fresh
}

export function BellFeed() {
  const f = useFrame()
  const c = useFrameCounts()
  const feed = useFeedData()
  const confirm = useDConfirm()
  const toast = useToast()
  const [clearedAt, setClearedAt] = useState<string | null>(null)
  const [routineOpen, setRoutineOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [scrolled, setScrolled] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const routine = useMemo(() => feed.groups.filter(isRoutine), [feed.groups])
  const days = useMemo(() => feedDays(feed.groups.filter(g => !isRoutine(g))), [feed.groups])
  const fresh = useArrivals(feed.groups.map(g => g.key))
  const open = c.bell.value?.open ?? null
  const unread = c.bell.value?.unreadGroups ?? null
  const health = c.health.value
  const groups = useMemo(() => {
    const gs = c.alerts.value?.groups ?? null
    if (!gs || hidden.size === 0) return gs
    return gs.map(g => ({ ...g, members: g.members.filter(m => !m.ids.every(id => hidden.has(id))) }))
      .map(g => ({ ...g, count: g.members.length })).filter(g => g.count > 0)
  }, [c.alerts.value, hidden])
  // The newest unread row that needs him takes the lime "Pick this up" (today's primary).
  const primaryKey = useMemo(() => feed.groups.find(g => g.unread > 0 && kindOf(g.family, g.latest.severity) === 'needs_you')?.key ?? null, [feed.groups])

  const close = () => f.setBellOpen(false)
  const go = (hash: string) => { close(); f.navigate(hash) }

  const openRow = (n: Notification) => {
    feed.markRead(n)
    c.refresh('bell')
    const url = (n.url ?? '').trim()
    const turn = inChatTurnId(n)
    if (turn) {
      // Claude already wrote about it: open that turn, as today (Feed.tsx getTurn).
      void getTurn(turn).then(row => {
        go(row ? dHash('claude', null, { thread: row.thread_id, turn: row.id }) : (toDHash(routableHash(url) ?? '') ?? dHash('lanes')))
      }).catch(() => go(toDHash(routableHash(url) ?? '') ?? dHash('lanes')))
      return
    }
    if (/^https?:\/\//i.test(url)) { window.open(url, '_blank', 'noopener,noreferrer'); return }
    const h = routableHash(url)
    // An address nothing routes lands on Lanes, today's fallback, never nowhere.
    go((h ? toDHash(h) : null) ?? dHash('lanes'))
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

  // One row inside an opened group: that row only, the rest of the group stays.
  const dismissMember = (n: Notification) => {
    void (async () => {
      const ok = await feed.dismissOne(n.id, n)
      c.refresh('bell')
      if (!ok) { toast.show({ id: `dismiss-${n.id}`, message: 'Could not dismiss. Nothing changed.', tone: 'failed', action: { label: 'Retry', verb: 'retry', run: () => dismissMember(n) } }); return }
      toast.show({ id: `dismiss-${n.id}`, message: 'Dismissed.', action: { label: 'Undo', verb: 'undo', run: () => { feed.restore([n]); c.refresh('bell') } } })
    })()
  }

  const dismissAlert = (ids: string[], what: string) => {
    setHidden(prev => new Set([...prev, ...ids]))
    void Promise.all(ids.map(id => dismissSystemAlert(id))).then(() => {
      c.refresh('alerts')
      toast.show({ id: `alert-${ids[0]}`, message: `${what} dismissed. It does not come back.` })
    }, (e: unknown) => {
      console.error('[d] dismiss alert failed', e)
      setHidden(prev => { const next = new Set(prev); for (const id of ids) next.delete(id); return next })
      c.refresh('alerts')
      toast.show({ id: `alert-${ids[0]}`, message: 'Could not dismiss the alert. Nothing changed.', tone: 'failed', action: { label: 'Retry', verb: 'retry', run: () => dismissAlert(ids, what) } })
    })
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
      const n = (groups ?? []).reduce((a, g) => a + g.count, 0)
      // Today's strip asks this one as a danger confirm: Cancel focused, Enter never clears.
      const ok = await confirm({
        title: 'Clear the system alerts?',
        message: `The ${n} open in the last 14 days are marked resolved. New ones still land. Undo stays on the receipt for a few seconds.`,
        confirmText: 'Clear alerts', verb: 'confirm', danger: true,
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

  const sub = clearedAt ? 'All read' : feed.error && !feed.loaded ? 'Could not read the feed'
    : unread == null ? (c.bell.failed ? 'Count could not be read' : 'Reading…')
      : unread === 0 ? 'All read' : `${unread} unread · ${(open ?? 0).toLocaleString('en-US')} open`
  const arrived = [...fresh].filter(k => feed.groups.some(g => g.key === k)).length

  return (
    <div className={`d-bellp d-bellp-${f.layout}`} role="dialog" aria-label="Alerts" data-bell-feed>
      <div className="d-bellp-h">
        <div className="d-bellp-t"><b>Alerts</b><small>{sub}</small></div>
        {feed.groups.length > 0 && <Btn verb="clear-all" onClick={clearAll}>Clear all</Btn>}
        <button type="button" className="d-ib" aria-label="Close alerts" onClick={close}><DIcon name="x" /></button>
      </div>
      <div className="d-bellp-b" ref={scroller} onScroll={e => setScrolled((e.currentTarget.scrollTop ?? 0) > 8)}>
        {health && health.urgent.length > 0 && (
          <button type="button" className="d-wfban" data-verb="workflows" onClick={() => { close(); openWorkflows() }}>
            <DIcon name="workflows" />
            <span><b>{health.urgent.length} automation alert{health.urgent.length === 1 ? '' : 's'}</b><small>{healthNote(health)}</small></span>
            <em>Open</em>
          </button>
        )}
        <WorkQueue go={go} />
        <SystemBox groups={groups} failed={c.alerts.failed} onRetry={() => c.refresh('alerts')} onClear={clearAlerts} onDismiss={dismissAlert} />
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
            {d.groups.map(g => <FeedGroup key={g.key} g={g} onOpen={openRow} onDismissAll={dismiss} onDismissOne={dismissMember} primary={g.key === primaryKey} />)}
          </section>
        ))}
        {routine.length > 0 && (
          <section className="d-routine" data-routine>
            <button type="button" className="d-routine-h" aria-expanded={routineOpen} onClick={() => setRoutineOpen(o => !o)}>
              <span>Routine updates</span><b>{routine.length}</b><em>{routineOpen ? 'Hide' : 'Show'}</em>
            </button>
            {routineOpen && routine.map(g => <FeedGroup key={g.key} g={g} onOpen={openRow} onDismissAll={dismiss} onDismissOne={dismissMember} />)}
          </section>
        )}
      </div>
      {arrived > 0 && scrolled && (
        <button type="button" className="d-newpill" onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })}>{arrived} new</button>
      )}
    </div>
  )
}
