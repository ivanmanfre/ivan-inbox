import { BrainDraftBadge } from './BrainDraftBadge'
import { useEffect, useRef, useState } from 'react'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { RetryDraft } from '../../wb/content/actions'
import type { ContentDraft } from '../../lib/content'
import { useFrameMaybe } from '../shell/frame'
import { Failed, Skeleton } from '../ui/states'
import { warsawDay, warsawHm } from '../ui/time'
import { LANE_NAME, age, dayLabel, ptOf, type Lane } from './model'
import { MovePanel } from './MovePanel'
import type { WeekRead } from './useWeek'
import { PRIMARY_LABEL, SHOWS, foldText, type Show, type Week as WeekModel, type WeekCard } from './weekModel'
import { useWeekVerbs } from './weekVerbs'
import { EarlyReadChip } from './EarlyReadChip'
import { useEarlyReads } from './useEarlyReads'
import type { PatternRead } from '../../lib/earlyReads'
import { VerdictStrip } from './VerdictStrip'
import { markShown, useJudged } from './verdictStore'
import './week.css'
import './verdict.css'

// CONTENT > REVIEW: THIS WEEK. One stack across the three seats, by day (today
// first), then what is still in review with no date this week. A chip row
// filters by seat. Each card: seat, time, the picture at its own shape, the
// post's first lines with LinkedIn's "…see more", its flags, and ONE key.
//
// A BRAIN DRAFT still to judge carries two keys instead: Drop and Approve (run 39). One tap, then a strip in the
// card's place with Undo (5 s); after Drop, the why is one more tap. Approve on Ivan's seat approves it (nothing publishes);
// Approve on Rise or Arch records the verdict only; Drop deletes (or archives).
// The keys: Approve (Ivan, one tap, Undo for 8 s, then the next card), Put on
// board (Rise, confirmed: it reaches Mattan), Schedule (Ivan, confirmed: it goes
// out on LinkedIn), Open (everything else). The date control (Ivan, Rise) is
// today's move sheet, operator_set_schedule_date, the day only. An ARCH card is
// view only (Open + picture): no Approve, Skip, board or date key on the card.
// The open post and the Planner keep every Arch control they had.
// Quick filters (21st.dev data-table move, 30 Sep): the same stack cut by what needs a person, with live counts.
type Quick = 'all' | 'decide' | 'flagged' | 'noimg'
const QUICK: [Quick, string, (c: WeekCard) => boolean][] = [
  ['all', 'Everything', () => true],
  ['decide', 'To decide', c => c.primary !== 'open'],
  ['flagged', 'Flagged', c => c.flags.some(f => f.tone === 'warn')],
  ['noimg', 'No image', c => c.flags.some(f => f.key === 'noimg')],
]

