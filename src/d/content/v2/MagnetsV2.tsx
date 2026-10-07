import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useResources } from '../../../hooks/useContent'
import { groupByLmStage, LM_STAGE_LABEL, stageOfLm, type LmStage, type Resource } from '../../../lib/styles'
import type { ContentLane } from '../../../lib/content'
import { ConfirmProvider } from '../../../wb/chrome/ConfirmSheet'
import { Skeleton } from '../../ui/states'
import { LANES, LANE_NAME, age, type Lane } from '../model'
import type { Trio } from '../SubNav'
import { Answer, Menu, Pill, SeatAv, Seg, type Tone } from './ui'

// CONTENT > LEAD MAGNETS, BRIEF 4 (SPEC-content §2.6). A D-native list in place
// of the legacy `wb` tree (its own H1, seat switch and 8-tab strip): one seat
// switch, three stage tabs plus More, covers at 4:5 (a sage tile with the
// format word when there is none, never an empty box), a title that is never an
// id, age on every card and a fold for anything waiting over 30 days. Read
// only, as today: opening a card mounts today's MagnetWindow unchanged (its
// keys, inline asks, field saves and the "Open the live page?" confirm).
const MagnetWindow = lazy(() => import('../../../wb/magnet').then(m => ({ default: m.MagnetWindow })))

type Tab = 'review' | 'generating' | 'published' | 'more'
const MORE_STAGES: LmStage[] = ['idea', 'approved', 'scheduled', 'error', 'archived', 'other']
const OLD_DAYS = 30
const DAY = 86_400_000

export function titleOfLm(r: Pick<Resource, 'topic' | 'format'>): string {
  const t = (r.topic ?? '').trim()
  return t || `${r.format ? r.format[0].toUpperCase() + r.format.slice(1) : 'Untitled'} lead magnet`
}

const toneOf = (s: LmStage): Tone => s === 'review' ? 'info' : s === 'error' ? 'bad' : s === 'published' ? 'ok' : s === 'approved' || s === 'scheduled' ? 'ok' : s === 'archived' ? 'queue' : 'neutral'

