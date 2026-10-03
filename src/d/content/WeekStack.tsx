import { BrainDraftBadge } from './BrainDraftBadge'
import { useCallback, useState } from 'react'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { RetryDraft } from '../../wb/content/actions'
import { setBoardVisible, type ContentDraft } from '../../lib/content'
import { useFrameMaybe } from '../shell/frame'
import { useDConfirm } from '../ui/confirm'
import { Failed, Skeleton } from '../ui/states'
import { useToast } from '../ui/toast'
import { warsawDay, warsawDayTime, warsawHm } from '../ui/time'
import { HOLD_MS, holdDecision, undoDecision } from './decisions'
import { LANE_NAME, OWNER, POSS, age, dayLabel, ptOf, type Lane } from './model'
import { MovePanel } from './MovePanel'
import type { WeekRead } from './useWeek'
import { PRIMARY_LABEL, SHOWS, foldText, type Show, type Week as WeekModel, type WeekCard } from './weekModel'
import { scheduleGuarded } from './writes'
import { EarlyReadChip } from './EarlyReadChip'
import { useEarlyReads } from './useEarlyReads'
import type { PatternRead } from '../../lib/earlyReads'
import { VerdictStrip } from './VerdictStrip'
import { judge, useJudged } from './verdictStore'
import './week.css'
import './verdict.css'