const SHOW_LABEL: Record<Show, string> = { all: 'All', ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' }

export function WeekStack({ week, read, show, setShow, now, openId, onOpen, onChanged, firstDay, seatRows, nowView = false }: {
  nowView?: boolean
  week: WeekModel
  read: WeekRead
  show: Show
  setShow: (s: Show) => void
  now: number
  openId: string | null
  onOpen: (id: string, lane: Lane) => void
  /** After a write lands: refetch the week and the seats. */
  onChanged: () => void
  /** The planner's first Monday (the move sheet's fourteen days start there). */
  firstDay: string
  /** A seat's rows, for the move sheet's "has a post" days. */
  seatRows: (lane: Lane) => ContentDraft[]
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [moving, setMoving] = useState<WeekCard | null>(null)
  const [showOld, setShowOld] = useState(false)
  const [quick, setQuick] = useState<Quick>('all')
  const earlyReads = useEarlyReads([...week.groups.flatMap(g => g.cards), ...week.older].map(c => c.r))
  const judged = useJudged()

  const { judgeIt, act } = useWeekVerbs({ ids: week.ids, onChanged, onOpen, setBusy })

  const all = [...week.groups.flatMap(g => g.cards), ...week.older]
  const qn = Object.fromEntries(QUICK.map(([k, , f]) => [k, all.filter(f).length])) as Record<Quick, number>
  const qf = (QUICK.find(x => x[0] === quick) ?? QUICK[0])[2]
  const groups = quick === 'all' ? week.groups : week.groups.map(g => ({ ...g, cards: g.cards.filter(qf) })).filter(g => g.cards.length)
  const older = quick === 'all' ? week.older : week.older.filter(qf)
  // An open strip whose draft has left the list (a refetch, the brain's visibility recheck, a dropped row that is
  // gone) must not vanish with it: it stands at the top of Drafts, in the order they were judged.
  const inList = new Set(all.map(c => c.r.id))
  const orphans = nowView ? [...judged.values()]
    .filter(e => !e.collapsed && !inList.has(e.id) && (show === 'all' || show === e.lane))
    .sort((a, b) => a.at - b.at) : []
  const orphanStrips = orphans.map(e => <VerdictStrip key={e.id} e={e} />)
  const empty = groups.length === 0 && older.length === 0 && orphans.length === 0
  const cards = (list: WeekCard[], dayed: boolean) => list.map(c => {
    const e = c.strip ? judged.get(c.r.id) : undefined
    if (e) return <VerdictStrip key={c.r.id} e={e} />
    return (
      <Card key={c.r.id} c={c} when={whenOf(c, now, dayed)} open={c.r.id === openId} busy={busy === c.r.id}
        read={earlyReads.get(c.r.id)} nowView={nowView} onChanged={onChanged} onOpen={() => onOpen(c.r.id, c.lane)} onKey={() => act(c)} onDate={() => setMoving(c)}
        onJudge={v => { void judgeIt(c, v) }} />
    )
  })

  return (
    <section className="cn-wk2" aria-label={nowView ? "Needs your tap" : "This week"}>
      <div className="cn-wk2-chips" role="tablist" aria-label="Seat">
        {SHOWS.map(s => (
          <button key={s} type="button" role="tab" aria-selected={s === show} data-verb={`show-${s}`} onClick={() => setShow(s)}>
            {SHOW_LABEL[s]}{!nowView && s !== 'all' && <b>{week.perLane[s]}</b>}
          </button>
        ))}
      </div>
      {nowView && week.toJudge > 0 && (
        <p className="cn-judge-line" role="status"><b>{week.toJudge}</b> brain draft{week.toJudge === 1 ? '' : 's'} to judge · Approve or Drop on each card</p>
      )}
      {!nowView && all.length > 0 && (
        <div className="cn-wk2-quick" role="tablist" aria-label="Filter the stack">
          {QUICK.filter(([k]) => k === 'all' || k === quick || qn[k] > 0).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={k === quick} data-verb={`quick-${k}`} onClick={() => setQuick(k)}>
              {label}<b>{qn[k]}</b>
            </button>
          ))}
        </div>
      )}
      <Sync read={read} />
      {show === 'arch' && (
        <p className="cn-wk2-note">Arch posts go out only after Davorin approves them on his panel. A card says when one is still waiting for his OK.</p>
      )}
      {read.source === 'none' && !read.settled ? <Skeleton lines={6} title={false} label="Reading this week" />
        : read.source === 'none' && read.error ? <Failed what="this week's posts" detail={read.error} onRetry={read.refresh} />
          : empty ? (
            <p className="cn-wk2-empty">{quick !== 'all' ? 'Nothing matches this filter.' : show === 'all' ? (nowView ? "No drafts need you." : 'Nothing this week, and nothing waits in review.') : `Nothing of ${SHOW_LABEL[show]}’s this week, and nothing in review.`}</p>
          ) : (
            <>
              {groups.map(g => (
                <section key={g.key} className={`cn-wk2-g cn-wk2-${g.kind}${g.key === 'fix' ? ' cn-needs-fix' : ''}`} aria-label={`${g.label}${g.date ? `, ${g.date}` : ''}`}>
                  <h2 className="cn-wk2-h"><b>{g.label}</b>{g.date && <span>{g.kind === 'review' ? g.date : g.date.replace(/^\w+ /, '')}</span>}{!nowView && <i>{g.cards.length}</i>}</h2>
                  {g.key === 'drafts' && orphanStrips}
                  {cards(g.cards, g.kind !== 'review')}
                </section>
              ))}
              {orphans.length > 0 && !groups.some(g => g.key === 'drafts') && (
                <section className="cn-wk2-g cn-wk2-review" aria-label="Drafts">
                  <h2 className="cn-wk2-h"><b>Drafts</b></h2>
                  {orphanStrips}
                </section>
              )}
              {older.length > 0 && (
                <section className="cn-wk2-g" aria-label="Older than two weeks">
                  <div className="cn-wk2-fold">
                    <span>In review, older than two weeks</span>
                    <button type="button" data-verb="show-older" aria-expanded={showOld} onClick={() => setShowOld(o => !o)}>{older.length} · {showOld ? 'Hide' : 'Show'}</button>
                  </div>
                  {showOld && cards(older, false)}
                </section>
              )}
            </>
          )}
      {moving && (
        <MovePanel key={moving.r.id} r={moving.r} lane={moving.lane} first={firstDay} seatRows={seatRows(moving.lane)} phone quickCommit={nowView}
          onClose={() => setMoving(null)} onDone={onChanged} />
      )}
    </section>
  )
}

