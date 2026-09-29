import { useCallback, useState } from 'react'
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
import './week.css'

// CONTENT > REVIEW: THIS WEEK. One stack across the three seats, by day (today
// first), then what is still in review with no date this week. A chip row
// filters by seat. Each card: seat, time, the picture at its own shape, the
// post's first lines with LinkedIn's "…see more", its flags, and ONE key.
//
// The keys: Approve (Ivan, one tap, Undo for 8 s, then the next card), Put on
// board (Rise, confirmed: it reaches Mattan), Schedule (Ivan, confirmed: it goes
// out on LinkedIn), Open (everything else). The date control (Ivan, Rise) is
// today's move sheet, operator_set_schedule_date, the day only. An ARCH card is
// view only (Open + picture): no Approve, Skip, board or date key on the card.
// The open post and the Planner keep every Arch control they had.
const SHOW_LABEL: Record<Show, string> = { all: 'All', ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' }

export function WeekStack({ week, read, show, setShow, now, openId, onOpen, onChanged, firstDay, seatRows }: {
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

  // Auto-advance: the next card's key takes the focus (and comes into view) once this one has moved on.
  const advance = useCallback((id: string) => {
    const i = week.ids.indexOf(id)
    const next = i >= 0 ? week.ids.slice(i + 1).find(x => x !== id) : null
    if (!next) return
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-card-id="${next}"] .cn-wc-key`)
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

  const act = (c: WeekCard) => {
    if (c.primary === 'approve') approve(c)
    else if (c.primary === 'board') void board(c)
    else if (c.primary === 'schedule') void schedule(c)
    else onOpen(c.r.id, c.lane)
  }

  const empty = week.groups.length === 0 && week.older.length === 0
  const cards = (list: WeekCard[], dayed: boolean) => list.map(c => (
    <Card key={c.r.id} c={c} when={whenOf(c, now, dayed)} open={c.r.id === openId} busy={busy === c.r.id}
      onOpen={() => onOpen(c.r.id, c.lane)} onKey={() => act(c)} onDate={() => setMoving(c)} />
  ))

  return (
    <section className="cn-wk2" aria-label="This week">
      <div className="cn-wk2-chips" role="tablist" aria-label="Seat">
        {SHOWS.map(s => (
          <button key={s} type="button" role="tab" aria-selected={s === show} data-verb={`show-${s}`} onClick={() => setShow(s)}>
            {SHOW_LABEL[s]}{s !== 'all' && <b>{week.perLane[s]}</b>}
          </button>
        ))}
      </div>
      <Sync read={read} />
      {show === 'arch' && (
        <p className="cn-wk2-note">Arch cards here are view only: Davorin reviews his posts on Friday and his publisher posts from review. Open a post for its board, date and picture controls.</p>
      )}
      {read.source === 'none' && !read.settled ? <Skeleton lines={6} title={false} label="Reading this week" />
        : read.source === 'none' && read.error ? <Failed what="this week's posts" detail={read.error} onRetry={read.refresh} />
          : empty ? (
            <p className="cn-wk2-empty">{show === 'all' ? 'Nothing this week, and nothing waits in review.' : `Nothing of ${SHOW_LABEL[show]}’s this week, and nothing in review.`}</p>
          ) : (
            <>
              {week.groups.map(g => (
                <section key={g.key} className={`cn-wk2-g cn-wk2-${g.kind}`} aria-label={`${g.label}${g.date ? `, ${g.date}` : ''}`}>
                  <h2 className="cn-wk2-h"><b>{g.label}</b>{g.date && <span>{g.kind === 'review' ? g.date : g.date.replace(/^\w+ /, '')}</span>}<i>{g.cards.length}</i></h2>
                  {cards(g.cards, g.kind !== 'review')}
                </section>
              ))}
              {week.older.length > 0 && (
                <section className="cn-wk2-g" aria-label="Older than two weeks">
                  <div className="cn-wk2-fold">
                    <span>In review, older than two weeks</span>
                    <button type="button" data-verb="show-older" aria-expanded={showOld} onClick={() => setShowOld(o => !o)}>{week.older.length} · {showOld ? 'Hide' : 'Show'}</button>
                  </div>
                  {showOld && cards(week.older, false)}
                </section>
              )}
            </>
          )}
      {moving && (
        <MovePanel key={moving.r.id} r={moving.r} lane={moving.lane} first={firstDay} seatRows={seatRows(moving.lane)} phone
          onClose={() => setMoving(null)} onDone={onChanged} />
      )}
    </section>
  )
}

function Sync({ read }: { read: WeekRead }) {
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
  if (!at) return `in review ${age(c.r.created_at, now)}`
  const hm = c.lane === 'risedtc' ? `${warsawHm(at)} · ${ptOf(at)}` : warsawHm(at)
  return dayed && !c.overdue ? hm : `${dayLabel(warsawDay(at))}, ${hm}`
}

function Card({ c, when, open, busy, onOpen, onKey, onDate }: {
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
        {c.flags.map(f => <span key={f.key} className={`cn-wc-flag cn-wc-${f.tone}`} title={f.title}>{f.text}</span>)}
      </div>
      <div className="cn-wc-main" onClick={onOpen}>
        <div className="cn-wc-text">
          <button type="button" className="cn-wc-title" data-verb="card-open" onClick={e => { stop(e); onOpen() }}>{c.title}</button>
          {c.body.trim() && (
            <p className="cn-wc-body">
              {more ? c.body.trim() : fold.head}
              {fold.folded && !more && <>{' '}<button type="button" className="cn-wc-more" data-verb="see-more" onClick={e => { stop(e); setMore(true) }}>…see more</button></>}
            </p>
          )}
        </div>
        {c.thumb && !broken && (
          <button type="button" className="cn-wc-pic" aria-label="Open the post" onClick={e => { stop(e); onOpen() }}>
            <img src={c.thumb} alt="" loading="lazy" onError={() => setBroken(true)} />
          </button>
        )}
      </div>
      <div className="cn-wc-acts">
        {c.canDate && (
          <button type="button" className="cn-wc-date" data-verb="card-date" onClick={onDate} disabled={busy}>
            {c.r.scheduled_at ? 'Move date' : 'Add a date'}
          </button>
        )}
        <span className="cn-grow" />
        <button type="button" className={`cn-wc-key${decision ? ' cn-wc-key-d' : ''}`} data-verb={`card-${c.primary}`} disabled={busy} onClick={onKey}>
          {busy ? 'Working…' : PRIMARY_LABEL[c.primary]}
        </button>
      </div>
    </article>
  )
}
