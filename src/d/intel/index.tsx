import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { useReportFailed } from '../shell/health'
import { AnswerRow, N } from '../ui/AnswerRow'
import { DIcon } from '../ui/icons'
import { Btn } from '../ui/Key'
import { Empty, Failed, Skeleton } from '../ui/states'
import { useToast } from '../ui/toast'
import { DROP_WINDOW_DAYS, FEED_WINDOW_DAYS, ago, clock, inDropped, inFeed, length, sortSources, tabOf, watchUrl, type IntelItem, type IntelSource, type IntelTab } from './model'
import './intel.css'

// D · INTEL. YouTube without the mess: every new upload from the chosen
// channels (plus channels found by the weekly search) is read in full and
// judged against what we run and what is open (~/.claude/intel-feed). The feed
// shows only recent keeps (and drops Ivan rescued). Useful / Noise go back into
// the judge; Mute stops a channel. Writer: ~/.claude/intel-feed/run.py. Tables:
// db/240_intel_feed.sql.

const ITEM_COLS = 'id,source_id,source_name,url,title,published_at,duration_sec,found_via,verdict,score,headline,what_new,applies_to,try_this,watch_from_sec,drop_reason,ivan_verdict,created_at'

type Load<T> = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: T }

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

export default function IntelPage({ layout, route, navigate }: PlaceProps) {
  const tab = tabOf(route.query)
  const toast = useToast()
  const [items, setItems] = useState<Load<IntelItem[]>>({ kind: 'loading' })
  const [sources, setSources] = useState<Load<IntelSource[]>>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const retry = useCallback(() => setTick(t => t + 1), [])

  // Reads: keeps and drops are separate queries so a busy week of drops can never push a keep out.
  // Rows Ivan touched since a read started keep their local value when that read lands, so a refresh can
  // never revert a tap (finding r2-5). `confirmed` holds the last value the server accepted per row.
  const touched = useRef(new Map<string, number>())
  const confirmed = useRef(new Map<string, string | null>())
  const inflight = useRef(new Map<string, number>())

  useEffect(() => {
    let live = true
    const t0 = Date.now()
    const fresh = (key: string) => (touched.current.get(key) ?? 0) >= t0 || (inflight.current.get(key) ?? 0) > 0
    Promise.all([
      supabase.from('intel_items').select(ITEM_COLS).or('verdict.eq.keep,ivan_verdict.eq.useful')
        .gte('published_at', daysAgo(FEED_WINDOW_DAYS)).order('published_at', { ascending: false }).limit(200),
      supabase.from('intel_items').select(ITEM_COLS).eq('verdict', 'drop')
        .gte('created_at', daysAgo(DROP_WINDOW_DAYS)).order('created_at', { ascending: false }).limit(300),
      supabase.from('intel_sources').select('id,name,url,topic,status,added_by,note,items_judged,items_kept,last_kept_at'),
    ]).then(([k, d, s]) => {
      if (!live) return
      setNow(Date.now())
      const err = k.error ?? d.error
      if (err) setItems({ kind: 'failed', message: err.message })
      else {
        const byId = new Map<string, IntelItem>()
        for (const r of [...(k.data ?? []), ...(d.data ?? [])] as IntelItem[]) byId.set(r.id, r)
        setItems(prev => {
          const local = new Map(prev.kind === 'ready' ? prev.data.map(x => [x.id, x]) : [])
          return { kind: 'ready', data: [...byId.values()].map(r => {
            const key = 'item:' + r.id
            if (fresh(key)) { const l = local.get(r.id); return l ? { ...r, ivan_verdict: l.ivan_verdict } : r }
            confirmed.current.set(key, r.ivan_verdict)  // a clean read is the server's value (finding r3-2)
            return r
          }) }
        })
      }
      if (s.error) setSources({ kind: 'failed', message: s.error.message })
      else setSources(prev => {
        const local = new Map(prev.kind === 'ready' ? prev.data.map(x => [x.id, x]) : [])
        return { kind: 'ready', data: ((s.data ?? []) as IntelSource[]).map(r => {
          const key = 'src:' + r.id
          if (fresh(key)) { const l = local.get(r.id); return l ? { ...r, status: l.status } : r }
          confirmed.current.set(key, r.status)
          return r
        }) }
      })
    })
    return () => { live = false }
  }, [tick])

  // The installed app stays open for days: re-read when it comes back to the front or back online.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') retry() }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('online', retry)
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('online', retry) }
  }, [retry])

  useReportFailed('intel', (items.kind === 'failed' ? 1 : 0) + (sources.kind === 'failed' ? 1 : 0))

  const all = useMemo(() => items.kind === 'ready' ? items.data : [], [items])
  const keeps = useMemo(() => all.filter(i => inFeed(i, now)).sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? '')), [all, now])
  const drops = useMemo(() => all.filter(i => inDropped(i, now)).sort((a, b) => b.created_at.localeCompare(a.created_at)), [all, now])
  const srcList = useMemo(() => sources.kind === 'ready' ? sortSources(sources.data) : [], [sources])
  const following = srcList.filter(s => s.status === 'core' || s.status === 'trial').length
  const fresh = keeps.filter(i => !i.ivan_verdict).length

  // Writes are serialized per row: each tap waits for the previous write on that row, and only the
  // newest tap may roll back, so a slow early request can never overwrite or undo a later choice.
  const chains = useRef(new Map<string, Promise<unknown>>())
  const seqs = useRef(new Map<string, number>())
  const serial = useCallback((key: string, current: string | null, next: string | null, write: () => PromiseLike<{ error: { message: string } | null }>) => {
    const seq = (seqs.current.get(key) ?? 0) + 1
    seqs.current.set(key, seq)
    touched.current.set(key, Date.now())
    inflight.current.set(key, (inflight.current.get(key) ?? 0) + 1)
    if (!confirmed.current.has(key)) confirmed.current.set(key, current)
    const p = (chains.current.get(key) ?? Promise.resolve()).then(() => write())
    chains.current.set(key, p.catch(() => undefined))
    return p.then(r => {
      touched.current.set(key, Date.now())
      inflight.current.set(key, (inflight.current.get(key) ?? 1) - 1)
      if (!r.error) confirmed.current.set(key, next)
      // On the newest tap's failure, restore what the server last accepted (finding r2-4).
      return { error: r.error, latest: seqs.current.get(key) === seq, restore: confirmed.current.get(key) ?? null }
    })
  }, [])

  const rate = useCallback(async (item: IntelItem, v: 'useful' | 'noise' | null, before: IntelItem['ivan_verdict'] = item.ivan_verdict) => {
    setItems(p => p.kind === 'ready' ? { kind: 'ready', data: p.data.map(x => x.id === item.id ? { ...x, ivan_verdict: v } : x) } : p)
    const { error, latest, restore } = await serial('item:' + item.id, item.ivan_verdict, v, () =>
      supabase.from('intel_items').update({ ivan_verdict: v, ivan_verdict_at: v ? new Date().toISOString() : null }).eq('id', item.id))
    if (error) {
      if (latest) setItems(p => p.kind === 'ready' ? { kind: 'ready', data: p.data.map(x => x.id === item.id ? { ...x, ivan_verdict: restore as IntelItem['ivan_verdict'] } : x) } : p)
      toast.show({ message: 'Could not save that.', sub: error.message, tone: 'failed' })
      return
    }
    if (v === 'noise') toast.show({ id: 'intel-' + item.id, message: 'Marked noise. The judge learns from it.', action: { label: 'Undo', verb: 'undo', run: () => void rate(item, before, 'noise') } })
    if (v === 'useful' && item.verdict === 'drop') toast.show({ id: 'intel-' + item.id, message: 'Moved to For you. The judge learns it was wrong.', action: { label: 'Undo', verb: 'undo', run: () => void rate(item, before, 'useful') } })
  }, [serial, toast])

  const setStatus = useCallback(async (sourceId: string, status: IntelSource['status'], prevStatus?: IntelSource['status']) => {
    const prev = prevStatus ?? (sources.kind === 'ready' ? sources.data.find(s => s.id === sourceId)?.status : undefined)
    setSources(p => p.kind === 'ready' ? { kind: 'ready', data: p.data.map(s => s.id === sourceId ? { ...s, status } : s) } : p)
    const current = sources.kind === 'ready' ? sources.data.find(s => s.id === sourceId)?.status ?? null : null
    const { error, latest, restore } = await serial('src:' + sourceId, current, status, () =>
      supabase.from('intel_sources').update({ status, updated_at: new Date().toISOString() }).eq('id', sourceId))
    if (error) {
      if (latest && restore) setSources(p => p.kind === 'ready' ? { kind: 'ready', data: p.data.map(s => s.id === sourceId ? { ...s, status: restore as IntelSource['status'] } : s) } : p)
      toast.show({ message: 'Could not change that channel.', sub: error.message, tone: 'failed' })
      return
    }
    const name = srcList.find(s => s.id === sourceId)?.name ?? 'Channel'
    if (status === 'muted' && prev) toast.show({ id: 'intel-src-' + sourceId, message: `${name} muted.`, sub: 'No new videos from it get read.', action: { label: 'Undo', verb: 'undo', run: () => void setStatus(sourceId, prev, 'muted') } })
  }, [serial, sources, srcList, toast])

  const go = (t: IntelTab) => navigate(dHash('intel', null, t === 'feed' ? {} : { tab: t }))
  const title = items.kind === 'ready'
    ? (keeps.length === 0 ? 'Nothing worth your time yet.' : <>Worth watching: <N v={fresh} /> new</>)
    : 'Intel'
  const sub = items.kind === 'ready' && sources.kind === 'ready'
    ? `${following} channels read in full. ${drops.length} dropped in the last ${DROP_WINDOW_DAYS} days.`
    : undefined

  const tabs = (
    <nav className="it-tabs" aria-label="Intel views">
      {([['feed', 'For you', keeps.length], ['dropped', 'Dropped', drops.length], ['sources', 'Channels', following]] as const).map(([id, label, n]) => (
        <button key={id} type="button" className={tab === id ? 'it-on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
          {label}<i>{n}</i>
        </button>
      ))}
    </nav>
  )

  let body
  if (tab === 'sources') {
    body = sources.kind === 'loading' ? <Skeleton lines={6} label="Reading channels" />
      : sources.kind === 'failed' ? <Failed what="the channel list" detail={sources.message} onRetry={retry} />
      : <ol className="it-srcs">{srcList.map(s => <SourceRow key={s.id} s={s} onStatus={setStatus} />)}</ol>
  } else if (items.kind === 'loading') {
    body = <Skeleton lines={8} label="Reading intel" />
  } else if (items.kind === 'failed') {
    body = <Failed what="the intel feed" detail={items.message} onRetry={retry} />
  } else if (tab === 'dropped') {
    body = drops.length === 0 ? <Empty title="Nothing dropped in the last two weeks." />
      : <ol className="it-drops">{drops.map(i => (
        <li key={i.id}>
          <a href={i.url} target="_blank" rel="noreferrer"><b>{i.title}</b></a>
          <small>{i.source_name} · {ago(i.published_at)}{i.found_via === 'discovery' ? ' · search' : ''}</small>
          <p>{i.drop_reason}</p>
          {inFeed({ ...i, ivan_verdict: 'useful' }, now) && <Btn verb="intel-rescue" className="it-rescue" onClick={() => rate(i, 'useful')}>Useful after all</Btn>}
        </li>
      ))}</ol>
  } else {
    body = keeps.length === 0
      ? <Empty title="Nothing passed yet." reason="Every new video from your channels is read and judged. Most get dropped, and that is the point." action={<Btn onClick={() => go('dropped')}>See what was dropped</Btn>} />
      : <ol className="it-feed">{keeps.map(i => <Card key={i.id} i={i} onRate={rate} onMute={i.source_id ? () => void setStatus(i.source_id!, 'muted') : undefined} />)}</ol>
  }

  return (
    <div className={`it-page it-${layout}`}>
      <AnswerRow title={title} sub={sub} />
      <div className="it-scroll">
        {tabs}
        {body}
      </div>
    </div>
  )
}