function Sync({ read }: { read: WeekRead }) {
  if (read.memberReadState && read.memberReadState !== 'idle') return <p className="cn-wk2-sync" role="status">{read.memberReadState === 'pending' ? 'Checking brain draft visibility.' : read.memberReadState === 'failed' ? 'Brain drafts are hidden until visibility can be verified.' : 'Brain draft visibility checked. Full week refresh is still available.'} <button type="button" onClick={read.refresh}>Refresh week</button></p>
  if (read.source === 'cache') {
    return <p className="cn-wk2-sync" role="status">Saved copy {read.at ? warsawHm(read.at) : ''}{read.error ? <> · could not refresh: {read.error} <button type="button" onClick={read.refresh}>Retry</button></> : ' · refreshing…'}</p>
  }
  if (read.source === 'live' && read.error) {
    return <p className="cn-wk2-sync cn-wk2-bad" role="alert">Could not refresh: {read.error} <button type="button" onClick={read.refresh}>Retry</button></p>
  }
  if (read.capped) return <p className="cn-wk2-sync cn-wk2-bad" role="status">Showing the newest 1,000 of {read.capped.toLocaleString('en-US')} rows.</p>
  return null
}

/** Inside a day group the header already names the day, so the card says the time only (Rise: Pacific too). */
function whenOf(c: WeekCard, now: number, dayed: boolean): string {
  const at = c.r.scheduled_at
  if (!at) return `created ${age(c.r.created_at, now)} ago`
  const hm = c.lane === 'risedtc' ? `${warsawHm(at)} · ${ptOf(at)}` : warsawHm(at)
  return dayed && !c.overdue ? hm : `${dayLabel(warsawDay(at))}, ${hm}`
}