export function MagnetsV2({ lane, setLane, phone, magnet, clearMagnet, counts }: {
  lane: Lane; setLane: (l: Lane) => void; phone: boolean
  magnet: string | null; clearMagnet: () => void
  counts?: Trio
}) {
  const res = useResources(lane as ContentLane)
  const [tab, setTab] = useState<Tab>('review')
  const [more, setMore] = useState<LmStage>('approved')
  const [q, setQ] = useState('')
  const [old, setOld] = useState(false)
  const [open, setOpen] = useState<string | null>(magnet)
  const now = useMemo(() => Date.now(), [])
  useEffect(() => { if (magnet) setOpen(magnet) }, [magnet])
  useEffect(() => { setOld(false) }, [lane, tab])

  const stages = useMemo(() => groupByLmStage(res.rows), [res.rows])
  const inTab = (t: Tab): Resource[] => t === 'review' ? stages.review : t === 'generating' ? [...stages.generating, ...stages.generating_assets] : t === 'published' ? stages.published : stages[more]
  const needle = q.trim().toLowerCase()
  const list = inTab(tab).filter(r => !needle || titleOfLm(r).toLowerCase().includes(needle))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  const fresh = list.filter(r => now - Date.parse(r.updated_at) <= OLD_DAYS * DAY)
  const stale = list.filter(r => now - Date.parse(r.updated_at) > OLD_DAYS * DAY)
  const oldest = stages.review.length ? Math.max(...stages.review.map(r => now - Date.parse(r.updated_at))) : 0
  const close = () => { setOpen(null); if (magnet) clearMagnet() }
  const queue = list.map(r => ({ id: r.id, title: r.topic ?? 'Untitled', type: r.format, updated_at: r.updated_at, status: r.status }))
  const loading = res.loading && !res.loadedAt

  const card = (r: Resource, i: number) => {
    const st = stageOfLm(r)
    const late = (st === 'approved' || st === 'scheduled' || st === 'published') && !r.landing_url
    return (
      <article key={r.id} className={`cv2-lm${open === r.id ? ' cv2-lm-on' : ''}`} data-magnet-id={r.id} style={{ '--i': Math.min(i, 8) } as React.CSSProperties}>
        <button type="button" className="cv2-lm-main" data-verb="magnet-open" onClick={() => setOpen(r.id)} aria-label={`Open ${titleOfLm(r)}`}>
          <span className="cv2-lm-cover">{r.cover_url ? <img src={r.cover_url} alt="" loading="lazy" /> : <span className="cv2-lm-none">{r.format ?? 'Lead magnet'}</span>}</span>
          <span className="cv2-lm-t">{titleOfLm(r)}</span>
          <span className="cv2-lm-m"><span>{r.format ?? 'Resource'} · {age(r.updated_at, now)}</span><Pill tone={toneOf(st)}>{LM_STAGE_LABEL[st]}</Pill></span>
          {late && <span className="cv2-lm-warn">No landing page yet</span>}
        </button>
        <span className="cv2-lm-more"><Menu label="More for this lead magnet" verb="magnet-more" head={<span>Id {r.id.slice(0, 8)}</span>}
          items={[{ key: 'open', label: 'Open', run: () => setOpen(r.id) }, ...(r.landing_url ? [{ key: 'live', label: 'Live page ↗', href: r.landing_url, external: true }] : [])]} /></span>
      </article>
    )
  }

  return (
    <section className={`cv2 cv2-lms${phone ? ' cv2-phone' : ''}`} aria-label="Lead magnets" data-cv2="lms">
      <div className="cv2-bar">
        <Seg label="Client" verb="magnet-lane" value={lane} onChange={id => { setLane(id as Lane); setOpen(null) }}
          options={LANES.map(l => ({ id: l, label: <><SeatAv lane={l} />{LANE_NAME[l]}</>, count: counts ? (counts[l] === undefined ? '…' : counts[l] ?? '–') : null }))} />
        <Seg label="Stage" verb="magnet-tab" size="sm" value={tab} onChange={id => setTab(id as Tab)}
          options={[{ id: 'review', label: 'Needs review', count: stages.review.length }, { id: 'generating', label: 'Generating', count: stages.generating.length + stages.generating_assets.length }, { id: 'published', label: 'Live', count: stages.published.length }, { id: 'more', label: tab === 'more' ? LM_STAGE_LABEL[more] : 'More' }]} />
        {tab === 'more' && (
          <select className="cv2-select" aria-label="Other stage" value={more} onChange={e => setMore(e.target.value as LmStage)}>
            {MORE_STAGES.map(s => <option key={s} value={s}>{LM_STAGE_LABEL[s]} · {stages[s].length}</option>)}
          </select>
        )}
        <span className="cv2-grow" />
        <input className="cv2-search" type="search" value={q} placeholder="Search" aria-label="Search lead magnets" onChange={e => setQ(e.target.value)} />
      </div>
      <Answer>{loading ? 'Reading lead magnets…' : res.error ? 'Lead magnets could not be read.'
        : stages.review.length ? <>{stages.review.length} wait for review. Oldest {Math.floor(oldest / DAY)} days.{stages.error.length ? ` ${stages.error.length} errored.` : ''}</>
          : <>Nothing waits for review.{stages.error.length ? ` ${stages.error.length} errored.` : ''}</>}</Answer>
      {res.error && <div className="cv2-banner cv2-banner-bad" role="alert"><span>{res.error}</span><button type="button" onClick={res.refresh}>Retry</button></div>}
      {loading ? <Skeleton lines={4} title={false} label="Reading lead magnets" />
        : list.length === 0 ? <div className="cv2-empty"><b>{needle ? 'Nothing matches the search.' : `Nothing at ${tab === 'more' ? LM_STAGE_LABEL[more].toLowerCase() : tab === 'published' ? 'live' : LM_STAGE_LABEL[tab === 'generating' ? 'generating' : 'review'].toLowerCase()}.`}</b></div>
          : <>
            {fresh.length > 0 && <div className="cv2-lm-grid">{fresh.map(card)}</div>}
            {stale.length > 0 && (
              <section className="cv2-sec" aria-label={`Waiting over ${OLD_DAYS} days`}>
                <button type="button" className="cv2-foldrow" aria-expanded={old} data-verb="magnet-old" onClick={() => setOld(o => !o)}>
                  <span className="cv2-h">Waiting over {OLD_DAYS} days · {stale.length}</span><span className="cv2-grow" /><span>{old ? 'Hide' : 'Show'}</span>
                </button>
                {old && <div className="cv2-lm-grid">{stale.map(card)}</div>}
              </section>
            )}
          </>}
      {open && (
        <div className="cn-legacy app wb ds-shell wb-work cv2-lm-window" data-wblane={lane}>
          <ConfirmProvider>
            <Suspense fallback={<Skeleton lines={6} label="Reading the lead magnet" />}>
              <MagnetWindow id={open} lane={lane as ContentLane} queue={queue} mobile={phone} onClose={close} onPick={id => setOpen(id)} />
            </Suspense>
          </ConfirmProvider>
        </div>
      )}
    </section>
  )
}
