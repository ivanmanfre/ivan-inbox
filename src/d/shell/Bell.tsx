import { useEffect, useMemo, useRef, useState } from 'react'
import { useFeedData } from '../../exp/brain/b/useFeedData'
import { ALERT_LOOK, kindOf } from '../../wb/ask/alertLook'
import { getTurn, routableHash, type Notification, type NotificationGroup } from '../../lib/turns'
import { dismissSystemAlert, resolveAllSystemAlerts, undoResolveAll } from '../../lib/systemAlerts'
import { useFrameCounts } from '../counts/useFrameCounts'
import { dHash, toDHash } from '../route'
import { DIcon } from '../ui/icons'
import { Btn } from '../ui/Key'
import { Empty, Failed, Skeleton } from '../ui/states'
import { useToast } from '../ui/toast'
import { warsawHm } from '../ui/time'
import { useStalled } from '../ui/timeout'
import { useFrame } from './frame'
import { feedDays } from './feedShape'
import { FeedGroup, inChatTurnId } from './FeedRows'
import { SystemBox } from './SystemAlerts'

// ---------------------------------------------------------------------------
// THE BELL. The button (desktop: right end of the answer row; phone: top bar)
// and the feed it opens (desktop: a panel under the answer row, right; phone:
// a sheet dropped under the top bar, which stays visible).
//
// Count: unread groups from the last four hours, see counts/bell.ts. The badge is a
// white count; it turns lime only while a CRITICAL system alert is open (the
// answer row gets the critical tint, a red top rule, at the same time).
//
// Feed: today's data hook (exp/brain/b/useFeedData) and today's verbs:
//   Clear all  -> dismiss every open notification and resolve system alerts
//                 inside their 14-day reader window; Undo restores both stamps
//   row ×      -> dismissOne / dismissGroupRows, Undo -> restore
//   member ×   -> dismissOne (one row inside an opened group), Undo -> restore
//   row tap    -> markRead + open its deep link inside D; a row Claude folded
//                 (`bot:<turn>`) opens that Claude turn; a url nothing routes -> Lanes
//   alert ×    -> dismissSystemAlert per id (resolved_by 'inbox'), final as today
// Above the feed: the system alerts (SystemAlerts.tsx).
// Digests fold under "Routine updates"; a row landing while scrolled shows "N new".
// ---------------------------------------------------------------------------