// CONTENT > REVIEW: THIS WEEK. One stack across the three seats, by day (today
// first), then what is still in review with no date this week. A chip row
// filters by seat. Each card: seat, time, the picture at its own shape, the
// post's first lines with LinkedIn's "…see more", its flags, and ONE key.
//
// A BRAIN DRAFT still to judge carries two keys instead: Drop and Keep (run 39). One tap, then a strip in the
// card's place with Undo (5 s) and the why, one more tap. Keep on Ivan's seat approves it (nothing publishes);
// Keep on Rise or Arch records the verdict only; Drop deletes (or archives). Arch stays view only otherwise.
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
  const toast = useToast()
  const confirm = useDConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [moving, setMoving] = useState<WeekCard | null>(null)
  const [showOld, setShowOld] = useState(false)
  const [quick, setQuick] = useState<Quick>('all')
  const earlyReads = useEarlyReads([...week.groups.flatMap(g => g.cards), ...week.older].map(c => c.r))
  const judged = useJudged()

  // Auto-advance: the next card's key takes the focus (and comes into view) once this one has moved on.
  const advance = useCallback((id: string) => {
    const i = week.ids.indexOf(id)
    const next = i >= 0 ? week.ids.slice(i + 1).find(x => x !== id) : null
    if (!next) return
    requestAnimationFrame(() => {
      const at = document.querySelector<HTMLElement>(`[data-card-id="${next}"]`)
      // Keep is the safe key of the pair (it never publishes), so it takes the focus on a card to judge.
      const el = at?.querySelector<HTMLElement>('.cn-wc-key-d') ?? at?.querySelector<HTMLElement>('.cn-wc-key')
      if (!el) return
      el.focus({ preventScroll: true })
      el.closest('article')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    })
  }, [week.ids])

  const approve = useCallback((c: WeekCard) => {
    const id = c.r.id
    holdDecision(id, 'approve', {
      onCommitted: onChanged,
      onFailed: e => { toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'The approve did not go through.', sub: 'It is back in review.' }); onChanged() },
    })
    toast.show({
      id: `decide-${id}`, ms: HOLD_MS, message: 'Approved.', sub: c.r.scheduled_at ? 'Nothing publishes until it is scheduled.' : 'Nothing publishes: it has no date yet.',
      action: { label: 'Undo', verb: 'undo-decision', run: () => { if (!undoDecision(id)) toast.show({ message: 'Too late to undo: it was already written.' }) } },
    })
    advance(id)
  }, [advance, onChanged, toast])

  const board = useCallback(async (c: WeekCard) => {
    const lane = c.lane
    const ok = await confirm({
      title: `Put this on ${POSS[lane]} board?`,
      message: `${OWNER[lane]} sees it. This reaches a client: it fires his board’s own sync, so it lands within moments. `
        + 'From there the decisions are his: approve, edit, veto, schedule. Nothing publishes, this writes board visibility only.',
      confirmText: 'Put it on his board', verb: 'confirm',
    })
    if (!ok) return
    setBusy(c.r.id)
    try {
      await setBoardVisible(c.r.id, true)
      toast.show({
        message: `On ${POSS[lane]} board.`, sub: `${OWNER[lane]} decides from there.`,
        action: { label: 'Undo', verb: 'undo-board', run: () => {
          setBoardVisible(c.r.id, false).then(() => { toast.show({ message: `Off ${POSS[lane]} board.`, sub: 'Nothing was deleted.' }); onChanged() })
            .catch(e => toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'Could not take it off.' }))
        } },
      })
      onChanged(); advance(c.r.id)
    } catch (e) {
      toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'Could not put it on the board.' })
    } finally { setBusy(null) }
  }, [advance, confirm, onChanged, toast])

  const schedule = useCallback(async (c: WeekCard) => {
    if (!c.r.scheduled_at) { onOpen(c.r.id, c.lane); return }
    const at = new Date(c.r.scheduled_at)
    const ok = await confirm({
      title: 'Put this post on LinkedIn?',
      message: `The publisher posts this on ${at.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. This is not an internal mark, it goes out on LinkedIn.`,
      confirmText: 'Schedule it', verb: 'confirm',
    })
    if (!ok) return
    setBusy(c.r.id)
    try { await scheduleGuarded(c.r.id, at.toISOString()); toast.show({ message: `Armed for ${warsawDayTime(at)} Warsaw.`, sub: 'The publisher posts it then.' }); onChanged(); advance(c.r.id) }
    catch (e) { toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'Could not arm it.' }) }
    finally { setBusy(null) }
  }, [advance, confirm, onChanged, onOpen, toast])

  // Keep / Drop: one tap, held for the Undo window (verdictStore). The one question is the QA override:
  // Keep on Ivan's seat approves, and a draft QA refused must say so first.
  const judgeIt = useCallback(async (c: WeekCard, verdict: 'keep' | 'drop') => {
    if (verdict === 'keep' && c.lane === 'ivan' && c.r.status === 'error') {
      const ok = await confirm({
        title: 'Approve this draft anyway?',
        message: 'QA refused this one. Approving overrides that verdict. Nothing publishes, scheduling is the separate act below.',
        confirmText: 'Approve', verb: 'confirm',
      })
      if (!ok) return
    }
    judge(c.r.id, verdict, { lane: c.lane, title: c.title, onCommitted: onChanged })
    advance(c.r.id)
  }, [advance, confirm, onChanged])

  const act = (c: WeekCard) => {
    if (c.primary === 'approve') approve(c)
    else if (c.primary === 'board') void board(c)
    else if (c.primary === 'schedule') void schedule(c)
    else onOpen(c.r.id, c.lane)
  }

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
        <p className="cn-judge-line" role="status"><b>{week.toJudge}</b> brain draft{week.toJudge === 1 ? '' : 's'} to judge · Keep or Drop on each card</p>
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
        <p className="cn-wk2-note">Arch cards here are view only: Davorin reviews his posts on Friday and his publisher posts from review. Open a post for its board, date and picture controls.</p>
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
  if (read.capped) return <p className="cn-wk2-sync cn-wk2-bad" role="status">Showing the newest 1,000 of {read.capped} rows.</p>
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
  return (
    <article className={`cn-wc${open ? ' cn-wc-on' : ''}`} data-card-id={c.r.id} data-lane={c.lane} aria-current={open ? 'true' : undefined}>
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
            <button type="button" className="cn-wc-key cn-wc-key-d cn-judge-key cn-judge-keep" data-verb="card-keep" disabled={busy} onClick={() => onJudge('keep')}>Keep</button>
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
