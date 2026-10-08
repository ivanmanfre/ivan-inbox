import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPayload, type CcPayload } from '../../lib/campaignControl'
import { recall, remember } from '../../lib/pageMemo'
import { supabase } from '../../lib/supabase'
import { ago } from '../../lib/today'
import { useDInbox } from '../counts/inbox'
import { fetchReady, type ReadyRead } from '../lanes/glance/ready'
import { dHash } from '../route'
import { SEAT_NAME, seatOf } from '../seats'
import { withTimeout } from '../ui/timeout'
import { dmsToAnswer, sendAlerts, stockAlerts, type GlanceAlert, type GlanceWire, type SentAt } from './glanceModel'
import './glance.css'

// The Glance (Brief's Mac menu bar item; the phone drawer's card): DMs waiting on Ivan and the seat alerts (no warm stock, low sends,
// LinkedIn refusing, queue empty). The DMs come off the frame's one inbox (no new read); the
// alerts from three reads made every 10 minutes while the window is visible, the first a few
// seconds after the page's own reads. Brief's native sidebar draws the same thing from the
// hidden [data-glance] line (bridge.js).

const EVERY_MS = 10 * 60_000
const FIRST_MS = 6_000
const SHOW_DMS = 4
const SAVED = 'd-glance-alerts-v1'
const SAVED_MAX_MS = 20 * 60_000

type Alerts = { list: GlanceAlert[]; at: number; failed: boolean }

/** invites sent in the last 8 days, every seat, paged past the 1000-row clamp. SELECT only. */
async function fetchSentAt(now: number): Promise<SentAt[]> {
  const since = new Date(now - 8 * 864e5).toISOString()
  const out: SentAt[] = []
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabase.from('outreach_prospects').select('id, at:connection_sent_at, c:outreach_campaigns!inner(client_id)')
      .gte('connection_sent_at', since).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as Array<{ at: string; c: { client_id: string | null } | null }>
    for (const r of rows) { const seat = seatOf(r.c?.client_id ?? null); if (seat && r.at) out.push({ seat, at: r.at }) }
    if (rows.length < 1000) break
  }
  return out
}

function saved(now: number): Alerts | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) ?? 'null') as Alerts | null
    return v && Array.isArray(v.list) && now - v.at < SAVED_MAX_MS ? { ...v, failed: false } : null
  } catch { return null }
}

export function useGlanceAlerts(eager = false): Alerts | null {
  const [a, setA] = useState<Alerts | null>(() => saved(Date.now()))
  const lastAt = useRef(a?.at ?? 0)
  useEffect(() => {
    let t: number | undefined, live = true
    const run = async () => {
      if (document.hidden) { t = window.setTimeout(run, 60_000); return }
      const now = Date.now()
      const [cc, ready, sends] = await Promise.allSettled([
        withTimeout(fetchPayload()).then(s => { if (s.state !== 'ok') throw new Error('monitor'); return s.payload }),
        withTimeout(fetchReady(now)),
        withTimeout(fetchSentAt(now)),
      ])
      if (!live) return
      const p = cc.status === 'fulfilled' ? cc.value : recall<CcPayload>('lanes:cc', now)?.value ?? null
      const r = ready.status === 'fulfilled' ? ready.value : recall<ReadyRead>('lanes:ready', now)?.value ?? null
      if (cc.status === 'fulfilled') remember('lanes:cc', cc.value)
      if (ready.status === 'fulfilled') remember('lanes:ready', ready.value)
      const next = { list: [...sendAlerts(p, sends.status === 'fulfilled' ? sends.value : null, now), ...stockAlerts(r)], at: now, failed: [cc, ready, sends].some(x => x.status === 'rejected') }
      setA(next)
      lastAt.current = now
      try { localStorage.setItem(SAVED, JSON.stringify(next)) } catch { /* full storage: the next read paints again */ }
      t = window.setTimeout(run, EVERY_MS)
    }
    // The phone drawer opens on a tap and closes soon after: read at once there.
    t = window.setTimeout(run, eager ? 0 : FIRST_MS)
    const onShow = () => { if (!document.hidden && lastAt.current && Date.now() - lastAt.current > EVERY_MS) { window.clearTimeout(t); void run() } }
    document.addEventListener('visibilitychange', onShow)
    return () => { live = false; window.clearTimeout(t); document.removeEventListener('visibilitychange', onShow) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return a
}

export function Glance({ onGo, eager = false, dataOnly = false }: { onGo?: () => void; eager?: boolean; dataOnly?: boolean }) {
  const inbox = useDInbox()
  const alerts = useGlanceAlerts(eager)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(i) }, [])
  const threads = inbox.threads ?? []
  const dms = useMemo(() => dmsToAnswer(threads, now), [threads, now])
  const reading = threads.length === 0 && !inbox.loadedAt && !inbox.cachedAt
  const list = alerts?.list ?? []
  const clear = !reading && dms.length === 0 && alerts != null && !alerts.failed && list.length === 0
  const wire: GlanceWire = {
    clear,
    dms: dms.length,
    top: dms.slice(0, SHOW_DMS).map(d => ({ name: d.name, seat: SEAT_NAME[d.seat], kind: d.kind, age: ago(d.since), href: d.href })),
    alerts: list.map(x => ({ text: x.text, tone: x.tone, href: x.href })),
  }
  // Desktop: the Mac menu bar draws it (Brief, from this line); the side panel keeps only the line.
  if (dataOnly) return <span hidden data-glance>{JSON.stringify(wire)}</span>
  return (
    <section className="d-gl" aria-label="Glance">
      <span hidden data-glance>{JSON.stringify(wire)}</span>
      <a className="d-gl-h" href={dHash('dms')} onClick={onGo}>
        <b>Reply to</b><span className={dms.length ? 'd-gl-n d-gl-hot' : 'd-gl-n'}>{reading ? '…' : dms.length}</span>
      </a>
      {dms.slice(0, SHOW_DMS).map(d => (
        <a key={d.id} className="d-gl-dm" href={d.href} onClick={onGo} title={`${d.name} · ${SEAT_NAME[d.seat]} · ${d.kind === 'draft' ? 'draft ready' : 'waiting for your reply'}`}>
          <i className={`d-gl-dot d-gl-${d.kind}`} aria-hidden="true" />
          <span className="d-gl-who"><span className="d-gl-name">{d.name}</span><small>{SEAT_NAME[d.seat]} · {d.kind === 'draft' ? 'draft ready' : 'waiting'} · {ago(d.since)}</small></span>
        </a>
      ))}
      {dms.length > SHOW_DMS && <a className="d-gl-more" href={dHash('dms')} onClick={onGo}>+{dms.length - SHOW_DMS} more</a>}
      {list.length > 0 && <div className="d-gl-h d-gl-ah"><b>Alerts</b><span className="d-gl-n d-gl-hot">{list.length}</span></div>}
      {list.map(x => (
        <a key={x.key} className={`d-gl-al d-gl-${x.tone}`} href={x.href} onClick={onGo}>
          <i aria-hidden="true">!</i><span>{x.text}</span>
        </a>
      ))}
      {clear && <p className="d-gl-ok">Nothing waiting. Sends and stock look normal.</p>}
      {alerts?.failed && <p className="d-gl-fail">Some checks could not be read</p>}
    </section>
  )
}