function Card({ i, onRate, onMute }: { i: IntelItem; onRate: (i: IntelItem, v: 'useful' | 'noise' | null) => void; onMute?: () => void }) {
  const len = length(i.duration_sec)
  return (
    <li className={`it-card${i.ivan_verdict === 'useful' ? ' it-useful' : ''}`}>
      <div className="it-meta">
        <span className="it-src">{i.source_name}</span>
        <span>{ago(i.published_at)}</span>
        {len && <span>{len}</span>}
        {i.found_via === 'discovery' && <span className="it-new">new channel</span>}
        {i.applies_to && <span className="it-for">{i.applies_to}</span>}
      </div>
      <h3>{i.headline || i.title}</h3>
      {i.what_new && <p>{i.what_new}</p>}
      {i.try_this && <p className="it-try"><b>Try</b> {i.try_this}</p>}
      <div className="it-keys">
        <a className="it-watch" href={watchUrl(i.url, i.watch_from_sec)} target="_blank" rel="noreferrer" title={i.title}>
          {i.watch_from_sec ? `Watch from ${clock(i.watch_from_sec)}` : 'Watch'} <DIcon name="external" />
        </a>
        <Btn verb="intel-useful" className={i.ivan_verdict === 'useful' ? 'it-pressed' : ''} aria-pressed={i.ivan_verdict === 'useful'} onClick={() => onRate(i, i.ivan_verdict === 'useful' ? null : 'useful')}>Useful</Btn>
        <Btn verb="intel-noise" onClick={() => onRate(i, 'noise')}>Noise</Btn>
        {onMute && <Btn verb="intel-mute" className="it-mute" onClick={onMute}>Mute channel</Btn>}
      </div>
    </li>
  )
}