export function BellButton() {
  const f = useFrame()
  const c = useFrameCounts()
  const n = c.bell.value?.unreadGroups ?? null
  const crit = c.alerts.value?.critical ?? 0
  // A WHITE count of recent unread groups; the badge turns lime only
  // while a critical system alert (today's rule: an open critical group in
  // system_alerts, 14 days) is open. With nothing unread but a critical open,
  // the lime badge says "!".
  const badge = n == null ? (c.bell.failed ? '?' : crit > 0 ? '!' : null) : n > 0 ? (n > 99 ? '99+' : String(n)) : crit > 0 ? '!' : null
  const label = [
    'Alerts',
    n == null ? (c.bell.failed ? 'count could not be read' : null) : `${n} unread in the last 4 hours`,
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
  // The feed never sits on its skeleton: 12 s, then the failed line with Retry,
  // and a quiet re-read every 20 s until it answers.
  const feedStalled = useStalled(!feed.loaded, () => void feed.refresh())
  const toast = useToast()
  const [clearedAt, setClearedAt] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const clearingRef = useRef(false)
  const [routineOpen, setRoutineOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [scrolled, setScrolled] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const routine = useMemo(() => feed.groups.filter(isRoutine), [feed.groups])
  const days = useMemo(() => feedDays(feed.groups.filter(g => !isRoutine(g))), [feed.groups])
  const fresh = useArrivals(feed.groups.map(g => g.key))
  const open = c.bell.value?.open ?? null
  const unread = c.bell.value?.unreadGroups ?? null
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
    if (clearingRef.current) return
    clearingRef.current = true
    setClearing(true)
    void (async () => {
      const [notificationResult, alertResult] = await Promise.allSettled([feed.clearAll(), resolveAllSystemAlerts()])
      const notificationStamp = notificationResult.status === 'fulfilled' ? notificationResult.value : null
      const alertStamp = alertResult.status === 'fulfilled' ? alertResult.value : null
      if (notificationResult.status === 'rejected') console.error('[d] clear notifications failed', notificationResult.reason)
      if (alertResult.status === 'rejected') console.error('[d] clear alerts failed', alertResult.reason)
      if (notificationStamp) setClearedAt(new Date().toISOString())
      if (alertStamp) setHidden(prev => new Set([...prev, ...(groups ?? []).flatMap(g => g.members.flatMap(m => m.ids))]))
      c.refresh(['bell', 'alerts'])
      clearingRef.current = false
      setClearing(false)
      const failed = !notificationStamp || !alertStamp
      const message = failed
        ? [!notificationStamp && 'Could not clear notifications.', !alertStamp && 'Could not clear system alerts.'].filter(Boolean).join(' ')
        : 'Alerts cleared.'
      if (!notificationStamp && !alertStamp) {
        toast.show({ id: 'clear-all', message, tone: 'failed', action: { label: 'Retry', verb: 'retry', run: clearAll } })
        return
      }
      toast.show({
        id: 'clear-all', message, tone: failed ? 'failed' : undefined,
        action: { label: 'Undo', verb: 'undo', run: () => {
          void Promise.allSettled([
            notificationStamp ? feed.undoClear(notificationStamp) : Promise.resolve(),
            alertStamp ? undoResolveAll(alertStamp) : Promise.resolve(),
          ]).then(([notifications, alerts]) => {
            if (notifications.status === 'fulfilled' && notificationStamp) setClearedAt(null)
            if (alerts.status === 'fulfilled' && alertStamp) setHidden(new Set())
            c.refresh(['bell', 'alerts'])
            if (notifications.status === 'rejected' || alerts.status === 'rejected') {
              console.error('[d] undo clear failed', notifications.status === 'rejected' ? notifications.reason : alerts.status === 'rejected' ? alerts.reason : null)
              toast.show({ id: 'clear-all-undo', message: 'Could not restore every alert.', tone: 'failed' })
            }
          })
        } },
      })
    })()
  }

  // The badge's number covers recent unread incidents; day headers
  // describe all unread groups visible in that day's feed.
  const systemEmpty = groups != null && groups.length === 0 && !c.alerts.failed
  const sub = clearedAt && !clearing && !feed.error && feed.groups.length === 0 && systemEmpty ? 'All clear' : feed.error && !feed.loaded ? 'Could not read the feed'
    : unread == null ? (c.bell.failed ? 'Count could not be read' : 'Reading…')
      : `${unread === 0 ? 'No' : unread} unread in the last 4 hours · ${(open ?? 0).toLocaleString('en-US')} not cleared`
  const arrived = [...fresh].filter(k => feed.groups.some(g => g.key === k)).length

  return (
    <div className={`d-bellp d-bellp-${f.layout}`} role="dialog" aria-label="Alerts" data-bell-feed>
      <div className="d-bellp-h">
        <div className="d-bellp-t"><b>Alerts</b><small>{sub}</small></div>
        {(feed.groups.length > 0 || (groups?.length ?? 0) > 0) && <Btn verb="clear-all" onClick={clearAll} disabled={clearing}>Clear all</Btn>}
        <button type="button" className="d-ib" aria-label="Close alerts" onClick={close}><DIcon name="x" /></button>
      </div>
      <div className="d-bellp-b" ref={scroller} onScroll={e => setScrolled((e.currentTarget.scrollTop ?? 0) > 8)}>
        <SystemBox groups={groups} failed={c.alerts.failed} onRetry={() => c.refresh('alerts')} onDismiss={dismissAlert} />
        {!feed.loaded && !feedStalled && <Skeleton lines={5} label="Reading notifications" />}
        {feedStalled && <Failed what="the notifications" detail="No answer in 12 s. Still trying in the background." onRetry={() => void feed.refresh()} />}
        {feed.loaded && feed.error && feed.groups.length === 0 && <Failed what="the notifications" onRetry={() => void feed.refresh()} />}
        {feed.loaded && !feed.error && !clearing && feed.groups.length === 0 && systemEmpty && (
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