function Card({ c, when, open, busy, onOpen, onKey, onDate, onJudge, nowView, onChanged, read }: {
  read?: PatternRead
  onJudge: (v: 'keep' | 'drop') => void
  nowView: boolean
  onChanged: () => void
  c: WeekCard; when: string; open: boolean; busy: boolean
  onOpen: () => void; onKey: () => void; onDate: () => void
}) {
  const [more, setMore] = useState(false)
  const [broken, setBroken] = useState(false)
  // The feed's three lines hold about 40 characters each at phone width, about 90 on the desktop column.
  const wide = useFrameMaybe()?.layout === 'desktop'
  const fold = foldText(c.body, 3, wide ? 90 : 40)
  const decision = c.primary !== 'open'
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  // Time to verdict starts when a card to judge is first half on screen (once per draft).
  const ref = useRef<HTMLElement>(null)
  const judgeable = c.judge
  const id = c.r.id
  useEffect(() => {
    if (!judgeable) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { markShown(id); return }
    const io = new IntersectionObserver(entries => {
      if (entries.some(en => en.isIntersecting)) { markShown(id); io.disconnect() }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [judgeable, id])
  return (
    <article ref={ref} className={`cn-wc${open ? ' cn-wc-on' : ''}`} data-card-id={c.r.id} data-lane={c.lane} aria-current={open ? 'true' : undefined}>
      <div className="cn-wc-meta">
        <span className={`cn-wc-lane cn-wc-l-${c.lane}`}>{LANE_NAME[c.lane]}</span>
        <span className="cn-wc-when">{when}</span>
        <EarlyReadChip read={read} lane={c.lane} />
        {c.flags.filter(f => f.key !== 'qa' || f.tone === 'warn').map(f => <span key={f.key} className={`cn-wc-flag cn-wc-${f.tone}`} title={f.title}>{f.text}</span>)}
      </div>
      <div className="cn-wc-main" onClick={onOpen}>
        <div className="cn-wc-text">
          <button type="button" className="cn-wc-title" data-verb="card-open" onClick={e => { stop(e); onOpen() }}>{c.title}</button>
          {c.body.trim() && (
            <p className="cn-wc-body">
              {(more ? c.body.trim() : fold.head).replace(/\n{2,}/g, '\n')}
              {fold.folded && !more && <>{' '}<button type="button" className="cn-wc-more" data-verb="see-more" onClick={e => { stop(e); setMore(true) }}>…see more</button></>}
            </p>
          )}
        </div>
        {c.thumb && !broken ? (
          <button type="button" className="cn-wc-pic" aria-label="Open the post" onClick={e => { stop(e); onOpen() }}>
            <img src={c.thumb} alt="" loading="lazy" onError={() => setBroken(true)} />
          </button>
        ) : <span className="cn-wc-nopic" aria-hidden="true">Text</span>}
      </div>
      <BrainDraftBadge draft={c.r} />
      <div className={`cn-wc-acts${c.judge ? ' cn-wc-acts-j' : ''}`}>
        {c.canDate && (
          <button type="button" className="cn-wc-date" data-verb="card-date" onClick={onDate} disabled={busy}>
            {c.r.scheduled_at ? 'Move date' : 'Add a date'}
          </button>
        )}
        {nowView && c.lane !== 'arch' && c.flags.some(f => ['blocked', 'stuck', 'stalled', 'error'].includes(f.key)) && <ConfirmProvider><RetryDraft d={c.r} lane={c.lane} onDone={onChanged} label="Fix" /></ConfirmProvider>}
        <span className="cn-grow" />
        {/* A card to judge has four keys: on the phone the title and the picture already open the post, so Open goes. */}
        {nowView && (c.judge ? wide : decision) && <button type="button" className="cn-wc-date" data-verb="card-open" onClick={onOpen}>Open</button>}
        {c.judge ? (
          <>
            <button type="button" className="cn-wc-key cn-judge-key" data-verb="card-drop" disabled={busy} onClick={() => onJudge('drop')}>Drop</button>
            <button type="button" className="cn-wc-key cn-wc-key-d cn-judge-key cn-judge-keep" data-verb="card-keep" disabled={busy} onClick={() => onJudge('keep')}>Approve</button>
          </>
        ) : (
          <button type="button" className={`cn-wc-key${decision ? ' cn-wc-key-d' : ''}`} data-verb={`card-${c.primary}`} disabled={busy} onClick={onKey}>
            {busy ? 'Working…' : PRIMARY_LABEL[c.primary]}
          </button>
        )}
      </div>
    </article>
  )
}