const STATUS_LABEL: Record<IntelSource['status'], string> = { core: 'Following', trial: 'On trial', muted: 'Muted', dropped: 'Dropped' }

function SourceRow({ s, onStatus }: { s: IntelSource; onStatus: (id: string, st: IntelSource['status']) => void }) {
  const live = s.status === 'core' || s.status === 'trial'
  return (
    <li className={live ? '' : 'it-off'}>
      <div className="it-st">
        <a href={s.url} target="_blank" rel="noreferrer"><b>{s.name}</b></a>
        <small>
          <span className={`it-chip it-${s.status}`}>{STATUS_LABEL[s.status]}</span>
          {s.items_kept}/{s.items_judged} kept{s.last_kept_at ? ` · last ${ago(s.last_kept_at)}` : ''}{s.topic ? ` · ${s.topic}` : ''}
        </small>
        {s.note && <small className="it-note">{s.note}</small>}
      </div>
      <div className="it-sk">
        {s.status === 'trial' && <Btn verb="intel-follow" onClick={() => onStatus(s.id, 'core')}>Follow</Btn>}
        {live
          ? <Btn verb="intel-mute" onClick={() => onStatus(s.id, 'muted')}>Mute</Btn>
          : <Btn verb="intel-unmute" onClick={() => onStatus(s.id, 'core')}>Follow again</Btn>}
      </div>
    </li>
  )
}
